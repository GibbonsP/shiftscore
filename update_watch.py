"""Keep the hosted site's season data current as games finish; emit ONE line when files are ready to publish.

Run under a monitor next to live_watch.py. Every INTERVAL seconds it asks nhl_impact.updater whether any finished game
is due (see that module), and if so ingests it, rebuilds the affected seasons, stages the changed files under publish/,
and prints a JSON line naming them. The session then publishes the page and those files with the Artifact tool.
Silent when nothing is due.

    python update_watch.py            # loop
    python update_watch.py --once     # one pass (prints nothing if nothing was due)
"""
import json
import os
import sys
import time

os.chdir(os.path.dirname(os.path.abspath(__file__)))
from nhl_impact import updater  # noqa: E402

INTERVAL = 20 * 60
last_error = None
while True:
    try:
        r = updater.run()
        last_error = None
        if r:
            print(json.dumps(r), flush=True)
    except Exception as e:  # network blips etc. must not kill the watcher
        msg = f"{type(e).__name__}: {e}"
        if msg != last_error:
            print(f"ERROR {msg}", flush=True)
            last_error = msg
    if "--once" in sys.argv:
        break
    time.sleep(INTERVAL)
