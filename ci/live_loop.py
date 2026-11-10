"""Run the live scorer in the cloud: tick every minute while games are in play, copy each changed document to the public live
bucket (index.json and g_<gameId>.json, which the site polls), and stop when the night is over.

Needs R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_LIVE_BUCKET. Runs for at most MAX_HOURS (a GitHub job is
limited to 6 hours), so the workflow starts it twice on a game night.
"""
import json
import os
import sys
import time
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
sys.path.insert(0, ROOT)
import boto3  # noqa: E402

from nhl_impact import live  # noqa: E402

MAX_SECONDS = float(os.environ.get("MAX_HOURS", "5.6")) * 3600
IDLE_EXIT_SEC = 90 * 60          # nothing in play and the next puck drop is further away than this: stop
BUCKET = os.environ["R2_LIVE_BUCKET"]
s3 = boto3.client("s3", endpoint_url=os.environ["R2_ENDPOINT"], aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
                  aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto")
started = time.time()
idle_since = None
print("live loop started", datetime.now(timezone.utc).isoformat(timespec="seconds"), flush=True)
while time.time() - started < MAX_SECONDS:
    try:
        r = live.tick()
        for d in r["docs"]:
            s3.upload_file(d["file_path"], BUCKET, f"live/{d['doc_id']}.json",
                           ExtraArgs={"ContentType": "application/json", "CacheControl": "no-store, max-age=0"})
        for doc_id in r["stale_docs"]:
            s3.delete_object(Bucket=BUCKET, Key=f"live/{doc_id}.json")
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
