"""Official final score / how a game ended, derived from stored events.

Shootout goals are stored as events (period 5) but are not goals: the official
score is goals through overtime, plus one for the shootout winner. Counting all
'goal' events (as the first version of the schedule/W-L code did) overstates
shootout games' scores.
"""
from collections import defaultdict


def game_results(conn) -> dict[int, dict]:
    """{game_id: {"home": int, "away": int, "outcome": "REG"|"OT"|"SO",
                  "home_goals_by_period": {...}, "away_goals_by_period": {...}}}"""
    games = {
        gid: (home, away)
        for gid, home, away in conn.execute("SELECT game_id, home_team_id, away_team_id FROM games")
    }
    by_period: dict[int, dict[tuple, int]] = defaultdict(lambda: defaultdict(int))
    for gid, period, team_id, n in conn.execute(
        "SELECT game_id, period, team_id, COUNT(*) FROM events WHERE type = 'goal' GROUP BY game_id, period, team_id"
    ):
        by_period[gid][(period, team_id)] = n
    last_period = dict(conn.execute("SELECT game_id, MAX(period) FROM events GROUP BY game_id"))

    out = {}
    for gid, (home, away) in games.items():
        goals = by_period.get(gid, {})
        hp = {p: n for (p, t), n in goals.items() if t == home and p <= 4}
        ap = {p: n for (p, t), n in goals.items() if t == away and p <= 4}
        h, a = sum(hp.values()), sum(ap.values())
        outcome = "REG"
        lp = last_period.get(gid, 3)
        if lp == 4:
            outcome = "OT"
        elif lp >= 5:
            outcome = "SO"
            sh = sum(n for (p, t), n in goals.items() if t == home and p >= 5)
            sa = sum(n for (p, t), n in goals.items() if t == away and p >= 5)
            if sh > sa:
                h += 1
            elif sa > sh:
                a += 1
        out[gid] = {"home": h, "away": a, "outcome": outcome, "home_by_period": hp, "away_by_period": ap}
    return out
