"""Refresh the schedule embedded in the site page (past week through the next four weeks) and re-assemble the page.

    python refresh_schedule.py          # fetch from the NHL API, update artifact_data/page_data.json, rebuild the page
"""
import datetime
import json
import os
import subprocess
import sys

os.chdir(os.path.dirname(os.path.abspath(__file__)))
from nhl_impact import api

today = datetime.date.today()
start, end = (today - datetime.timedelta(days=7)).isoformat(), (today + datetime.timedelta(days=28)).isoformat()
rows = api.get_schedule_window(start, end)
data = json.load(open("artifact_data/page_data.json"))
data["schedule"] = rows
with open("artifact_data/page_data.json", "w") as f:
    json.dump(data, f, separators=(",", ":"))
print(f"schedule: {len(rows)} games, {start} to {end}")
sys.exit(subprocess.call([sys.executable, "build_artifact.py", "--page-only"]))
