import json
from collections import defaultdict

from . import api, gamescore
from .shifts import group_by_period, mmss_to_sec, on_ice_at

SHOT_ATTEMPT_TYPES = {"goal", "shot-on-goal", "missed-shot", "blocked-shot"}
FULL_STRENGTH_5V5 = "1551"


def _shooter_id(details: dict) -> int | None:
    return details.get("scoringPlayerId") or details.get("shootingPlayerId")


def _opposite_zone(zone: str) -> str:
    return {"O": "D", "D": "O"}.get(zone, zone)


def retally_goals_shots(conn, game_id: int) -> None:
    """Idempotently reset each player's goals/shots for a game from stored
    events, excluding the shootout. Used to repair games ingested before the
    shootout exclusion existed, without re-fetching from the API."""
    rows = conn.execute(
        "SELECT type, details_json FROM events WHERE game_id = ? AND period < 5 AND type IN ('goal', 'shot-on-goal')",
        (game_id,),
    ).fetchall()
    goals: dict[int, int] = defaultdict(int)
    shots: dict[int, int] = defaultdict(int)
    for etype, details_json in rows:
        d = json.loads(details_json)
        if etype == "goal":
            goals[d["scoringPlayerId"]] += 1
            shots[d["scoringPlayerId"]] += 1
        else:
            shots[d["shootingPlayerId"]] += 1
    conn.execute("UPDATE player_game_stats SET goals = 0, shots = 0 WHERE game_id = ?", (game_id,))
    for pid in set(goals) | set(shots):
        conn.execute(
            "UPDATE player_game_stats SET goals = ?, shots = ? WHERE game_id = ? AND player_id = ?",
            (goals[pid], shots[pid], game_id, pid),
        )
    conn.commit()


class NotReady(ValueError):
    """The NHL hasn't finished posting this game yet (play-by-play or shift chart). Not an error: the game is tried again on the next run."""


