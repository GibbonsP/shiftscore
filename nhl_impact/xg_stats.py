from collections import defaultdict

from . import gamescore
from .adjustments import shot_weight
from .shifts import group_by_period, on_ice_at
from .shot_features import extract_game_shot_rows
from .units import UNIT_WEIGHTS, _skaters_only, team_units
from .xg_model import danger_bucket, predict_danger, predict_xg

DANGER_FOR_COLS = {"high": "hdcf", "medium": "mdcf", "low": "ldcf"}
DANGER_AGAINST_COLS = {"high": "hdca", "medium": "mdca", "low": "ldca"}
BAND_PREFIX = {"high": "hd", "medium": "md", "low": "ld"}
BAND_COLS = [f"{b}{m}{s}" for b in ("hd", "md", "ld") for m in ("g", "xg") for s in ("f", "a")]   # goals and xG by danger band, for and against


def compute_game_xg(conn, game_id: int, pipeline, score_factors: dict) -> None:
    game = conn.execute(
        "SELECT home_team_id, away_team_id FROM games WHERE game_id = ?", (game_id,)
    ).fetchone()
    if game is None:
        return
    home_team_id, away_team_id = game

    shot_rows = extract_game_shot_rows(conn, game_id)
    if not shot_rows:
        return
    # Expected goals are counted on SHOTS ON GOAL with the goalie in net, each worth the chance a shot on goal becomes a goal (the danger
    # model); misses, blocked shots and empty-net attempts add nothing. (Until November 2026 this was the attempt-level xG of every
    # unblocked attempt; see METHODOLOGY.md, "One xG definition across the site".) `pipeline` (the attempt model) is no longer needed here.
    for row, dp in zip(shot_rows, predict_danger(shot_rows)):
        chance = bool(row["on_goal"]) and row.get("opp_goalie") != 0
        row["xg"] = float(dp) if chance else 0.0
        row["danger"] = danger_bucket(dp)

    positions = dict(conn.execute("SELECT player_id, position FROM players").fetchall())
    shift_rows = conn.execute(
        "SELECT player_id, team_id, period, start_sec, end_sec FROM shifts WHERE game_id = ?",
        (game_id,),
    ).fetchall()
    shifts_by_period = group_by_period(shift_rows)
    player_team = {r[0]: r[1] for r in shift_rows}

    # --- individual attribution: ixg (any situation) + on-ice xgf/xga and
    # danger-bucket counts restricted to 5v5, matching the existing
    # cf_5v5/ca_5v5 scope in player_game_stats ---
    player_acc: dict[int, dict] = defaultdict(lambda: defaultdict(float))
    # --- unit attribution: all strength states (line/pair at even strength,
    # whole group at pp/pk), matching unit_game_stats' existing scope ---
    unit_acc: dict[tuple, dict] = defaultdict(lambda: defaultdict(float))
    unit_period_acc: dict[tuple, dict] = defaultdict(lambda: defaultdict(float))  # same, keyed by period too

    def add_unit(team_id, unit_type, player_ids, period, **kwargs):
        key = (team_id, unit_type, player_ids)
        for k, v in kwargs.items():
            unit_acc[key][k] += v
            unit_period_acc[key + (period,)][k] += v

    for row in shot_rows:
        shooter_id = row["shooter_id"]
        shooter_team = row["team_id"]
        defending_team = home_team_id if shooter_team == away_team_id else away_team_id
        xg = row["xg"]
        danger = row["danger"]
        state = row["strength_state"]
        goal = int(bool(row.get("is_goal")))
        bp = BAND_PREFIX[danger]

        player_acc[shooter_id]["ixg"] += xg
        if row["is_rebound"]:
            player_acc[shooter_id]["ixg_rebound"] += xg
        if row["created_rebound"]:
            player_acc[shooter_id]["rebounds_created"] += 1
        player_acc[shooter_id]["ixg_adjusted"] += xg * shot_weight(row, score_factors, is_defending=False)

        if state == "other":
            continue  # pulled-goalie / non-standard situations — no reliable unit/strength attribution

        period_shifts = shifts_by_period.get(row["period"], [])
        on_ice = _skaters_only(on_ice_at(period_shifts, row["time_sec"]), positions)
        is_5v5 = state == "even"
        # danger chances are shots on goal with the goalie in net; xG covers every unblocked attempt
        chance = bool(row["on_goal"]) and row.get("opp_goalie") != 0

        # individual on-ice stats: "_all" covers every situation, "_5v5" is the
        # narrower subset also kept for comparison (same "keep both" pattern
        # used for raw Corsi vs. xG)
        for pid in on_ice.get(shooter_team, set()):
            player_acc[pid]["xgf_all"] += xg
            if chance:
                player_acc[pid][f"{DANGER_FOR_COLS[danger]}_all"] += 1
                player_acc[pid][f"{bp}gf_all"] += goal       # goals and expected goals by band (a shot on goal's xG is its chance of scoring)
                player_acc[pid][f"{bp}xgf_all"] += xg
            if is_5v5:
                player_acc[pid]["xgf_5v5"] += xg
                if chance:
                    player_acc[pid][f"{DANGER_FOR_COLS[danger]}_5v5"] += 1
        for pid in on_ice.get(defending_team, set()):
            player_acc[pid]["xga_all"] += xg
            if chance:
                player_acc[pid][f"{DANGER_AGAINST_COLS[danger]}_all"] += 1
                player_acc[pid][f"{bp}ga_all"] += goal
                player_acc[pid][f"{bp}xga_all"] += xg
            if is_5v5:
                player_acc[pid]["xga_5v5"] += xg
                if chance:
                    player_acc[pid][f"{DANGER_AGAINST_COLS[danger]}_5v5"] += 1

        # units: line/pair at even strength, whole group at pp/pk — covers
        # every situation already, so no separate "_all" variant needed
        defender_state = "pk" if state == "pp" else "pp" if state == "pk" else "even"
        xg_for_adj = xg * shot_weight(row, score_factors, is_defending=False)
        xg_against_adj = xg * shot_weight(row, score_factors, is_defending=True)
        for unit_type, player_ids in team_units(on_ice.get(shooter_team, set()), positions, state):
            add_unit(
                shooter_team, unit_type, player_ids, row["period"],
                xgf=xg, xgf_adjusted=xg_for_adj, **({DANGER_FOR_COLS[danger]: 1, f"{bp}gf": goal, f"{bp}xgf": xg} if chance else {}),
            )
        for unit_type, player_ids in team_units(on_ice.get(defending_team, set()), positions, defender_state):
            add_unit(
                defending_team, unit_type, player_ids, row["period"],
                xga=xg, xga_adjusted=xg_against_adj, **({DANGER_AGAINST_COLS[danger]: 1, f"{bp}ga": goal, f"{bp}xga": xg} if chance else {}),
            )

    _apply_player_stats(conn, game_id, player_acc, has_shifts=bool(shift_rows))
    _apply_unit_stats(conn, game_id, unit_acc)
    _apply_unit_period_stats(conn, game_id, unit_period_acc)
    conn.commit()


