"""Decide whether an Update site run has anything to do, so the many scheduled runs at game time cost a few seconds when it is quiet.

A scheduled run at night (22:00-07:59 UTC) has work only when a game is in progress, starts within the next hour, or finished (started in
the last 7 hours) and is not on the live site yet. Once every game that ended is published the runs stop doing anything. Daytime runs, manual runs and anything unexpected always go ahead. If the schedule can't be
read it goes ahead too. Writes work=true|false to $GITHUB_OUTPUT. Standard library only, so it runs before anything is installed.
"""
import json
import os
import urllib.request
from datetime import datetime, timedelta, timezone

WEB = "https://api-web.nhle.com/v1"


def on_site(game: dict) -> bool:
    """Is this finished game already published on the live site? (its home team's game file holds it)"""
    site = os.environ.get("SITE_URL", "").rstrip("/")
    if not site:
        return False
    gid = str(game["id"])
    season = f"{gid[:4]}{int(gid[:4]) + 1}"
    home = game["homeTeam"]["abbrev"]
    req = urllib.request.Request(f"{site}/data/{season}/games/{home}.json?t={int(datetime.now(timezone.utc).timestamp())}", headers={"User-Agent": "shiftscore-gate"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return f'"{gid}"' in resp.read().decode("utf-8", "replace")
    except Exception:
        return False


def decide() -> tuple[bool, str]:
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    now = datetime.now(timezone.utc)
    if event != "schedule":
        return True, f"{event or 'manual'} run: going ahead"
    if not (now.hour >= 22 or now.hour < 8):
        return True, "daytime run: going ahead"
    seen = {}
    for day in {(now - timedelta(hours=5)).date(), (now - timedelta(hours=29)).date()}:
        req = urllib.request.Request(f"{WEB}/schedule/{day.isoformat()}", headers={"User-Agent": "shiftscore-gate"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            for d in json.load(resp).get("gameWeek", []):
                for g in d.get("games", []):
                    if g.get("gameType") in (1, 2):
                        seen[g["id"]] = g
    for g in seen.values():
        st = g.get("gameState", "")
        if st in ("LIVE", "CRIT"):
            return True, f"game {g['id']} is in progress"
        if st in ("PPD", "CNCL", "SUSP"):
            continue
        try:
            start = datetime.fromisoformat(g["startTimeUTC"].replace("Z", "+00:00"))
        except Exception:
            continue
        if start > now + timedelta(hours=1) or start < now - timedelta(hours=7):
            continue
        if st in ("FUT", "PRE"):
            return True, f"game {g['id']} starts at {start:%H:%M} UTC"
        if not on_site(g):
            return True, f"game {g['id']} ({st}) is not on the site yet"
    return False, f"nothing to do: no game in progress or starting within the hour, and every finished game is on the site ({len(seen)} on the schedule)"


try:
    work, why = decide()
except Exception as e:                      # fail open: a broken check must never stop the site updating
    work, why = True, f"couldn't read the schedule ({type(e).__name__}: {e}): going ahead"
print(("RUN: " if work else "SKIP: ") + why)
out = os.environ.get("GITHUB_OUTPUT")
if out:
    with open(out, "a") as f:
        f.write(f"work={'true' if work else 'false'}\n")
