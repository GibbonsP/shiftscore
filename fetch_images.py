"""Download NHL team logos and player headshots and package them for the hosted site.

The site's sandbox only shows images that ship inside it (other hosts are blocked), so the images are
fetched once here, shrunk, and published with the site:

    python fetch_images.py

Outputs (gitignored, regenerable):
    images_cache/headshots/{player_id}.jpg     168x168 thumbnails, kept so reruns only download new players
    images_cache/logos/{ABBREV}_{light|dark}.svg
    artifact_data/logos.json                    {ABBREV: {"l": svg text, "d": svg text}}
    artifact_data/photo_team.json               {player_id: team abbrev}  (which photo file holds a player)
    artifact_data/photos/{ABBREV}.json          {player_id: base64 JPEG}  for the team's current players

Source: assets.nhle.com (the NHL's own CDN, the same one its API links to).
"""
import base64
import io
import json
import os
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor

import requests
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)

LOGO_URL = "https://assets.nhle.com/logos/nhl/svg/{abbrev}_{variant}.svg"
MUG_URL = "https://assets.nhle.com/mugs/nhl/{season}/{abbrev}/{pid}.png"
LANDING_URL = "https://api-web.nhle.com/v1/player/{pid}/landing"
THUMB = 168   # the NHL's own file is 336px; 168 stays sharp at 2x on the player page and in tables
BACKDROP = (217, 232, 245)  # headshots have transparent backgrounds; sit them on pale ice blue

session = requests.Session()
session.headers.update({"User-Agent": "nhl-impact-research/0.1"})


def fetch(url, retries=3):
    for attempt in range(retries):
        try:
            r = session.get(url, timeout=20)
            if r.status_code == 200:
                return r.content
            if r.status_code == 404:
                return None
        except requests.RequestException:
            pass
        time.sleep(1.0 * (attempt + 1))
    return None


def thumbnail(png_bytes) -> bytes:
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    base = Image.new("RGB", img.size, BACKDROP)
    base.paste(img, mask=img.split()[3])
    side = min(base.size)  # square crop from the top-center: faces sit in the upper part of the frame
    left = (base.width - side) // 2
    base = base.crop((left, 0, left + side, side)).resize((THUMB, THUMB), Image.LANCZOS)
    out = io.BytesIO()
    base.save(out, "JPEG", quality=82, optimize=True)
    return out.getvalue()


def main():
    conn = sqlite3.connect("nhl_impact.db")
    teams = {}
    for tid, ab in conn.execute(
        "SELECT home_team_id, home_team_abbrev FROM games UNION SELECT away_team_id, away_team_abbrev FROM games"
    ):
        teams[tid] = ab
    abbrevs = sorted(set(teams.values()))

    # ---- logos
    os.makedirs("images_cache/logos", exist_ok=True)
    logos = {}
    for ab in abbrevs:
        entry = {}
        for key, variant in (("l", "light"), ("d", "dark")):
            path = f"images_cache/logos/{ab}_{variant}.svg"
            if not os.path.exists(path):
                data = fetch(LOGO_URL.format(abbrev=ab, variant=variant))
                if data:
                    open(path, "wb").write(data)
            if os.path.exists(path):
                entry[key] = open(path, encoding="utf-8").read()
        if entry:
            logos[ab] = entry
    os.makedirs("artifact_data", exist_ok=True)
    json.dump(logos, open("artifact_data/logos.json", "w"), separators=(",", ":"))
    print(f"logos: {len(logos)} teams, {sum(len(v) for v in logos.values())} files")

    # ---- headshots: each player's most recent team and season
    latest = {}
    for pid, tid, season, date in conn.execute(
        "SELECT s.player_id, s.team_id, g.season, g.game_date FROM player_game_stats s JOIN games g ON g.game_id = s.game_id"
    ):
        if tid in teams and (pid not in latest or date > latest[pid][2]):
            latest[pid] = (teams[tid], season, date)
    os.makedirs("images_cache/headshots", exist_ok=True)

    def get_photo(pid):
        path = f"images_cache/headshots/{pid}.jpg"
        if os.path.exists(path):
            return pid, True
        ab, season, _ = latest[pid]
        png = fetch(MUG_URL.format(season=season, abbrev=ab, pid=pid))
        if png is None:  # not under that team/season: ask the player's own record where his headshot lives
            landing = fetch(LANDING_URL.format(pid=pid))
            if landing:
                url = json.loads(landing).get("headshot")
                png = fetch(url) if url else None
        if png is None:
            return pid, False
        try:
            open(path, "wb").write(thumbnail(png))
        except Exception:  # unreadable image: skip, the page falls back to initials
            return pid, False
        return pid, True

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(get_photo, sorted(latest)))
    have = {pid for pid, ok in results if ok}
    print(f"headshots: {len(have)} of {len(latest)} players ({len(latest) - len(have)} without a photo)")

    # ---- package by team
    by_team: dict[str, dict[str, str]] = {}
    photo_team = {}
    for pid in have:
        ab = latest[pid][0]
        photo_team[str(pid)] = ab
        by_team.setdefault(ab, {})[str(pid)] = base64.b64encode(open(f"images_cache/headshots/{pid}.jpg", "rb").read()).decode()
    os.makedirs("artifact_data/photos", exist_ok=True)
    for ab, photos in by_team.items():
        json.dump(photos, open(f"artifact_data/photos/{ab}.json", "w"), separators=(",", ":"))
    json.dump(photo_team, open("artifact_data/photo_team.json", "w"), separators=(",", ":"))
    total = sum(os.path.getsize(f"artifact_data/photos/{ab}.json") for ab in by_team)
    print(f"packaged {len(by_team)} team photo files, {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