def _apply_player_stats(conn, game_id: int, player_acc: dict, has_shifts: bool = True) -> None:
    for player_id, stats in player_acc.items():
        row = conn.execute(
            """SELECT goals, primary_assists, secondary_assists, shots, blocks,
                      penalties_taken, penalties_drawn, faceoff_wins, faceoff_losses,
                      cf_5v5, ca_5v5, gf_5v5, ga_5v5
               FROM player_game_stats WHERE game_id = ? AND player_id = ?""",
            (game_id, player_id),
        ).fetchone()
        if row is None:
            continue
        base_stats = dict(
            zip(
                [
                    "goals", "primary_assists", "secondary_assists", "shots", "blocks",
                    "penalties_taken", "penalties_drawn", "faceoff_wins", "faceoff_losses",
                    "cf_5v5", "ca_5v5", "gf_5v5", "ga_5v5",
                ],
                row,
            )
        )
        full_stats = {**base_stats, **stats}
        new_score = gamescore.raw_game_score(full_stats) if has_shifts else None  # no shift data -> no Game Score

        conn.execute(
            """UPDATE player_game_stats SET
               ixg = ?, xgf_5v5 = ?, xga_5v5 = ?,
               hdcf_5v5 = ?, hdca_5v5 = ?, mdcf_5v5 = ?, mdca_5v5 = ?, ldcf_5v5 = ?, ldca_5v5 = ?,
               xgf_all = ?, xga_all = ?,
               hdcf_all = ?, hdca_all = ?, mdcf_all = ?, mdca_all = ?, ldcf_all = ?, ldca_all = ?,
               ixg_rebound = ?, rebounds_created = ?, ixg_adjusted = ?,
               raw_game_score = ?,
               """ + ", ".join(f"{c}_all = ?" for c in BAND_COLS) + """
               WHERE game_id = ? AND player_id = ?""",
            (
                stats.get("ixg", 0),
                stats.get("xgf_5v5", 0),
                stats.get("xga_5v5", 0),
                int(stats.get("hdcf_5v5", 0)),
                int(stats.get("hdca_5v5", 0)),
                int(stats.get("mdcf_5v5", 0)),
                int(stats.get("mdca_5v5", 0)),
                int(stats.get("ldcf_5v5", 0)),
                int(stats.get("ldca_5v5", 0)),
                stats.get("xgf_all", 0),
                stats.get("xga_all", 0),
                int(stats.get("hdcf_all", 0)),
                int(stats.get("hdca_all", 0)),
                int(stats.get("mdcf_all", 0)),
                int(stats.get("mdca_all", 0)),
                int(stats.get("ldcf_all", 0)),
                int(stats.get("ldca_all", 0)),
                stats.get("ixg_rebound", 0),
                int(stats.get("rebounds_created", 0)),
                stats.get("ixg_adjusted", 0),
                new_score,
                *[(int(stats.get(f"{c}_all", 0)) if "xg" not in c else stats.get(f"{c}_all", 0)) for c in BAND_COLS],
                game_id,
                player_id,
            ),
        )