def ingest_game(conn, game_id: int, require_complete: bool = False) -> None:
    pbp = api.get_play_by_play(game_id)
    if require_complete and not any(p.get("typeDescKey") == "game-end" for p in pbp.get("plays", [])):
        # the NHL sometimes serves a finished game's play-by-play before it is complete (a game stored that way shows 0-0 with no goals);
        # refuse before touching the database so the game stays "new" and is fetched again on the next pass
        raise NotReady(f"play-by-play for game {game_id} is not complete yet (no game-end event)")
    # delete-before-insert makes re-running the backfill on an already-ingested
    # game safe instead of duplicating shift/event rows
    conn.execute("DELETE FROM shifts WHERE game_id = ?", (game_id,))
    conn.execute("DELETE FROM events WHERE game_id = ?", (game_id,))

    conn.execute(
        """INSERT OR REPLACE INTO games
           (game_id, season, game_date, home_team_id, away_team_id,
            home_team_abbrev, away_team_abbrev)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            game_id,
            str(pbp["season"]),
            pbp["gameDate"],
            pbp["homeTeam"]["id"],
            pbp["awayTeam"]["id"],
            pbp["homeTeam"]["abbrev"],
            pbp["awayTeam"]["abbrev"],
        ),
    )

    player_team: dict[int, int] = {}
    for rs in pbp["rosterSpots"]:
        player_team[rs["playerId"]] = rs["teamId"]
        conn.execute(
            # an upsert, not INSERT OR REPLACE: that would wipe the stored shooting hand on every re-ingest
            "INSERT INTO players (player_id, first_name, last_name, position) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(player_id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name, "
            "position = excluded.position",
            (
                rs["playerId"],
                rs["firstName"]["default"],
                rs["lastName"]["default"],
                rs["positionCode"],
            ),
        )

    shift_rows_raw = api.get_shifts(game_id)
    if require_complete and not shift_rows_raw:
        # a game that just ended often has no shift chart yet; storing it now would publish half-empty cards and wait hours for a retry, so refuse
        # (the game stays "new" and is tried again on the next run). After six hours it is taken as it is: some games never get a chart.
        started = pbp.get("startTimeUTC")
        if started:
            from datetime import datetime, timezone
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(started.replace("Z", "+00:00"))).total_seconds()
            if age < 6 * 3600:
                conn.rollback()
                raise NotReady(f"no shift chart for game {game_id} yet")
    if require_complete and shift_rows_raw:
        # the NHL posts a shift chart in pieces: a chart that has started but isn't whole makes ice time and every unit look short (one pair showed
        # 15:43 against its real 17:35). A whole regulation chart has every skater's shifts adding up to nearly six players for 60 minutes per team,
        # so a chart well under that, or one that stops before the third period ends, is refused and tried again on the next run.
        started = pbp.get("startTimeUTC")
        if started:
            from datetime import datetime, timezone
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(started.replace("Z", "+00:00"))).total_seconds()
            if age < 6 * 3600:
                per_team: dict = defaultdict(int)
                last_end = 0
                for r in shift_rows_raw:
                    if r["period"] <= 3:
                        per_team[r["teamId"]] += max(0, mmss_to_sec(r["endTime"]) - mmss_to_sec(r["startTime"]))
                        if r["period"] == 3:
                            last_end = max(last_end, mmss_to_sec(r["endTime"]))
                if len(per_team) < 2 or min(per_team.values()) < 0.92 * 6 * 3600 or last_end < 1190:
                    conn.rollback()
                    raise NotReady(f"shift chart for game {game_id} is not complete yet")
    shift_rows = []
    for s in shift_rows_raw:
        start_sec = mmss_to_sec(s["startTime"])
        end_sec = mmss_to_sec(s["endTime"])
        shift_rows.append((s["playerId"], s["teamId"], s["period"], start_sec, end_sec))
        conn.execute(
            "INSERT INTO shifts (game_id, player_id, team_id, period, start_sec, end_sec) VALUES (?, ?, ?, ?, ?, ?)",
            (game_id, s["playerId"], s["teamId"], s["period"], start_sec, end_sec),
        )

    toi_sec: dict[int, int] = defaultdict(int)
    for player_id, _team_id, _period, start_sec, end_sec in shift_rows:
        toi_sec[player_id] += max(0, end_sec - start_sec)

    shifts_by_period = group_by_period(shift_rows)
    stats: dict[int, dict] = defaultdict(lambda: defaultdict(int))

    for play in pbp["plays"]:
        etype = play["typeDescKey"]
        details = play.get("details", {})
        period = play["periodDescriptor"]["number"]
        time_sec = mmss_to_sec(play["timeInPeriod"])
        situation_code = play.get("situationCode")

        conn.execute(
            """INSERT OR REPLACE INTO events
               (game_id, event_id, period, time_sec, type, team_id, situation_code, home_defending_side, details_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                game_id,
                play["eventId"],
                period,
                time_sec,
                etype,
                details.get("eventOwnerTeamId"),
                situation_code,
                play.get("homeTeamDefendingSide"),
                json.dumps(details),
            ),
        )

        # period 5+ in a regular-season game is the shootout: those goals/shots
        # are stored (to decide the winner) but are NOT goals or shots for any
        # player, on-ice stat, or xG purposes — counting them inflated player
        # goals by ~1.6% and polluted the xG training set with shootout shots
        if period >= 5:
            continue

        if etype == "goal":
            stats[details["scoringPlayerId"]]["goals"] += 1
            stats[details["scoringPlayerId"]]["shots"] += 1
            if details.get("assist1PlayerId"):
                stats[details["assist1PlayerId"]]["primary_assists"] += 1
            if details.get("assist2PlayerId"):
                stats[details["assist2PlayerId"]]["secondary_assists"] += 1
        elif etype == "shot-on-goal":
            stats[details["shootingPlayerId"]]["shots"] += 1
        elif etype == "blocked-shot":
            # a handful of games publish blocked shots with no blocker id
            if details.get("blockingPlayerId"):
                stats[details["blockingPlayerId"]]["blocks"] += 1
        elif etype == "faceoff":
            # a few faceoffs are published without one of the players (e.g. a missing id on a live feed)
            if details.get("winningPlayerId"):
                stats[details["winningPlayerId"]]["faceoff_wins"] += 1
            if details.get("losingPlayerId"):
                stats[details["losingPlayerId"]]["faceoff_losses"] += 1
        elif etype == "penalty":
            if details.get("committedByPlayerId"):
                stats[details["committedByPlayerId"]]["penalties_taken"] += 1
            if details.get("drawnByPlayerId"):
                stats[details["drawnByPlayerId"]]["penalties_drawn"] += 1

        if etype in SHOT_ATTEMPT_TYPES:
            shooter_id = _shooter_id(details)
            shooter_team = player_team.get(shooter_id)
            if shooter_team is None:
                continue
            is_5v5 = situation_code == FULL_STRENGTH_5V5
            on_ice = on_ice_at(shifts_by_period.get(period, []), time_sec)
            for team_id, players_on_ice in on_ice.items():
                is_shooting_team = team_id == shooter_team
                for pid in players_on_ice:
                    # "_all" covers every situation (5v5+PP+PK); "_5v5" is the
                    # narrower subset also kept for comparison, same "keep
                    # both" pattern as raw Corsi alongside xG
                    stats[pid]["cf_all" if is_shooting_team else "ca_all"] += 1
                    if etype == "goal":
                        stats[pid]["gf_all" if is_shooting_team else "ga_all"] += 1
                    if is_5v5:
                        stats[pid]["cf_5v5" if is_shooting_team else "ca_5v5"] += 1
                        if etype == "goal":
                            stats[pid]["gf_5v5" if is_shooting_team else "ga_5v5"] += 1

    for player_id, s in stats.items():
        team_id = player_team.get(player_id)
        # a handful of games (e.g. 57 in Apr 2025) have no shift data on the NHL
        # API at all, so on-ice terms would be zero and the score would be a
        # misleadingly low box-score-only number — leave it NULL instead
        score = gamescore.raw_game_score(s) if shift_rows else None
        conn.execute(
            """INSERT OR REPLACE INTO player_game_stats
               (game_id, player_id, team_id, goals, primary_assists, secondary_assists,
                shots, blocks, penalties_taken, penalties_drawn, faceoff_wins, faceoff_losses,
                cf_5v5, ca_5v5, gf_5v5, ga_5v5, cf_all, ca_all, gf_all, ga_all, toi_sec, raw_game_score)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                game_id,
                player_id,
                team_id,
                s.get("goals", 0),
                s.get("primary_assists", 0),
                s.get("secondary_assists", 0),
                s.get("shots", 0),
                s.get("blocks", 0),
                s.get("penalties_taken", 0),
                s.get("penalties_drawn", 0),
                s.get("faceoff_wins", 0),
                s.get("faceoff_losses", 0),
                s.get("cf_5v5", 0),
                s.get("ca_5v5", 0),
                s.get("gf_5v5", 0),
                s.get("ga_5v5", 0),
                s.get("cf_all", 0),
                s.get("ca_all", 0),
                s.get("gf_all", 0),
                s.get("ga_all", 0),
                toi_sec.get(player_id, 0),
                score,
            ),
        )

    conn.commit()


def recompute_all_situations_corsi(conn, game_id: int) -> None:
    """Backfills cf_all/ca_all/gf_all/ga_all from already-stored events/shifts
    (no API calls) — the complement to the existing 5v5-only tally, added
    after the fact so it didn't require a full re-ingest."""
    events = conn.execute(
        "SELECT period, time_sec, type, details_json FROM events WHERE game_id = ? AND type IN ({})".format(
            ",".join("?" * len(SHOT_ATTEMPT_TYPES))
        ),
        (game_id, *SHOT_ATTEMPT_TYPES),
    ).fetchall()
    shift_rows = conn.execute(
        "SELECT player_id, team_id, period, start_sec, end_sec FROM shifts WHERE game_id = ?",
        (game_id,),
    ).fetchall()
    shifts_by_period = group_by_period(shift_rows)
    player_team = {r[0]: r[1] for r in shift_rows}

    stats: dict[int, dict] = defaultdict(lambda: defaultdict(int))
    for period, time_sec, etype, details_json in events:
        details = json.loads(details_json) if details_json else {}
        shooter_id = _shooter_id(details)
        shooter_team = player_team.get(shooter_id)
        if shooter_team is None:
            continue
        on_ice = on_ice_at(shifts_by_period.get(period, []), time_sec)
        for team_id, players_on_ice in on_ice.items():
            is_shooting_team = team_id == shooter_team
            for pid in players_on_ice:
                stats[pid]["cf_all" if is_shooting_team else "ca_all"] += 1
                if etype == "goal":
                    stats[pid]["gf_all" if is_shooting_team else "ga_all"] += 1

    for player_id, s in stats.items():
        conn.execute(
            "INSERT OR IGNORE INTO player_game_stats (game_id, player_id, team_id) VALUES (?, ?, ?)",
            (game_id, player_id, player_team.get(player_id)),
        )
        conn.execute(
            "UPDATE player_game_stats SET cf_all=?, ca_all=?, gf_all=?, ga_all=? WHERE game_id=? AND player_id=?",
            (s.get("cf_all", 0), s.get("ca_all", 0), s.get("gf_all", 0), s.get("ga_all", 0), game_id, player_id),
        )
    conn.commit()


def recompute_onice_tallies(conn, game_id: int) -> None:
    """Rebuild every on-ice Corsi/goal tally (5v5 and all-situations) for one game from the stored
    events and shifts — no API calls. Same counting as ingest_game, used to repair games after
    the on-ice lookup was fixed (see shifts.on_ice_at)."""
    events = conn.execute(
        "SELECT period, time_sec, type, situation_code, details_json FROM events "
        "WHERE game_id = ? AND period < 5 AND type IN ({})".format(",".join("?" * len(SHOT_ATTEMPT_TYPES))),
        (game_id, *SHOT_ATTEMPT_TYPES),
    ).fetchall()
    shift_rows = conn.execute(
        "SELECT player_id, team_id, period, start_sec, end_sec FROM shifts WHERE game_id = ?", (game_id,)
    ).fetchall()
    shifts_by_period = group_by_period(shift_rows)
    player_team = {r[0]: r[1] for r in shift_rows}

    stats: dict[int, dict] = defaultdict(lambda: defaultdict(int))
    for period, time_sec, etype, situation_code, details_json in events:
        details = json.loads(details_json) if details_json else {}
        shooter_team = player_team.get(_shooter_id(details))
        if shooter_team is None:
            continue
        is_5v5 = situation_code == FULL_STRENGTH_5V5
        for team_id, players_on_ice in on_ice_at(shifts_by_period.get(period, []), time_sec).items():
            mine = team_id == shooter_team
            for pid in players_on_ice:
                s = stats[pid]
                s["cf_all" if mine else "ca_all"] += 1
                if etype == "goal":
                    s["gf_all" if mine else "ga_all"] += 1
                if is_5v5:
                    s["cf_5v5" if mine else "ca_5v5"] += 1
                    if etype == "goal":
                        s["gf_5v5" if mine else "ga_5v5"] += 1

    conn.execute(
        "UPDATE player_game_stats SET cf_all=0, ca_all=0, gf_all=0, ga_all=0, cf_5v5=0, ca_5v5=0, gf_5v5=0, ga_5v5=0 "
        "WHERE game_id = ?", (game_id,),
    )
    for pid, s in stats.items():
        conn.execute(
            "INSERT OR IGNORE INTO player_game_stats (game_id, player_id, team_id) VALUES (?, ?, ?)",
            (game_id, pid, player_team.get(pid)),
        )
        conn.execute(
            """UPDATE player_game_stats SET cf_all=?, ca_all=?, gf_all=?, ga_all=?, cf_5v5=?, ca_5v5=?, gf_5v5=?, ga_5v5=?
               WHERE game_id=? AND player_id=?""",
            tuple(s.get(k, 0) for k in ("cf_all", "ca_all", "gf_all", "ga_all", "cf_5v5", "ca_5v5", "gf_5v5", "ga_5v5")) + (game_id, pid),
        )
    conn.commit()


def compute_extra_stats(conn, game_id: int) -> None:
    """Hits, takeaways, giveaways, PIM, missed shots, shift counts, and zone
    starts — all derivable from already-stored events/shifts, so this is a
    pure reprocessing pass (no API calls), unlike ingest_game above."""
    events = conn.execute(
        "SELECT period, time_sec, type, details_json FROM events WHERE game_id = ?",
        (game_id,),
    ).fetchall()
    shift_rows = conn.execute(
        "SELECT player_id, team_id, period, start_sec, end_sec FROM shifts WHERE game_id = ?",
        (game_id,),
    ).fetchall()
    player_team = {r[0]: r[1] for r in shift_rows}

    stats: dict[int, dict] = defaultdict(lambda: defaultdict(int))
    # faceoff zoneCode is relative to the WINNING team (confirmed from the
    # same event vocabulary used elsewhere in this codebase) — (period,
    # time_sec) is the key since a shift's start_sec coincides exactly with
    # the faceoff that creates it
    faceoff_by_time: dict[tuple[int, int], tuple[str, int]] = {}

    for period, time_sec, etype, details_json in events:
        details = json.loads(details_json) if details_json else {}
        if etype == "hit":
            if details.get("hittingPlayerId"):
                stats[details["hittingPlayerId"]]["hits"] += 1
        elif etype == "giveaway":
            pid = details.get("playerId")
            if pid:
                stats[pid]["giveaways"] += 1
                if details.get("zoneCode") == "D":
                    stats[pid]["giveaways_dzone"] += 1
        elif etype == "takeaway":
            pid = details.get("playerId")
            if pid:
                stats[pid]["takeaways"] += 1
        elif etype == "missed-shot":
            shooter = details.get("shootingPlayerId")
            if shooter:
                stats[shooter]["missed_shots"] += 1
        elif etype == "penalty":
            committed_by = details.get("committedByPlayerId")
            if committed_by and details.get("duration"):
                stats[committed_by]["pim"] += details["duration"]
        elif etype == "faceoff":
            zone = details.get("zoneCode")
            winner = details.get("winningPlayerId")
            winner_team = player_team.get(winner)
            if zone and winner_team is not None:
                faceoff_by_time[(period, time_sec)] = (zone, winner_team)

    for player_id, team_id, period, start_sec, _end_sec in shift_rows:
        stats[player_id]["shifts"] += 1
        fo = faceoff_by_time.get((period, start_sec))
        if fo is None:
            stats[player_id]["fly_starts"] += 1
            continue
        zone, winner_team = fo
        team_zone = zone if team_id == winner_team else _opposite_zone(zone)
        if team_zone == "O":
            stats[player_id]["oz_starts"] += 1
        elif team_zone == "D":
            stats[player_id]["dz_starts"] += 1
        elif team_zone == "N":
            stats[player_id]["nz_starts"] += 1

    for player_id, s in stats.items():
        # a player with zero tallied box-score events (rare, but possible for
        # very limited playing time) may not have a player_game_stats row yet
        conn.execute(
            "INSERT OR IGNORE INTO player_game_stats (game_id, player_id, team_id) VALUES (?, ?, ?)",
            (game_id, player_id, player_team.get(player_id)),
        )
        conn.execute(
            """UPDATE player_game_stats SET
               hits=?, takeaways=?, giveaways=?, giveaways_dzone=?, pim=?, missed_shots=?,
               shifts=?, oz_starts=?, dz_starts=?, nz_starts=?, fly_starts=?
               WHERE game_id=? AND player_id=?""",
            (
                s.get("hits", 0), s.get("takeaways", 0), s.get("giveaways", 0),
                s.get("giveaways_dzone", 0), s.get("pim", 0), s.get("missed_shots", 0),
                s.get("shifts", 0), s.get("oz_starts", 0), s.get("dz_starts", 0),
                s.get("nz_starts", 0), s.get("fly_starts", 0),
                game_id, player_id,
            ),
        )

    conn.commit()
