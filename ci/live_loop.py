"""Run the live scorer in the cloud: tick every minute while games are in play, copy each changed document to the public live
bucket (index.json and g_<gameId>.json, which the site polls), and stop when the night is over.

Needs R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_LIVE_BUCKET. Runs for at most MAX_HOURS (a GitHub job is
limited to 6 hours), so the workflow starts it twice on a game night.
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
sys.path.insert(0, ROOT)
import boto3  # noqa: E402

from nhl_impact import live  # noqa: E402

MAX_SECONDS = float(os.environ.get("MAX_HOURS", "5.6")) * 3600
IDLE_EXIT_SEC = 4 * 3600         # nothing in play and the next puck drop is further away than this: stop (the evening start is ~2h before the first puck)
BUCKET = os.environ["R2_LIVE_BUCKET"]
s3 = boto3.client("s3", endpoint_url=os.environ["R2_ENDPOINT"], aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
                  aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto")
started = time.time()
idle_since = None

# GitHub's own scheduler skips and delays runs (a finished game can wait hours for the next Update site run), so when a game ends this loop
# asks for the update itself: 20 and 50 minutes after it sees the final (the NHL's shift data takes a while to appear). The update then
# deploys only if it ingested something new. Needs GITHUB_TOKEN with actions: write (see live.yml); without it nothing happens.
FINAL_STATES = {"FINAL", "OFF", "OVER"}
UPDATE_DELAYS = (20 * 60, 50 * 60)
final_seen = None            # game ids already final (None until the first tick: games that ended before this run started are not chased)
update_due = []              # times at which to ask for an update
dispatches = 0


def request_update():
    token, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        print("no GITHUB_TOKEN: not asking for an update", flush=True)
        return
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/actions/workflows/update-site.yml/dispatches", method="POST",
        data=json.dumps({"ref": os.environ.get("GITHUB_REF_NAME", "main"), "inputs": {"only_if_new": "true"}}).encode(),
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        print(f"asked Update site to run (HTTP {resp.status})", flush=True)


def watch_finals(docs):
    """Note games that just became final; schedule an update for each."""
    global final_seen
    idx = next((d for d in docs if d["doc_id"] == "index"), None)
    if not idx:
        return
    with open(idx["file_path"]) as fh:
        finals = {g["id"] for g in json.load(fh).get("games", []) if g.get("state") in FINAL_STATES}
    if final_seen is None:
        final_seen = finals
        return
    if finals - final_seen:
        now_ = time.time()
        update_due.extend(now_ + d for d in UPDATE_DELAYS)
    final_seen |= finals

print("live loop started", datetime.now(timezone.utc).isoformat(timespec="seconds"), flush=True)
while time.time() - started < MAX_SECONDS:
    try:
        r = live.tick()
        for d in r["docs"]:
            s3.upload_file(d["file_path"], BUCKET, f"live/{d['doc_id']}.json",
                           ExtraArgs={"ContentType": "application/json", "CacheControl": "no-store, max-age=0"})
        for doc_id in r["stale_docs"]:
            s3.delete_object(Bucket=BUCKET, Key=f"live/{doc_id}.json")
        watch_finals(r["docs"])
        for due in [t for t in update_due if t <= time.time()]:
            update_due.remove(due)
            if dispatches < 20 and not any(abs(due - t) < 600 for t in update_due):   # one request covers dues within ten minutes of each other
                dispatches += 1
                try:
                    request_update()
                except Exception as e:
                    print(f"update request failed: {type(e).__name__}: {e}", flush=True)
        if r["docs"] or r["stale_docs"]:
            print(json.dumps({"wrote": [d["doc_id"] for d in r["docs"]], "live": r["live"], "date": r["date"]}), flush=True)
        if r["live"]:
            idle_since = None
        else:
            idle_since = idle_since or time.time()
            # nothing in play: leave if the next game is far off (next_sleep_sec is capped at 30 minutes, so use the idle clock)
            if r["next_sleep_sec"] >= 1800 and time.time() - idle_since > IDLE_EXIT_SEC:
                print("no games in play or starting soon; stopping", flush=True)
                break
        time.sleep(max(30, min(r["next_sleep_sec"], 300)))     # never sleep long, so a late start is noticed within five minutes
    except Exception as e:                                       # a network blip must not end the night
        print(f"tick failed: {type(e).__name__}: {e}", flush=True)
        time.sleep(60)
print("live loop finished", datetime.now(timezone.utc).isoformat(timespec="seconds"), flush=True)
