import argparse
import json
import time

from nhl_impact import adjustments, api, calibrate, db, goalie_stats, impact, ingest, report, units, xg_model, xg_stats


def cmd_ingest(args):
    conn = db.connect(args.db)
    games = api.get_team_schedule(args.team, args.season)
    if args.limit:
        games = games[: args.limit]

    game_ids = []
    for i, g in enumerate(games):
        game_id = g["id"]
        print(f"[{i+1}/{len(games)}] ingesting game {game_id} ({g['gameDate']})")
        ingest.ingest_game(conn, game_id)
        game_ids.append(game_id)
        time.sleep(0.3)

    for i, game_id in enumerate(game_ids):
        print(f"[{i+1}/{len(game_ids)}] computing impact/units for game {game_id}")
        impact.compute_game_impacts(conn, game_id)
        units.compute_game_units(conn, game_id)
        ingest.compute_extra_stats(conn, game_id)

    conn.close()


def cmd_ingest_all(args):
    conn = db.connect(args.db)
    teams = api.get_current_teams()
    print(f"{len(teams)} teams")

    games_by_id = {}
    for team in teams:
        for g in api.get_team_schedule(team, args.season):
            games_by_id[g["id"]] = g
        time.sleep(0.2)

    games = sorted(games_by_id.values(), key=lambda g: g["gameDate"])
    # the schedule includes games that haven't been played yet (and, mid-season,
    # in-progress ones) — only completed games have full shift/event data
    games = [g for g in games if g.get("gameState") in ("OFF", "FINAL")]
    if not args.refetch:
        # "have" = fully ingested (has player stats), so a game that failed
        # partway through an earlier run gets retried instead of skipped
        have = {r[0] for r in conn.execute("SELECT DISTINCT game_id FROM player_game_stats").fetchall()}
        games = [g for g in games if g["id"] not in have]
    if args.limit:
        games = games[: args.limit]
    print(f"{len(games)} unique games to ingest")

    for i, g in enumerate(games):
        game_id = g["id"]
        print(f"[{i+1}/{len(games)}] ingesting game {game_id} ({g['gameDate']})")
        try:
            ingest.ingest_game(conn, game_id)
        except Exception as e:
            print(f"  failed: {e}")
        time.sleep(0.3)

    for i, g in enumerate(games):
        game_id = g["id"]
        if i % 50 == 0:
            print(f"[{i+1}/{len(games)}] computing impact/units for game {game_id}")
        impact.compute_game_impacts(conn, game_id)
        units.compute_game_units(conn, game_id)
        ingest.compute_extra_stats(conn, game_id)

    conn.close()


def cmd_recompute_impacts(args):
    """Recompute QoC/QoT/adjusted impact for every game, in date order. Needed
    after anything that changes raw_game_score (apply-xg), since each game's
    ratings are built from earlier games' scores."""
    conn = db.connect(args.db)
    game_ids = [r[0] for r in conn.execute("SELECT game_id FROM games ORDER BY game_date, game_id").fetchall()]
    for i, gid in enumerate(game_ids):
        if i % 100 == 0:
            print(f"[{i+1}/{len(game_ids)}] recomputing impact for game {gid}")
        impact.compute_game_impacts(conn, gid)
    conn.close()


def cmd_fix_shootouts(args):
    """One-time repair: recompute goals/shots per player from stored events,
    excluding the shootout (older ingests counted shootout goals as goals)."""
    conn = db.connect(args.db)
    game_ids = [r[0] for r in conn.execute("SELECT DISTINCT game_id FROM events WHERE period >= 5").fetchall()]
    before = conn.execute("SELECT SUM(goals), SUM(shots) FROM player_game_stats").fetchone()
    for gid in game_ids:
        ingest.retally_goals_shots(conn, gid)
    after = conn.execute("SELECT SUM(goals), SUM(shots) FROM player_game_stats").fetchone()
    print(f"{len(game_ids)} shootout games repaired; goals {before[0]} -> {after[0]}, shots {before[1]} -> {after[1]}")
    conn.close()


def cmd_recompute_onice(args):
    """Rebuild on-ice tallies and line/pair/PP/PK unit stats for every game from stored events and
    shifts (after a fix to the on-ice lookup). Follow with apply-xg to re-add the xG layer."""
    conn = db.connect(args.db)
    game_ids = [r[0] for r in conn.execute("SELECT game_id FROM games ORDER BY game_date").fetchall()]
    for i, gid in enumerate(game_ids):
        if i % 200 == 0:
            print(f"[{i+1}/{len(game_ids)}] recomputing on-ice stats for game {gid}")
        ingest.recompute_onice_tallies(conn, gid)
        units.compute_game_units(conn, gid)
    conn.close()


def cmd_extra_stats(args):
    """Backfill hits/takeaways/giveaways/PIM/zone-starts for already-ingested
    games — pure reprocessing of stored events/shifts, no API calls."""
    conn = db.connect(args.db)
    game_ids = [r[0] for r in conn.execute("SELECT game_id FROM games ORDER BY game_date").fetchall()]
    for i, gid in enumerate(game_ids):
        if i % 100 == 0:
            print(f"[{i+1}/{len(game_ids)}] computing extra stats for game {gid}")
        ingest.compute_extra_stats(conn, gid)
    conn.close()


