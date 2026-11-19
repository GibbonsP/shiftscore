"""Who each forward line and defense pair played against, game by game, at 5-on-5.

For every stretch of a game when both teams had three forwards and two defensemen on the ice, this credits the time and the shots to the
pairing of each team's line and pair against the other team's line and pair: a line against each opposing line and each opposing pair, a
pair against each opposing line and pair. It sweeps the same shift and event boundaries as units.compute_game_units, so a unit's matchup
rows add up to its even-strength numbers (time, shot attempts and goals; expected goals use the same shot-on-goal chances as everywhere else).

Table unit_matchup_stats has one row per (game, team, unit, opposing unit), from the unit's own team's point of view.
"""
import json
from collections import defaultdict

from .ingest import SHOT_ATTEMPT_TYPES, _shooter_id
from .shifts import group_by_period, on_ice_at, on_ice_during
from .shot_features import extract_game_shot_rows
from .units import _skaters_only, team_states, team_units
from .xg_model import predict_danger

EV_TYPES = ("line", "pair")


def _ids(unit) -> str:
    return ",".join(str(p) for p in sorted(unit[1]))


def _even_units(on_ice_ids, positions):
    """The (line, pair) on the ice at 5-on-5 as {type: player_ids string}, or {} when a side isn't 3 forwards + 2 defensemen."""
    out = {}
    for unit_type, pids in team_units(on_ice_ids, positions, "even"):
        if unit_type in EV_TYPES:
            out[unit_type] = ",".join(str(p) for p in sorted(pids))
    return out if len(out) == 2 else {}


