"""Playoff odds: simulate the rest of the regular season many times and count how often each team makes the playoffs.

Each remaining game is drawn from the same model as the game predictions on the site (nhl_impact has no copy of that model's maths in Python
until now; this mirrors `predictGame` in artifact_script_body.js): a team's attack and defense are its expected goals for and against in recent
games (older games count less, last season's games count too), pulled toward the league average, with a small home edge and a penalty for the
road team on the second night of a back-to-back. Goals are Poisson; a tie after 60 minutes is an overtime or shootout coin flip.

The standings come from the NHL (points, regulation wins, wins without a shootout). The format is the NHL's: the top three in each division
and the next two best in the conference, 16 teams. Tiebreakers: points, then regulation wins, then regulation-plus-overtime wins, then a coin
flip (the NHL's later tiebreakers, head to head and goal differential, are not modeled).
"""
import glob
import json
import os
import urllib.request
from datetime import date

import numpy as np

WEB = "https://api-web.nhle.com/v1"
DECAY, SHRINK, HOME, AWAY_B2B = 0.95, 10.0, 1.03, 0.90
SIMS = 10000
SHOOTOUT_SHARE = 0.4          # share of overtime-or-shootout games that are decided in the shootout (the winner then has no regulation-plus-overtime win)
MAXG = 14


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "shiftscore-odds"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def fetch_standings() -> dict:
    out = {}
    for t in _get(f"{WEB}/standings/now")["standings"]:
        out[t["teamAbbrev"]["default"]] = {
            "conf": t["conferenceName"], "div": t["divisionName"], "gp": t["gamesPlayed"], "w": t["wins"], "l": t["losses"], "otl": t["otLosses"],
            "pts": t["points"], "rw": t["regulationWins"], "row": t["regulationPlusOtWins"], "gd": t["goalDifferential"]}
    return out


def fetch_remaining(season: str, teams) -> list[tuple]:
    """Regular-season games not yet final, once each: (game id, date, away, home)."""
    seen, out = set(), []
    for t in teams:
        for g in _get(f"{WEB}/club-schedule-season/{t}/{season}")["games"]:
            if g.get("gameType") != 2 or g["id"] in seen:
                continue
            seen.add(g["id"])
            if g.get("gameState") in ("FINAL", "OFF"):
                continue
            out.append((g["id"], g["gameDate"], g["awayTeam"]["abbrev"], g["homeTeam"]["abbrev"]))
    return sorted(out, key=lambda x: (x[1], x[0]))


def team_ratings(season: str, prev_season: str | None, teams) -> tuple[dict, float]:
    """({team: (attack, defense)}, league average expected goals per team-game) from the exported team files."""
    def load(s, t):
        try:
            with open(f"artifact_data/{s}/teams/{t}.json") as f:
                return json.load(f)["schedule"]
        except Exception:
            return []
    cur = {t: load(season, t) for t in teams}
    prev = {t: load(prev_season, t) for t in teams} if prev_season else {t: [] for t in teams}
    xs = [r["xgf"] for rows in cur.values() for r in rows if r.get("xgf") is not None]
    L = float(np.mean(xs)) if xs else 3.0
    out = {}
    for t in teams:
        f = a = w = 0.0
        for r in prev[t] + cur[t]:
            if r.get("xgf") is None or r.get("xga") is None:
                continue
            f = f * DECAY + r["xgf"]; a = a * DECAY + r["xga"]; w = w * DECAY + 1
        out[t] = ((f + SHRINK * L) / (w + SHRINK), (a + SHRINK * L) / (w + SHRINK))
    return out, L


def _outcome_probs(lh: float, la: float):
    """(P home wins in regulation, P away wins in regulation, P tied after regulation) for independent Poisson goals."""
    k = np.arange(MAXG)
    ph, pa = np.exp(-lh) * lh ** k / _fact(k), np.exp(-la) * la ** k / _fact(k)
    m = np.outer(ph, pa); m = m / m.sum()
    return float(np.tril(m, -1).sum()), float(np.triu(m, 1).sum()), float(np.trace(m))


_FACT = np.array([float(np.prod(np.arange(1, i + 1))) if i else 1.0 for i in range(MAXG)])
def _fact(k): return _FACT[k]


