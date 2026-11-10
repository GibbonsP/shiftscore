"""Bring the database and the hosted site's data up to date with games that have finished.

The live tab covers games in progress (live.py). This covers everything else on the site (Games, Teams, Players,
Leaderboards, rankings, player cards): once a game is final and the NHL has finished filling in its shift chart, the
game is ingested, scored, rated, and the current season's site data is rebuilt.

One run (`run()`):
  1. look at the scoreboard for every day since the newest game in the database;
  2. ingest each regular-season game that finished at least SETTLE_SEC ago and isn't in yet, plus any game that still
     has no shift chart (up to 36 hours) and, once, every game 24 hours after it ended (shift charts keep filling in);
  3. run the per-game pipeline on them: units, extra stats, xG, goalie stats, impacts;
  4. fetch shooting hands / headshots for new players;
  5. rebuild the affected seasons (build_artifact.py --seasons) and stage the changed files under publish/data/.

It returns None when nothing was due, else an event dict naming the files to publish (the watcher prints it; the
session publishes them with the Artifact tool, since only it can).
"""
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

from . import api, db, goalie_stats, impact, ingest, units, xg_model, xg_stats
from .live import load_score_factors

SETTLE_SEC = int(3.5 * 3600)   # a game ends about 2.5-3 hours after the puck drops and the shift chart follows; games still missing shifts are retried
REFRESH_SEC = 24 * 3600
NO_SHIFTS_RETRY_SEC = 60 * 24 * 3600   # keep asking for a missing shift chart for two months (it can be posted late, and the watcher may have been off)
NO_SHIFTS_RETRY_EVERY = 3 * 3600       # but no more than once every three hours per game
STATE_FILE = "update_state.json"
FINISHED = ("OFF", "FINAL")
PUBLISH_ROOT = "publish"
# files outside the per-season shards that a run can change (new players' headshots)
EXTRA_GLOBS = ["photo_team.json", "photos"]


def _load_state() -> dict:
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"games": {}}


def _save_state(state: dict) -> None:
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)


def _season_of(game_id: int) -> str:
    y = game_id // 1000000
    return f"{y}{y + 1}"


def due_games(conn, state: dict, now: datetime) -> list[tuple[int, str]]:
    """[(game_id, kind)] for finished regular-season games that need (re)ingesting. kind is 'new' (not in the database),
    'retry' (in, but the shift chart was empty) or 'final' (the one-time pass 24 hours after the game ended)."""
    newest = conn.execute("SELECT MAX(game_date) FROM games").fetchone()[0]
    start = (datetime.strptime(newest, "%Y-%m-%d") - timedelta(days=1)).date() if newest else (now - timedelta(days=3)).date()
    have = {r[0] for r in conn.execute("SELECT DISTINCT game_id FROM player_game_stats")}
    with_shifts = {r[0] for r in conn.execute("SELECT DISTINCT game_id FROM shifts")}
    out, seen = [], set()
    day = start
    while day <= (now + timedelta(days=1)).date():
        board = api.get_scoreboard(day.isoformat())
        for g in board.get("games", []):
            gid = g["id"]
            if gid in seen or g.get("gameType") != 2 or g.get("gameState") not in FINISHED:
                continue
            seen.add(gid)
            started = g.get("startTimeUTC")
            if not started:
                continue
            age = (now - datetime.fromisoformat(started.replace("Z", "+00:00"))).total_seconds()
            if age < SETTLE_SEC:
                continue
            info = state["games"].get(str(gid), {})
            if gid not in have:
                out.append((gid, "new"))
            elif gid not in with_shifts and age < NO_SHIFTS_RETRY_SEC and now.timestamp() - info.get("ingested", 0) >= NO_SHIFTS_RETRY_EVERY:
                out.append((gid, "retry"))
            elif age >= REFRESH_SEC and not info.get("refreshed"):
                out.append((gid, "final"))
        day += timedelta(days=1)
        time.sleep(0.2)
    # games already in the database whose shift chart never arrived: the scan above only looks at recent days, so ask for
    # these by id (the NHL can post a chart days late, and a watcher that was off leaves older gaps)
    queued = {g for g, _ in out}
    cutoff = (now - timedelta(seconds=NO_SHIFTS_RETRY_SEC)).date().isoformat()
    for gid, gdate in conn.execute("SELECT game_id, game_date FROM games WHERE game_date >= ? ORDER BY game_date", (cutoff,)).fetchall():
        if gid in queued or gid in with_shifts:
            continue
        if now.timestamp() - state["games"].get(str(gid), {}).get("ingested", 0) >= NO_SHIFTS_RETRY_EVERY:
            out.append((gid, "retry"))
    return out