def cmd_units(args):
    conn = db.connect(args.db)
    rows = conn.execute(
        """SELECT u.player_ids, u.unit_type, t.abbrev, gm.game_date,
                  u.toi_sec, u.cf, u.ca, u.gf, u.ga, u.unit_score
           FROM unit_game_stats u
           JOIN games gm ON gm.game_id = u.game_id
           JOIN (SELECT home_team_id AS id, home_team_abbrev AS abbrev FROM games
                 UNION SELECT away_team_id, away_team_abbrev FROM games) t
             ON t.id = u.team_id
           WHERE u.unit_type = ? AND u.toi_sec >= ?
           ORDER BY u.unit_score DESC
           LIMIT ?""",
        (args.type, args.min_toi, args.limit),
    ).fetchall()

    players = dict(conn.execute("SELECT player_id, first_name || ' ' || last_name FROM players").fetchall())

    print(f"{'Unit':<38}{'Team':<6}{'Date':<12}{'TOI':>6}{'CF':>5}{'CA':>5}{'GF':>5}{'GA':>5}{'Score':>8}")
    for player_ids, unit_type, team, date, toi, cf, ca, gf, ga, score in rows:
        names = " / ".join(players.get(int(pid), pid) for pid in player_ids.split(","))
        toi_str = f"{toi // 60}:{toi % 60:02d}"
        print(f"{names:<38}{team:<6}{date:<12}{toi_str:>6}{cf:>5}{ca:>5}{gf:>5}{ga:>5}{score:>8.2f}")

    conn.close()


SEASON_LABELS = lambda s: f"{s[:4]}-{s[6:]}"


def cmd_report(args):
    """One self-contained report per season under report/{season}/, plus a
    season picker at report/index.html."""
    import os

    from nhl_impact import season_slice

    conn = db.connect(args.db)
    all_seasons = season_slice.seasons(conn)
    conn.close()
    pipeline = xg_model.load(args.model)
    wanted = [args.season] if args.season else all_seasons
    for season in wanted:
        print(f"building {season}...")
        sconn = season_slice.slice_season(args.db, season, f"build/season_{season}.db")
        report.generate_report(sconn, os.path.join(args.out, season), pipeline)
        sconn.close()
    links = "".join(f'<li><a href="{s}/index.html">{SEASON_LABELS(s)} regular season</a></li>' for s in reversed(all_seasons))
    with open(os.path.join(args.out, "index.html"), "w") as f:
        f.write(f"<!doctype html><meta charset=utf-8><title>NHL Impact</title><h1>NHL Impact</h1><ul>{links}</ul>")
    print(f"report written to {args.out}/index.html")


def cmd_train_xg(args):
    conn = db.connect(args.db)
    metrics = xg_model.train(conn, model_path=args.model)
    danger = xg_model.train_danger(xg_model.build_dataset(conn))   # P(goal | shot on goal), for the danger bands
    conn.close()
    print("danger model (shots on goal):", {k: round(v, 4) if isinstance(v, float) else v for k, v in danger.items()})
    for k, v in metrics.items():
        if k == "calibration":
            print("calibration (predicted -> actual goal rate, by decile):")
            for row in v:
                print(f"   {row['predicted']:.4f} -> {row['actual']:.4f}   (n={row['n']})")
        else:
            print(f"{k}: {v:.4f}" if isinstance(v, float) else f"{k}: {v}")


def cmd_apply_xg(args):
    conn = db.connect(args.db)
    pipeline = xg_model.load(args.model)
    print("computing score-state adjustment factors (one pass over all games)...")
    score_factors = adjustments.compute_score_adjustment_factors(conn)
    print("score_factors:", {k: (round(v[0], 3), round(v[1], 3)) for k, v in score_factors.items()})
    with open("models/score_factors.json", "w") as f:  # reused by the live-game scorer (live.py)
        json.dump({str(k): list(v) for k, v in score_factors.items()}, f)
    game_ids = [r[0] for r in conn.execute("SELECT game_id FROM games ORDER BY game_date").fetchall()]
    for i, gid in enumerate(game_ids):
        if i % 100 == 0:
            print(f"[{i+1}/{len(game_ids)}] scoring xG for game {gid}")
        xg_stats.compute_game_xg(conn, gid, pipeline, score_factors)
    conn.close()


def cmd_apply_goalies(args):
    conn = db.connect(args.db)
    pipeline = xg_model.load(args.model)
    game_ids = [r[0] for r in conn.execute("SELECT game_id FROM games ORDER BY game_date").fetchall()]
    for i, gid in enumerate(game_ids):
        if i % 100 == 0:
            print(f"[{i+1}/{len(game_ids)}] scoring goalie stats for game {gid}")
        goalie_stats.compute_game_goalie_stats(conn, gid, pipeline)
    conn.close()