def _apply_unit_period_stats(conn, game_id: int, unit_period_acc: dict) -> None:
    """Add the xG layer to the per-period unit rows (units.compute_game_units wrote the counts)."""
    for (team_id, unit_type, player_ids, period), stats in unit_period_acc.items():
        key = ",".join(str(p) for p in sorted(player_ids))
        row = conn.execute(
            "SELECT gf, ga FROM unit_period_stats WHERE game_id=? AND team_id=? AND unit_type=? AND player_ids=? AND period=?",
            (game_id, team_id, unit_type, key, period),
        ).fetchone()
        if row is None:
            continue
        gf, ga = row
        score = gf * UNIT_WEIGHTS["gf"] + ga * UNIT_WEIGHTS["ga"] + UNIT_WEIGHTS["xgf_adjusted"] * stats.get("xgf_adjusted", 0) + UNIT_WEIGHTS["xga_adjusted"] * stats.get("xga_adjusted", 0)
        conn.execute(
            """UPDATE unit_period_stats SET xgf = ?, xga = ?, hdcf = ?, hdca = ?, mdcf = ?, mdca = ?, ldcf = ?, ldca = ?, unit_score = ?
               WHERE game_id = ? AND team_id = ? AND unit_type = ? AND player_ids = ? AND period = ?""",
            (stats.get("xgf", 0), stats.get("xga", 0), int(stats.get("hdcf", 0)), int(stats.get("hdca", 0)),
             int(stats.get("mdcf", 0)), int(stats.get("mdca", 0)), int(stats.get("ldcf", 0)), int(stats.get("ldca", 0)),
             score, game_id, team_id, unit_type, key, period),
        )


def _apply_unit_stats(conn, game_id: int, unit_acc: dict) -> None:
    for (team_id, unit_type, player_ids), stats in unit_acc.items():
        key = ",".join(str(p) for p in sorted(player_ids))
        row = conn.execute(
            "SELECT cf, ca, gf, ga FROM unit_game_stats WHERE game_id=? AND team_id=? AND unit_type=? AND player_ids=?",
            (game_id, team_id, unit_type, key),
        ).fetchone()
        if row is None:
            continue  # every xG-scored shot is also a Corsi event, so this shouldn't happen
        base = dict(zip(["cf", "ca", "gf", "ga"], row))
        full_stats = {**base, **stats}
        new_score = sum(UNIT_WEIGHTS.get(k, 0) * full_stats.get(k, 0) for k in set(UNIT_WEIGHTS) | set(stats))

        conn.execute(
            """UPDATE unit_game_stats SET
               xgf = ?, xga = ?, hdcf = ?, hdca = ?, mdcf = ?, mdca = ?, ldcf = ?, ldca = ?,
               xgf_adjusted = ?, xga_adjusted = ?,
               unit_score = ?,
               """ + ", ".join(f"{c} = ?" for c in BAND_COLS) + """
               WHERE game_id = ? AND team_id = ? AND unit_type = ? AND player_ids = ?""",
            (
                stats.get("xgf", 0),
                stats.get("xga", 0),
                int(stats.get("hdcf", 0)),
                int(stats.get("hdca", 0)),
                int(stats.get("mdcf", 0)),
                int(stats.get("mdca", 0)),
                int(stats.get("ldcf", 0)),
                int(stats.get("ldca", 0)),
                stats.get("xgf_adjusted", 0),
                stats.get("xga_adjusted", 0),
                new_score,
                *[(int(stats.get(c, 0)) if "xg" not in c else stats.get(c, 0)) for c in BAND_COLS],
                game_id,
                team_id,
                unit_type,
                key,
            ),
        )
