import json
import os

from .game_info import game_results
from .game_pages import build_games
from .site_export import compact_game
from .unit_pages import UNIT_TYPE_LABELS, build_units, toi_str, unit_key

STYLE = """
:root { color-scheme: light dark; }
body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 920px;
       margin: 2rem auto; padding: 0 1rem; line-height: 1.4; }
h1 { font-size: 1.4rem; }
nav { margin-bottom: 1.5rem; display: flex; gap: 1rem; flex-wrap: wrap; }
nav a { text-decoration: none; padding: 0.3rem 0.7rem; border: 1px solid #8884; border-radius: 6px; }
nav a.active { font-weight: 600; border-color: #888; }
table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #8883; }
th { font-weight: 600; }
tr:nth-child(even) { background: #80808014; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.caption { color: #888; font-size: 0.85rem; margin-bottom: 1rem; }
.scroll { overflow-x: auto; }
.scorebox { display: flex; gap: 2rem; align-items: baseline; flex-wrap: wrap; margin: 0.5rem 0 1rem; }
.scorebox .team { font-size: 1.6rem; font-weight: 600; }
.scorebox .big { font-size: 2.2rem; font-weight: 700; }
.pos { color: #1a7f4e; } .neg { color: #b1372e; }
"""

PAGES = [
    ("index.html", "Games"),
    ("player_games.html", "Player Games"),
    ("season.html", "Season xG Leaders"),
    ("goalies.html", "Goalies"),
    ("lines.html", "Lines"),
    ("pairs.html", "D Pairs"),
    ("pp.html", "Power Play"),
    ("pk.html", "Penalty Kill"),
    ("units/index.html", "Unit Pages"),
    ("teams/index.html", "Teams"),
    ("players/index.html", "Players"),
]


def _nav(active: str, prefix: str = "") -> str:
    links = "".join(
        f'<a href="{prefix}{href}"{" class=\"active\"" if href == active else ""}>{label}</a>'
        for href, label in PAGES
    )
    return f"<nav>{links}</nav>"


def _player_link(player_id: int, name: str, prefix: str = "") -> str:
    return f'<a href="{prefix}players/{player_id}.html">{name}</a>'


def _team_link(abbrev: str, prefix: str = "") -> str:
    return f'<a href="{prefix}teams/{abbrev}.html">{abbrev}</a>'


def _table(headers: list[str], rows: list[list[str]], numeric_cols: set[int]) -> str:
    thead = "".join(f'<th class="{"num" if i in numeric_cols else ""}">{h}</th>' for i, h in enumerate(headers))
    body_rows = []
    for row in rows:
        cells = "".join(f'<td class="{"num" if i in numeric_cols else ""}">{c}</td>' for i, c in enumerate(row))
        body_rows.append(f"<tr>{cells}</tr>")
    return f"<table><thead><tr>{thead}</tr></thead><tbody>{''.join(body_rows)}</tbody></table>"


def _page(title: str, active: str, caption: str, table_html: str, prefix: str = "") -> str:
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{title} — NHL Impact</title>
<style>{STYLE}</style></head>
<body>
<h1>{title}</h1>
{_nav(active, prefix)}
<p class="caption">{caption}</p>
{table_html}
</body></html>"""


def _toi_str(sec: int) -> str:
    return f"{sec // 60}:{sec % 60:02d}"


def render_player_games(conn, limit: int = 100) -> str:
    rows = conn.execute(
        """SELECT pgi.player_id, p.first_name || ' ' || p.last_name AS name, t.abbrev, gm.game_date,
                  pgi.raw_game_score, pgi.qoc, pgi.qot, pgi.adjusted_impact, pgs.ixg
           FROM player_game_impact pgi
           JOIN players p ON p.player_id = pgi.player_id
           JOIN player_game_stats pgs ON pgs.game_id = pgi.game_id AND pgs.player_id = pgi.player_id
           JOIN games gm ON gm.game_id = pgi.game_id
           JOIN (SELECT home_team_id AS id, home_team_abbrev AS abbrev FROM games
                 UNION SELECT away_team_id, away_team_abbrev FROM games) t ON t.id = pgs.team_id
           ORDER BY pgi.adjusted_impact DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    table_rows = [
        [_player_link(pid, name), _team_link(team), date, f"{raw:.2f}", f"{qoc:.2f}", f"{qot:.2f}", f"{adj:.2f}", f"{ixg:.2f}"]
        for pid, name, team, date, raw, qoc, qot, adj, ixg in rows
    ]
    table = _table(
        ["Player", "Team", "Date", "Raw", "QoC", "QoT", "Adjusted", "ixG"],
        table_rows,
        numeric_cols={3, 4, 5, 6, 7},
    )
    caption = "Best single-game performances, adjusted for quality of competition and teammates."
    return _page("Top Player Games", "player_games.html", caption, table)


