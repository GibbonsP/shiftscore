"""Live in-progress game scoring.

A live game is scored with exactly the code that scores finished games, run on a
throwaway in-memory database holding just that one game: ingest the play-by-play
and shift chart as they stand right now, compute xG, on-ice stats and Game Score,
then build the same compact box-score JSON the permanent pages use.

Differences from a finished game, all because they need history or a finished
game: no QoC/QoT/Adjusted Impact (those rate every player against his prior
games — added when the game is ingested permanently), and if the NHL isn't
publishing a shift chart for the game yet there is no ice time or on-ice stats
(the box score says so). Predicted Value isn't computed.

`tick()` writes JSON files, one per Firestore-style document the page reads:
    live/index        today's games with status, score, shots, xG, goals
    live/g_<game id>  the full filterable box score for games in play or just finished
and returns which documents changed since the previous tick, so a poller only
sends writes that matter.
"""
import json
import os
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from . import api, db, goalie_stats, ingest, units, xg_model, xg_stats
from .game_pages import build_games
from .site_export import compact_game

IN_PLAY = {"LIVE", "CRIT"}
FINISHED = {"FINAL", "OFF", "OVER"}
# games that finished within this long still get a final write; older ones are left alone
FINAL_GRACE_SEC = 4 * 3600
HEARTBEAT_SEC = 150

OUT_DIR = "live_out"
STATE_FILE = os.path.join(OUT_DIR, "state.json")


def load_score_factors(path: str = "models/score_factors.json") -> dict:
    with open(path) as f:
        return {int(k): tuple(v) for k, v in json.load(f).items()}


_HANDS: dict[int, str] = {}


def _shooting_hands(conn) -> None:
    """Copy each skater's shooting hand into the throwaway game DB (it decides left D vs right D in the unit
    lists). Hands come from the main database; a player it has never seen (a call-up in his first game) is looked
    up once from the NHL player record. Without a hand a defenseman just sorts after the others."""
    if not _HANDS:
        try:
            main_db = sqlite3.connect("nhl_impact.db")
            _HANDS.update({pid: h for pid, h in main_db.execute("SELECT player_id, shoots FROM players WHERE shoots IS NOT NULL")})
            main_db.close()
        except sqlite3.Error:
            pass
    for (pid,) in conn.execute("SELECT player_id FROM players WHERE position != 'G'").fetchall():
        hand = _HANDS.get(pid)
        if hand is None:
            try:
                hand = api.get_player_landing(pid).get("shootsCatches")
            except Exception:
                hand = None
            _HANDS[pid] = hand or ""
        if hand:
            conn.execute("UPDATE players SET shoots = ? WHERE player_id = ?", (hand, pid))


def build_live_game(game_id: int, pipeline, score_factors: dict) -> dict:
    """Compact box score (artifact_game_view.js format) for one game as it stands now."""
    conn = db.connect(":memory:")
    try:
        ingest.ingest_game(conn, game_id)
        _shooting_hands(conn)
        units.compute_game_units(conn, game_id)
        ingest.compute_extra_stats(conn, game_id)
        xg_stats.compute_game_xg(conn, game_id, pipeline, score_factors)
        goalie_stats.compute_game_goalie_stats(conn, game_id, pipeline)
        # no history in this throwaway DB, so no QoC/QoT: carry the raw Game Score through
        conn.execute(
            """INSERT OR REPLACE INTO player_game_impact (game_id, player_id, game_date, raw_game_score)
               SELECT pgs.game_id, pgs.player_id, gm.game_date, pgs.raw_game_score
               FROM player_game_stats pgs JOIN games gm ON gm.game_id = pgs.game_id WHERE pgs.game_id = ?""",
            (game_id,),
        )
        conn.commit()
        games = build_games(conn, set(), pipeline)
        return compact_game(games[0]) if games else {}
    finally:
        conn.close()


def _status_text(sb_game: dict) -> str:
    state = sb_game.get("gameState")
    if state in IN_PLAY:
        clock = sb_game.get("clock") or {}
        pd = sb_game.get("periodDescriptor") or {}
        label = {"REG": f"P{pd.get('number', '?')}", "OT": "OT", "SO": "SO"}.get(pd.get("periodType"), "")
        if clock.get("inIntermission"):
            return f"INT after P{pd.get('number', '?')}"
        return f"{label} {clock.get('timeRemaining', '')}".strip()
    if state in FINISHED:
        pt = (sb_game.get("gameOutcome") or {}).get("lastPeriodType")
        return "FINAL" + (f"/{pt}" if pt and pt != "REG" else "")
    return ""


def _shot_xg(built: dict, side: int) -> float:
    return sum((s[10] if s[10] is not None else s[5]) for s in built.get("shots", []) if s[2] == side and s[6] >= 1 and s[9] != 1)


def _index_entry(sb_game: dict, built: dict | None) -> dict:
    away, home = sb_game["awayTeam"], sb_game["homeTeam"]
    entry = {
        "id": sb_game["id"], "state": sb_game.get("gameState"), "status": _status_text(sb_game),
        "start": sb_game.get("startTimeUTC"),
        "away": away["abbrev"], "home": home["abbrev"],
        "away_score": away.get("score", 0), "home_score": home.get("score", 0),
    }
    if built:
        ts = built.get("tc", {})
        def team_total(side, idx):
            return sum(c[idx] for c in ts.get(side, {}).values())
        entry.update(
            {
                # TEAM_FIELDS position 2 = sog (see game_slices). Team xG counts shots on goal with the goalie in net, each worth the chance a shot
                # on goal becomes a goal (shot row field 10, or field 5 on older rows): the same definition as the game page.
                "sog": [team_total("away", 2), team_total("home", 2)],
                "xg": [round(_shot_xg(built, 0), 2), round(_shot_xg(built, 1), 2)],
                "goals": [[g["label"], g["time"], g["team"], g["scorer"]] for g in built.get("goals", [])],
                "no_shifts": built.get("ns", 0),
            }
        )
    return entry


