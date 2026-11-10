# Game Score weights. They are tuned, not published: the values live in the private file private/formulas.json (see formulas.py and the
# private INTERNAL_FORMULAS.md). Game Score is the weighted sum of what a skater did in one game: goals, assists, shots, blocks, faceoffs,
# penalties, his team's 5v5 shot attempts, goals and expected goals for and against while he is on the ice, and his own flurry- and
# score-adjusted expected goals (adjustments.py).
from .formulas import FORMULAS

WEIGHTS = dict(FORMULAS["game_score_weights"])


def raw_game_score(stats: dict) -> float:
    return sum(WEIGHTS[k] * stats.get(k, 0) for k in WEIGHTS)
