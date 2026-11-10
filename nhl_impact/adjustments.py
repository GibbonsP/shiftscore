from collections import defaultdict

from .shot_features import extract_game_shot_rows

# Discount for a rebound shot's contribution when summing into a team or player's total xG (value in private/formulas.json; a hand-picked
# placeholder, not fit to data). It stops a flurry of close-together rebound attempts from counting as independent chances, in the spirit
# of MoneyPuck's published "flurry adjusted" metric without reproducing its numbers.
from .formulas import FORMULAS

FLURRY_DISCOUNT = FORMULAS["flurry_discount"]


def compute_score_adjustment_factors(conn) -> dict[int, tuple[float, float]]:
    """Empirically derived (not hand-picked) from this season's own data:
    for each score-differential bucket (-3..+3, from the shooting team's own
    perspective), how far that bucket's actual share of Fenwick shot
    attempts deviates from the league-average 50/50 split, and the
    multiplier that would correct it. Teams protecting a lead generate
    fewer shot attempts (CF% below 50% while ahead), teams trailing
    generate more — this isn't about them playing worse/better, it's a
    structural effect of game state, so it's normalized out rather than
    left to make a leading team's on-ice stats look artificially weak.
    Returns {bucket: (mult_for, mult_against)}."""
    for_count: dict[int, int] = defaultdict(int)
    against_count: dict[int, int] = defaultdict(int)

    game_ids = [r[0] for r in conn.execute("SELECT game_id FROM games").fetchall()]
    for game_id in game_ids:
        for row in extract_game_shot_rows(conn, game_id):
            d = row["score_diff"]
            for_count[d] += 1
            against_count[-d] += 1

    factors: dict[int, tuple[float, float]] = {}
    for bucket in range(-3, 4):
        total = for_count[bucket] + against_count[bucket]
        if total == 0:
            factors[bucket] = (1.0, 1.0)
            continue
        cf_pct = for_count[bucket] / total
        mult_for = 0.5 / cf_pct if cf_pct > 0 else 1.0
        mult_against = 0.5 / (1 - cf_pct) if cf_pct < 1 else 1.0
        factors[bucket] = (mult_for, mult_against)
    return factors


def shot_weight(row: dict, score_factors: dict[int, tuple[float, float]], is_defending: bool) -> float:
    """Combined flurry + score-state multiplier for one shot, from either the
    shooting team's side (is_defending=False) or the defending team's side
    (is_defending=True, whose own score bucket is the negation of the row's
    score_diff since it's a two-team zero-sum differential)."""
    flurry = FLURRY_DISCOUNT if row["is_rebound"] else 1.0
    bucket = -row["score_diff"] if is_defending else row["score_diff"]
    mult_for, mult_against = score_factors.get(bucket, (1.0, 1.0))
    score_mult = mult_against if is_defending else mult_for
    return flurry * score_mult
