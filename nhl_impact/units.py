import json
from collections import defaultdict

from .ingest import SHOT_ATTEMPT_TYPES, _shooter_id
from .shifts import group_by_period, on_ice_at, on_ice_during

FORWARD_POSITIONS = {"L", "C", "R"}

# Unit Score weights (values in private/formulas.json): goals for and against and the flurry- and score-adjusted expected goals for and
# against, with raw shot attempts left out on purpose (a line is together about a minute at a time, so raw attempts and goals let one bounce
# dominate). Uses xgf_adjusted / xga_adjusted for the same reason gamescore.py uses adjusted xG.
from .formulas import FORMULAS

UNIT_WEIGHTS = dict(FORMULAS["unit_weights"])
# Forward lines and defense pairs (even strength) use their own weights, chosen by how well a unit's score in some games predicted its other
# games (METHODOLOGY.md, "Unit Score recipe"): expected goals carry the score, goals count for less, raw shot attempts a little. Power-play,
# penalty-kill and 4-on-4 / 3-on-3 units were not part of that test and keep UNIT_WEIGHTS.
UNIT_WEIGHTS_EV = dict(FORMULAS["unit_weights_ev"])
EVEN_STRENGTH_UNITS = {"line", "pair"}
# Penalty-kill units got the same kind of recipe on 2026-11-13 (xG leads; their own scale), tested the same way on penalty kills. Power-play
# units were tested too and kept UNIT_WEIGHTS (goals carry real signal on the power play); 4-on-4 and 3-on-3 units were not tested.
UNIT_WEIGHTS_PK = dict(FORMULAS["unit_weights_pk"])


def unit_score(unit_type: str, stats: dict) -> float:
    """Unit Score for one unit over some stretch of play. stats has gf, ga, cf, ca, xgf_adjusted, xga_adjusted (missing counts as 0)."""
    w = UNIT_WEIGHTS_EV if unit_type in EVEN_STRENGTH_UNITS else UNIT_WEIGHTS_PK if unit_type == "pk" else UNIT_WEIGHTS
    return sum(w[k] * stats.get(k, 0) for k in w)


def team_states(situation_code: str | None) -> tuple[str, str]:
    """Returns (away_state, home_state), each 'even' | 'pp' | 'pk' | 'other'.
    situation_code digits are [awayGoalie][awaySkaters][homeSkaters][homeGoalie].
    Pulled-goalie and non-standard skater counts are classified 'other' and
    skipped in v1 rather than guessed at."""
    if not situation_code or len(situation_code) != 4 or not situation_code.isdigit():
        return "other", "other"
    away_goalie, away_skaters, home_skaters, home_goalie = (int(c) for c in situation_code)
    if away_goalie != 1 or home_goalie != 1:
        return "other", "other"
    if away_skaters not in (3, 4, 5) or home_skaters not in (3, 4, 5):
        return "other", "other"
    if away_skaters == home_skaters:
        return "even", "even"
    if away_skaters > home_skaters:
        return "pp", "pk"
    return "pk", "pp"


def team_units(on_ice_ids: set, positions: dict[int, str], state: str) -> list[tuple[str, frozenset]]:
    """Given a team's on-ice SKATER ids (goalie already excluded) and that
    team's strength state, returns the unit(s) present: a line + a pair at
    even strength, or one whole group at pp/pk. Deployments that don't split
    cleanly into 3F+2D at even strength are skipped rather than forced."""
    if state == "even":
        forwards = frozenset(p for p in on_ice_ids if positions.get(p) in FORWARD_POSITIONS)
        dmen = frozenset(p for p in on_ice_ids if positions.get(p) == "D")
        units = []
        if len(forwards) == 3:
            units.append(("line", forwards))
        if len(dmen) == 2:
            units.append(("pair", dmen))
        if not units and len(on_ice_ids) in (3, 4):
            # 4-on-4 and 3-on-3 have no line/pair structure: the whole group on the ice is the unit,
            # the way a power-play group is
            units.append(("ev4" if len(on_ice_ids) == 4 else "ev3", frozenset(on_ice_ids)))
        return units
    if state in ("pp", "pk") and on_ice_ids:
        return [(state, frozenset(on_ice_ids))]
    return []


def _skaters_only(on_ice: dict[int, set], positions: dict[int, str]) -> dict[int, set]:
    return {
        team_id: {pid for pid in pids if positions.get(pid) != "G"}
        for team_id, pids in on_ice.items()
    }


