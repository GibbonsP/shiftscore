"""Per-game box score data: the traditional box score (score by period, goals,
penalties, skater/goalie lines) plus this project's advanced layer (xG, danger
chances, Game Score, QoC/QoT, adjusted impact, unit scores).

Counting stats are stored per (period x situation) cell (see game_slices.py)
so the page can filter by period and situation; Game Score / QoC / QoT /
Adjusted Impact / Predicted Value are full-game values straight from the DB.

Shared by the static report and the hosted site (both render with the same
JavaScript, artifact_game_view.js) so they show identical numbers.
"""
import json
from collections import defaultdict

from .game_info import game_results
from .game_slices import cell_index, compute_game_slices, team_situation
from .unit_pages import order_players, player_slots, unit_key
from .gamescore import WEIGHTS, game_score_parts
from .units import team_states

# Within one game, most "units" are fragments (a line together for 20s, a PP
# group that existed for one shift). Only combinations with real ice time are
# listed on the game page; the unit's season page still counts all of its time.
# Special teams and 4-on-4 / 3-on-3 groups are few per game, so every one is listed (a power play is only ~2 minutes
# split across 3-6 five-man groups); even-strength lines and pairs show past one minute together or a goal.
# Everything else is summed into one "other combinations" row per team and type, so each section adds up
# to the team's real time in that situation.
GAME_UNIT_MIN_TOI = {"line": 60, "pair": 60, "pp": 0, "pk": 0, "ev4": 0, "ev3": 0}


def _strength_label(situation_code, scoring_is_home: bool) -> str:
    """EV / PP / SH / EN for the team that scored, from the situationCode at the goal.

    A goalie pulled for an extra attacker doesn't change who is on a power play: the extra skater is taken off each side's count first, so
    6 skaters (goalie out) against 4 is still a power play (the NHL scores it that way), and 6 against 5 is even strength."""
    if not situation_code or len(situation_code) != 4 or not situation_code.isdigit():
        return "EV"
    away_goalie, away_sk, home_sk, home_goalie = (int(c) for c in situation_code)
    defending_goalie = away_goalie if scoring_is_home else home_goalie
    if away_goalie == 1 and home_goalie == 1:
        away_state, home_state = team_states(situation_code)
        state = home_state if scoring_is_home else away_state
        label = "PP" if state == "pp" else "SH" if state == "pk" else "EV"
    else:
        # only the usual extra attacker (six skaters with the goalie out) is taken off; odd counts (five skaters and no goalie) stay even strength
        away_eff = away_sk - 1 if away_goalie == 0 and away_sk == 6 else away_sk
        home_eff = home_sk - 1 if home_goalie == 0 and home_sk == 6 else home_sk
        mine, theirs = (home_eff, away_eff) if scoring_is_home else (away_eff, home_eff)
        odd = (away_goalie == 0 and away_sk != 6) or (home_goalie == 0 and home_sk != 6)
        label = "EV" if odd or mine == theirs or not (3 <= min(mine, theirs) and max(mine, theirs) <= 5) else "PP" if mine > theirs else "SH"
    if defending_goalie == 0:
        label += " EN"
    return label


def _clock(time_sec: int) -> str:
    return f"{time_sec // 60}:{time_sec % 60:02d}"


def _period_label(p: int) -> str:
    return {1: "1st", 2: "2nd", 3: "3rd", 4: "OT", 5: "SO"}.get(p, str(p))


def _r2(x):
    return round(x, 2) if isinstance(x, float) else x


def _others_by_period(by_period):
    """Per-period split of an 'other combinations' row: the period itself when there is only one, else
    [[period, n, toi, ...], ...]."""
    if not by_period:
        return None
    if len(by_period) == 1:
        return next(iter(by_period))
    return [[p] + [_r2(x) for x in by_period[p]] for p in sorted(by_period)]


