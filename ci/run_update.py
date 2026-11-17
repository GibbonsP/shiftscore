"""One scheduled update: ingest the games that are due, rebuild what changed, and refresh the schedule on the page.

Prints what happened and writes `updated=true|false` to $GITHUB_OUTPUT (the page is always rebuilt, because the schedule and
scores in it age; `updated` says whether new games were ingested).
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
sys.path.insert(0, ROOT)
from nhl_impact import updater  # noqa: E402

event = updater.run()
if event:
    brief = {k: (len(v) if k == "changed" else v) for k, v in event.items() if k not in ("page", "root")}
    print(json.dumps(brief))
    if event.get("event") == "update_failed":
        print("update failed:", json.dumps(event)[:800], file=sys.stderr)
        sys.exit(1)
else:
    print("no finished games due")
# the schedule and the final scores of games not yet processed live in the page: refresh them on every run
subprocess.run([sys.executable, "refresh_schedule.py"], check=True)
out = os.environ.get("GITHUB_OUTPUT")
if out:
    with open(out, "a") as f:
        f.write(f"updated={'true' if event else 'false'}\n")
        # the first run of an even UTC hour (the one before :15) is the two-hourly refresh slot: deploy even when no new game came in (the schedule and scores on the page age)
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        f.write(f"slot={'true' if now.hour % 2 == 0 and now.minute < 15 else 'false'}\n")
