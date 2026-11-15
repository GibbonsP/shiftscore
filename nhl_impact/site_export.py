"""Exports for the hosted site, one season at a time.

Everything here runs against a single-season sliced DB (see season_slice.py)
and returns plain JSON-able structures; build_artifact.py handles writing
files and assembling the page.

Layout the page expects (per season S):
  inline in the page: leaderboards + teams/players/games indexes
  data/S/teams/{ABBREV}.json   roster, goalies, schedule, player logs, unit pages
  data/S/games/{HOME}.json     full box score for every game that team hosted
Games are sharded by HOME team so each game is stored once.
"""
from collections import defaultdict

from .game_info import game_results
from .game_pages import build_games
from .unit_pages import MIN_TOI_SEC, build_units, order_players, player_slots, unit_key


def rows(conn, q, params=()):
    cur = conn.execute(q, params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


TEAM_JOIN = """JOIN (SELECT home_team_id AS id, home_team_abbrev AS abbrev FROM games
                      UNION SELECT away_team_id, away_team_abbrev FROM games) t"""


# How many rows of each ranking go into the page. The site shows the top 75 (150 for player games) but lets the
# viewer raise a minimum-ice-time slider, so it needs a deeper pool to fill the list after low-TOI rows drop out.
POOL = {"goalie_games": 400, "player_games": 400, "season_xg": 300, "goalies": 150, "units": 300, "season_avg": 1000}
# a game needs this much ice time to count on the single-game boards, and a unit this much to count on the unit boards, so the
# worst lists are not just a minute of bad luck (the boards' ice-time slider can raise the bar further)
MIN_GAME_TOI = 300
MIN_GOALIE_GAME_SF = 10   # a goalie game needs at least this many shots on goal to make the single-game boards (a relief appearance of a few shots says nothing)
MIN_UNIT_TOI = {"line": 180, "pair": 180, "pp": 40, "pk": 40}


def _toi_text(sec) -> str:
    sec = int(sec or 0)
    return f"{sec // 60}:{sec % 60:02d}"


def leaderboards(conn, unit_keys: set) -> dict:
    def player_games_query(order):
        return rows(
            conn,
            f"""SELECT pgi.player_id AS pid, p.first_name || ' ' || p.last_name AS player, t.abbrev AS team, gm.game_date AS date,
                      ROUND(pgi.raw_game_score,2) AS raw, ROUND(pgi.qoc,2) AS qoc, ROUND(pgi.qot,2) AS qot,
                      ROUND(pgi.adjusted_impact,2) AS adjusted, ROUND(pgs.ixg,2) AS ixg, pgs.toi_sec AS toi_sec,
                      gm.game_id AS gid, gm.home_team_abbrev AS home
               FROM player_game_impact pgi
               JOIN players p ON p.player_id = pgi.player_id
               JOIN player_game_stats pgs ON pgs.game_id = pgi.game_id AND pgs.player_id = pgi.player_id
               JOIN games gm ON gm.game_id = pgi.game_id
               {TEAM_JOIN} ON t.id = pgs.team_id
               WHERE pgs.toi_sec >= {MIN_GAME_TOI} AND pgi.adjusted_impact IS NOT NULL
               ORDER BY pgi.adjusted_impact {order} LIMIT {POOL['player_games']}""",
        )
    player_games, player_games_worst = player_games_query("DESC"), player_games_query("ASC")
    def goalie_games_query(order):
        data = rows(
            conn,
            f"""SELECT gs.goalie_id AS pid, p.first_name || ' ' || p.last_name AS goalie, t.abbrev AS team, gm.game_date AS date,
                      CASE WHEN gm.home_team_id = gs.team_id THEN gm.away_team_abbrev ELSE gm.home_team_abbrev END AS opp,
                      CASE WHEN gm.home_team_id = gs.team_id THEN 'vs' ELSE '@' END AS loc,
                      gs.shots_faced AS sf, gs.goals_allowed AS ga, ROUND(gs.xga,2) AS xga, ROUND(gs.gsax,2) AS gsax,
                      gm.game_id AS gid, gm.home_team_abbrev AS home
               FROM goalie_game_stats gs
               JOIN players p ON p.player_id = gs.goalie_id
               JOIN games gm ON gm.game_id = gs.game_id
               {TEAM_JOIN} ON t.id = gs.team_id
               WHERE gs.shots_faced >= {MIN_GOALIE_GAME_SF}
               ORDER BY gs.gsax {order}, gs.game_id LIMIT {POOL['goalie_games']}""",
        )
        for r in data:
            r["sv_pct"] = round((r["sf"] - r["ga"]) / r["sf"], 3) if r["sf"] else 0
        return data
    goalie_games, goalie_games_worst = goalie_games_query("DESC"), goalie_games_query("ASC")
    n_games = conn.execute("SELECT COUNT(*) FROM games").fetchone()[0]
    min_gp = 10 if n_games > 600 else 1  # in-progress seasons: don't hide everyone behind a GP floor

    season_xg = rows(
        conn,
        f"""SELECT pgs.player_id AS pid, p.first_name || ' ' || p.last_name AS player, COUNT(*) AS gp, SUM(goals) AS goals,
                  SUM(shots) AS shots, ROUND(SUM(ixg),1) AS total_ixg,
                  ROUND(SUM(goals) - SUM(ixg),1) AS goals_above_ixg, SUM(toi_sec) AS toi_sec
           FROM player_game_stats pgs JOIN players p ON p.player_id = pgs.player_id
           WHERE p.position != 'G'
           GROUP BY pgs.player_id HAVING gp >= {min_gp} ORDER BY total_ixg DESC LIMIT {POOL['season_xg']}""",
    )
    # the team each leader last played for (the leaders table shows its logo)
    last_team = {pid: abbrev for pid, abbrev in conn.execute(
        f"""SELECT pgs.player_id, t.abbrev FROM player_game_stats pgs JOIN games gm ON gm.game_id = pgs.game_id
            {TEAM_JOIN} ON t.id = pgs.team_id ORDER BY gm.game_date, gm.game_id""")}
    for r in season_xg:
        r["team"] = last_team.get(r["pid"], "")
    # season averages of Game Score (raw and Adjusted): every skater with enough games, best first; the page reverses it for "worst"
    avg_min = 10 if n_games > 600 else (3 if n_games > 150 else 1)
    season_avg = rows(
        conn,
        f"""SELECT pgi.player_id AS pid, p.first_name || ' ' || p.last_name AS player, COUNT(*) AS gp,
                  ROUND(AVG(pgi.raw_game_score),2) AS avg_raw, ROUND(AVG(pgi.adjusted_impact),2) AS avg_adjusted,
                  SUM(pgs.goals) AS goals, SUM(pgs.primary_assists + pgs.secondary_assists) AS assists, SUM(pgs.toi_sec) AS toi_sec
           FROM player_game_impact pgi JOIN players p ON p.player_id = pgi.player_id
           JOIN player_game_stats pgs ON pgs.game_id = pgi.game_id AND pgs.player_id = pgi.player_id
           WHERE p.position != 'G' AND pgi.adjusted_impact IS NOT NULL
           GROUP BY pgi.player_id HAVING gp >= {avg_min} ORDER BY avg_adjusted DESC LIMIT {POOL['season_avg']}""",
    )
    for r in season_avg:
        r["team"] = last_team.get(r["pid"], "")
    goalies = rows(
        conn,
        f"""SELECT gs.goalie_id AS pid, p.first_name || ' ' || p.last_name AS goalie, t.abbrev AS team, COUNT(*) AS gp,
                  SUM(shots_faced) AS sf, SUM(goals_allowed) AS ga, ROUND(SUM(xga),1) AS xga,
                  ROUND(SUM(gsax),1) AS gsax
           FROM goalie_game_stats gs JOIN players p ON p.player_id = gs.goalie_id
           {TEAM_JOIN} ON t.id = gs.team_id
           GROUP BY gs.goalie_id HAVING gp >= {min_gp} ORDER BY gsax DESC LIMIT {POOL['goalies']}""",
    )
    official = official_goalies(conn)
    for g in goalies:
        apply_official_goalie(g, official, "pid", "sf", "ga", g["gp"])
        g["sv_pct"] = g["sv_pct"] or 0

    players = dict(conn.execute("SELECT player_id, first_name || ' ' || last_name FROM players").fetchall())
    slots = player_slots(conn)

    def unit_rows(unit_type, min_toi, order="DESC"):
        data = rows(
            conn,
            f"""SELECT u.player_ids, t.abbrev AS team, gm.game_date AS date, u.toi_sec,
                      u.cf, u.ca, u.gf, u.ga, ROUND(u.xgf,2) AS xgf, ROUND(u.xga,2) AS xga,
                      u.hdcf, u.hdca, ROUND(u.unit_score,2) AS score,
                      gm.game_id AS gid, gm.home_team_abbrev AS home
               FROM unit_game_stats u
               JOIN games gm ON gm.game_id = u.game_id
               {TEAM_JOIN} ON t.id = u.team_id
               WHERE u.unit_type = ? AND u.toi_sec >= ?
               ORDER BY u.unit_score {order} LIMIT {POOL['units']}""",
            (unit_type, min_toi),
        )
        for r in data:
            r["unit"] = ", ".join(players.get(pid, str(pid)) for pid in order_players(r["player_ids"].split(","), slots))
            r["toi"] = f"{r['toi_sec'] // 60}:{r['toi_sec'] % 60:02d}"
            key = unit_key(r["team"], unit_type, r["player_ids"])
            # only set when the unit has its own page (enough season TOI) — the UI links on this
            r["unit_key"] = key if key in unit_keys else None
            del r["player_ids"]
        return data

    meta = conn.execute("SELECT MIN(game_date), MAX(game_date), COUNT(*) FROM games").fetchone()
    for board in (player_games, player_games_worst, season_xg, season_avg):  # goalies qualify on games played, not ice time
        for r in board:
            r["toi"] = _toi_text(r["toi_sec"])
    return {
        "meta": {"start": meta[0], "end": meta[1], "games": meta[2]},
        "player_games": player_games, "player_games_worst": player_games_worst, "season_xg": season_xg, "season_avg": season_avg,
        "goalies": goalies,
        "goalie_games": goalie_games, "goalie_games_worst": goalie_games_worst,
        **{key: unit_rows(t, MIN_UNIT_TOI[t]) for key, t in (("lines", "line"), ("pairs", "pair"), ("pp", "pp"), ("pk", "pk"))},
        **{key + "_worst": unit_rows(t, MIN_UNIT_TOI[t], "ASC") for key, t in (("lines", "line"), ("pairs", "pair"), ("pp", "pp"), ("pk", "pk"))},
    }


def _player_summary_and_log(conn, player_id, home_by_game):
    totals = conn.execute(
        """SELECT COUNT(*), SUM(goals), SUM(primary_assists + secondary_assists), SUM(shots),
                  AVG(raw_game_score), SUM(ixg), SUM(hits), SUM(takeaways),
                  SUM(giveaways), SUM(pim), SUM(toi_sec), SUM(oz_starts), SUM(dz_starts), SUM(nz_starts), SUM(fly_starts),
                  SUM(cf_all), SUM(ca_all), SUM(xgf_all), SUM(xga_all), SUM(hdcf_all), SUM(hdca_all),
                  SUM(faceoff_wins), SUM(faceoff_losses), SUM(penalties_drawn), SUM(penalties_taken), SUM(blocks),
                  SUM(mdcf_all), SUM(mdca_all), SUM(ldcf_all), SUM(ldca_all),
                  SUM(hdgf_all), SUM(hdga_all), SUM(mdgf_all), SUM(mdga_all), SUM(ldgf_all), SUM(ldga_all),
                  SUM(hdxgf_all), SUM(hdxga_all), SUM(mdxgf_all), SUM(mdxga_all), SUM(ldxgf_all), SUM(ldxga_all),
                  SUM(primary_assists)
           FROM player_game_stats WHERE player_id = ?""",
        (player_id,),
    ).fetchone()
    (gp, goals, assists, shots, avg_raw, total_ixg, hits, tk, gv, pim, toi, oz, dz, nz, fly,
     cf, ca, xgf, xga, hdcf, hdca, fow, fol, pd, pt, blk, mdcf, mdca, ldcf, ldca,
     hdgf, hdga, mdgf, mdga, ldgf, ldga, hdxgf, hdxga, mdxgf, mdxga, ldxgf, ldxga, a1) = (v or 0 for v in totals)
    avg_adj = (
        conn.execute("SELECT AVG(adjusted_impact) FROM player_game_impact WHERE player_id = ?", (player_id,)).fetchone()[0]
        or 0
    )
    summary = {
        "gp": gp, "goals": goals, "assists": assists, "a1": int(a1), "a2": int(assists - a1), "points": goals + assists, "shots": shots,
        "avg_raw": round(avg_raw, 2), "avg_adjusted": round(avg_adj, 2), "total_ixg": round(total_ixg, 1),
        "hits": hits, "takeaways": tk, "giveaways": gv, "pim": pim,
        "toi": int(toi), "oz": int(oz), "dz": int(dz), "nz": int(nz), "fly": int(fly),
        "cf": int(cf), "ca": int(ca), "xgf": round(xgf, 1), "xga": round(xga, 1), "hdcf": int(hdcf), "hdca": int(hdca),
        "fow": int(fow), "fol": int(fol), "pd": int(pd), "pt": int(pt), "blk": int(blk),
        "mdcf": int(mdcf), "mdca": int(mdca), "ldcf": int(ldcf), "ldca": int(ldca),
        # goals and expected goals on the ice by danger band, for and against (the shot danger card shows them under the counts)
        "hdgf": int(hdgf), "hdga": int(hdga), "mdgf": int(mdgf), "mdga": int(mdga), "ldgf": int(ldgf), "ldga": int(ldga),
        "hdxgf": round(hdxgf, 2), "hdxga": round(hdxga, 2), "mdxgf": round(mdxgf, 2), "mdxga": round(mdxga, 2), "ldxgf": round(ldxgf, 2), "ldxga": round(ldxga, 2),
    }
    log = rows(
        conn,
        f"""SELECT gm.game_date AS date, t.abbrev AS team, pgs.goals, pgs.primary_assists + pgs.secondary_assists AS assists,
                  pgs.primary_assists AS a1, pgs.secondary_assists AS a2,
                  ROUND(pgi.raw_game_score,2) AS raw, ROUND(pgi.qoc,2) AS qoc, ROUND(pgi.qot,2) AS qot,
                  ROUND(pgi.adjusted_impact,2) AS adjusted, ROUND(pgs.ixg,2) AS ixg, gm.game_id AS gid,
                  CASE WHEN gm.home_team_id = pgs.team_id THEN gm.away_team_abbrev ELSE gm.home_team_abbrev END AS opp,
                  CASE WHEN gm.home_team_id = pgs.team_id THEN 'vs' ELSE '@' END AS loc
           FROM player_game_impact pgi
           JOIN players pl ON pl.player_id = pgi.player_id
           JOIN player_game_stats pgs ON pgs.game_id = pgi.game_id AND pgs.player_id = pgi.player_id
           JOIN games gm ON gm.game_id = pgi.game_id
           {TEAM_JOIN} ON t.id = pgs.team_id
           WHERE pgi.player_id = ? ORDER BY gm.game_date""",
        (player_id,),
    )
    for r in log:
        r["home"] = home_by_game[r["gid"]]
    return summary, log


def _compact_unit(u, home_by_game):
    # log rows as arrays (not dicts) — tens of thousands of rows, key names would roughly double the size
    return {
        "key": u["key"], "type": u["type"], "players": u["players"], "summary": u["summary"],
        "log": [
            [g["date"], g["opp"], g["loc"], g["result"], g["toi_sec"], g["cf"], g["ca"], g["gf"], g["ga"],
             g["xgf"], g["xga"], g["hdcf"], g["hdca"], g["score"], g["game_id"], home_by_game[g["game_id"]],
             g.get("mdcf", 0), g.get("mdca", 0), g.get("ldcf", 0), g.get("ldca", 0)]
            for g in u["log"]
        ],
    }


def _extra_units_shard(units, home_by_game):
    """Short-lived units, compact: players as ids with one shared name table (names repeat a lot)."""
    names, out = {}, []
    for u in units:
        c = _compact_unit(u, home_by_game)
        for p in c.pop("players"):
            names[str(p["id"])] = [p["name"], p["pos"]]
        c["p"] = [p["id"] for p in u["players"]]
        out.append(c)
    return {"names": names, "units": out}


def team_shards(conn, units: list[dict]) -> tuple[dict, list, list, dict]:
    """({abbrev: shard}, teams_index, players_index, {abbrev: extra units shard})."""
    results = game_results(conn)
    official_g = official_goalies(conn)
    from .goalie_stats import starters as goalie_starters
    starter_of = goalie_starters(conn)   # (game, team) -> the goalie who started, for the start / relief flag
    home_by_game = dict(conn.execute("SELECT game_id, home_team_abbrev FROM games"))
    teams = sorted(
        set(conn.execute(
            "SELECT DISTINCT home_team_id, home_team_abbrev FROM games "
            "UNION SELECT DISTINCT away_team_id, away_team_abbrev FROM games"
        ).fetchall()),
        key=lambda t: t[1],
    )
    units_by_team: dict[str, list] = {}
    for u in units:
        units_by_team.setdefault(u["team"], []).append(u)

    shards, teams_index, unit_shards = {}, [], {}
    primary_team: dict[int, tuple[int, str]] = {}

    # per-game goalie lines and each team's expected goals for and against in each game. A goalie's expected goals against are the
    # shots his team faced; the other team's goalie rows are therefore this team's expected goals for.
    gg: dict[int, dict[int, list]] = {}
    for gid, tid, pid, sf, ga, xga, gsax in conn.execute(
        "SELECT game_id, team_id, goalie_id, shots_faced, goals_allowed, xga, gsax FROM goalie_game_stats"
    ):
        gg.setdefault(gid, {}).setdefault(tid, []).append((pid, sf, ga, xga, gsax))
    game_teams = {gid: (h, a) for gid, h, a in conn.execute("SELECT game_id, home_team_id, away_team_id FROM games")}

    def team_xg(gid, tid):
        """(xGF, xGA) for a team in a game, or (None, None) when goalie rows are missing."""
        h, a = game_teams[gid]
        own, opp = gg.get(gid, {}).get(tid), gg.get(gid, {}).get(a if tid == h else h)
        if not own or not opp:
            return None, None
        return round(sum(r[3] for r in opp), 2), round(sum(r[3] for r in own), 2)

    for team_id, abbrev in teams:
        roster = rows(
            conn,
            """SELECT p.player_id, p.first_name || ' ' || p.last_name AS name, p.position, COUNT(*) gp,
                      SUM(pgs.goals) goals, SUM(pgs.primary_assists + pgs.secondary_assists) assists,
                      SUM(pgs.primary_assists) a1, SUM(pgs.secondary_assists) a2,
                      ROUND(AVG(pgi.adjusted_impact),2) avg_adjusted
               FROM player_game_stats pgs
               JOIN players p ON p.player_id = pgs.player_id
               LEFT JOIN player_game_impact pgi ON pgi.game_id = pgs.game_id AND pgi.player_id = pgs.player_id
               WHERE pgs.team_id = ? AND p.position != 'G'
               GROUP BY p.player_id ORDER BY gp DESC""",
            (team_id,),
        )
        goalie_rows = rows(
            conn,
            """SELECT p.player_id, p.first_name || ' ' || p.last_name AS name, COUNT(*) gp,
                      SUM(gs.shots_faced) shots_faced, SUM(gs.goals_allowed) goals_allowed, ROUND(SUM(gs.gsax),1) gsax
               FROM goalie_game_stats gs JOIN players p ON p.player_id = gs.goalie_id
               WHERE gs.team_id = ? GROUP BY gs.goalie_id ORDER BY gp DESC""",
            (team_id,),
        )
        for r in goalie_rows:
            apply_official_goalie(r, official_g, "player_id", "shots_faced", "goals_allowed", r["gp"])
        games = conn.execute(
            """SELECT game_id, game_date,
                      CASE WHEN home_team_id = ? THEN away_team_abbrev ELSE home_team_abbrev END,
                      CASE WHEN home_team_id = ? THEN 'vs' ELSE '@' END
               FROM games WHERE home_team_id = ? OR away_team_id = ? ORDER BY game_date""",
            (team_id, team_id, team_id, team_id),
        ).fetchall()
        schedule, wins, losses = [], 0, 0
        for game_id, date, opp, loc in games:
            res = results[game_id]
            gf, ga = (res["home"], res["away"]) if loc == "vs" else (res["away"], res["home"])
            won = gf > ga
            wins += won
            losses += not won
            txf, txa = team_xg(game_id, team_id)
            schedule.append(
                {"gid": game_id, "home": home_by_game[game_id], "date": date, "opponent": opp, "loc": loc,
                 "score": f"{gf}-{ga}", "result": "W" if won else "L", "outcome": res["outcome"], "xgf": txf, "xga": txa}
            )

        players = {}
        for p in roster + goalie_rows:
            summary, log = _player_summary_and_log(conn, p["player_id"], home_by_game)
            players[str(p["player_id"])] = {"name": p["name"], "summary": summary, "game_log": log}
        # a goalie's game-by-game line: shots, goals, expected goals against, and what the team did, for the start grade and trend
        for gr in goalie_rows:
            gl = []
            for r in schedule:
                mine = gg.get(r["gid"], {}).get(team_id, [])
                row = next((x for x in mine if x[0] == gr["player_id"]), None)
                if not row:
                    continue
                gl.append({"gid": r["gid"], "home": r["home"], "date": r["date"], "opp": r["opponent"], "loc": r["loc"],
                           "sf": row[1], "ga": row[2], "xga": round(row[3], 2), "gsax": round(row[4], 2),
                           "win": r["result"] == "W", "relief": starter_of.get((r["gid"], team_id), gr["player_id"]) != gr["player_id"],
                           "txf": r["xgf"], "txa": r["xga"]})
            players[str(gr["player_id"])]["goalie_log"] = gl

        shards[abbrev] = {
            "abbrev": abbrev, "wins": wins, "losses": losses, "games_played": len(games),
            "roster": roster, "goalies": goalie_rows, "schedule": schedule, "players": players,
            # units with a real sample ride along with the team; the long tail of short-lived
            # combinations lives in units/{ABBREV}.json, fetched when one is opened
            "units": [_compact_unit(u, home_by_game) for u in units_by_team.get(abbrev, [])
                      if u["summary"]["toi_sec"] >= MIN_TOI_SEC.get(u["type"], 10**9)],
            "units_total": len(units_by_team.get(abbrev, [])),
        }
        unit_shards[abbrev] = _extra_units_shard(
            [u for u in units_by_team.get(abbrev, []) if u["summary"]["toi_sec"] < MIN_TOI_SEC.get(u["type"], 10**9)],
            home_by_game)
        # the last ten games (record and points) and the goalies' combined goals saved above expected, for the Power Rankings
        l10 = schedule[-10:]
        l10w = sum(1 for r in l10 if r["result"] == "W")
        l10otl = sum(1 for r in l10 if r["result"] != "W" and r["outcome"] != "REG")
        teams_index.append({"abbrev": abbrev, "wins": wins, "losses": losses, "gp": len(games),
                            "l10": f"{l10w}-{len(l10) - l10w - l10otl}-{l10otl}", "l10_pts": 2 * l10w + l10otl, "l10_gp": len(l10),
                            "gsax": round(sum(r["gsax"] or 0 for r in goalie_rows), 1)})
        for p in roster:
            prev = primary_team.get(p["player_id"])
            if prev is None or p["gp"] > prev[0]:
                primary_team[p["player_id"]] = (p["gp"], abbrev)

    # every skater with the season totals the Skaters table shows
    players_index = []
    for pid, name, pos, gp, g, a, a1, sog, toi, ixg, avg_raw, avg_adj in conn.execute(
        """SELECT p.player_id, p.first_name||' '||p.last_name, p.position, COUNT(*), SUM(pgs.goals), SUM(pgs.primary_assists + pgs.secondary_assists),
                  SUM(pgs.primary_assists), SUM(pgs.shots), SUM(pgs.toi_sec), ROUND(SUM(pgs.ixg),1),
                  (SELECT ROUND(AVG(i.raw_game_score),2) FROM player_game_impact i WHERE i.player_id = p.player_id),
                  (SELECT ROUND(AVG(i.adjusted_impact),2) FROM player_game_impact i WHERE i.player_id = p.player_id)
           FROM player_game_stats pgs JOIN players p ON p.player_id=pgs.player_id
           WHERE p.position != 'G' GROUP BY p.player_id"""
    ):
        players_index.append({"id": pid, "name": name, "pos": pos, "team": primary_team.get(pid, (0, "?"))[1], "gp": gp,
                              "g": g or 0, "a": a or 0, "a1": a1 or 0, "sog": sog or 0, "toi_sec": toi or 0, "ixg": ixg or 0,
                              "avg_raw": avg_raw, "avg_adj": avg_adj})
    return shards, teams_index, players_index, unit_shards


def _trim_cells(cells: dict) -> dict:
    """Drop trailing zeros from each cell array (the page pads them back on load; see padGameShard)."""
    out = {}
    for k, v in cells.items():
        v = list(v)
        while v and v[-1] == 0:
            v.pop()
        out[k] = v
    return out


def compact_game(g: dict) -> dict:
    """Compact JSON for artifact_game_view.js. Field order inside the cell
    arrays is game_slices.PLAYER_FIELDS / TEAM_FIELDS / GOALIE_FIELDS."""
    return {
        "id": g["id"], "date": g["date"], "home": g["home"], "away": g["away"],
        "hs": g["home_score"], "as": g["away_score"], "oc": g["outcome"],
        "bp": g["by_period"], "tc": {sd: _trim_cells(c) for sd, c in g["team_cells"].items()}, "shots": g["shots"],
        "goals": g["goals"],
        "pens": [[p["period"], p["label"], p["time"], p["team"], p["player"], p["pid"], p["desc"], p["min"]] for p in g["penalties"]],
        "sk": {
            side: [[s["id"], s["name"], s["pos"], s["raw"], s["qoc"], s["qot"], s["adj"], s["pv"], _trim_cells(s["cells"]), s["zs"], s["parts"]] for s in rows_]
            for side, rows_ in g["skaters"].items()
        },
        "gl": [[x["id"], x["name"], x["team"], _trim_cells(x["cells"]), 1 if x.get("starter") else 0] for x in g["goalies"]],
        "units": [
            [u["team"], u["type"], u["toi"], u["players"], u["cf"], u["ca"], u["gf"], u["ga"],
             u["xgf"], u["xga"], u["hdcf"], u["hdca"], u["score"], u["key"],
             u["mdcf"], u["mdca"], u["ldcf"], u["ldca"], u["pr"]]
            for u in g["units"]
        ],
        "stars": g["stars"], "ns": int(g["no_shifts"]), "uo": g["unit_others"],
    }


def game_shards(games: list[dict]) -> tuple[dict, list]:
    """({HOME_ABBREV: {game_id: compact_game}}, games_index) — index rows are
    [id, date, away, away_score, home, home_score, outcome, top_performer, raw, adjusted, player_id, team]."""
    shards: dict[str, dict] = {}
    index = []
    for g in games:
        shards.setdefault(g["home"], {})[str(g["id"])] = compact_game(g)
        index.append(
            [g["id"], g["date"], g["away"], g["away_score"], g["home"], g["home_score"], g["outcome"],
             g["stars"][0]["name"] if g["stars"] else "",
             g["stars"][0].get("raw") if g["stars"] else None, g["stars"][0]["adj"] if g["stars"] else None,
             g["stars"][0]["id"] if g["stars"] else None, g["stars"][0]["team"] if g["stars"] else None]
        )
    return shards, index


# per-player splits by situation, summed over a season (see player_splits)
SPLIT_FIELDS = ["toi", "g", "a", "sog", "ixg", "cf", "ca", "xgf", "xga", "gf", "ga", "hdcf", "hdca", "ihd", "imd", "ild",
                "ihg", "img", "ilg", "ihx", "imx", "ilx"]
_SITUATION_GROUPS = {"EV": (0, 1), "PP": (2,), "PK": (3,)}


def _sum_cells(cells, sits=None):
    """Sum a team/player cell dict over situations (None = all) -> list in field order."""
    out = None
    for k, v in cells.items():
        if sits is not None and int(k) % 5 not in sits:
            continue
        out = list(v) if out is None else [a + b for a, b in zip(out, v)]
    return out


def attach_game_logs(team_data: dict, games: list[dict]) -> None:
    """Add each game's numbers to the team's schedule rows so the team page can show a full game log: shots, shot attempts, shots on
    goal by danger band, power play, penalty minutes, faceoffs, the best skater, the best forward line and defense pair (3:00
    together at least), and the starting goalie. All of it comes from the game's own cells, so it matches the game page."""
    from .game_slices import TEAM_FIELDS

    ti = {f: i for i, f in enumerate(TEAM_FIELDS)}

    def get(cells, sits, field):
        v = _sum_cells(cells, sits)
        return v[ti[field]] if v else 0

    # each goalie's line for each game, from the goalie logs already on the shard
    goalie_by_game: dict[str, dict[int, tuple]] = {}
    for team, shard in team_data.items():
        by = goalie_by_game.setdefault(team, {})
        for pid, p in shard["players"].items():
            for r in p.get("goalie_log", []):
                best = by.get(r["gid"])
                if best is None or r["sf"] > best[1]:
                    by[r["gid"]] = (int(pid), r["sf"], r["ga"], r["xga"], r["gsax"])

    for g in games:
        for side, opp in (("home", "away"), ("away", "home")):
            team = g[side]
            shard = team_data.get(team)
            if not shard:
                continue
            # season shot danger on the power play (this team's shots for) and the penalty kill (the other team's power-play shots against it):
            # shots on goal by band, goals, expected goals and time
            sp = shard.setdefault("special", {"pp": [0, 0, 0, 0, 0.0, 0], "pk": [0, 0, 0, 0, 0.0, 0]})
            for kind, cells in (("pp", g["team_cells"][side]), ("pk", g["team_cells"][opp])):
                a = sp[kind]
                a[0] += int(get(cells, (2,), "hdc")); a[1] += int(get(cells, (2,), "mdc")); a[2] += int(get(cells, (2,), "ldc"))
                a[3] += int(get(cells, (2,), "goals")); a[4] += get(cells, (2,), "xgf"); a[5] += int(get(cells, (2,), "toi"))
            row = next((r for r in shard["schedule"] if r["gid"] == g["id"]), None)
            if row is None:
                continue
            T, O = g["team_cells"][side], g["team_cells"][opp]
            row.update({
                "sf": int(get(T, None, "sog")), "sa": int(get(O, None, "sog")),
                "cf": int(get(T, None, "attempts")), "ca": int(get(O, None, "attempts")),
                "hdf": int(get(T, None, "hdc")), "hda": int(get(O, None, "hdc")),
                "mdf": int(get(T, None, "mdc")), "mda": int(get(O, None, "mdc")),
                "ldf": int(get(T, None, "ldc")), "lda": int(get(O, None, "ldc")),
                "ppg": int(get(T, (2,), "goals")), "ppga": int(get(O, (2,), "goals")),
                "pim": int(get(T, None, "pim")),
                "fow": int(get(T, None, "fow")), "fol": int(get(T, None, "fol")),
            })
            sk = [s for s in g["skaters"][side] if s.get("adj") is not None]
            if sk:
                b = max(sk, key=lambda s: s["adj"])
                row["bs"] = [b["id"], round(b["adj"], 2), round(b["raw"], 2) if b.get("raw") is not None else None]
            for utype, key in (("line", "bl"), ("pair", "bp")):
                us = [u for u in g["units"] if u["team"] == team and u["type"] == utype and u["toi"] >= 180]
                if us:
                    u = max(us, key=lambda u: u["score"])
                    row[key] = [u["key"], round(u["score"], 2), list(u["players"])]
            gk = goalie_by_game.get(team, {}).get(g["id"])
            if gk:
                row["gk"] = [gk[0], gk[1], gk[2], round(gk[3], 2), round(gk[4], 2)]


def team_advanced(games: list[dict]) -> dict:
    """Season team numbers from the per-game team cells: shot and chance shares (all situations and 5v5),
    PDO, power-play and penalty-kill rates, faceoffs and physical play. Records use official scores."""
    from .game_slices import TEAM_FIELDS

    ti = {f: i for i, f in enumerate(TEAM_FIELDS)}
    acc = defaultdict(lambda: defaultdict(float))

    def get(cells, sits, field):
        v = _sum_cells(cells, sits)
        return v[ti[field]] if v else 0.0

    for g in games:
        for side, opp in (("home", "away"), ("away", "home")):
            team, T, O = g[side], g["team_cells"][side], g["team_cells"][opp]
            a = acc[team]
            mine, theirs = (g["home_score"], g["away_score"]) if side == "home" else (g["away_score"], g["home_score"])
            a["gp"] += 1
            if mine > theirs:
                a["w"] += 1
            elif g["outcome"] == "REG":
                a["l"] += 1
            else:
                a["otl"] += 1
            a["gf_off"] += mine  # official score; not "gf", which the cell loop below already uses for goals from the cells
            a["ga_off"] += theirs
            for label, sits in (("", None), ("5", (0,))):
                for f, key in (("goals", "g"), ("sog", "s"), ("attempts", "c"), ("xgf", "x"), ("hdc", "h")):
                    a[f"{key}f{label}"] += get(T, sits, f)
                    a[f"{key}a{label}"] += get(O, sits, f)
            a["toi5"] += get(T, (0,), "toi")
            a["pp_toi"] += get(T, (2,), "toi")
            a["pp_gf"] += get(T, (2,), "goals")
            a["pp_xgf"] += get(T, (2,), "xgf")
            a["pk_toi"] += get(T, (3,), "toi")
            a["pk_ga"] += get(O, (2,), "goals")
            a["pk_xga"] += get(O, (2,), "xgf")
            for f in ("fow", "fol", "hits", "blocks", "tk", "gv", "pim"):
                a[f] += get(T, None, f)

    def share(x, y):
        return round(100 * x / (x + y), 1) if x + y else None

    out = {}
    for team, a in acc.items():
        gp = a["gp"]
        out[team] = {
            "w": int(a["w"]), "l": int(a["l"]), "otl": int(a["otl"]), "pts": int(2 * a["w"] + a["otl"]),
            "gf": int(a["gf_off"]), "ga": int(a["ga_off"]),
            "xgf": round(a["xf"], 1), "xga": round(a["xa"], 1),
            "xgf_pct": share(a["xf"], a["xa"]), "cf_pct": share(a["cf"], a["ca"]), "sf_pct": share(a["sf"], a["sa"]),
            "hdcf_pct": share(a["hf"], a["ha"]),
            "xgf_pct5": share(a["xf5"], a["xa5"]), "cf_pct5": share(a["cf5"], a["ca5"]), "hdcf_pct5": share(a["hf5"], a["ha5"]),
            # PDO = shooting % + save % at 5v5, scaled to 100
            "pdo5": round(100 * (a["gf5"] / a["sf5"] + 1 - a["ga5"] / a["sa5"]), 1) if a["sf5"] and a["sa5"] else None,
            "pp_g": int(a["pp_gf"]), "pk_ga_n": int(a["pk_ga"]),  # power-play goals for, and against while shorthanded
            "pp_gf60": round(a["pp_gf"] * 3600 / a["pp_toi"], 2) if a["pp_toi"] else None,
            "pp_xgf60": round(a["pp_xgf"] * 3600 / a["pp_toi"], 2) if a["pp_toi"] else None,
            "pk_ga60": round(a["pk_ga"] * 3600 / a["pk_toi"], 2) if a["pk_toi"] else None,
            "pk_xga60": round(a["pk_xga"] * 3600 / a["pk_toi"], 2) if a["pk_toi"] else None,
            "fo_pct": share(a["fow"], a["fol"]),
            "hits_pg": round(a["hits"] / gp, 1), "blocks_pg": round(a["blocks"] / gp, 1),
            "tk_pg": round(a["tk"] / gp, 1), "gv_pg": round(a["gv"] / gp, 1), "pim_pg": round(a["pim"] / gp, 1),
        }
    return out


def player_splits(games: list[dict]) -> dict:
    """{(team, player_id): {"EV": [...], "PP": [...], "PK": [...]}} season sums in SPLIT_FIELDS order."""
    from .game_slices import PLAYER_FIELDS

    pi = {f: i for i, f in enumerate(PLAYER_FIELDS)}
    acc: dict = {}
    for g in games:
        for side in ("home", "away"):
            team = g[side]
            for s in g["skaters"][side]:
                for name, sits in _SITUATION_GROUPS.items():
                    v = _sum_cells(s["cells"], sits)
                    if v is None:
                        continue
                    row = [v[pi["toi"]], v[pi["g"]], v[pi["a1"]] + v[pi["a2"]], v[pi["sog"]], v[pi["ixg"]], v[pi["cf"]], v[pi["ca"]],
                           v[pi["xgf"]], v[pi["xga"]], v[pi["gf"]], v[pi["ga"]], v[pi["hdcf"]], v[pi["hdca"]],
                           v[pi["ihd"]], v[pi["imd"]], v[pi["ild"]],
                           v[pi["ihg"]], v[pi["img"]], v[pi["ilg"]], v[pi["ihx"]], v[pi["imx"]], v[pi["ilx"]]]
                    cur = acc.setdefault((team, s["id"]), {}).setdefault(name, [0.0] * len(SPLIT_FIELDS))
                    for i, x in enumerate(row):
                        cur[i] += x
    return {k: {n: [round(x, 2) for x in vals] for n, vals in d.items()} for k, d in acc.items()}


def goalie_danger(games: list[dict]) -> dict:
    """{(team, goalie_id): [sf, ga, xga] x (high, medium, low)} season sums: shots faced, goals allowed and
    expected goals against in each shot-danger band."""
    from .game_slices import GOALIE_FIELDS

    gi = {f: i for i, f in enumerate(GOALIE_FIELDS)}
    order = ["sfh", "gah", "xgah", "sfm", "gam", "xgam", "sfl", "gal", "xgal"]
    acc: dict = {}
    for g in games:
        for x in g["goalies"]:
            v = _sum_cells(x["cells"], None)
            if v is None:
                continue
            cur = acc.setdefault((x["team"], x["id"]), [0.0] * len(order))
            for i, k in enumerate(order):
                cur[i] += v[gi[k]]
    return {k: [round(x, 2) for x in vals] for k, vals in acc.items()}


def _share(a, b):
    return 100 * a / (a + b) if a + b else None


# Player-card metrics, as (group, label, value(summary), higher is better, decimals, suffix). Rates are per 60 minutes
# of the player's own ice time, all situations.
def _per60(key):
    return lambda s: s[key] * 3600 / s["toi"] if s["toi"] else None


SKATER_CARD = [
    ("Overall", "Game Score (avg)", lambda s: s["avg_raw"], True, 2, ""),
    ("Overall", "Adjusted impact (avg)", lambda s: s["avg_adjusted"], True, 2, ""),
    ("Scoring", "Goals / 60", _per60("goals"), True, 2, ""),
    ("Scoring", "Assists / 60", _per60("assists"), True, 2, ""),
    ("Scoring", "Points / 60", _per60("points"), True, 2, ""),
    ("Scoring", "Shots / 60", _per60("shots"), True, 2, ""),
    ("Scoring", "ixG / 60", _per60("total_ixg"), True, 2, ""),
    ("On ice", "xGF%", lambda s: _share(s["xgf"], s["xga"]), True, 1, "%"),
    ("On ice", "CF%", lambda s: _share(s["cf"], s["ca"]), True, 1, "%"),
    ("On ice", "HDCF%", lambda s: _share(s["hdcf"], s["hdca"]), True, 1, "%"),
    ("On ice", "xGF / 60", _per60("xgf"), True, 2, ""),
    ("On ice", "xGA / 60", _per60("xga"), False, 2, ""),
    ("Play", "Penalties drawn / 60", _per60("pd"), True, 2, ""),
    ("Play", "Penalties taken / 60", _per60("pt"), False, 2, ""),
    ("Play", "Takeaways / 60", _per60("takeaways"), True, 2, ""),
    ("Play", "Giveaways / 60", _per60("giveaways"), False, 2, ""),
    ("Play", "Hits / 60", _per60("hits"), True, 2, ""),
    ("Play", "Blocks / 60", _per60("blk"), True, 2, ""),
]
GOALIE_CARD = [
    ("Results", "Save %", lambda g: g.get("sv_pct"), True, 3, ""),
    ("Results", "Goals against avg", lambda g: g["goals_allowed"] * 3600 / g["toi"] if g["toi"] else None, False, 2, ""),
    ("Results", "GSAx", lambda g: g["gsax"], True, 1, ""),
    ("Results", "GSAx / 60", lambda g: g["gsax"] * 3600 / g["toi"] if g["toi"] else None, True, 2, ""),
    ("Workload", "Shots against / 60", lambda g: g["shots_faced"] * 3600 / g["toi"] if g["toi"] else None, False, 1, ""),
]


def _percentile(value, pool, hi):
    """Where a value sits among a pool, 0-100 (ties count half), flipped when lower is better."""
    if value is None or not pool:
        return None
    below = sum(1 for v in pool if v < value) + 0.5 * sum(1 for v in pool if v == value)
    pct = 100 * below / len(pool)
    return round(pct if hi else 100 - pct)


def attach_player_cards(team_data: dict) -> None:
    """Percentile-bar player card for every player: skaters against forwards or defensemen, goalies against goalies.
    The pool is the players with a real sample (at least 10% of the busiest skater's ice time, or a quarter of the
    busiest goalie's games); anyone else is still placed against that pool, and the card says how big it is."""
    pos, summ, goalie_rows = {}, {}, {}
    for shard in team_data.values():
        for r in shard["roster"]:
            pos.setdefault(r["player_id"], r["position"])
        for r in shard["goalies"]:
            pos.setdefault(r["player_id"], "G")
            goalie_rows.setdefault(r["player_id"], r)
        for pid, p in shard["players"].items():
            summ.setdefault(int(pid), p["summary"])
    skater_ids = [p for p, ps in pos.items() if ps != "G" and p in summ and summ[p]["toi"] > 0]
    max_toi = max((summ[p]["toi"] for p in skater_ids), default=0)
    groups = {"forwards": [], "defensemen": []}
    for p in skater_ids:
        if summ[p]["toi"] >= 0.1 * max_toi:
            groups["forwards" if pos[p] != "D" else "defensemen"].append(p)
    pools = {g: [[fn(summ[p]) for p in ids if fn(summ[p]) is not None] for (_, _, fn, _, _, _) in SKATER_CARD] for g, ids in groups.items()}

    goalies = {}
    for pid, r in goalie_rows.items():
        if pid in summ:
            goalies[pid] = dict(r, toi=summ[pid]["toi"])
    max_gp = max((g["gp"] for g in goalies.values()), default=0)
    goalie_pool_ids = [p for p, g in goalies.items() if g["gp"] >= 0.25 * max_gp]
    goalie_pools = [[fn(goalies[p]) for p in goalie_pool_ids if fn(goalies[p]) is not None] for (_, _, fn, _, _, _) in GOALIE_CARD]

    def metrics(spec, pool_lists, source):
        out = []
        for (group, label, fn, hi, d, suffix), pool in zip(spec, pool_lists):
            v = fn(source)
            if v is None:
                continue
            out.append([group, label, f"{v:.{d}f}{suffix}", _percentile(v, pool, hi)])
        return out

    for shard in team_data.values():
        for pid, p in shard["players"].items():
            pid = int(pid)
            if pos.get(pid) == "G" and pid in goalies:
                p["card"] = {"pool": "goalies", "n": len(goalie_pool_ids), "m": metrics(GOALIE_CARD, goalie_pools, goalies[pid]),
                             "small": goalies[pid]["gp"] < 0.25 * max_gp}
            elif pid in skater_ids:
                g = "forwards" if pos[pid] != "D" else "defensemen"
                # below the pool's ice-time bar the per-60 rates are noisy: the card says so
                p["card"] = {"pool": g, "n": len(groups[g]), "m": metrics(SKATER_CARD, pools[g], summ[pid]),
                             "small": summ[pid]["toi"] < 0.1 * max_toi}


def special_teams_opportunities(conn) -> dict[str, list[int]]:
    """{team abbrev: [power plays, times shorthanded]}, counted from the game state, used when the NHL's official
    numbers don't cover the same games. A power play starts when a team's skater advantage appears or grows (a second
    penalty during one counts as another). Penalty events are skipped, since the NHL stamps them with the state from
    before the penalty, and stretches with a goalie out are ignored."""
    abbrev = {}
    for gid, home_id, away_id, home_ab, away_ab in conn.execute(
        "SELECT game_id, home_team_id, away_team_id, home_team_abbrev, away_team_abbrev FROM games"
    ):
        abbrev[gid] = (home_ab, away_ab)
    skip = ("penalty", "delayed-penalty", "game-end", "period-end", "period-start", "shootout-complete")
    ppo = defaultdict(int)
    prev = {}  # (game, side) -> last skater advantage
    for gid, etype, code in conn.execute(
        "SELECT game_id, type, situation_code FROM events WHERE period < 5 ORDER BY game_id, period, time_sec, event_id"
    ):
        if gid not in abbrev or etype in skip or not code or len(code) != 4 or not code.isdigit():
            continue
        away_g, away_s, home_s, home_g = (int(c) for c in code)
        if away_g != 1 or home_g != 1:
            continue
        for side, diff in (("away", away_s - home_s), ("home", home_s - away_s)):
            k = (gid, side)
            if diff > 0 and diff > max(prev.get(k, 0), 0):
                ppo[k] += 1
            prev[k] = diff
    out = defaultdict(lambda: [0, 0])
    for (gid, side), n in ppo.items():
        home_ab, away_ab = abbrev[gid]
        me, opp = (home_ab, away_ab) if side == "home" else (away_ab, home_ab)
        out[me][0] += n
        out[opp][1] += n
    return out


def official_goalies(conn) -> dict[int, dict]:
    """The NHL's official season goalie rows by player id ({} when the request fails or the DB spans several seasons)."""
    from . import api
    seasons = [r[0] for r in conn.execute("SELECT DISTINCT season FROM games")]
    if len(seasons) != 1:
        return {}
    try:
        return api.get_goalie_summary(seasons[0])
    except Exception:
        return {}


def apply_official_goalie(row: dict, official: dict, pid_key: str, sf_key: str, ga_key: str, gp: int) -> None:
    """Replace a goalie's shots against, goals against and save % with the NHL's own numbers, so they read exactly as
    on nhl.com. Used only when the NHL row covers the same games as ours and he played for one team; otherwise ours
    (shots on goal and goals allowed, counted from the play-by-play) stand and the save % is computed from them."""
    o = official.get(row[pid_key])
    if o and o.get("gamesPlayed") == gp and "," not in (o.get("teamAbbrevs") or ""):
        row[sf_key], row[ga_key] = o["shotsAgainst"], o["goalsAgainst"]
        row["sv_pct"] = round(o["savePct"], 3) if o.get("savePct") is not None else None
    else:
        row["sv_pct"] = round(1 - row[ga_key] / row[sf_key], 3) if row[sf_key] else None


def official_special_teams(conn) -> dict[str, dict]:
    """The NHL's official PP% / PK% rows for this season, by team abbreviation ({} when the request fails)."""
    from . import api
    seasons = [r[0] for r in conn.execute("SELECT DISTINCT season FROM games")]
    ids = dict(conn.execute("SELECT home_team_id, home_team_abbrev FROM games UNION SELECT away_team_id, away_team_abbrev FROM games"))
    if len(seasons) != 1:
        return {}
    try:
        rows_ = api.get_special_teams(seasons[0])
    except Exception:
        return {}
    return {ids[tid]: r for tid, r in rows_.items() if tid in ids and "ppOpportunities" in r and "timesShorthanded" in r}


def league_units(units: list[dict], max_team_gp: int) -> dict:
    """Every regular unit in the league, by type, with season totals: the Units tab's sortable tables. The bar for 'regular' is the team
    pages' (10 minutes together for a line or pair, 3 for a power-play or penalty-kill unit), scaled down early in a season."""
    f = min(1.0, max_team_gp / 20)
    floor = {"line": max(120, 600 * f), "pair": max(120, 600 * f), "pp": max(30, 180 * f), "pk": max(30, 180 * f)}
    out = {t: [] for t in floor}
    for u in units:
        t, sm = u["type"], u["summary"]
        if t in out and sm["toi_sec"] >= floor[t]:
            out[t].append({"key": u["key"], "team": u["team"], "unit": ", ".join(p["name"] for p in u["players"]), "gp": sm["gp"],
                           "toi_sec": sm["toi_sec"], "gf": sm["gf"], "ga": sm["ga"], "xgf": round(sm["xgf"], 1), "xga": round(sm["xga"], 1),
                           "total": sm["total_score"], "avg": sm["avg_score"], "per60": sm["score_per60"]})
    for rows_ in out.values():
        rows_.sort(key=lambda r: -r["toi_sec"])
    return out


def build_season(conn, pipeline) -> dict:
    """Everything the page needs for one (sliced) season."""
    units = build_units(conn, 1)  # every unit gets a page
    unit_keys = {u["key"] for u in units}
    board = leaderboards(conn, unit_keys)
    team_data, teams_index, players_index, unit_data = team_shards(conn, units)
    games = build_games(conn, unit_keys, pipeline)
    game_data, games_index = game_shards(games)

    adv = team_advanced(games)
    st = special_teams_opportunities(conn)
    official = official_special_teams(conn)
    for t in teams_index:
        t.update(adv.get(t["abbrev"], {}))
        o = official.get(t["abbrev"])
        if o and o["gamesPlayed"] == t["gp"]:  # the NHL's own numbers, when they cover the same games as ours
            t["ppo"], t["pko"] = o["ppOpportunities"], o["timesShorthanded"]
            t["pp_pct"], t["pk_pct"] = round(100 * o["powerPlayPct"], 1), round(100 * o["penaltyKillPct"], 1)
            continue
        ppo, pko = st.get(t["abbrev"], [0, 0])
        t["ppo"], t["pko"] = ppo, pko
        t["pp_pct"] = round(100 * t.get("pp_g", 0) / ppo, 1) if ppo else None
        t["pk_pct"] = round(100 * (1 - t.get("pk_ga_n", 0) / pko), 1) if pko else None
    for (team, pid), splits in player_splits(games).items():
        shard = team_data.get(team)
        if shard and str(pid) in shard["players"]:
            shard["players"][str(pid)]["splits"] = splits
    for (team, pid), danger in goalie_danger(games).items():
        shard = team_data.get(team)
        if shard and str(pid) in shard["players"]:
            shard["players"][str(pid)]["danger"] = danger
    attach_game_logs(team_data, games)
    attach_player_cards(team_data)
    return {
        "inline": dict(board, teams_index=teams_index, players_index=players_index, games_index=games_index),
        "team_shards": team_data, "game_shards": game_data, "unit_shards": unit_data,
        "league_units": league_units(units, max((t["gp"] for t in teams_index), default=0)),
    }
