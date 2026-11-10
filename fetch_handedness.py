"""Fetch each skater's shooting hand (L/R) from the NHL player record and store it in players.shoots.

Used to order defense pairs left D then right D (the NHL's own position list only says "D"):

    python fetch_handedness.py

Safe to rerun: only players without a stored hand are fetched.
"""
import json
import os
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)

LANDING_URL = "https://api-web.nhle.com/v1/player/{pid}/landing"
session = requests.Session()
session.headers.update({"User-Agent": "nhl-impact-research/0.1"})


def fetch_hand(pid, retries=3):
    for attempt in range(retries):
        try:
            r = session.get(LANDING_URL.format(pid=pid), timeout=20)
            if r.status_code == 200:
                return pid, json.loads(r.content).get("shootsCatches")
            if r.status_code == 404:
                return pid, None
        except (requests.RequestException, ValueError):
            pass
        time.sleep(1.0 * (attempt + 1))
    return pid, None


def main():
    conn = sqlite3.connect("nhl_impact.db")
    cols = {r[1] for r in conn.execute("PRAGMA table_info(players)")}
    if "shoots" not in cols:
        conn.execute("ALTER TABLE players ADD COLUMN shoots TEXT")
    todo = [r[0] for r in conn.execute("SELECT player_id FROM players WHERE position != 'G' AND shoots IS NULL")]
    print(f"{len(todo)} players to fetch")
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(fetch_hand, todo))
    got = 0
    for pid, hand in results:
        if hand in ("L", "R"):
            conn.execute("UPDATE players SET shoots = ? WHERE player_id = ?", (hand, pid))
            got += 1
    conn.commit()
    print(f"stored {got} of {len(todo)} ({len(todo) - got} without a hand)")
    for pos, hand, n in conn.execute("SELECT position, shoots, COUNT(*) FROM players WHERE position != 'G' GROUP BY 1, 2"):
        print(f"  {pos} {hand}: {n}")


if __name__ == "__main__":
    main()
