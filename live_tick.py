"""One live-scoring tick: fetch today's games, rebuild the ones in play, and write the
documents the site's Live tab reads into live_out/. Prints a JSON summary.

    python live_tick.py                 # normal tick
    python live_tick.py --force         # rewrite every document even if unchanged
    python live_tick.py --replay GAMEID [--as-live]
                                        # build a finished game's documents for testing the page
"""
import argparse
import json
import os
import sys

from nhl_impact import live, xg_model

p = argparse.ArgumentParser()
p.add_argument("--force", action="store_true")
p.add_argument("--replay", type=int, default=None)
p.add_argument("--as-live", action="store_true", help="with --replay: label the game as in progress")
args = p.parse_args()
os.chdir(os.path.dirname(os.path.abspath(__file__)))

if args.replay:
    os.makedirs(live.OUT_DIR, exist_ok=True)
    pipeline = xg_model.load("models/xg_model.joblib")
    b = live.build_live_game(args.replay, pipeline, live.load_score_factors())
    status = "P2 12:34" if args.as_live else "FINAL"
    b["live"] = {"state": "LIVE" if args.as_live else "FINAL", "status": status, "updated": "2026-01-01T00:00:00+00:00"}
    sb = {"id": args.replay, "gameState": "LIVE" if args.as_live else "FINAL",
          "awayTeam": {"abbrev": b["away"], "score": b["as"]}, "homeTeam": {"abbrev": b["home"], "score": b["hs"]}}
    entry = live._index_entry(sb, b); entry["status"] = status
    json.dump({"game": b, "updated": b["live"]["updated"]}, open(f"{live.OUT_DIR}/g_{args.replay}.json", "w"), separators=(",", ":"))
    json.dump({"updated": b["live"]["updated"], "date": "replay", "games": [entry]}, open(f"{live.OUT_DIR}/index.json", "w"), separators=(",", ":"))
    print(json.dumps({"replay": args.replay, "bytes": os.path.getsize(f"{live.OUT_DIR}/g_{args.replay}.json")}))
    sys.exit(0)

print(json.dumps(live.tick(force=args.force)))