def render_season_leaders(conn, limit: int = 50) -> str:
    rows = conn.execute(
        """SELECT pgs.player_id, p.first_name || ' ' || p.last_name AS name, COUNT(*) games,
                  SUM(goals) goals, SUM(shots) shots, SUM(ixg) total_ixg,
                  SUM(goals) - SUM(ixg) AS goals_above_ixg
           FROM player_game_stats pgs
           JOIN players p ON p.player_id = pgs.player_id
           GROUP BY pgs.player_id
           HAVING games >= 10
           ORDER BY total_ixg DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    table_rows = [
        [_player_link(pid, name), str(games), str(goals), str(shots), f"{ixg:.1f}", f"{gax:+.1f}"]
        for pid, name, games, goals, shots, ixg, gax in rows
    ]
    table = _table(
        ["Player", "GP", "Goals", "Shots", "Total ixG", "Goals − ixG"],
        table_rows,
        numeric_cols={1, 2, 3, 4, 5},
    )
    caption = (
        "Season expected-goals leaders (min 10 GP). \"Goals − ixG\" is a rough finishing/luck "
        "indicator — positive means scoring above what their shot quality alone would predict."
    )
    return _page("Season xG Leaders", "season.html", caption, table)


def render_goalies(conn, limit: int = 50) -> str:
    rows = conn.execute(
        """SELECT gs.goalie_id, p.first_name || ' ' || p.last_name AS name, t.abbrev, COUNT(*) gp,
                  SUM(shots_faced) sf, SUM(goals_allowed) ga, SUM(xga) xga, SUM(gsax) gsax
           FROM goalie_game_stats gs
           JOIN players p ON p.player_id = gs.goalie_id
           JOIN (SELECT home_team_id AS id, home_team_abbrev AS abbrev FROM games
                 UNION SELECT away_team_id, away_team_abbrev FROM games) t ON t.id = gs.team_id
           GROUP BY gs.goalie_id
           HAVING gp >= 10
           ORDER BY gsax DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    table_rows = []
    for pid, name, team, gp, sf, ga, xga, gsax in rows:
        sv_pct = 1 - ga / sf if sf else 0
        table_rows.append(
            [_player_link(pid, name), _team_link(team), str(gp), str(sf), str(ga), f"{xga:.1f}", f"{gsax:+.1f}", f"{sv_pct:.3f}"]
        )
    table = _table(
        ["Goalie", "Team", "GP", "Shots Faced", "Goals Allowed", "xGA", "GSAx", "Sv%"],
        table_rows,
        numeric_cols={2, 3, 4, 5, 6, 7},
    )
    caption = (
        "Goals Saved Above Expected (min 10 GP) = expected goals against (from the same shot-"
        "quality model used everywhere else) minus actual goals allowed. Positive means stopping "
        "more than an average goalie would given the shots faced."
    )
    return _page("Goalies", "goalies.html", caption, table)


def render_units(conn, unit_type: str, title: str, min_toi: int = 60, limit: int = 100, unit_keys: set | None = None) -> str:
    rows = conn.execute(
        """SELECT u.player_ids, t.abbrev, gm.game_date, u.toi_sec, u.cf, u.ca, u.gf, u.ga,
                  u.xgf, u.xga, u.hdcf, u.hdca, u.unit_score
           FROM unit_game_stats u
           JOIN games gm ON gm.game_id = u.game_id
           JOIN (SELECT home_team_id AS id, home_team_abbrev AS abbrev FROM games
                 UNION SELECT away_team_id, away_team_abbrev FROM games) t ON t.id = u.team_id
           WHERE u.unit_type = ? AND u.toi_sec >= ?
           ORDER BY u.unit_score DESC LIMIT ?""",
        (unit_type, min_toi, limit),
    ).fetchall()

    players = dict(conn.execute("SELECT player_id, first_name || ' ' || last_name FROM players").fetchall())

    table_rows = []
    for player_ids, team, date, toi, cf, ca, gf, ga, xgf, xga, hdcf, hdca, score in rows:
        names = ", ".join(
            _player_link(int(pid), players.get(int(pid), pid)) for pid in player_ids.split(",")
        )
        table_rows.append(
            [
                names, _team_link(team), date, _toi_str(toi), str(cf), str(ca), str(gf), str(ga),
                f"{xgf:.2f}", f"{xga:.2f}", str(hdcf), str(hdca), f"{score:.2f}",
                _unit_page_link(unit_key(team, unit_type, player_ids), unit_keys),
            ]
        )

    table = _table(
        ["Unit", "Team", "Date", "TOI", "CF", "CA", "GF", "GA", "xGF", "xGA", "HDC For", "HDC Against", "Score", "Season page"],
        table_rows,
        numeric_cols={3, 4, 5, 6, 7, 8, 9, 10, 11, 12},
    )
    caption = f"Best {title.lower()} combinations by on-ice differential (min {min_toi}s together)."
    return _page(title, f"{unit_type if unit_type != 'pair' else 'pairs'}.html", caption, table)


def _unit_page_link(key: str, unit_keys: set | None, prefix: str = "") -> str:
    if unit_keys is None or key not in unit_keys:
        return ""
    return f'<a href="{prefix}units/{key}.html">season &rarr;</a>'


def _unit_players_html(unit: dict, prefix: str = "../") -> str:
    return ", ".join(_player_link(p["id"], p["name"], prefix) for p in unit["players"])


def _unit_summary_table(units: list[dict], prefix: str = "../", with_team: bool = False) -> str:
    """One row per unit: the table used on team pages, player pages, and the index."""
    headers = ["Unit"] + (["Team"] if with_team else []) + ["GP", "TOI", "GF", "GA", "xGF", "xGA", "Total", "Avg / GM", "Per 60"]
    rows = []
    for u in units:
        s = u["summary"]
        names = ", ".join(p["name"] for p in u["players"])
        rows.append(
            [f'<a href="{prefix}units/{u["key"]}.html">{names}</a>']
            + ([_team_link(u["team"], prefix)] if with_team else [])
            + [str(s["gp"]), toi_str(s["toi_sec"]), str(s["gf"]), str(s["ga"]), f'{s["xgf"]:.1f}', f'{s["xga"]:.1f}',
               f'{s["total_score"]:.2f}', f'{s["avg_score"]:.2f}', f'{s["score_per60"]:.2f}']
        )
    first_num = 2 if with_team else 1
    return _table(headers, rows, numeric_cols=set(range(first_num, len(headers))))


def render_unit_page(unit: dict) -> str:
    s = unit["summary"]
    label = UNIT_TYPE_LABELS[unit["type"]]
    summary = _table(
        ["GP", "TOI", "CF", "CA", "GF", "GA", "xGF", "xGA", "HDCF", "HDCA", "Total Score", "Avg Score / GM", "Score / 60"],
        [[str(s["gp"]), toi_str(s["toi_sec"]), str(s["cf"]), str(s["ca"]), str(s["gf"]), str(s["ga"]),
          f'{s["xgf"]:.1f}', f'{s["xga"]:.1f}', str(s["hdcf"]), str(s["hdca"]),
          f'{s["total_score"]:.2f}', f'{s["avg_score"]:.2f}', f'{s["score_per60"]:.2f}']],
        numeric_cols=set(range(13)),
    )
    log_rows = [
        [f'<a href="../games/{g["game_id"]}.html">{g["date"]}</a>', f'{g["loc"]} {_team_link(g["opp"], "../")}', g["result"], toi_str(g["toi_sec"]), str(g["cf"]), str(g["ca"]),
         str(g["gf"]), str(g["ga"]), f'{g["xgf"]:.2f}', f'{g["xga"]:.2f}', str(g["hdcf"]), str(g["hdca"]), f'{g["score"]:.2f}']
        for g in unit["log"]
    ]
    log_table = _table(
        ["Date", "Opp", "Result", "TOI", "CF", "CA", "GF", "GA", "xGF", "xGA", "HDCF", "HDCA", "Unit Score"],
        log_rows, numeric_cols=set(range(3, 13)),
    )
    title = " / ".join(p["name"].split()[-1] for p in unit["players"])
    body = f"""<h1>{title} <span style="font-weight:400;color:#888;font-size:1rem">{_team_link(unit["team"], "../")} &middot; {label}</span></h1>
<p class="caption">{_unit_players_html(unit)}</p>
<p class="caption">Unit Score = 1.0&middot;GF &minus; 1.0&middot;GA + 0.5&middot;xGF(adj) &minus; 0.5&middot;xGA(adj), summed over this unit's time together in each game. It is a count, so a longer game together scores higher in magnitude; Score / 60 normalizes for that.</p>
<h2 style="font-size:1.05rem;margin-top:1.5rem;">Season Summary</h2>
{summary}
<h2 style="font-size:1.05rem;margin-top:1.5rem;">Game Log ({s["gp"]} games)</h2>
{log_table}"""
    return _detail_page(title, body)


def _unit_sections(units: list[dict], prefix: str = "../") -> str:
    out = []
    for t in ("line", "pair", "pp", "pk", "ev4", "ev3"):
        group = [u for u in units if u["type"] == t]
        if group:
            out.append(
                f'<h2 style="font-size:1.05rem;margin-top:1.5rem;">{UNIT_TYPE_LABELS[t]}s</h2>'
                + _unit_summary_table(sorted(group, key=lambda u: -u["summary"]["toi_sec"]), prefix)
            )
    return "".join(out)


def render_units_index(units: list[dict], min_gp: int = 8, limit: int = 40) -> str:
    out = []
    for t in ("line", "pair", "pp", "pk", "ev4", "ev3"):
        group = [u for u in units if u["type"] == t and u["summary"]["gp"] >= min_gp]
        group.sort(key=lambda u: -u["summary"]["avg_score"])
        out.append(
            f'<h2 style="font-size:1.05rem;margin-top:1.5rem;">{UNIT_TYPE_LABELS[t]}s &mdash; top {min(limit, len(group))} by avg score / game</h2>'
            + _unit_summary_table(group[:limit], "../", with_team=True)
        )
    count = len(units)
    caption = (
        f"{count} units have their own page (lines and pairs with 10+ min together on the season, PP/PK units with 3+ min; "
        f"shorter-lived combinations are one-off deployments). Ranked here by average Unit Score per game, min {min_gp} GP. "
        "Every unit is also listed on its team's page."
    )
    body = f'<h1>Unit Pages</h1>{_nav("units/index.html", "../")}<p class="caption">{caption}</p>' + "".join(out)
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Unit Pages — NHL Impact</title>
<style>{STYLE}</style></head>
<body>
{body}
</body></html>"""


def _detail_page(title: str, body_html: str, prefix: str = "../") -> str:
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{title} — NHL Impact</title>
<style>{STYLE}</style></head>
<body>
{_nav("", prefix)}
{body_html}
</body></html>"""


def render_player_page(conn, player_id: int, units: list[dict] | None = None) -> str | None:
    p = conn.execute(
        "SELECT first_name, last_name, position FROM players WHERE player_id = ?", (player_id,)
    ).fetchone()
    if p is None:
        return None
    name = f"{p[0]} {p[1]}"

    totals = conn.execute(
        """SELECT COUNT(*), SUM(goals), SUM(primary_assists + secondary_assists), SUM(shots),
                  AVG(raw_game_score), SUM(ixg), SUM(hits), SUM(takeaways),
                  SUM(giveaways), SUM(pim)
           FROM player_game_stats WHERE player_id = ?""",
        (player_id,),
    ).fetchone()
    gp, goals, assists, shots, avg_raw, total_ixg, hits, tk, gv, pim = (v or 0 for v in totals)
    impact = conn.execute("SELECT AVG(adjusted_impact) FROM player_game_impact WHERE player_id = ?", (player_id,)).fetchone()
    avg_adj = impact[0] or 0

    summary = _table(
        ["GP", "G", "A", "P", "Shots", "Avg Raw", "Avg Adjusted", "Total ixG", "Hits", "Takeaways", "Giveaways", "PIM"],
        [[
            str(gp), str(goals), str(assists), str(goals + assists), str(shots), f"{avg_raw:.2f}",
            f"{avg_adj:.2f}", f"{total_ixg:.1f}", str(hits), str(tk), str(gv), str(pim),
        ]],
        numeric_cols=set(range(13)),
    )

    log_rows = conn.execute(
        """SELECT gm.game_date, t.abbrev, pgs.goals, pgs.primary_assists + pgs.secondary_assists,
                  pgi.raw_game_score, pgi.qoc, pgi.qot, pgi.adjusted_impact, pgs.ixg, gm.game_id
           FROM player_game_impact pgi
           JOIN player_game_stats pgs ON pgs.game_id = pgi.game_id AND pgs.player_id = pgi.player_id
           JOIN games gm ON gm.game_id = pgi.game_id
           JOIN (SELECT home_team_id AS id, home_team_abbrev AS abbrev FROM games
                 UNION SELECT away_team_id, away_team_abbrev FROM games) t ON t.id = pgs.team_id
           WHERE pgi.player_id = ? ORDER BY gm.game_date""",
        (player_id,),
    ).fetchall()
    log_table_rows = [
        [f'<a href="../games/{gid}.html">{date}</a>', _team_link(team, "../"), str(g), str(a), f"{raw:.2f}", f"{qoc:.2f}", f"{qot:.2f}", f"{adj:.2f}", f"{ixg:.2f}"]
        for date, team, g, a, raw, qoc, qot, adj, ixg, gid in log_rows
    ]
    log_table = _table(
        ["Date", "Team", "G", "A", "Raw", "QoC", "QoT", "Adjusted", "ixG"], log_table_rows, numeric_cols={2, 3, 4, 5, 6, 7, 8}
    )

    body = f"""<h1>{name} <span style="font-weight:400;color:#888;font-size:1rem">{p[2]}</span></h1>
<h2 style="font-size:1.05rem;margin-top:1.5rem;">Season Summary</h2>
{summary}
<h2 style="font-size:1.05rem;margin-top:1.5rem;">Game Log ({gp} games)</h2>
{log_table}{_unit_sections(units) if units else ""}"""
    return _detail_page(name, body)


def render_team_page(conn, team_id: int, abbrev: str, units: list[dict] | None = None) -> str:
    roster_rows = conn.execute(
        """SELECT p.player_id, p.first_name || ' ' || p.last_name, p.position, COUNT(*) gp,
                  SUM(pgs.goals), SUM(pgs.primary_assists + pgs.secondary_assists),
                  AVG(pgi.adjusted_impact)
           FROM player_game_stats pgs
           JOIN players p ON p.player_id = pgs.player_id
           LEFT JOIN player_game_impact pgi ON pgi.game_id = pgs.game_id AND pgi.player_id = pgs.player_id
           WHERE pgs.team_id = ? AND p.position != 'G'
           GROUP BY p.player_id ORDER BY gp DESC""",
        (team_id,),
    ).fetchall()
    roster_table_rows = [
        [_player_link(pid, name, "../"), pos, str(gp), str(g or 0), str(a or 0), f"{(adj or 0):.2f}"]
        for pid, name, pos, gp, g, a, adj in roster_rows
    ]
    roster_table = _table(["Player", "Pos", "GP", "G", "A", "Avg Adjusted"], roster_table_rows, numeric_cols={2, 3, 4, 5})

    goalie_rows = conn.execute(
        """SELECT p.player_id, p.first_name || ' ' || p.last_name, COUNT(*) gp,
                  SUM(gs.shots_faced), SUM(gs.goals_allowed), SUM(gs.gsax)
           FROM goalie_game_stats gs JOIN players p ON p.player_id = gs.goalie_id
           WHERE gs.team_id = ? GROUP BY gs.goalie_id ORDER BY gp DESC""",
        (team_id,),
    ).fetchall()
    goalie_table_rows = [
        [_player_link(pid, name, "../"), str(gp), str(sf), str(ga), f"{gsax:+.1f}"]
        for pid, name, gp, sf, ga, gsax in goalie_rows
    ]
    goalie_table = _table(["Goalie", "GP", "Shots Faced", "Goals Allowed", "GSAx"], goalie_table_rows, numeric_cols={1, 2, 3, 4})

    games = conn.execute(
        """SELECT game_id, game_date,
                  CASE WHEN home_team_id = ? THEN away_team_abbrev ELSE home_team_abbrev END,
                  CASE WHEN home_team_id = ? THEN 'vs' ELSE '@' END
           FROM games WHERE home_team_id = ? OR away_team_id = ? ORDER BY game_date""",
        (team_id, team_id, team_id, team_id),
    ).fetchall()
    results = game_results(conn)
    sched_rows = []
    wins = losses = 0
    for game_id, date, opp, loc in games:
        res = results[game_id]
        gf, ga = (res["home"], res["away"]) if loc == "vs" else (res["away"], res["home"])
        result = "W" if gf > ga else "L"
        if result == "W":
            wins += 1
        else:
            losses += 1
        suffix = "" if res["outcome"] == "REG" else f" ({res['outcome']})"
        sched_rows.append([f'<a href="../games/{game_id}.html">{date}</a>', f"{loc} {opp}", f"{gf}-{ga}{suffix}", result])
    sched_table = _table(["Date", "Opponent", "Score", "Result"], sched_rows, numeric_cols=set())

    body = f"""<h1>{abbrev}</h1>
<p class="caption">{wins}-{losses} ({len(games)} games played)</p>
<h2 style="font-size:1.05rem;margin-top:1.5rem;">Skaters</h2>
{roster_table}
<h2 style="font-size:1.05rem;margin-top:1.5rem;">Goalies</h2>
{goalie_table}
{_unit_sections(units) if units else ""}
<h2 style="font-size:1.05rem;margin-top:1.5rem;">Schedule</h2>
{sched_table}"""
    return _detail_page(abbrev, body)


def render_players_index(conn) -> str:
    rows = conn.execute(
        """SELECT p.player_id, p.first_name || ' ' || p.last_name, p.position, COUNT(*) gp
           FROM player_game_stats pgs JOIN players p ON p.player_id = pgs.player_id
           WHERE p.position != 'G'
           GROUP BY p.player_id ORDER BY gp DESC"""
    ).fetchall()
    # this page lives IN players/, so links to a sibling file need no "players/"
    # prefix — using _player_link here (which always prepends "players/") would
    # resolve to players/players/{id}.html
    table_rows = [[f'<a href="{pid}.html">{name}</a>', pos, str(gp)] for pid, name, pos, gp in rows]
    table = _table(["Player", "Pos", "GP"], table_rows, numeric_cols={2})
    return _page("Players", "players/index.html", f"All {len(rows)} skaters who played this season, by games played.", table, prefix="../")


def render_teams_index(conn) -> str:
    teams = conn.execute(
        "SELECT DISTINCT home_team_id, home_team_abbrev FROM games "
        "UNION SELECT DISTINCT away_team_id, away_team_abbrev FROM games"
    ).fetchall()
    teams = sorted(set(teams), key=lambda t: t[1])
    # same fix as render_players_index: this page lives IN teams/
    table_rows = [[f'<a href="{abbrev}.html">{abbrev}</a>'] for _tid, abbrev in teams]
    table = _table(["Team"], table_rows, numeric_cols=set())
    return _page("Teams", "teams/index.html", f"All {len(teams)} teams.", table, prefix="../")


GAME_VIEW_JS = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "artifact_game_view.js")).read()