def build_games(conn, unit_keys: set | None = None, pipeline=None) -> list[dict]:
    """Every game in the connected DB as a dict. `pipeline` is the trained xG
    model (needed for the period/situation cells). Meant to run against a
    single-season sliced DB, but works on any DB."""
    if pipeline is None:
        raise ValueError("build_games needs the xG pipeline to compute per-period/situation stats")
    unit_keys = unit_keys or set()
    results = game_results(conn)
    slots = player_slots(conn)
    players = {
        pid: (f"{f} {l}", pos)
        for pid, f, l, pos in conn.execute("SELECT player_id, first_name, last_name, position FROM players")
    }
    games = conn.execute(
        "SELECT game_id, season, game_date, home_team_id, away_team_id, home_team_abbrev, away_team_abbrev "
        "FROM games ORDER BY game_date, game_id"
    ).fetchall()

    # bulk-load per-game rows once instead of querying per game
    impact_rows = defaultdict(dict)
    score_terms = sorted(WEIGHTS)
    cur = conn.execute(
        """SELECT pgs.game_id, pgs.player_id, pgs.team_id, pgi.raw_game_score, pgi.qoc, pgi.qot,
                  pgi.adjusted_impact, pgs.predicted_value,
                  pgs.oz_starts, pgs.dz_starts, pgs.nz_starts, pgs.fly_starts, """ + ", ".join("pgs." + t for t in score_terms) + """
           FROM player_game_stats pgs
           LEFT JOIN player_game_impact pgi ON pgi.game_id = pgs.game_id AND pgi.player_id = pgs.player_id"""
    )
    for row in cur:
        gid, pid, tid, raw, qoc, qot, adj, pv, oz, dz, nz, fly = row[:12]
        parts = tuple(round(x, 2) for x in game_score_parts(dict(zip(score_terms, (v or 0 for v in row[12:]))))) if raw is not None else None
        impact_rows[gid][pid] = (tid, raw, qoc, qot, adj, pv, [oz or 0, dz or 0, nz or 0, fly or 0], parts)
    from .goalie_stats import starters as goalie_starters
    starter_of = goalie_starters(conn)   # (game, team) -> the goalie who started (in net at the opening faceoff)
    events_by_game = defaultdict(list)
    for r in conn.execute(
        "SELECT game_id, period, time_sec, type, team_id, situation_code, details_json FROM events "
        "WHERE type IN ('goal','penalty') AND period < 5 ORDER BY game_id, period, time_sec, event_id"
    ):
        events_by_game[r[0]].append(r)

    unit_rows = defaultdict(list)
    for r in conn.execute(
        """SELECT game_id, team_id, unit_type, player_ids, toi_sec, cf, ca, gf, ga, xgf, xga, hdcf, hdca, unit_score,
                  mdcf, mdca, ldcf, ldca
           FROM unit_game_stats ORDER BY game_id, unit_type, toi_sec DESC"""
    ):
        unit_rows[r[0]].append(r)

    # who each line and pair played against at 5-on-5 (matchups.py), keyed by game
    matchup_rows = defaultdict(list)
    try:
        for r in conn.execute(
            """SELECT game_id, team_id, unit_type, player_ids, opp_type, opp_player_ids, toi_sec, cf, ca, gf, ga, xgf, xga
               FROM unit_matchup_stats WHERE unit_type != 'none'"""
        ):
            matchup_rows[r[0]].append(r)
    except Exception:   # a database from before the table existed
        pass

    # the same units split by period: the recap's period filter and its overtime section sum these
    period_rows = defaultdict(list)  # (game, team, type, player_ids) -> [[period, toi, cf, ca, gf, ga, xgf, xga, hdcf, hdca, mdcf, mdca, ldcf, ldca, score]]
    for r in conn.execute(
        """SELECT game_id, team_id, unit_type, player_ids, period, toi_sec, cf, ca, gf, ga, xgf, xga, hdcf, hdca,
                  mdcf, mdca, ldcf, ldca, unit_score
           FROM unit_period_stats ORDER BY period"""
    ):
        period_rows[r[:4]].append([r[4], r[5], r[6], r[7], r[8], r[9], round(r[10] or 0, 2), round(r[11] or 0, 2),
                                   r[12], r[13], r[14] or 0, r[15] or 0, r[16] or 0, r[17] or 0, round(r[18] or 0, 2)])

    def one_or_many(rows_):
        """A unit that only played one period is just that period's number; otherwise the per-period rows."""
        return rows_[0][0] if len(rows_) == 1 else rows_

    out = []
    for game_id, season, date, home_id, away_id, home_ab, away_ab in games:
        if game_id not in results:  # game inserted mid-build (live ingest)
            continue
        res = results[game_id]
        abbrev = {home_id: home_ab, away_id: away_ab}
        side = {home_id: "home", away_id: "away"}
        slices = compute_game_slices(conn, game_id, pipeline)

        sk = {home_id: [], away_id: []}
        goalies = []
        for pid, (tid, raw, qoc, qot, adj, pv, zs, parts) in impact_rows.get(game_id, {}).items():
            name, pos = players.get(pid, (str(pid), "?"))
            if pos == "G":
                if pid in slices["goalies"] and tid in abbrev:
                    goalies.append({"id": pid, "name": name, "team": abbrev[tid], "cells": slices["goalies"][pid],
                                    "starter": starter_of.get((game_id, tid)) == pid})
                continue
            if tid not in sk:
                continue
            sk[tid].append(
                {
                    "id": pid, "name": name, "pos": pos, "cells": slices["players"].get(pid, {}),
                    "raw": round(raw, 2) if raw is not None else None,
                    "qoc": round(qoc, 2) if qoc is not None else None,
                    "qot": round(qot, 2) if qot is not None else None,
                    "adj": round(adj, 2) if adj is not None else None,
                    "pv": round(pv, 3) if pv is not None else None,
                    "zs": zs,  # shift starts: offensive zone, defensive zone, neutral zone, on the fly
                    "parts": parts,  # (offense, defense, faceoffs and penalties) points; with the competition / position adjustment they add up to adj
                }
            )
        for lst in sk.values():
            # forwards first, then D, each by total ice time
            lst.sort(key=lambda s: (0 if s["pos"] != "D" else 1, -sum(c[0] for c in s["cells"].values())))
        goalies.sort(key=lambda g: -sum(c[0] for c in g["cells"].values()))

        goals, penalties = [], []
        for _g, period, time_sec, etype, team_id, situation_code, details_json in events_by_game.get(game_id, []):
            d = json.loads(details_json) if details_json else {}
            if etype == "penalty":
                committed = d.get("committedByPlayerId")
                penalties.append(
                    {
                        "period": period, "label": _period_label(period), "time": _clock(time_sec),
                        "team": abbrev.get(team_id, "?"),
                        "player": players.get(committed, (str(committed), ""))[0] if committed else "Bench",
                        "pid": committed, "desc": (d.get("descKey") or "").replace("-", " "), "min": d.get("duration"),
                    }
                )
            else:
                scorer = d.get("scoringPlayerId")
                scoring_home = team_id == home_id
                goals.append(
                    {
                        "period": period, "label": _period_label(period), "time": _clock(time_sec),
                        "team": abbrev.get(team_id, "?"),
                        "scorer": players.get(scorer, (str(scorer), ""))[0], "scorer_id": scorer,
                        "assists": [
                            {"name": players.get(d[k], (str(d[k]), ""))[0], "id": d[k]}
                            for k in ("assist1PlayerId", "assist2PlayerId") if d.get(k)
                        ],
                        "strength": _strength_label(situation_code, scoring_home),
                        "cell": cell_index(period, team_situation(situation_code, scoring_home)),
                        "score": f"{d.get('awayScore', '')}-{d.get('homeScore', '')}",
                    }
                )

        team_cells = {side[tid]: slices["teams"].get(tid, {}) for tid in (home_id, away_id)}
        # linescore (never filtered): goals and shots by period, from the team cells
        # (team cell layout: [toi, goals, sog, ...] — see game_slices.TEAM_FIELDS)
        n_periods = 3 if res["outcome"] == "REG" else 4
        by_period = {
            sd: {
                "goals": {_period_label(p): sum(c[1] for k, c in team_cells[sd].items() if int(k) // 5 == p - 1) for p in range(1, n_periods + 1)},
                "sog": {_period_label(p): sum(c[2] for k, c in team_cells[sd].items() if int(k) // 5 == p - 1) for p in range(1, n_periods + 1)},
            }
            for sd in ("home", "away")
        }

        units = []
        others = {}  # (team, type) -> [n, toi, cf, ca, gf, ga, xgf, xga, hdcf, hdca, mdcf, mdca, ldcf, ldca, score]
        others_p = {}  # (team, type) -> {period: [n, toi, ...same as others]}
        for _g, tid, utype, pids, toi, cf, ca, gf, ga, xgf, xga, hdcf, hdca, score, mdcf, mdca, ldcf, ldca in unit_rows.get(game_id, []):
            ab = abbrev.get(tid)
            if ab is None:
                continue
            # a unit that was on the ice for a goal always gets listed, however short its shift: a power-play
            # group that scored seconds into its shift is exactly the one a reader looks for
            if toi < GAME_UNIT_MIN_TOI.get(utype, 10**9) and not (gf or ga):
                row = others.setdefault((ab, utype), [0] * 14 + [0.0])
                for i, v in enumerate((1, toi, cf, ca, gf, ga, xgf or 0, xga or 0, hdcf, hdca, mdcf or 0, mdca or 0, ldcf or 0, ldca or 0, score or 0)):
                    row[i] += v
                for pr in period_rows.get((game_id, tid, utype, pids), []):
                    prow = others_p.setdefault((ab, utype), {}).setdefault(pr[0], [0] * 14 + [0.0])
                    for i, v in enumerate((1,) + tuple(pr[1:])):
                        prow[i] += v
                continue
            key = unit_key(ab, utype, pids)
            units.append(
                {
                    "team": ab, "type": utype, "toi": toi, "players": order_players(pids.split(","), slots),
                    "cf": cf, "ca": ca, "gf": gf, "ga": ga, "xgf": round(xgf or 0, 2), "xga": round(xga or 0, 2),
                    "hdcf": hdcf, "hdca": hdca, "mdcf": mdcf or 0, "mdca": mdca or 0, "ldcf": ldcf or 0, "ldca": ldca or 0,
                    "score": round(score or 0, 2),
                    "key": key if key in unit_keys else None,
                    "pr": one_or_many(period_rows.get((game_id, tid, utype, pids), [])) if period_rows.get((game_id, tid, utype, pids)) else None,
                }
            )

        # matchups as rows [side, own slot, opposing slot, toi, cf, ca, gf, ga, xgf, xga]; a slot is L1-L4 / P1-P3 (rank by ice time among the
        # team's lines or pairs that game, the same ranking the page uses for grades), side is 0 for the away team and 1 for the home team
        slot_of_unit = {}
        for ut_, n_ in (("line", 4), ("pair", 3)):
            for tid_ in (home_id, away_id):
                ranked = sorted([u for u in unit_rows.get(game_id, []) if u[1] == tid_ and u[2] == ut_], key=lambda u: -u[4])[:n_]
                for i_, u in enumerate(ranked):
                    slot_of_unit[(tid_, ut_, u[3])] = ("L" if ut_ == "line" else "P") + str(i_ + 1)
        matchups = []
        for _g, tid, ut, pids, ot, opids, toi, cf, ca, gf, ga, xgf, xga in matchup_rows.get(game_id, []):
            a_, b_ = slot_of_unit.get((tid, ut, pids)), slot_of_unit.get((home_id if tid == away_id else away_id, ot, opids))
            if a_ and b_:
                matchups.append([1 if tid == home_id else 0, a_, b_, toi, cf, ca, gf, ga, round(xgf or 0, 2), round(xga or 0, 2)])

        everyone = [dict(s, team=abbrev[tid]) for tid, lst in sk.items() for s in lst if s["adj"] is not None]
        stars = []
        for s in sorted(everyone, key=lambda s: -s["adj"])[:3]:
            # player cell layout: [toi, g, a1, a2, sog, ...] — see game_slices.PLAYER_FIELDS
            g, a1, a2, sog = (int(sum(c[i] for c in s["cells"].values())) for i in (1, 2, 3, 4))
            stars.append({"id": s["id"], "name": s["name"], "team": s["team"], "pos": s["pos"], "adj": s["adj"], "raw": s["raw"],
                          "line": f"{g}G {a1 + a2}A, {sog} SOG"})

        out.append(
            {
                "id": game_id, "season": season, "date": date,
                "home": home_ab, "away": away_ab,
                "home_score": res["home"], "away_score": res["away"], "outcome": res["outcome"],
                "by_period": by_period, "team_cells": team_cells, "shots": slices["shots"],
                "goals": goals, "penalties": penalties,
                "skaters": {"home": sk[home_id], "away": sk[away_id]},
                "goalies": goalies, "units": units, "stars": stars, "matchups": matchups,
                "unit_others": [
                    [t, ty] + [_r2(x) for x in row] + [_others_by_period(others_p.get((t, ty)))]
                    for (t, ty), row in others.items()
                ],
                # the NHL published no shift chart for a few games: no TOI, on-ice stats, Game Score or unit scores
                "no_shifts": not any(c[0] for cells in team_cells.values() for c in cells.values()),
            }
        )
    return out
