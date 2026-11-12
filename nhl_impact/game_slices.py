"""Per-game stats split into (period x situation) cells, so a box score can be
filtered by period and by game situation in the browser.

Every counting stat is stored per *cell*; any filter ("period 2, power play")
is then just the sum of the matching cells — no recomputation, and the
unfiltered view is the sum of all cells.

Cells: period 1/2/3/OT (index 0-3) x the player's own team's situation:
    0 = 5v5    1 = other even strength (4v4, 3v3)    2 = power play
    3 = penalty kill    4 = other (empty net, odd skater counts)
cell index = period_index * 5 + situation. The situation is from the *player's
team's* perspective, so one shot is a PP cell for the shooting team and a PK
cell for the defending team. Shootout events (period 5) are excluded.

TOI is split using the situation code of the most recent event, the same
approximation unit TOI uses: the code only changes at events, so the seconds
right after a penalty expires are attributed to the old situation until the
next whistle. Counting stats use each event's own code and are exact.
"""
import json
from collections import defaultdict

from .gamescore import WEIGHTS
from .ingest import SHOT_ATTEMPT_TYPES, _shooter_id
from .shifts import group_by_period, on_ice_at, on_ice_during
from .shot_features import attacking_net_x, extract_game_shot_rows
from .xg_model import LOW_DANGER_MAX, MEDIUM_DANGER_MAX, predict_danger, predict_xg

SITUATIONS = ["5v5", "EV", "PP", "PK", "X"]
HIGH_DANGER_XG = MEDIUM_DANGER_MAX  # same cutoffs as xg_model.danger_bucket

# hdcf/hdca (on-ice high-danger chances for/against) are last so earlier positions never move
# Danger bands are the chance a shot on goal scores (xg_model.predict_danger): low < 7%, medium 7-14%, high >= 14%.
# Everything new is appended so existing positions never move.
PLAYER_FIELDS = ["toi", "g", "a1", "a2", "sog", "hits", "blk", "tk", "gv", "pim", "fow", "fol",
                 "pd", "pt", "ixg", "cf", "ca", "gf", "ga", "xgf", "xga", "hdcf", "hdca",
                 "mdcf", "mdca", "ldcf", "ldca",        # on-ice medium / low-danger chances for and against
                 "ihd", "imd", "ild",                   # the player's own shots on goal by danger band
                 "ihg", "img", "ilg",                   # ...the goals among them
                 "ihx", "imx", "ilx",                   # ...and the chance each shot on goal had of scoring, added up (expected goals)
                 "gsc"]                                 # Game Score points earned in the cell (so the page can sum any filter without knowing the formula)
TEAM_FIELDS = ["toi", "goals", "sog", "attempts", "xgf", "hdc", "hits", "blocks", "tk", "gv", "pim", "fow", "fol",
               "mdc", "ldc"]
# per goalie: overall, then shots faced / goals allowed / expected goals against in each danger band
GOALIE_FIELDS = ["toi", "sf", "ga", "xga",
                 "sfh", "gah", "xgah", "sfm", "gam", "xgam", "sfl", "gal", "xgal"]
_PI = {f: i for i, f in enumerate(PLAYER_FIELDS)}
_TI = {f: i for i, f in enumerate(TEAM_FIELDS)}
_GI = {f: i for i, f in enumerate(GOALIE_FIELDS)}


def team_situation(code: str | None, is_home: bool) -> int:
    """Situation index (see module docstring) for one team from a situationCode
    [awayGoalie][awaySkaters][homeSkaters][homeGoalie]."""
    if not code or len(code) != 4 or not code.isdigit():
        return 4
    away_g, away_s, home_s, home_g = (int(c) for c in code)
    if away_g != 1 or home_g != 1 or not (3 <= away_s <= 5) or not (3 <= home_s <= 5):
        return 4
    if away_s == home_s:
        return 0 if away_s == 5 else 1
    mine, theirs = (home_s, away_s) if is_home else (away_s, home_s)
    return 2 if mine > theirs else 3