# the shared GameView (artifact_game_view.js) renders both this report's game
# pages and the hosted site's, so the numbers and filters are identical; these
# styles are the small subset of the site's look that the view's markup needs
GAME_PAGE_STYLE = """
/* colour tokens the shared box-score view (and its SVG shot maps and charts) are written against */
:root { --ink: #0c2038; --muted: #4b5f78; --line: #c3d2e0; --surface: #fbfdff; --accent: #1352a6; --bad: #c0392b; --good: #137a4b;
        --red: #5db4f0; --rail: #d5e6f6; --crease: #cfe5f8; }
@media (prefers-color-scheme: dark) {
  :root { --ink: #e3effa; --muted: #8fb0d2; --line: #1b3a63; --surface: #0b2142; --accent: #7cc4f5; --bad: #ff8a8a; --good: #4cc790;
          --red: #7cc4f5; --rail: #11305a; --crease: #17406f; }
}
.pos { color: var(--good); } .neg { color: var(--bad); }
.gv-key svg { flex: none; }
.table-scroll { overflow-x: auto; margin-bottom: 0.5rem; }
.detail-title { font-size: 1.5rem; font-weight: 600; margin: 0.5rem 0 0.2rem; }
.detail-sub { color: #888; font-weight: 400; font-size: 0.95rem; }
.detail-h3 { font-size: 1.05rem; font-weight: 600; margin: 1.6rem 0 0.4rem; }
.panel-caption { color: #888; font-size: 0.85rem; margin: 0.3rem 0 0.6rem; max-width: 70ch; }
.empty { color: #888; padding: 0.8rem 0; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 8px; }
.chip { font: inherit; font-size: 0.85rem; background: none; color: inherit; border: 1px solid #8886; border-radius: 999px; padding: 4px 12px; cursor: pointer; }
.chip[aria-pressed="true"] { background: #1c5d8c; color: #fff; border-color: #1c5d8c; }
.gv-filters { margin: 1rem 0 0.5rem; }
.gv-stars { margin: 0 0 0 1.2rem; padding: 0; }
.gv-maps { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 18px; }
.gv-map { margin: 0; min-width: 0; }
.gv-danger-chips { margin: 4px 0 14px; }
.gv-map figcaption { font-size: 0.85rem; color: #888; margin-bottom: 6px; }
.gv-keys { display: flex; flex-wrap: wrap; gap: 6px 22px; margin: 2px 0 8px; font-size: 0.85rem; }
.gv-group { margin: 34px 0 6px; padding-bottom: 6px; font-size: 1rem; font-weight: 700; letter-spacing: 0.02em; color: var(--ink); border-bottom: 2px solid var(--accent); }
.gv-ot { margin-top: 26px; }
.gv-ot-result { font-size: 0.95rem; }
.gv-expected { margin: 2px 0 8px; font-size: 0.9rem; color: var(--muted); }
.gv-expected strong { color: var(--ink); font-variant-numeric: tabular-nums; }
.gv-verdict { margin: 8px 0 12px; font-size: 1.05rem; font-weight: 600; line-height: 1.45; }
.gv-wp-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin: 4px 0; font-weight: 700; }
.gv-wp { display: flex; height: 26px; margin-bottom: 12px; border-radius: 99px; overflow: hidden; font-size: 0.8rem; font-weight: 800; color: #fff; }
.gv-wp span { display: grid; place-items: center; min-width: 2.6em; }
.gv-wp-a { background: var(--accent); }
.gv-wp-h { background: var(--muted); }
.night { font-weight: 700; white-space: nowrap; }
.night.pos { color: var(--good); }
.night.neg { color: var(--bad); }
.unit-scroll > .table-scroll { max-height: 330px; overflow: auto; }
.scroll-hint { margin: 4px 2px 12px; font-size: 12.5px; color: var(--muted); }
.gv-card-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin: 6px 0 10px; }
.gv-nav { display: flex; flex-wrap: nowrap; gap: 6px; margin: 12px 0 8px; overflow-x: auto; padding-bottom: 4px; -webkit-overflow-scrolling: touch; }
.gv-nav .chip { flex: 0 0 auto; }
.gv-teampick { margin: 6px 0 4px; }
[data-gv-sec] { scroll-margin-top: 84px; }
.gv-details { margin-top: 34px; padding-top: 4px; border-top: 2px solid var(--line); }
.gv-details-title { margin: 14px 0 8px; font-size: 1.05rem; font-weight: 800; letter-spacing: 0.02em; }
.gv-card-preview svg { display: block; width: 100%; max-width: 720px; height: auto; border-radius: 14px; box-shadow: 0 10px 34px rgba(8,28,48,0.25); }
.gv-shot { cursor: pointer; outline: none; }
.gv-shot:hover, .gv-shot:focus { stroke-width: 2.4; stroke: var(--ink); }
.gv-tip { position: fixed; z-index: 1000; display: none; pointer-events: none; padding: 8px 11px; border-radius: 9px; background: var(--ink); color: var(--surface); font-size: 0.8rem; line-height: 1.45; box-shadow: 0 6px 22px rgba(0,0,0,0.28); max-width: 240px; }
.gv-tip strong { display: block; font-size: 0.85rem; }
.gv-tip span { display: block; opacity: 0.92; }
.gv-player-pick { margin: 6px 0 4px; font-size: 0.85rem; }
.gv-player-pick select { margin-left: 6px; padding: 6px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); font: inherit; max-width: 100%; }
.gv-key { display: inline-flex; align-items: center; gap: 8px; }
.live-badge { font-size: 0.75rem; padding: 1px 8px; border: 1px solid #8886; border-radius: 999px; }
.live-badge.on { background: #b1372e; color: #fff; border-color: #b1372e; }
a.row-link { color: inherit; }
"""


