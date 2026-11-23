"""Who is trending up and down, for the home page.

Form is the recent stretch against the same player's (or unit's) earlier games in the season, in the site's own scores:
  * skaters: average Adjusted Game Score, last 5 games against everything before
  * goalies: goals saved above expected per start, last 4 starts against everything before
  * forward lines and D pairs (listed separately): average Unit Score, last 5 games against everything before
  * power-play and penalty-kill units: the same, by Unit Score
A player or unit has to have enough earlier games for the comparison to mean something and has to be playing now (a game in his team's
last three), so an injured player's old hot streak doesn't show up. Each list is the five biggest rises and the five biggest falls.
"""

TOP = 5
SKATER_RECENT, SKATER_PRIOR, SKATER_MIN_GP = 5, 8, 12
GOALIE_RECENT, GOALIE_PRIOR, GOALIE_MIN_SF = 4, 6, 10
UNIT_RECENT, UNIT_PRIOR = 5, 8
LINE_PAIR_MIN_AVG_TOI = 300      # seconds per game together: a unit that is only occasionally together isn't a unit
ST_MIN_TOTAL_TOI = 1200          # twenty minutes in all for a power-play or penalty-kill group
ACTIVE_WITHIN = 3                # his last game must be among his team's last three


def _split(vals, n_recent, n_prior):
    """vals in date order -> (recent average, earlier average, games in each) or None when there isn't enough to compare."""
    if len(vals) < n_recent + n_prior:
        return None
    recent, prior = vals[-n_recent:], vals[:-n_recent]
    return sum(recent) / len(recent), sum(prior) / len(prior), len(prior)


MIN_CHANGE = 0.1     # a change smaller than this is noise, not a trend


def _pick(items):
    items = [i for i in items if i is not None]
    up = sorted((i for i in items if i["delta"] >= MIN_CHANGE), key=lambda i: -i["delta"])[:TOP]
    down = sorted((i for i in items if i["delta"] <= -MIN_CHANGE), key=lambda i: i["delta"])[:TOP]
    return {"up": up, "down": down}


def _item(base, recent, prior, n_prior, digits=2):
    return {**base, "recent": round(recent, digits), "prior": round(prior, digits), "delta": round(recent - prior, digits), "n": n_prior}


def build(team_data: dict, units: list, players_index: list) -> dict:
    """team_data: {abbrev: shard} (with schedule rows already carrying their game numbers), units: every unit of the season."""
    # the dates of each team's processed games, newest last: the "playing now" test
    team_dates = {}
    for abbrev, shard in team_data.items():
        team_dates[abbrev] = sorted(r["date"] for r in shard.get("schedule", []) if r.get("sf") is not None)

    def active(team, last_date):
        dates = team_dates.get(team) or []
        return bool(dates) and last_date >= dates[max(0, len(dates) - ACTIVE_WITHIN)]

    info = {p["id"]: p for p in players_index}
    seen, skaters, goalies = set(), [], []
    for abbrev, shard in team_data.items():
        for pid, p in shard.get("players", {}).items():
            if pid in seen:
                continue
            seen.add(pid)
            glog = p.get("goalie_log")
            if glog:
                rows = sorted((r for r in glog if r["sf"] >= GOALIE_MIN_SF), key=lambda r: r["date"])
                s = _split([r["gsax"] for r in rows], GOALIE_RECENT, GOALIE_PRIOR)
                if s and active(abbrev, rows[-1]["date"]):
                    goalies.append(_item({"id": int(pid), "name": p["name"], "team": abbrev}, *s))
                continue
            log = [r for r in p.get("game_log", []) if r.get("adjusted") is not None]
            if len(log) < SKATER_MIN_GP:
                continue
            log.sort(key=lambda r: r["date"])
            s = _split([r["adjusted"] for r in log], SKATER_RECENT, SKATER_PRIOR)
            team = log[-1]["team"]
            if s and active(team, log[-1]["date"]):
                pos = (info.get(int(pid)) or {}).get("pos", "")
                skaters.append(_item({"id": int(pid), "name": p["name"], "team": team, "pos": pos}, *s))

    lines, pairs, special = [], [], []
    for u in units:
        log = sorted(u["log"], key=lambda g: g["date"])
        st = u["type"] in ("pp", "pk")
        if len(log) < UNIT_RECENT + UNIT_PRIOR:
            continue
        toi = sum(g["toi_sec"] for g in log)
        if st and toi < ST_MIN_TOTAL_TOI:
            continue
        if not st and toi / len(log) < LINE_PAIR_MIN_AVG_TOI:
            continue
        if u["type"] not in ("line", "pair", "pp", "pk"):
            continue
        s = _split([g["score"] for g in log], UNIT_RECENT, UNIT_PRIOR)
        if not s or not active(u["team"], log[-1]["date"]):
            continue
        item = _item({"key": u["key"], "team": u["team"], "type": u["type"], "players": [p["name"] for p in u["players"]]}, *s)
        (special if st else lines if u["type"] == "line" else pairs).append(item)

    return {"skaters": _pick(skaters), "goalies": _pick(goalies), "lines": _pick(lines), "pairs": _pick(pairs), "special": _pick(special),
            "rules": {"skaters": SKATER_RECENT, "goalies": GOALIE_RECENT, "units": UNIT_RECENT}}
