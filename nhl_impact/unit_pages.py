"""Per-unit (line / D pair / PP unit / PK unit) season summaries and game logs.

Shared by report.py (static HTML pages) and export_team_data.py (JSON shards
for the hosted site) so both show identical numbers.

A "unit" is a (team, unit_type, set of player ids). Even-strength deployments
and especially PP/PK groupings fragment heavily (a penalty ending mid-shift,
an injury replacement, a double-shift), so most distinct combinations are a
few seconds long in one game. Only units with a meaningful season sample get
a page — see MIN_TOI_SEC.
"""

from .game_info import game_results

# total season TOI a unit needs to get its own page. Lines/pairs are deployed
# for long stretches so 10 min filters out one-off combinations; special-teams
# groups are together for much less (a PP is ~2 min), so the bar is lower.
MIN_TOI_SEC = {"line": 600, "pair": 600, "pp": 180, "pk": 180, "ev4": 120, "ev3": 120}

UNIT_TYPE_LABELS = {"line": "Forward line", "pair": "D pair", "pp": "Power play unit", "pk": "Penalty kill unit",
                    "ev4": "4-on-4 unit", "ev3": "3-on-3 unit"}


# Order a unit's players the way a lineup card reads: left wing, center, right wing, then left D, right D.
# The NHL publishes neither a game's actual line slots nor a defenseman's side, so both are inferred:
#  - a defenseman's side is the hand he shoots;
#  - on a forward line, the center is whoever takes the draws (centers take ~7 faceoffs a game, wingers ~1; the listed
#    position alone is unreliable, plenty of listed centers play wing), then wingers go to the side they shoot from.
CENTER_FACEOFFS_PER_GAME = 3.5
_FORWARD_SLOT = {"L": 0, "C": 1, "R": 2}


def player_slots(conn) -> dict[int, tuple]:
    """{player_id: (listed position, shooting hand, faceoffs per game)} for ordering unit lineups."""
    fo = {pid: (n or 0) / gp for pid, n, gp in conn.execute(
        "SELECT player_id, SUM(faceoff_wins + faceoff_losses), COUNT(*) FROM player_game_stats GROUP BY player_id")}
    return {pid: (pos, shoots, fo.get(pid, 0.0)) for pid, pos, shoots in conn.execute("SELECT player_id, position, shoots FROM players")}


def _wing_cost(info, side):
    pos, shoots, fo = info
    cost = {"L" if side == 0 else "R": 0.0, "C": 1.0}.get(pos, 2.0)
    cost += 0.0 if shoots == ("L" if side == 0 else "R") else 0.5
    return cost + (3.0 if fo >= CENTER_FACEOFFS_PER_GAME else 0.0)


def _order_line(pids, slots):
    """Three forwards -> [LW, C, RW]: the cheapest of the six ways to fill the slots."""
    from itertools import permutations
    def cost(order):
        lw, c, rw = (slots.get(p, ("?", None, 0.0)) for p in order)
        return _wing_cost(lw, 0) + (0.0 if c[2] >= CENTER_FACEOFFS_PER_GAME else 4.0) + _wing_cost(rw, 1)
    return list(min(permutations(sorted(pids)), key=lambda o: (cost(o), o)))


def order_players(pids, slots: dict) -> list[int]:
    pids = [int(p) for p in pids]
    fwd = [p for p in pids if slots.get(p, ("?",))[0] in _FORWARD_SLOT]
    others = [p for p in pids if p not in fwd]
    if len(fwd) == 3:
        fwd = _order_line(fwd, slots)
    else:  # power-play and penalty-kill groups: listed position, centers (by faceoffs) in the middle
        fwd.sort(key=lambda p: (_FORWARD_SLOT[slots[p][0]], -slots[p][2], p))
    dmen = sorted((p for p in others if slots.get(p, ("?",))[0] == "D"),
                  key=lambda p: ({"L": 0, "R": 1}.get(slots[p][1], 2), p))
    rest = sorted(p for p in others if p not in dmen)
    return fwd + dmen + rest


def unit_key(abbrev: str, unit_type: str, player_ids: str) -> str:
    """Stable URL/file-safe id, e.g. EDM-line-8477934-8478402-8478420."""
    return f"{abbrev}-{unit_type}-{player_ids.replace(',', '-')}"


def toi_str(sec: int) -> str:
    return f"{sec // 60}:{sec % 60:02d}"


