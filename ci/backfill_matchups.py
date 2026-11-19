"""Fill in the line and pair matchup rows (nhl_impact/matchups.py) for every processed game that lacks them, so the first update after
this feature ships backfills the whole history (about a tenth of a second a game). Writes filled=true|false to $GITHUB_OUTPUT so the
workflow knows to save the database. Safe to run every time: with nothing missing it does nothing."""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
sys.path.insert(0, ROOT)
from nhl_impact import db, matchups  # noqa: E402

conn = db.connect("nhl_impact.db")
t = time.time()
n = matchups.backfill(conn, max_seconds=25 * 60)
left = len(matchups.missing_games(conn))
conn.close()
print(f"matchups: {n} games filled in {time.time() - t:.0f}s, {left} still missing")
out = os.environ.get("GITHUB_OUTPUT")
if out:
    with open(out, "a") as f:
        f.write(f"filled={'true' if n else 'false'}\n")