def compute_game_units(conn, game_id: int) -> None:
    game = conn.execute(
        "SELECT home_team_id, away_team_id FROM games WHERE game_id = ?", (game_id,)
    ).fetchone()
    if game is None:
        return
    home_team_id, away_team_id = game

    positions = dict(conn.execute("SELECT player_id, position FROM players").fetchall())

    shift_rows = conn.execute(
        "SELECT player_id, team_id, period, start_sec, end_sec FROM shifts WHERE game_id = ?",
        (game_id,),
    ).fetchall()
    shifts_by_period = group_by_period(shift_rows)

    events = conn.execute(
        "SELECT event_id, period, time_sec, type, situation_code, details_json FROM events "
        "WHERE game_id = ? ORDER BY period, time_sec, event_id",
        (game_id,),
    ).fetchall()

    # accumulator: (team_id, unit_type, frozenset(player_ids)) -> stat dict
    acc: dict[tuple, dict] = defaultdict(lambda: defaultdict(int))
    pacc: dict[tuple, dict] = defaultdict(lambda: defaultdict(int))  # same, keyed by period too

    def add(team_id, unit_type, player_ids, period, **kwargs):
        key = (team_id, unit_type, player_ids)
        for k, v in kwargs.items():
            acc[key][k] += v
            pacc[key + (period,)][k] += v

    # --- TOI pass: sweep each period using combined shift + event-time boundaries,
    # since situation_code (and therefore unit identity) can only change at an event ---
    events_by_period: dict[int, list] = defaultdict(list)
    for event_id, period, time_sec, etype, situation_code, details_json in events:
        events_by_period[period].append((time_sec, situation_code))

    for period, period_shifts in shifts_by_period.items():
        period_events = events_by_period.get(period, [])
        if not period_events:
            continue
        event_times = [t for t, _ in period_events]

        boundaries = sorted({s[3] for s in period_shifts} | {s[4] for s in period_shifts} | set(event_times))

        ev_idx = 0
        current_situation = None
        for t1, t2 in zip(boundaries, boundaries[1:]):
            duration = t2 - t1
            if duration <= 0:
                continue
            while ev_idx < len(period_events) and period_events[ev_idx][0] <= t1:
                current_situation = period_events[ev_idx][1]
                ev_idx += 1
            if current_situation is None:
                continue

            away_state, home_state = team_states(current_situation)
            on_ice = on_ice_during(period_shifts, t1, t2)
            on_ice = _skaters_only(on_ice, positions)

            for team_id, state in ((away_team_id, away_state), (home_team_id, home_state)):
                for unit_type, player_ids in team_units(on_ice.get(team_id, set()), positions, state):
                    add(team_id, unit_type, player_ids, period, toi_sec=duration)

    # --- CF/CA/GF/GA pass: driven by actual shot-attempt events ---
    player_team = {row[0]: row[1] for row in shift_rows}

    for event_id, period, time_sec, etype, situation_code, details_json in events:
        if etype not in SHOT_ATTEMPT_TYPES:
            continue
        details = json.loads(details_json)
        shooter_id = _shooter_id(details)
        shooter_team = player_team.get(shooter_id)
        if shooter_team is None:
            continue
        defending_team = home_team_id if shooter_team == away_team_id else away_team_id

        away_state, home_state = team_states(situation_code)
        shooter_state = away_state if shooter_team == away_team_id else home_state
        defender_state = home_state if shooter_team == away_team_id else away_state
        if shooter_state == "other" or defender_state == "other":
            continue

        period_shifts = shifts_by_period.get(period, [])
        on_ice = _skaters_only(on_ice_at(period_shifts, time_sec), positions)

        is_goal = etype == "goal"
        for unit_type, player_ids in team_units(on_ice.get(shooter_team, set()), positions, shooter_state):
            add(shooter_team, unit_type, player_ids, period, cf=1, gf=1 if is_goal else 0)
        for unit_type, player_ids in team_units(on_ice.get(defending_team, set()), positions, defender_state):
            add(defending_team, unit_type, player_ids, period, ca=1, ga=1 if is_goal else 0)

    conn.execute("DELETE FROM unit_game_stats WHERE game_id = ?", (game_id,))
    for (team_id, unit_type, player_ids), stats in acc.items():
        if not player_ids or stats.get("toi_sec", 0) <= 0:
            continue
        score = unit_score(unit_type, stats)
        conn.execute(
            """INSERT OR REPLACE INTO unit_game_stats
               (game_id, team_id, unit_type, player_ids, toi_sec, cf, ca, gf, ga, unit_score)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                game_id,
                team_id,
                unit_type,
                ",".join(str(p) for p in sorted(player_ids)),
                stats.get("toi_sec", 0),
                stats.get("cf", 0),
                stats.get("ca", 0),
                stats.get("gf", 0),
                stats.get("ga", 0),
                score,
            ),
        )

    conn.execute("DELETE FROM unit_period_stats WHERE game_id = ?", (game_id,))
    for (team_id, unit_type, player_ids, period), stats in pacc.items():
        # keep every period row of a unit that has a full-game row (even one with events but no ice time in
        # that period: a shot at the instant a shift ended), so the periods always add up to the game
        if not player_ids or acc[(team_id, unit_type, player_ids)].get("toi_sec", 0) <= 0 or period > 4:
            continue
        conn.execute(
            """INSERT OR REPLACE INTO unit_period_stats
               (game_id, team_id, unit_type, player_ids, period, toi_sec, cf, ca, gf, ga, unit_score)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (game_id, team_id, unit_type, ",".join(str(p) for p in sorted(player_ids)), period,
             stats.get("toi_sec", 0), stats.get("cf", 0), stats.get("ca", 0), stats.get("gf", 0), stats.get("ga", 0),
             unit_score(unit_type, stats)),
        )

    conn.commit()