def cmd_calibrate(args):
    conn = db.connect(args.db)
    result = calibrate.fit_predictive_weights(conn)
    conn.close()
    print(f"n_train={result['n_train']} n_test={result['n_test']} n_total={result['n_total']}")
    print(f"test_r2={result['test_r2']:.4f} (held-out, chronological split, alpha={result['alpha']})")
    print()
    for k, v in result["weights"].items():
        print(f"{k}: {v}")

    if args.apply:
        with open(args.weights_out, "w") as f:
            json.dump(result["weights"], f, indent=2)
        print(f"\nweights saved to {args.weights_out}")
        conn = db.connect(args.db)
        calibrate.apply_predicted_value(conn, result["weights"])
        conn.close()
        print("predicted_value applied to all player_game_stats rows")


def cmd_leaderboard(args):
    conn = db.connect(args.db)
    rows = conn.execute(
        """SELECT p.first_name, p.last_name, gm.game_date, pgi.raw_game_score,
                  pgi.qoc, pgi.qot, pgi.adjusted_impact
           FROM player_game_impact pgi
           JOIN players p ON p.player_id = pgi.player_id
           JOIN games gm ON gm.game_id = pgi.game_id
           ORDER BY pgi.adjusted_impact DESC
           LIMIT ?""",
        (args.limit,),
    ).fetchall()

    print(f"{'Player':<22}{'Date':<12}{'Raw':>8}{'QoC':>8}{'QoT':>8}{'Adjusted':>10}")
    for first, last, date, raw, qoc, qot, adj in rows:
        name = f"{first} {last}"
        print(f"{name:<22}{date:<12}{raw:>8.2f}{qoc:>8.2f}{qot:>8.2f}{adj:>10.2f}")

    conn.close()


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    p_ingest = sub.add_parser("ingest")
    p_ingest.add_argument("team")
    p_ingest.add_argument("season")
    p_ingest.add_argument("--limit", type=int, default=None)
    p_ingest.add_argument("--db", default="nhl_impact.db")
    p_ingest.set_defaults(func=cmd_ingest)

    p_all = sub.add_parser("ingest-all")
    p_all.add_argument("season")
    p_all.add_argument("--limit", type=int, default=None)
    p_all.add_argument("--refetch", action="store_true", help="re-ingest games already in the DB")
    p_all.add_argument("--db", default="nhl_impact.db")
    p_all.set_defaults(func=cmd_ingest_all)

    p_lb = sub.add_parser("leaderboard")
    p_lb.add_argument("--limit", type=int, default=20)
    p_lb.add_argument("--db", default="nhl_impact.db")
    p_lb.set_defaults(func=cmd_leaderboard)

    p_units = sub.add_parser("units")
    p_units.add_argument("type", choices=["line", "pair", "pp", "pk"])
    p_units.add_argument("--limit", type=int, default=20)
    p_units.add_argument("--min-toi", type=int, default=60, help="minimum seconds together")
    p_units.add_argument("--db", default="nhl_impact.db")
    p_units.set_defaults(func=cmd_units)

    p_report = sub.add_parser("report")
    p_report.add_argument("--out", default="report")
    p_report.add_argument("--model", default="models/xg_model.joblib")
    p_report.add_argument("--season", default=None, help="e.g. 20242025; default builds every season")
    p_report.add_argument("--db", default="nhl_impact.db")
    p_report.set_defaults(func=cmd_report)

    p_train = sub.add_parser("train-xg")
    p_train.add_argument("--model", default="models/xg_model.joblib")
    p_train.add_argument("--db", default="nhl_impact.db")
    p_train.set_defaults(func=cmd_train_xg)

    p_apply = sub.add_parser("apply-xg")
    p_apply.add_argument("--model", default="models/xg_model.joblib")
    p_apply.add_argument("--db", default="nhl_impact.db")
    p_apply.set_defaults(func=cmd_apply_xg)

    p_goalies = sub.add_parser("apply-goalies")
    p_goalies.add_argument("--model", default="models/xg_model.joblib")
    p_goalies.add_argument("--db", default="nhl_impact.db")
    p_goalies.set_defaults(func=cmd_apply_goalies)

    p_recompute = sub.add_parser("recompute-impacts")
    p_recompute.add_argument("--db", default="nhl_impact.db")
    p_recompute.set_defaults(func=cmd_recompute_impacts)

    p_fix = sub.add_parser("fix-shootouts")
    p_fix.add_argument("--db", default="nhl_impact.db")
    p_fix.set_defaults(func=cmd_fix_shootouts)

    p_onice = sub.add_parser("recompute-onice")
    p_onice.add_argument("--db", default="nhl_impact.db")
    p_onice.set_defaults(func=cmd_recompute_onice)

    p_extra = sub.add_parser("extra-stats")
    p_extra.add_argument("--db", default="nhl_impact.db")
    p_extra.set_defaults(func=cmd_extra_stats)

    p_calib = sub.add_parser("calibrate")
    p_calib.add_argument("--apply", action="store_true", help="save weights and apply predicted_value to all games")
    p_calib.add_argument("--weights-out", default="models/predicted_value_weights.json")
    p_calib.add_argument("--db", default="nhl_impact.db")
    p_calib.set_defaults(func=cmd_calibrate)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
