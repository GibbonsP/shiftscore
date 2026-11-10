from collections import defaultdict

from .shot_features import extract_game_shot_rows
from .xg_model import predict_danger, predict_xg


def starters(conn) -> dict:
    """{(game_id, team_id): goalie_id}: the goalie who started the game for that team. A goalie who was pulled after a few shots is still the
    starter, so this is who was in net at the opening faceoff, not who faced the most shots.
    1. the shift chart: the goalie whose first shift of period 1 starts at 0:00;
    2. otherwise (no shift chart yet, or a gap in it) the goalie who faced the team's first shot on goal;
    3. otherwise the goalie who faced the most shots."""
    out: dict = {}
    for gid, tid, pid in conn.execute(
        "SELECT DISTINCT s.game_id, s.team_id, s.player_id FROM shifts s JOIN players p ON p.player_id = s.player_id "
        "WHERE p.position = 'G' AND s.period = 1 AND s.start_sec = 0 ORDER BY s.game_id, s.team_id, s.player_id"
    ):
        out.setdefault((gid, tid), pid)
    rows = conn.execute("SELECT game_id, team_id, goalie_id, shots_faced FROM goalie_game_stats").fetchall()
    missing = {(g, t) for g, t, _, _ in rows if (g, t) not in out}
    if missing:
        import json
        by_goalie = {(g, p): t for g, t, p, _ in rows}
        games = sorted({g for g, _ in missing})
        for gid in games:
            for etype, details in conn.execute(
                "SELECT type, details_json FROM events WHERE game_id = ? AND type IN ('shot-on-goal', 'goal') ORDER BY period, time_sec, rowid", (gid,)
            ):
                try:
                    goalie = json.loads(details or "{}").get("goalieInNetId")
                except ValueError:
                    continue
                team = by_goalie.get((gid, goalie))
                if team is not None and (gid, team) in missing and (gid, team) not in out:
                    out[(gid, team)] = goalie
        for g, t, p, n in sorted(rows, key=lambda r: -r[3]):
            if (g, t) in missing and (g, t) not in out:
                out[(g, t)] = p
    return out


def compute_game_goalie_stats(conn, game_id: int, pipeline) -> None:
    shot_rows = extract_game_shot_rows(conn, game_id)
    if not shot_rows:
        return
    xg_values = predict_xg(pipeline, shot_rows)
    # expected goals against use the chance each shot ON GOAL had of scoring (the danger model): that is the shot the goalie faced
    danger = predict_danger(shot_rows)

    # the goalie's team is the DEFENDING team — the shot's own team_id is the
    # shooter's team, so look up each goalie's actual team from shifts rather
    # than assume (handles the rare goalie-swap-mid-game case correctly)
    goalie_team = dict(
        conn.execute(
            "SELECT DISTINCT player_id, team_id FROM shifts WHERE game_id = ?", (game_id,)
        ).fetchall()
    )

    acc: dict[int, dict] = defaultdict(lambda: defaultdict(float))
    for row, xg, dp in zip(shot_rows, xg_values, danger):
        goalie_id = row["goalie_id"]
        if goalie_id is None:
            continue  # empty net — no goalie to attribute this shot to
        # shots faced are shots on goal (saves plus goals), so save % is the usual saves / shots on goal. Expected goals against sum the
        # chance each of those shots on goal had of scoring (shots that missed the net were never faced and add nothing). Before November
        # 2026 this summed the attempt xG over every unblocked attempt, misses included; see METHODOLOGY.md, "Goalie expected goals".
        if row["on_goal"]:
            acc[goalie_id]["shots_faced"] += 1
            acc[goalie_id]["xga"] += float(dp)
        if row["is_goal"]:
            acc[goalie_id]["goals_allowed"] += 1

    conn.execute("DELETE FROM goalie_game_stats WHERE game_id = ?", (game_id,))
    for goalie_id, stats in acc.items():
        gsax = stats["xga"] - stats["goals_allowed"]
        conn.execute(
            """INSERT INTO goalie_game_stats
               (game_id, goalie_id, team_id, shots_faced, goals_allowed, xga, gsax)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                game_id,
                goalie_id,
                goalie_team.get(goalie_id),
                int(stats["shots_faced"]),
                int(stats["goals_allowed"]),
                stats["xga"],
                gsax,
            ),
        )
    conn.commit()