def process_game(conn, game_id: int, pipeline, factors: dict) -> None:
    ingest.ingest_game(conn, game_id)
    ingest.compute_extra_stats(conn, game_id)
    units.compute_game_units(conn, game_id)
    xg_stats.compute_game_xg(conn, game_id, pipeline, factors)
    goalie_stats.compute_game_goalie_stats(conn, game_id, pipeline)
    impact.compute_game_impacts(conn, game_id)


def _hash_tree(paths: list[str]) -> dict[str, str]:
    import hashlib
    out = {}
    for p in paths:
        files = [os.path.join(d, f) for d, _, fs in os.walk(p) for f in fs] if os.path.isdir(p) else [p] if os.path.exists(p) else []
        for f in files:
            with open(f, "rb") as fh:
                out[f] = hashlib.md5(fh.read()).hexdigest()
    return out


def run(db_path: str = "nhl_impact.db", python: str | None = None) -> dict | None:
    now = datetime.now(timezone.utc)
    state = _load_state()
    conn = db.connect(db_path)
    todo = due_games(conn, state, now)
    if not todo:
        conn.close()
        return None

    pipeline = xg_model.load("models/xg_model.joblib")
    factors = load_score_factors()
    done, failed = [], []
    players_before = {r[0] for r in conn.execute("SELECT player_id FROM players")}
    for gid, kind in todo:
        try:
            process_game(conn, gid, pipeline, factors)
            info = state["games"].setdefault(str(gid), {})
            info["ingested"] = time.time()
            if kind == "final":
                info["refreshed"] = True
            done.append(gid)
        except Exception as e:  # one broken game must not stop the rest
            failed.append((gid, f"{type(e).__name__}: {e}"))
        time.sleep(0.3)
    if not done:
        conn.close()
        _save_state(state)
        return {"event": "update_failed", "failed": failed}

    new_players = {r[0] for r in conn.execute("SELECT player_id FROM players")} - players_before
    seasons = sorted({r[0] for r in conn.execute(f"SELECT DISTINCT season FROM games WHERE game_id IN ({','.join(map(str, done))})")})
    conn.close()
    _save_state(state)

    py = python or sys.executable
    extra_before = _hash_tree([f"artifact_data/{p}" for p in EXTRA_GLOBS])
    if new_players:
        subprocess.run([py, "-u", "fetch_handedness.py"], check=False, capture_output=True)
        subprocess.run([py, "-u", "fetch_images.py"], check=False, capture_output=True)
    r = subprocess.run([py, "-u", "build_artifact.py", "--seasons", *seasons], capture_output=True, text=True)
    if r.returncode != 0:
        return {"event": "update_failed", "failed": failed, "build_error": (r.stderr or r.stdout)[-600:]}

    with open("artifact_data/changed.json") as f:
        changed = json.load(f)
    extra_after = _hash_tree([f"artifact_data/{p}" for p in EXTRA_GLOBS])
    paths = list(changed["changed"]) + ["data/" + os.path.relpath(p, "artifact_data") for p, h in extra_after.items() if extra_before.get(p) != h]
    # stage them where the publish step reads from (publish/data/<same path>), and drop removed files
    for pub in paths:
        src = os.path.join("artifact_data", pub[len("data/"):])  # a published path data/X is the local file artifact_data/X
        dst = os.path.join(PUBLISH_ROOT, pub)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(src, dst)
    removed = list(changed["removed"])
    for pub in removed:
        try:
            os.remove(os.path.join(PUBLISH_ROOT, pub))
        except OSError:
            pass
    return {
        "event": "site_updated", "games": done, "failed": failed, "seasons": seasons,
        "changed": paths, "removed": removed, "n_files": len(paths),
        "bytes": sum(os.path.getsize(os.path.join(PUBLISH_ROOT, p)) for p in paths),
        "page": os.path.abspath("artifact_shift_score_final.html"), "root": os.path.abspath(PUBLISH_ROOT),
    }
