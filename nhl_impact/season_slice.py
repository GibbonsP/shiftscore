"""Copy one season out of the main DB into its own standalone DB.

The report and exporters read only stored per-game values, so pointing them at
a single-season copy gives season-scoped pages without threading a season
filter through every query. Ratings/QoC were already computed against full
history in the main DB, so a slice keeps those exact values.
"""
import os

from . import db

GAME_TABLES = [
    "shifts", "events", "player_game_stats", "player_game_impact", "unit_game_stats", "unit_period_stats", "goalie_game_stats",
]


def seasons(conn) -> list[str]:
    return [r[0] for r in conn.execute("SELECT DISTINCT season FROM games ORDER BY season")]


def slice_season(src_path: str, season: str, dst_path: str):
    if os.path.exists(dst_path):
        os.remove(dst_path)
    os.makedirs(os.path.dirname(dst_path) or ".", exist_ok=True)
    dst = db.connect(dst_path)
    dst.execute("ATTACH DATABASE ? AS src", (src_path,))

    def cols(table):  # explicit names: column ORDER can differ between a fresh schema and an ALTER-migrated DB
        return ", ".join(r[1] for r in dst.execute(f"PRAGMA main.table_info({table})"))

    dst.execute(f"INSERT INTO games ({cols('games')}) SELECT {cols('games')} FROM src.games WHERE season = ?", (season,))
    dst.execute(f"INSERT INTO players ({cols('players')}) SELECT {cols('players')} FROM src.players")
    for t in GAME_TABLES:
        dst.execute(
            f"INSERT INTO {t} ({cols(t)}) SELECT {cols(t)} FROM src.{t} WHERE game_id IN (SELECT game_id FROM main.games)"
        )
    dst.commit()
    dst.execute("DETACH DATABASE src")
    return dst