def build_units(conn, min_toi: dict | int | None = None) -> list[dict]:
    """Every qualifying unit with its season summary and per-game log.

    min_toi overrides MIN_TOI_SEC: an int applies to every unit type (1 = every unit that
    ever shared the ice), a dict is per type. The hosted site passes 1 so every unit has a page.

    Each log row is the unit's unit_score for that game plus the stats behind it.
    Log rows are dicts here; export_team_data compacts them to arrays for size.
    """
    teams = {
        tid: abbrev
        for tid, abbrev in conn.execute(
            "SELECT home_team_id, home_team_abbrev FROM games UNION SELECT away_team_id, away_team_abbrev FROM games"
        )
    }
    players = {
        pid: (f"{first} {last}", pos)
        for pid, first, last, pos in conn.execute("SELECT player_id, first_name, last_name, position FROM players")
    }
    games = {
        gid: (date, home, away)
        for gid, date, home, away in conn.execute("SELECT game_id, game_date, home_team_id, away_team_id FROM games")
    }
    results = game_results(conn)
    slots = player_slots(conn)

    qualifying = {
        (team_id, unit_type, pids)
        for team_id, unit_type, pids, toi in conn.execute(
            "SELECT team_id, unit_type, player_ids, SUM(toi_sec) FROM unit_game_stats GROUP BY team_id, unit_type, player_ids"
        )
        if toi >= (min_toi if isinstance(min_toi, int) else (min_toi or MIN_TOI_SEC).get(unit_type, 10**9))
    }

    rows = conn.execute(
        """SELECT game_id, team_id, unit_type, player_ids, toi_sec, cf, ca, gf, ga,
                  xgf, xga, hdcf, hdca, unit_score, mdcf, mdca, ldcf, ldca,
                  hdgf, hdga, mdgf, mdga, ldgf, ldga, hdxgf, hdxga, mdxgf, mdxga, ldxgf, ldxga
           FROM unit_game_stats ORDER BY game_id"""
    ).fetchall()

    by_unit: dict[tuple, list] = {}
    for r in rows:
        k = (r[1], r[2], r[3])
        if k in qualifying:
            by_unit.setdefault(k, []).append(r)

    units = []
    for (team_id, unit_type, pids), unit_rows in by_unit.items():
        abbrev = teams[team_id]
        log = []
        for game_id, _t, _u, _p, toi, cf, ca, gf, ga, xgf, xga, hdcf, hdca, score, mdcf, mdca, ldcf, ldca, *band_gx in unit_rows:
            date, home, away = games[game_id]
            is_home = home == team_id
            opp_id = away if is_home else home
            res = results[game_id]
            tf, ta = (res["home"], res["away"]) if is_home else (res["away"], res["home"])
            log.append(
                {
                    "game_id": game_id,
                    "date": date,
                    "opp": teams[opp_id],
                    "loc": "vs" if is_home else "@",
                    "result": f"{'W' if tf > ta else 'L'}{'' if res['outcome'] == 'REG' else ' ' + res['outcome']} {tf}-{ta}",
                    "toi_sec": toi, "cf": cf, "ca": ca, "gf": gf, "ga": ga,
                    "xgf": round(xgf or 0, 2), "xga": round(xga or 0, 2),
                    "hdcf": hdcf, "hdca": hdca, "score": round(score or 0, 2),
                    "mdcf": mdcf or 0, "mdca": mdca or 0, "ldcf": ldcf or 0, "ldca": ldca or 0,
                }
            )
        log.sort(key=lambda g: g["date"])

        toi = sum(g["toi_sec"] for g in log)
        total_score = sum(g["score"] for g in log)
        BANDX = ["hdgf", "hdga", "mdgf", "mdga", "ldgf", "ldga", "hdxgf", "hdxga", "mdxgf", "mdxga", "ldxgf", "ldxga"]
        band_totals = [sum((r[18 + i] or 0) for r in unit_rows) for i in range(len(BANDX))]
        summary = {
            "gp": len(log), "toi_sec": toi,
            "cf": sum(g["cf"] for g in log), "ca": sum(g["ca"] for g in log),
            "gf": sum(g["gf"] for g in log), "ga": sum(g["ga"] for g in log),
            "xgf": round(sum(g["xgf"] for g in log), 1), "xga": round(sum(g["xga"] for g in log), 1),
            "hdcf": sum(g["hdcf"] for g in log), "hdca": sum(g["hdca"] for g in log),
            "mdcf": sum(g["mdcf"] for g in log), "mdca": sum(g["mdca"] for g in log),
            "ldcf": sum(g["ldcf"] for g in log), "ldca": sum(g["ldca"] for g in log),
            "total_score": round(total_score, 2),
            "avg_score": round(total_score / len(log), 2),
            "score_per60": round(total_score / toi * 3600, 2) if toi else 0.0,
        }
        # goals and xG by danger band (hdgf, hdga, mdgf, mdga, ldgf, ldga, then the same six for xG), as one short list and only for units that
        # had shots on goal: thousands of units carry this, so it is kept compact
        if any(band_totals):
            summary["bx"] = [(round(v, 2) if i >= 6 else int(v)) for i, v in enumerate(band_totals)]
        pid_list = order_players(pids.split(","), slots)
        units.append(
            {
                "key": unit_key(abbrev, unit_type, pids),
                "team": abbrev,
                "type": unit_type,
                "players": [{"id": p, "name": players.get(p, (str(p), "?"))[0], "pos": players.get(p, (str(p), "?"))[1]} for p in pid_list],
                "summary": summary,
                "log": log,
            }
        )
    units.sort(key=lambda u: -u["summary"]["toi_sec"])
    return units