def compute_game_matchups(conn, game_id: int) -> int:
    """Write the game's matchup rows (replacing any). Returns how many rows."""
    game = conn.execute("SELECT home_team_id, away_team_id FROM games WHERE game_id = ?", (game_id,)).fetchone()
    if game is None:
        return 0
    home_id, away_id = game
    positions = dict(conn.execute("SELECT player_id, position FROM players").fetchall())
    shift_rows = conn.execute("SELECT player_id, team_id, period, start_sec, end_sec FROM shifts WHERE game_id = ?", (game_id,)).fetchall()
    if not shift_rows:
        conn.execute("INSERT OR IGNORE INTO unit_matchup_stats (game_id, team_id, unit_type, player_ids, opp_type, opp_player_ids) VALUES (?, 0, 'none', '', 'none', '')", (game_id,))
        conn.commit()
        return 0
    shifts_by_period = group_by_period(shift_rows)
    player_team = {r[0]: r[1] for r in shift_rows}
    events = conn.execute(
        "SELECT event_id, period, time_sec, type, situation_code, details_json FROM events WHERE game_id = ? ORDER BY period, time_sec, event_id",
        (game_id,),
    ).fetchall()

    acc: dict[tuple, dict] = defaultdict(lambda: defaultdict(float))

    def add(team_id, unit_type, pids, opp_type, opp_pids, **kw):
        a = acc[(team_id, unit_type, pids, opp_type, opp_pids)]
        for k, v in kw.items():
            a[k] += v

    def credit(team_a, units_a, team_b, units_b, kw_a, kw_b):
        """Each of team A's units against each of team B's, and the reverse, at 5-on-5."""
        for ta, pa in units_a.items():
            for tb, pb in units_b.items():
                if kw_a:
                    add(team_a, ta, pa, tb, pb, **kw_a)
                if kw_b:
                    add(team_b, tb, pb, ta, pa, **kw_b)

    # time together: the shift and event boundaries, with the strength state from the latest event (as units.compute_game_units does)
    by_period: dict[int, list] = defaultdict(list)
    for _eid, period, t, _ty, sit, _d in events:
        by_period[period].append((t, sit))
    for period, shifts in shifts_by_period.items():
        pev = by_period.get(period, [])
        if not pev:
            continue
        bounds = sorted({s[3] for s in shifts} | {s[4] for s in shifts} | {t for t, _ in pev})
        i, sit = 0, None
        for t1, t2 in zip(bounds, bounds[1:]):
            if t2 - t1 <= 0:
                continue
            while i < len(pev) and pev[i][0] <= t1:
                sit = pev[i][1]
                i += 1
            if sit is None or team_states(sit) != ("even", "even"):
                continue
            on = _skaters_only(on_ice_during(shifts, t1, t2), positions)
            ua, uh = _even_units(on.get(away_id, set()), positions), _even_units(on.get(home_id, set()), positions)
            if ua and uh:
                credit(away_id, ua, home_id, uh, {"toi_sec": t2 - t1}, {"toi_sec": t2 - t1})

    # shot attempts and goals
    for _eid, period, t, etype, sit, details_json in events:
        if etype not in SHOT_ATTEMPT_TYPES:
            continue
        shooter_team = player_team.get(_shooter_id(json.loads(details_json)))
        if shooter_team is None or team_states(sit) != ("even", "even"):
            continue
        on = _skaters_only(on_ice_at(shifts_by_period.get(period, []), t), positions)
        defender = home_id if shooter_team == away_id else away_id
        us, ud = _even_units(on.get(shooter_team, set()), positions), _even_units(on.get(defender, set()), positions)
        if us and ud:
            goal = 1 if etype == "goal" else 0
            credit(shooter_team, us, defender, ud, {"cf": 1, "gf": goal}, {"ca": 1, "ga": goal})

    # expected goals: the shot-on-goal chances (the same ones every other xG on the site counts)
    shot_rows = extract_game_shot_rows(conn, game_id)
    for row, dp in zip(shot_rows, predict_danger(shot_rows)):
        if row["strength_state"] != "even" or not (row["on_goal"] and row.get("opp_goalie") != 0):
            continue
        on = _skaters_only(on_ice_at(shifts_by_period.get(row["period"], []), row["time_sec"]), positions)
        st = row["team_id"]
        defender = home_id if st == away_id else away_id
        us, ud = _even_units(on.get(st, set()), positions), _even_units(on.get(defender, set()), positions)
        if us and ud:
            credit(st, us, defender, ud, {"xgf": float(dp)}, {"xga": float(dp)})

    # keep only the units that held a slot that game (the four forward lines and three pairs with the most ice time, as the site ranks
    # them), so the table stays small: the page shows L1-L4 and P1-P3 against each other
    top = set()
    for tid in (home_id, away_id):
        for utype, n in (("line", 4), ("pair", 3)):
            for (pids,) in conn.execute(
                "SELECT player_ids FROM unit_game_stats WHERE game_id = ? AND team_id = ? AND unit_type = ? ORDER BY toi_sec DESC LIMIT ?",
                (game_id, tid, utype, n),
            ):
                top.add((tid, utype, pids))
    acc = {k: v for k, v in acc.items() if (k[0], k[1], k[2]) in top and (home_id if k[0] == away_id else away_id, k[3], k[4]) in top}

    conn.execute("DELETE FROM unit_matchup_stats WHERE game_id = ?", (game_id,))
    conn.executemany(
        "INSERT INTO unit_matchup_stats (game_id, team_id, unit_type, player_ids, opp_type, opp_player_ids, toi_sec, cf, ca, gf, ga, xgf, xga) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [(game_id, tid, ut, pids, ot, opids, int(s["toi_sec"]), int(s["cf"]), int(s["ca"]), int(s["gf"]), int(s["ga"]),
          round(s["xgf"], 3), round(s["xga"], 3)) for (tid, ut, pids, ot, opids), s in acc.items()],
    )
    if not acc:   # nothing to record (no shifts, or no 5-on-5 time): leave a marker so it is not retried every run
        conn.execute("INSERT OR IGNORE INTO unit_matchup_stats (game_id, team_id, unit_type, player_ids, opp_type, opp_player_ids) VALUES (?, 0, 'none', '', 'none', '')", (game_id,))
    conn.commit()
    return len(acc)


def missing_games(conn) -> list[int]:
    """Processed games that have shifts but no matchup rows yet (oldest first)."""
    return [g for (g,) in conn.execute(
        """SELECT DISTINCT u.game_id FROM unit_game_stats u
           WHERE NOT EXISTS (SELECT 1 FROM unit_matchup_stats m WHERE m.game_id = u.game_id)
           ORDER BY u.game_id""")]


def backfill(conn, max_seconds: float | None = None) -> int:
    """Fill in matchup rows for processed games that lack them. Returns how many games were done."""
    import time
    start, n = time.time(), 0
    for gid in missing_games(conn):
        if max_seconds is not None and time.time() - start > max_seconds:
            break
        try:
            compute_game_matchups(conn, gid)
        except Exception as e:  # one broken game must not stop the rest
            print(f"matchups for game {gid} failed: {type(e).__name__}: {e}", flush=True)
            conn.execute("INSERT OR IGNORE INTO unit_matchup_stats (game_id, team_id, unit_type, player_ids, opp_type, opp_player_ids) VALUES (?, 0, 'none', '', 'none', '')", (gid,))
            conn.commit()
            continue
        n += 1
        if n % 200 == 0:
            print(f"  matchups: {n} games", flush=True)
    return n