def danger_band(xg: float) -> str:
    """'h' / 'm' / 'l' from the chance a shot on goal scores — the same cutoffs as xg_model.danger_bucket."""
    return "l" if xg < LOW_DANGER_MAX else "m" if xg < MEDIUM_DANGER_MAX else "h"


def cell_index(period: int, situation: int) -> int:
    return (min(period, 4) - 1) * 5 + situation


def compute_game_slices(conn, game_id: int, pipeline) -> dict:
    """{"players": {pid: {cell: [..PLAYER_FIELDS]}}, "teams": {team_id: {cell: [..TEAM_FIELDS]}},
        "goalies": {pid: {cell: [..GOALIE_FIELDS]}}}   (zero-only cells omitted)"""
    game = conn.execute("SELECT home_team_id, away_team_id FROM games WHERE game_id = ?", (game_id,)).fetchone()
    if game is None:
        return {"players": {}, "teams": {}, "goalies": {}, "shots": []}
    home_id, away_id = game

    positions = dict(conn.execute("SELECT player_id, position FROM players").fetchall())
    shift_rows = conn.execute(
        "SELECT player_id, team_id, period, start_sec, end_sec FROM shifts WHERE game_id = ? AND period < 5",
        (game_id,),
    ).fetchall()
    shifts_by_period = group_by_period(shift_rows)
    player_team = {r[0]: r[1] for r in shift_rows}
    # players with no shifts (rare) still have a team via their game row
    for pid, tid in conn.execute("SELECT player_id, team_id FROM player_game_stats WHERE game_id = ?", (game_id,)):
        player_team.setdefault(pid, tid)

    shot_rows = extract_game_shot_rows(conn, game_id)
    xg_by_event = {r["event_id"]: x for r, x in zip(shot_rows, predict_xg(pipeline, shot_rows))}
    # danger band = chance a SHOT ON GOAL scores (second model), not the attempt-level xG; xG itself is unchanged
    danger_by_event = {r["event_id"]: x for r, x in zip(shot_rows, predict_danger(shot_rows))}

    events = conn.execute(
        "SELECT event_id, period, time_sec, type, team_id, situation_code, details_json, home_defending_side FROM events "
        "WHERE game_id = ? AND period < 5 ORDER BY period, time_sec, event_id",
        (game_id,),
    ).fetchall()

    P = defaultdict(lambda: defaultdict(lambda: [0.0] * len(PLAYER_FIELDS)))
    T = defaultdict(lambda: defaultdict(lambda: [0.0] * len(TEAM_FIELDS)))
    G = defaultdict(lambda: defaultdict(lambda: [0.0] * len(GOALIE_FIELDS)))

    def sit(code, team_id):
        return team_situation(code, team_id == home_id)

    def is_goalie(pid):
        return positions.get(pid) == "G"

    # ---- time on ice: sweep segments between shift changes / events
    events_by_period = defaultdict(list)
    for _eid, period, time_sec, _t, _tid, code, _d, _hds in events:
        events_by_period[period].append((time_sec, code))
    for period, pshifts in shifts_by_period.items():
        pevents = events_by_period.get(period, [])
        boundaries = sorted({s[3] for s in pshifts} | {s[4] for s in pshifts} | {t for t, _ in pevents})
        idx, code = 0, None
        for t1, t2 in zip(boundaries, boundaries[1:]):
            if t2 <= t1:
                continue
            while idx < len(pevents) and pevents[idx][0] <= t1:
                if pevents[idx][1]:
                    code = pevents[idx][1]
                idx += 1
            on_ice = on_ice_during(pshifts, t1, t2)
            for team_id, pids in on_ice.items():
                if not pids:
                    continue
                c = cell_index(period, sit(code, team_id))
                T[team_id][c][_TI["toi"]] += t2 - t1
                for pid in pids:
                    if is_goalie(pid):
                        G[pid][c][_GI["toi"]] += t2 - t1
                    else:
                        P[pid][c][_PI["toi"]] += t2 - t1

    # ---- events
    shots = []  # every unblocked attempt: where it was taken from and how dangerous it was
    for event_id, period, time_sec, etype, event_team, code, details_json, home_def_side in events:
        d = json.loads(details_json) if details_json else {}

        def bump_player(pid, field, n=1):
            tid = player_team.get(pid)
            if tid is None or is_goalie(pid):
                return None
            P[pid][cell_index(period, sit(code, tid))][_PI[field]] += n
            return tid

        def bump_team(tid, field, n=1):
            if tid is not None:
                T[tid][cell_index(period, sit(code, tid))][_TI[field]] += n

        if etype in SHOT_ATTEMPT_TYPES:
            shooter = _shooter_id(d)
            shooter_team = player_team.get(shooter)
            if shooter_team is None:
                continue
            defender_team = home_id if shooter_team == away_id else away_id
            xg = xg_by_event.get(event_id)  # None for blocked shots (not Fenwick)
            dp = danger_by_event.get(event_id)
            # the defending goalie is out (situation code: [awayGoalie][awaySkaters][homeSkaters][homeGoalie]): an empty-net
            # attempt is not an ordinary chance, so it stays out of the danger counts (its goal still counts as a goal)
            empty_net = bool(code and len(code) == 4 and code.isdigit() and int(code[0] if shooter_team == home_id else code[3]) == 0)
            on_ice = on_ice_at(shifts_by_period.get(period, []), time_sec)

            if xg is not None and d.get("xCoord") is not None and d.get("yCoord") is not None:
                # rotate every shot to attack the +x net, so one half-rink drawing shows both teams
                sign = 1 if attacking_net_x(home_def_side, shooter_team == home_id) > 0 else -1
                shots.append([
                    period, time_sec, 1 if shooter_team == home_id else 0,
                    round(d["xCoord"] * sign), round(d["yCoord"] * sign), round(float(xg), 3),
                    2 if etype == "goal" else 1 if etype == "shot-on-goal" else 0,
                    shooter, cell_index(period, sit(code, shooter_team)), 1 if empty_net else 0, round(float(dp), 3),
                ])

            bump_team(shooter_team, "attempts")
            if etype in ("goal", "shot-on-goal"):
                bump_player(shooter, "sog")
                bump_team(shooter_team, "sog")
            if etype == "goal":
                bump_team(shooter_team, "goals")
            # danger "chances" are shots on goal (saves plus goals), the way most public sites count them; xG still
            # sums every unblocked attempt, misses included, because it is the chance of the attempt becoming a goal
            on_target = etype in ("goal", "shot-on-goal") and not empty_net
            # expected goals in the cells are the chance a shot ON GOAL scores (0 for misses and empty-net attempts); `xg` (every unblocked
            # attempt) only sizes the dots on the shot maps
            cx = float(dp) if (on_target and dp is not None) else 0.0
            if xg is not None:
                band = danger_band(dp)
                bump_player(shooter, "ixg", cx)
                bump_team(shooter_team, "xgf", cx)
                if on_target:
                    bump_player(shooter, {"h": "ihd", "m": "imd", "l": "ild"}[band])
                    bump_player(shooter, {"h": "ihx", "m": "imx", "l": "ilx"}[band], float(dp) if dp is not None else xg)
                    if etype == "goal":
                        bump_player(shooter, {"h": "ihg", "m": "img", "l": "ilg"}[band])
                    bump_team(shooter_team, {"h": "hdc", "m": "mdc", "l": "ldc"}[band])
            if etype == "blocked-shot" and d.get("blockingPlayerId"):
                blocker = d["blockingPlayerId"]
                if bump_player(blocker, "blk") is not None:
                    bump_team(player_team[blocker], "blocks")

            for team_id, pids in on_ice.items():
                for pid in pids:
                    if is_goalie(pid):
                        continue
                    c = cell_index(period, sit(code, team_id))
                    row = P[pid][c]
                    band = danger_band(dp) if dp is not None else None
                    if team_id == shooter_team:
                        row[_PI["cf"]] += 1
                        if etype == "goal":
                            row[_PI["gf"]] += 1
                        if xg is not None:
                            row[_PI["xgf"]] += cx
                            if on_target:
                                row[_PI[{"h": "hdcf", "m": "mdcf", "l": "ldcf"}[band]]] += 1
                    else:
                        row[_PI["ca"]] += 1
                        if etype == "goal":
                            row[_PI["ga"]] += 1
                        if xg is not None:
                            row[_PI["xga"]] += cx
                            if on_target:
                                row[_PI[{"h": "hdca", "m": "mdca", "l": "ldca"}[band]]] += 1

            if etype == "goal":
                bump_player(shooter, "g")
                if d.get("assist1PlayerId"):
                    bump_player(d["assist1PlayerId"], "a1")
                if d.get("assist2PlayerId"):
                    bump_player(d["assist2PlayerId"], "a2")
            if etype in ("goal", "shot-on-goal") and d.get("goalieInNetId") in player_team:
                goalie = d["goalieInNetId"]
                gc = cell_index(period, sit(code, defender_team))
                G[goalie][gc][_GI["sf"]] += 1
                if etype == "goal":
                    G[goalie][gc][_GI["ga"]] += 1
                if xg is not None:
                    # a goalie's expected goals against are the chance each shot ON GOAL had of scoring (the danger model), not the
                    # attempt xG, which also prices in the chance the shot misses the net and so runs low for shots that were on goal
                    xg_g = float(dp) if dp is not None else xg
                    G[goalie][gc][_GI["xga"]] += xg_g
                    suffix = {"h": "h", "m": "m", "l": "l"}[danger_band(dp)]
                    G[goalie][gc][_GI["sf" + suffix]] += 1
                    G[goalie][gc][_GI["xga" + suffix]] += xg_g
                    if etype == "goal":
                        G[goalie][gc][_GI["ga" + suffix]] += 1
        elif etype == "hit":
            tid = bump_player(d.get("hittingPlayerId"), "hits")
            bump_team(tid, "hits")
        elif etype == "takeaway":
            tid = bump_player(d.get("playerId"), "tk")
            bump_team(tid, "tk")
        elif etype == "giveaway":
            tid = bump_player(d.get("playerId"), "gv")
            bump_team(tid, "gv")
        elif etype == "penalty":
            committed, drawn = d.get("committedByPlayerId"), d.get("drawnByPlayerId")
            if committed:
                tid = bump_player(committed, "pt")
                if d.get("duration"):
                    bump_player(committed, "pim", d["duration"])
                    bump_team(tid, "pim", d["duration"])
            if drawn:
                bump_player(drawn, "pd")
        elif etype == "faceoff":
            w, l = d.get("winningPlayerId"), d.get("losingPlayerId")
            bump_team(bump_player(w, "fow"), "fow")
            bump_team(bump_player(l, "fol"), "fol")

    def cell_score(v):
        """The slice score for one cell: the Game Score terms over every situation, with unadjusted own xG (flurry and score adjustment
        and the 5v5-only on-ice terms are only in the stored whole-game score)."""
        g = lambda f: v[_PI[f]]
        w = WEIGHTS
        return (w["goals"] * g("g") + w["primary_assists"] * g("a1") + w["secondary_assists"] * g("a2") + w["shots"] * g("sog")
                + w["blocks"] * g("blk") + w["faceoff_wins"] * (g("fow") - g("fol")) + w["penalties_drawn"] * (g("pd") - g("pt"))
                + w["cf_5v5"] * (g("cf") - g("ca")) + w["gf_5v5"] * (g("gf") - g("ga")) + w["ixg_adjusted"] * g("ixg")
                + w["xgf_5v5"] * (g("xgf") - g("xga")))

    def pack(acc, ndigits=2, score=False):
        out = {}
        for key, cells in acc.items():
            kept = {}
            for c, vals in cells.items():
                if score:
                    vals[_PI["gsc"]] = round(cell_score(vals), 3)
                if any(vals):
                    kept[c] = [round(v, 3 if score and i == _PI["gsc"] else ndigits) if isinstance(v, float) and v != int(v) else int(v) for i, v in enumerate(vals)]
            if kept:
                out[key] = kept
        return out

    return {"players": pack(P, score=True), "teams": pack(T), "goalies": pack(G), "shots": shots}