def render_game_page(g: dict) -> str:
    title = f"{g['away']} @ {g['home']} {g['date']}"
    payload = json.dumps(compact_game(g), separators=(",", ":"))
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{title} — NHL Impact</title>
<style>{STYLE}{GAME_PAGE_STYLE}</style></head>
<body>
{_nav("", "../")}
<div id="game"></div>
<script>
{GAME_VIEW_JS}
const links = {{
  backHtml: '<a href="../index.html">&larr; All games</a>',
  player: (id, team, text) => `<a href="../players/${{id}}.html">${{escapeHtml(text)}}</a>`,
  team: (abbrev) => `<a href="../teams/${{abbrev}}.html">${{abbrev}}</a>`,
  unit: (key, team, text) => `<a href="../units/${{key}}.html">${{escapeHtml(text)}}</a>`,
}};
GameView.mount(document.getElementById("game"), {payload}, links);
</script>
</body></html>"""


def render_games_index(games: list[dict], prefix: str = "") -> str:
    """The report's home page. prefix is "" at the report root (where it lives)."""
    gdir = f"{prefix}games/"
    rows = []
    for g in sorted(games, key=lambda x: (x["date"], x["id"]), reverse=True):
        tag = "" if g["outcome"] == "REG" else f" ({g['outcome']})"
        rows.append(
            [f'<a href="{gdir}{g["id"]}.html">{g["date"]}</a>', _team_link(g["away"], prefix), str(g["away_score"]),
             _team_link(g["home"], prefix), str(g["home_score"]) + tag,
             ", ".join(f'{s["name"]}' for s in g["stars"][:1])]
        )
    table = _table(["Date", "Away", "", "Home", "", "Top performer"], rows, numeric_cols={2, 4})
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Games — NHL Impact</title>
<style>{STYLE}</style></head>
<body>
<h1>Games</h1>{_nav("index.html", prefix)}
<p class="caption">{len(games)} games, newest first. Each game has a full box score with advanced stats and per-player Game Scores.</p>
{table}
</body></html>"""


def generate_report(conn, out_dir: str = "report", pipeline=None) -> None:
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(os.path.join(out_dir, "players"), exist_ok=True)
    os.makedirs(os.path.join(out_dir, "teams"), exist_ok=True)

    os.makedirs(os.path.join(out_dir, "units"), exist_ok=True)
    os.makedirs(os.path.join(out_dir, "games"), exist_ok=True)

    units = build_units(conn)
    unit_keys = {u["key"] for u in units}
    units_by_team: dict[str, list] = {}
    units_by_player: dict[int, list] = {}
    for u in units:
        units_by_team.setdefault(u["team"], []).append(u)
        for p in u["players"]:
            units_by_player.setdefault(p["id"], []).append(u)

    games = build_games(conn, unit_keys, pipeline)

    pages = {
        "player_games.html": render_player_games(conn),
        "season.html": render_season_leaders(conn),
        "goalies.html": render_goalies(conn),
        "lines.html": render_units(conn, "line", "Lines", unit_keys=unit_keys),
        "pairs.html": render_units(conn, "pair", "D Pairs", unit_keys=unit_keys),
        "pp.html": render_units(conn, "pp", "Power Play", min_toi=20, unit_keys=unit_keys),
        "pk.html": render_units(conn, "pk", "Penalty Kill", min_toi=20, unit_keys=unit_keys),
        "units/index.html": render_units_index(units),
        "index.html": render_games_index(games),
        "players/index.html": render_players_index(conn),
        "teams/index.html": render_teams_index(conn),
    }

    player_ids = [r[0] for r in conn.execute("SELECT DISTINCT player_id FROM player_game_stats").fetchall()]
    for pid in player_ids:
        html = render_player_page(conn, pid, units_by_player.get(pid))
        if html is not None:
            pages[f"players/{pid}.html"] = html

    teams = conn.execute(
        "SELECT DISTINCT home_team_id, home_team_abbrev FROM games "
        "UNION SELECT DISTINCT away_team_id, away_team_abbrev FROM games"
    ).fetchall()
    for team_id, abbrev in sorted(set(teams), key=lambda t: t[1]):
        pages[f"teams/{abbrev}.html"] = render_team_page(conn, team_id, abbrev, units_by_team.get(abbrev))

    for u in units:
        pages[f"units/{u['key']}.html"] = render_unit_page(u)
    for g in games:
        pages[f"games/{g['id']}.html"] = render_game_page(g)

    for filename, html in pages.items():
        with open(os.path.join(out_dir, filename), "w") as f:
            f.write(html)
