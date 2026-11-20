"""Full-size player headshots for the places that show a photo large (the player and unit pages' card header, the shareable card images).

The small 168px thumbnails (fetch_images.py) stay in the per-team files for tables and lists. These are the NHL's own 336px images, flattened onto
the same ice-blue backdrop and saved as high-quality JPEGs, one static file per player: artifact_data/photos_lg/{player_id}.jpg (about 15 KB each,
fetched only when a profile is opened). Only players that don't have one yet are downloaded, so this is quick after the first run. Writes
added=true|false to $GITHUB_OUTPUT so the workflow knows to save the state.

    python fetch_headshots_lg.py            # every player with a photo
    python fetch_headshots_lg.py --limit 20 # a few, to look at
"""
import argparse
import io
import json
import os
import sqlite3
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

import fetch_images as fi   # (changes into the project folder)

OUT = "artifact_data/photos_lg"
SIZE = 336


def big(png_bytes: bytes) -> bytes:
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    base = Image.new("RGB", img.size, fi.BACKDROP)
    base.paste(img, mask=img.split()[3])
    side = min(base.size)
    left = (base.width - side) // 2
    base = base.crop((left, 0, left + side, side))
    if side != SIZE:
        base = base.resize((SIZE, SIZE), Image.LANCZOS)
    out = io.BytesIO()
    base.save(out, "JPEG", quality=88, subsampling=0, optimize=True)
    return out.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    conn = sqlite3.connect("nhl_impact.db")
    teams = {}
    for tid, ab in conn.execute("SELECT home_team_id, home_team_abbrev FROM games UNION SELECT away_team_id, away_team_abbrev FROM games"):
        teams[tid] = ab
    latest = {}
    for pid, tid, season, date in conn.execute("SELECT s.player_id, s.team_id, g.season, g.game_date FROM player_game_stats s JOIN games g ON g.game_id = s.game_id"):
        if tid in teams and (pid not in latest or date > latest[pid][2]):
            latest[pid] = (teams[tid], season, date)
    # only players the site has a small photo for (the rest show initials)
    try:
        has_small = {int(k) for k in json.load(open("artifact_data/photo_team.json"))}
    except Exception:
        has_small = set(latest)
    todo = [p for p in sorted(latest) if p in has_small and not os.path.exists(f"{OUT}/{p}.jpg")]
    if args.limit:
        todo = todo[: args.limit]
    os.makedirs(OUT, exist_ok=True)

    def get(pid):
        ab, season, _ = latest[pid]
        png = fi.fetch(fi.MUG_URL.format(season=season, abbrev=ab, pid=pid))
        if png is None:
            landing = fi.fetch(fi.LANDING_URL.format(pid=pid))
            url = json.loads(landing).get("headshot") if landing else None
            png = fi.fetch(url) if url else None
        if png is None:
            return False
        try:
            with open(f"{OUT}/{pid}.jpg", "wb") as f:
                f.write(big(png))
            return True
        except Exception:
            return False

    with ThreadPoolExecutor(max_workers=6) as pool:
        ok = sum(pool.map(get, todo))
    total = len([f for f in os.listdir(OUT) if f.endswith(".jpg")])
    print(f"large headshots: {ok} of {len(todo)} downloaded now, {total} on hand")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"added={'true' if ok else 'false'}\n")


if __name__ == "__main__":
    main()
