"""Assemble the hosted site from the DB, every season.


For each season: slice it out of the main DB, export leaderboards + indexes
(embedded in the page) and per-team / per-game JSON files. Outputs (gitignored,
fully regenerable):

    artifact_shift_score_final.html
    artifact_data/{season}/teams/{ABBREV}.json
    artifact_data/{season}/games/{HOME}.json
    artifact_data/manifest.json   (published path -> local path, per season)

Publish with the Artifact tool using `files` = the manifest entries (one season
per publish keeps each upload under the 64MB / 255-file limits).
"""
import argparse
import glob
import hashlib
import json
import os
import shutil

from nhl_impact import db, season_slice, site_export, xg_model

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)

parser = argparse.ArgumentParser()
parser.add_argument("--db", default="nhl_impact.db")
parser.add_argument("--page-only", action="store_true", help="re-assemble the page from the last export (no data rebuild)")
parser.add_argument("--seasons", nargs="+", help="rebuild only these seasons and keep the rest from the last full build "
                    "(what the automatic updater uses; writes artifact_data/changed.json listing the files that changed)")
args = parser.parse_args()
PAGE_DATA = "artifact_data/page_data.json"


def goalie_history():
    """Every goalie's starts and goals saved above expected over all built seasons: {player_id: [sum of GSAx, starts]}.
    The game predictions rate the likely starter from this (a goalie's earlier teams count too)."""
    hist = {}
    for path in sorted(glob.glob("artifact_data/*/teams/*.json")):
        with open(path) as fh:
            for r in json.load(fh).get("schedule", []):
                gk = r.get("gk")
                if gk:
                    e = hist.setdefault(str(gk[0]), [0.0, 0])
                    e[0] = round(e[0] + gk[4], 3); e[1] += 1
    return hist

def assemble(data):
    shell = open("artifact_shift_score.html").read()
    script = open("artifact_game_view.js").read() + "\n" + open("artifact_script_body.js").read()
    assert "__DATA_JSON__" in script and "/*__SCRIPT__*/" in shell
    script = script.replace("__DATA_JSON__", json.dumps(data, separators=(",", ":")))
    # escape non-ASCII in the script so it renders correctly regardless of how the host declares the charset
    script = "".join(c if ord(c) < 128 else f"\\u{ord(c):04x}" for c in script)
    page = shell.replace("/*__SCRIPT__*/", script)
    with open("artifact_shift_score_final.html", "w") as f:
        f.write(page)
    return page


if args.page_only:
    _data = json.load(open(PAGE_DATA)); _data["goalie_hist"] = goalie_history()
    page = assemble(_data)
    print(f"re-assembled page ({len(page) / 1e3:.0f} KB) from {PAGE_DATA}")
    raise SystemExit(0)

pipeline = xg_model.load("models/xg_model.joblib")
conn = db.connect(args.db)
all_seasons = season_slice.seasons(conn)
conn.close()

by_season, season_meta = {}, []
manifest: dict[str, dict[str, str]] = {}
os.makedirs("artifact_data", exist_ok=True)
prev = json.load(open(PAGE_DATA)) if args.seasons else None
prev_manifest = json.load(open("artifact_data/manifest.json")) if args.seasons else {}
changed = {"changed": [], "removed": []}  # published paths, for the seasons rebuilt in this run


def file_hash(path):
    with open(path, "rb") as fh:
        return hashlib.md5(fh.read()).hexdigest()


for season in all_seasons:
    if args.seasons and season not in args.seasons:
        by_season[season] = prev["by_season"][season]
        season_meta.append(next(m for m in prev["seasons"] if m["id"] == season))
        manifest[season] = prev_manifest[season]
        continue
    sconn = season_slice.slice_season(args.db, season, f"build/season_{season}.db")
    print(f"exporting {season}...")
    out = site_export.build_season(sconn, pipeline)
    sconn.close()
    by_season[season] = out["inline"]

    games_played = out["inline"]["meta"]["games"]
    max_team_gp = max((t["gp"] for t in out["inline"]["teams_index"]), default=0)
    season_meta.append(
        {"id": season, "label": f"{season[:4]}–{season[6:]}", "games": games_played,
         "max_team_gp": max_team_gp, "in_progress": max_team_gp < 82}
    )

    root = f"artifact_data/{season}"
    old_hashes = {pub: file_hash(path) for pub, path in prev_manifest.get(season, {}).items() if os.path.exists(path)}
    shutil.rmtree(root, ignore_errors=True)
    files = {}
    for kind, shards in (("teams", out["team_shards"]), ("games", out["game_shards"]), ("units", out["unit_shards"])):
        os.makedirs(f"{root}/{kind}")
        for key, data in shards.items():
            path = f"{root}/{kind}/{key}.json"
            with open(path, "w") as f:
                json.dump(data, f, separators=(",", ":"))
            files[f"data/{season}/{kind}/{key}.json"] = path
    # the Units tab's league-wide tables, fetched when that tab opens
    with open(f"{root}/league_units.json", "w") as f:
        json.dump(out["league_units"], f, separators=(",", ":"))
    files[f"data/{season}/league_units.json"] = f"{root}/league_units.json"
    manifest[season] = files
    changed["changed"] += [pub for pub, path in files.items() if old_hashes.get(pub) != file_hash(path)]
    changed["removed"] += [pub for pub in old_hashes if pub not in files]
    size = sum(os.path.getsize(p) for p in files.values()) / 1e6
    print(f"  {len(files)} files, {size:.1f} MB")

# default season: the latest one with enough games that leaderboards mean something
default = next((s["id"] for s in reversed(season_meta) if s["max_team_gp"] >= 10), season_meta[-1]["id"])
data = {"seasons": season_meta, "default": default, "by_season": by_season, "goalie_hist": goalie_history()}
# the league schedule (past week through the next four weeks) for the Home page's date browser; keep the last one if the API is down
try:
    import datetime
    from nhl_impact import api
    _today = datetime.date.today()
    data["schedule"] = api.get_schedule_window((_today - datetime.timedelta(days=7)).isoformat(), (_today + datetime.timedelta(days=28)).isoformat())
except Exception as e:
    print("schedule fetch failed, keeping the previous one:", e)
    data["schedule"] = (json.load(open(PAGE_DATA)).get("schedule", []) if os.path.exists(PAGE_DATA) else [])

with open(PAGE_DATA, "w") as f:
    json.dump(data, f, separators=(",", ":"))
page = assemble(data)
with open("artifact_data/manifest.json", "w") as f:
    json.dump(manifest, f, indent=1)
if args.seasons:
    with open("artifact_data/changed.json", "w") as f:
        json.dump(changed, f, indent=1)
    print(f"{len(changed['changed'])} files changed, {len(changed['removed'])} removed")
print(f"built page ({len(page) / 1e3:.0f} KB), seasons {[s['id'] for s in season_meta]}, default {default}")
