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


def _best_of_seven(p_games: list[float]) -> float:
    """Chance the first team wins a best-of-seven, given its chance in each of the seven games (played in order, stopping at four wins)."""
    states = {(0, 0): 1.0}                      # (wins, losses) -> probability of being there before this game
    total = 0.0
    for p in p_games:
        nxt = {}
        for (w, l), pr in states.items():
            for won, q in ((1, p), (0, 1 - p)):
                w2, l2 = w + won, l + 1 - won
                if w2 == 4:
                    total += pr * q
                elif l2 < 4:
                    nxt[(w2, l2)] = nxt.get((w2, l2), 0.0) + pr * q
        states = nxt
    return total


def _series_matrix(teams, rates, L):
    """HI[i, j]: the chance team i, with home ice, beats team j in a best-of-seven (home in games 1, 2, 5 and 7). A game is the same model as the
    regular season with a tie after regulation settled by a coin flip (playoff overtime is sudden death)."""
    n = len(teams)
    win_home = np.zeros((n, n))                                   # win_home[i, j]: i beats j in a game at i's rink
    for i, ti in enumerate(teams):
        for j, tj in enumerate(teams):
            if i == j:
                continue
            (hf, ha), (af, aa) = rates[ti], rates[tj]
            pr_h, pr_a, tie = _outcome_probs(HOME * hf * aa / L, af * ha / (HOME * L))
            win_home[i, j] = pr_h + tie / 2
    HI = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            if i != j:
                h, a = win_home[i, j], 1 - win_home[j, i]
                HI[i, j] = _best_of_seven([h, h, a, a, h, a, h])
    return HI


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
    # the schedule's worth in standings points: expected points from each remaining game against the real opponent, minus the same game against an
    # average team (same building, same rest), added up. Positive means the remaining schedule is easier than average.
    avg_f = float(np.mean([rates[t][0] for t in teams])); avg_a = float(np.mean([rates[t][1] for t in teams]))
    sos_pts = {t: 0.0 for t in teams}
    exp_pts = lambda p, home: (2 * (p[0] + p[1]) + p[2]) if home else (2 * (p[3] + p[2]) + p[1])
    for g, (_gid, d, a, h) in enumerate(remaining):
        (hf, ha), (af, aa) = rates[h], rates[a]
        flag = b2b(a, d)

        def mk(hf_, ha_, af_, aa_):
            lh, la = HOME * hf_ * aa_ / L, af_ * ha_ / (HOME * L)
            if flag:
                la *= AWAY_B2B; lh /= AWAY_B2B ** 0.5
            pr_h, pr_a, tie = _outcome_probs(lh, la)
            return [pr_h, tie / 2, tie / 2, pr_a]
        probs[g] = mk(hf, ha, af, aa)
        sos_pts[h] += exp_pts(probs[g], True) - exp_pts(mk(hf, ha, avg_f, avg_a), True)       # the home team against an average visitor
        sos_pts[a] += exp_pts(probs[g], False) - exp_pts(mk(avg_f, avg_a, af, aa), False)     # the visitor against an average home team

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

    # ---- who is in, and in which seed. Per conference: the top three in each division, then the two best of the rest (wild cards).
    made = np.zeros((sims, n), bool)
    seed_cnt = {k: np.zeros(n) for k in ("div1", "div2", "div3", "wc1", "wc2")}     # how often each team finishes in each spot
    pres = np.zeros((sims, n), bool); pres[np.arange(sims), np.argmax(key, axis=1)] = True
    HI = _series_matrix(teams, rates, L)                                            # HI[i, j]: chance team i (with home ice) beats team j in a best of seven
    rnd = {k: np.zeros(n) for k in ("r2", "r3", "final", "cup")}
    ar = np.arange(sims)
    champs = []
    for conf in ("Eastern", "Western"):
        cidx = np.array([idx[t] for t in teams if standings[t]["conf"] == conf])
        divs = sorted({standings[t]["div"] for t in teams if standings[t]["conf"] == conf})
        in_top = np.zeros((sims, n), bool)
        top3 = {}
        for dv in divs:
            didx = np.array([idx[t] for t in teams if standings[t]["div"] == dv])
            order = np.argsort(-key[:, didx], axis=1)
            top3[dv] = didx[order[:, :3]]
            for k in range(3):
                in_top[ar, top3[dv][:, k]] = True
                np.add.at(seed_cnt[f"div{k + 1}"], top3[dv][:, k], 1)
        wk = np.where(in_top[:, cidx], -1.0, key[:, cidx])                          # the wild cards: the next best two in the conference
        wc = cidx[np.argsort(-wk, axis=1)[:, :2]]
        made |= in_top
        for k in range(2):
            made[ar, wc[:, k]] = True
            np.add.at(seed_cnt[f"wc{k + 1}"], wc[:, k], 1)

        def win(a_, b_):
            """The winner of a best-of-seven between two teams per sim; the one with the better regular season has home ice."""
            a_better = key[ar, a_] >= key[ar, b_]
            hi, lo = np.where(a_better, a_, b_), np.where(a_better, b_, a_)
            return np.where(rng.random(sims) < HI[hi, lo], hi, lo)

        A, B = top3[divs[0]], top3[divs[1]]
        a_top = key[ar, A[:, 0]] >= key[ar, B[:, 0]]                                 # the division winner with more points plays the second wild card
        top_dw, other_dw = np.where(a_top, A[:, 0], B[:, 0]), np.where(a_top, B[:, 0], A[:, 0])
        w1, w2 = win(top_dw, wc[:, 1]), win(other_dw, wc[:, 0])
        w3, w4 = win(A[:, 1], A[:, 2]), win(B[:, 1], B[:, 2])
        for w in (w1, w2, w3, w4):
            np.add.at(rnd["r2"], w, 1)
        r2a = win(w1, np.where(a_top, w3, w4)); r2b = win(w2, np.where(a_top, w4, w3))   # a division's bracket stays together until the conference final
        for w in (r2a, r2b):
            np.add.at(rnd["r3"], w, 1)
        champ = win(r2a, r2b)
        np.add.at(rnd["final"], champ, 1)
        champs.append(champ)
    e, w_ = champs
    a_better = key[ar, e] >= key[ar, w_]
    hi, lo = np.where(a_better, e, w_), np.where(a_better, w_, e)
    cup_winner = np.where(rng.random(sims) < HI[hi, lo], hi, lo)
    np.add.at(rnd["cup"], cup_winner, 1)

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
            "playoffs": round(float(made[:, i].mean()), 4), "r2": round(float(rnd["r2"][i] / sims), 4), "r3": round(float(rnd["r3"][i] / sims), 4),
            "final": round(float(rnd["final"][i] / sims), 4), "cup": round(float(rnd["cup"][i] / sims), 4),
            "div1": round(float(seed_cnt["div1"][i] / sims), 4), "div2": round(float(seed_cnt["div2"][i] / sims), 4), "div3": round(float(seed_cnt["div3"][i] / sims), 4),
            "wc1": round(float(seed_cnt["wc1"][i] / sims), 4), "wc2": round(float(seed_cnt["wc2"][i] / sims), 4), "pres": round(float(pres[:, i].mean()), 4),
            "pts_mean": round(float(pts[:, i].mean()), 1),
            "sos": round(float(np.mean(sos[t])), 3) if sos[t] else None, "sos_pts": round(sos_pts[t], 1), "power": round(strength[t], 3),
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
        print(f"{t['abbrev']} {t['conf'][:1]}-{t['div'][:3]} {t['w']}-{t['l']}-{t['otl']} {t['pts']}pts  playoffs {100 * t['playoffs']:5.1f}%  1st {100 * t['div1']:5.1f}%  cup {100 * t['cup']:4.1f}%  proj {t['pts_mean']}  sos {t['sos']} ({t['sos_pts']:+.1f} pts)")
    print(res["cutoff"], res["games_left"], "games left")