def simulate(season: str, prev_season: str | None = None, sims: int = SIMS, seed: int = 20262027) -> dict:
    standings = fetch_standings()
    teams = sorted(standings)
    remaining = fetch_remaining(season, teams)
    rates, L = team_ratings(season, prev_season, teams)
    idx = {t: i for i, t in enumerate(teams)}
    # each team's game dates, for the road team's second night of a back-to-back (finished games from the team files, then what's left)
    dates = {t: [] for t in teams}
    for t in teams:
        try:
            with open(f"artifact_data/{season}/teams/{t}.json") as f:
                dates[t] = [r["date"] for r in json.load(f)["schedule"]]
        except Exception:
            pass
    for _gid, d, a, h in remaining:
        dates[a].append(d); dates[h].append(d)
    dates = {t: sorted(set(v)) for t, v in dates.items()}
    prev_day = lambda d: (date.fromisoformat(d).toordinal() - 1)
    b2b = lambda t, d: (date.fromisoformat(d).toordinal() - 1) in {date.fromisoformat(x).toordinal() for x in dates[t]}

    G = len(remaining)
    home = np.array([idx[h] for *_x, h in remaining]); away = np.array([idx[a] for _g, _d, a, _h in remaining])
    probs = np.zeros((G, 4))     # home regulation win, home overtime win, away overtime win, away regulation win
    for g, (_gid, d, a, h) in enumerate(remaining):
        (hf, ha), (af, aa) = rates[h], rates[a]
        lh, la = HOME * hf * aa / L, af * ha / (HOME * L)
        if b2b(a, d):
            la *= AWAY_B2B; lh /= AWAY_B2B ** 0.5
        pr_h, pr_a, tie = _outcome_probs(lh, la)
        probs[g] = [pr_h, tie / 2, tie / 2, pr_a]

    rng = np.random.default_rng(seed)
    cum = np.cumsum(probs, axis=1)
    u = rng.random((sims, G))
    outcome = (u[:, :, None] > cum[None, :, :3]).sum(axis=2)              # 0 home reg, 1 home OT, 2 away OT, 3 away reg
    so = rng.random((sims, G)) < SHOOTOUT_SHARE                           # an overtime-or-shootout game that ended in the shootout
    n = len(teams)
    pts = np.tile(np.array([standings[t]["pts"] for t in teams], float), (sims, 1))
    rw = np.tile(np.array([standings[t]["rw"] for t in teams], float), (sims, 1))
    row = np.tile(np.array([standings[t]["row"] for t in teams], float), (sims, 1))
    hw, aw = outcome <= 1, outcome >= 2                                    # home won / away won
    for g in range(G):
        h, a = home[g], away[g]
        o = outcome[:, g]
        pts[:, h] += np.where(o <= 1, 2, np.where(o == 2, 1, 0))           # home: win 2, overtime loss 1, regulation loss 0
        pts[:, a] += np.where(o >= 2, 2, np.where(o == 1, 1, 0))
        rw[:, h] += (o == 0); rw[:, a] += (o == 3)
        row[:, h] += (o == 0) | ((o == 1) & ~so[:, g]); row[:, a] += (o == 3) | ((o == 2) & ~so[:, g])
    key = pts * 1e6 + rw * 1e3 + row + rng.random((sims, n)) * 0.5          # points, regulation wins, regulation-plus-overtime wins, then a coin flip

    made = np.zeros((sims, n), bool); won_div = np.zeros((sims, n), bool); top_conf = np.zeros((sims, n), bool)
    for conf in ("Eastern", "Western"):
        cidx = [idx[t] for t in teams if standings[t]["conf"] == conf]
        in_top = np.zeros((sims, n), bool)
        for dv in sorted({standings[t]["div"] for t in teams if standings[t]["conf"] == conf}):
            didx = np.array([idx[t] for t in teams if standings[t]["div"] == dv])
            order = np.argsort(-key[:, didx], axis=1)
            top3 = didx[order[:, :3]]
            for k in range(3):
                in_top[np.arange(sims), top3[:, k]] = True
            won_div[np.arange(sims), top3[:, 0]] = True
        rest = np.array(cidx)
        wk = np.where(in_top[:, rest], -1.0, key[:, rest])                  # the wild cards: the next best two in the conference
        wc = rest[np.argsort(-wk, axis=1)[:, :2]]
        made |= in_top
        for k in range(2):
            made[np.arange(sims), wc[:, k]] = True
        ck = key[:, rest]; top_conf[np.arange(sims), rest[np.argmax(ck, axis=1)]] = True
    pres = np.zeros((sims, n), bool); pres[np.arange(sims), np.argmax(key, axis=1)] = True

    # what the remaining schedule asks of each team: the average strength (expected-goal difference per game) of its opponents
    strength = {t: rates[t][0] - rates[t][1] for t in teams}
    sos = {t: [] for t in teams}
    for _gid, _d, a, h in remaining:
        sos[h].append(strength[a]); sos[a].append(strength[h])
    out = []
    for t in teams:
        i = idx[t]; s = standings[t]
        out.append({
            "abbrev": t, "conf": s["conf"], "div": s["div"], "gp": s["gp"], "w": s["w"], "l": s["l"], "otl": s["otl"], "pts": s["pts"], "rem": len(sos[t]),
            "playoffs": round(float(made[:, i].mean()), 4), "division": round(float(won_div[:, i].mean()), 4),
            "conf_top": round(float(top_conf[:, i].mean()), 4), "pres": round(float(pres[:, i].mean()), 4),
            "pts_mean": round(float(pts[:, i].mean()), 1), "pts_p10": int(np.percentile(pts[:, i], 10)), "pts_p90": int(np.percentile(pts[:, i], 90)),
            "sos": round(float(np.mean(sos[t])), 3) if sos[t] else None, "power": round(strength[t], 3),
        })
    # the points the last wild card needed, by conference (median of the 16th team's... the lowest team in)
    cutoff = {}
    for conf in ("Eastern", "Western"):
        cidx = np.array([idx[t] for t in teams if standings[t]["conf"] == conf])
        vals = np.where(made[:, cidx], pts[:, cidx], 10 ** 6).min(axis=1)
        cutoff[conf] = int(np.median(vals))
    return {"season": season, "sims": sims, "games_left": G, "standings_date": date.today().isoformat(), "cutoff": cutoff, "teams": out}


if __name__ == "__main__":
    import sys
    res = simulate(sys.argv[1] if len(sys.argv) > 1 else "20262027", sys.argv[2] if len(sys.argv) > 2 else "20252026")
    for t in sorted(res["teams"], key=lambda x: -x["playoffs"]):
        print(f"{t['abbrev']} {t['conf'][:1]}-{t['div'][:3]} {t['w']}-{t['l']}-{t['otl']} {t['pts']}pts  playoffs {100 * t['playoffs']:5.1f}%  div {100 * t['division']:5.1f}%  pres {100 * t['pres']:4.1f}%  proj {t['pts_mean']} ({t['pts_p10']}-{t['pts_p90']})  sos {t['sos']}")
    print(res["cutoff"], res["games_left"], "games left")
