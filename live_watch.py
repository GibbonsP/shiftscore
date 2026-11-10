"""Poll the NHL scoreboard and emit ONE line whenever there is something to write to the site.

Meant to be run under a monitor (each stdout line wakes the session, which then writes the
listed documents into the artifact's `live` collection). Silent when nothing changed, so an
idle night costs nothing. Sleeps 60s while games are in play, otherwise until ~10 minutes before the
next puck drop (at most 30 minutes).

    python live_watch.py
"""
import json
import os
import time

os.chdir(os.path.dirname(os.path.abspath(__file__)))
from nhl_impact import live  # noqa: E402

last_error = None
while True:
    try:
        r = live.tick()
        last_error = None
        if r["docs"] or r["stale_docs"]:
            print(json.dumps({
                "ids": [d["doc_id"] for d in r["docs"]], "live": r["live"],
                "stale": r["stale_docs"], "date": r["date"], "dir": os.path.abspath(live.OUT_DIR),
            }), flush=True)
        time.sleep(r["next_sleep_sec"])
    except Exception as e:  # network blips etc. must not kill the watcher
        msg = f"{type(e).__name__}: {e}"
        if msg != last_error:  # report each distinct failure once
            print(f"ERROR {msg}", flush=True)
            last_error = msg
        time.sleep(120)
