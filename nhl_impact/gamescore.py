# Game Score weights. They are tuned, not published: the values live in the private file private/formulas.json (see formulas.py and the
# private INTERNAL_FORMULAS.md). Game Score is the weighted sum of what a skater did in one game: goals, assists, shots, blocks, faceoffs,
# penalties, his team's 5v5 shot attempts, goals and expected goals for and against while he is on the ice, and his own flurry- and
# score-adjusted expected goals (adjustments.py).
from .formulas import FORMULAS

WEIGHTS = dict(FORMULAS["game_score_weights"])


def raw_game_score(stats: dict) -> float:
    return sum(WEIGHTS[k] * stats.get(k, 0) for k in WEIGHTS)


# The pieces of a Game Score for the bar-graph card (the user chose to show this split on 2026-11-14; the weights themselves stay private):
# offense is his own production and his team's 5v5 shots, goals and expected goals for while he is on; defense is blocks and the same
# against; the rest is faceoffs and penalties. Together they add up to the raw Game Score.
OFFENSE_TERMS = ("goals", "primary_assists", "secondary_assists", "shots", "ixg_adjusted", "gf_5v5", "xgf_5v5", "cf_5v5")
DEFENSE_TERMS = ("blocks", "ga_5v5", "xga_5v5", "ca_5v5")
OTHER_TERMS = ("faceoff_wins", "faceoff_losses", "penalties_drawn", "penalties_taken")


def game_score_parts(stats: dict) -> tuple[float, float, float]:
    """(offense, defense, faceoffs and penalties) points of one skater-game; they sum to raw_game_score."""
    return tuple(sum(WEIGHTS[k] * stats.get(k, 0) for k in terms) for terms in (OFFENSE_TERMS, DEFENSE_TERMS, OTHER_TERMS))