def _load_state() -> dict:
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def tick(date: str | None = None, model_path: str = "models/xg_model.joblib", force: bool = False) -> dict:
    """Fetch the scoreboard, rebuild every game in play (and games that just
    ended), write the documents under OUT_DIR, and report what changed.

    Returns {"date", "live": n, "docs": [{"collection","doc_id","file_path"}...],
             "next_sleep_sec": suggested wait before the next tick, "summary": str}."""
    os.makedirs(OUT_DIR, exist_ok=True)
    board = api.get_scoreboard(date)
    games = board.get("games", [])
    now = datetime.now(timezone.utc)
    state = _load_state()
    stale_docs: list[str] = []
    if state.get("date") != board.get("currentDate"):
        # a new hockey day: last night's game documents are no longer referenced by the index
        stale_docs = [d for d in state.get("docs_written", []) if d != "index"]
        state = {"date": board.get("currentDate"), "sig": {}, "docs_written": []}

    def recent(g):
        # a finished game gets its final write only while it's fresh
        start = g.get("startTimeUTC")
        if not start:
            return False
        age = (now - datetime.fromisoformat(start.replace("Z", "+00:00"))).total_seconds()
        return age < FINAL_GRACE_SEC + 3 * 3600

    to_build = [g for g in games if g.get("gameState") in IN_PLAY or (g.get("gameState") in FINISHED and recent(g))]
    pipeline = xg_model.load(model_path)
    factors = load_score_factors()

    built: dict[int, dict] = {}
    if to_build:
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {g["id"]: pool.submit(build_live_game, g["id"], pipeline, factors) for g in to_build}
            for gid, fut in futures.items():
                try:
                    built[gid] = fut.result()
                except Exception as e:  # one broken game must not stop the others
                    print(f"  build failed for {gid}: {e}")

    index = {
        "updated": now.isoformat(timespec="seconds"),
        "date": board.get("currentDate"),
        "games": [_index_entry(g, built.get(g["id"])) for g in games],
    }
    docs = []

    def write(doc_id: str, payload: dict, sig):
        if not force and state["sig"].get(doc_id) == sig:
            return
        path = os.path.join(OUT_DIR, f"{doc_id}.json")
        with open(path, "w") as f:
            json.dump(payload, f, separators=(",", ":"))
        state["sig"][doc_id] = sig
        if doc_id not in state["docs_written"]:
            state["docs_written"].append(doc_id)
        docs.append({"collection": "live", "doc_id": doc_id, "file_path": os.path.abspath(path)})

    for g in to_build:
        b = built.get(g["id"])
        if not b:
            continue
        away, home = g["awayTeam"], g["homeTeam"]
        pd, clock = g.get("periodDescriptor") or {}, g.get("clock") or {}
        b["live"] = {"state": g.get("gameState"), "status": _status_text(g), "updated": index["updated"]}
        # a game's doc changes when its state, score, period/clock, or event count does
        n_events = sum(c[1] for side in b.get("tc", {}).values() for c in side.values())
        sig = [g.get("gameState"), away.get("score"), home.get("score"), pd.get("number"), clock.get("timeRemaining"), n_events]
        write(f"g_{g['id']}", {"game": b, "updated": index["updated"]}, sig)

    idx_sig = [[e["id"], e["state"], e["status"], e["away_score"], e["home_score"], e.get("sog")] for e in index["games"]]
    # the index is rewritten whenever any game changed, and at least every HEARTBEAT_SEC while a game is
    # in play so the page can tell "quiet intermission" from "the poller stopped"
    n_live_now = sum(1 for g in games if g.get("gameState") in IN_PLAY)
    since = time.time() - state.get("last_index_write", 0)
    if docs or force or state["sig"].get("index") != idx_sig or (n_live_now and since >= HEARTBEAT_SEC):
        state["last_index_write"] = time.time()
        write("index", index, idx_sig)
        docs.sort(key=lambda d: d["doc_id"] != "index")  # index first

    with open(STATE_FILE, "w") as f:
        json.dump(state, f)

    n_live = sum(1 for g in games if g.get("gameState") in IN_PLAY)
    n_soon = sum(1 for g in games if g.get("gameState") in {"PRE"} or g.get("gameState") == "FUT")
    if n_live:
        sleep = 60
    else:
        upcoming = [g for g in games if g.get("gameState") in {"FUT", "PRE"} and g.get("startTimeUTC")]
        if upcoming:
            first = min((datetime.fromisoformat(g["startTimeUTC"].replace("Z", "+00:00")) for g in upcoming))
            until = (first - now).total_seconds()
            sleep = int(max(60, min(1800, until - 600)))  # wake ~10 min before puck drop
        else:
            sleep = 1800
    return {
        "date": board.get("currentDate"), "live": n_live, "docs": docs, "next_sleep_sec": sleep,
        "stale_docs": stale_docs,
        "summary": f"{len(games)} games ({n_live} in play, {n_soon} not started), {len(docs)} doc(s) to write",
    }
