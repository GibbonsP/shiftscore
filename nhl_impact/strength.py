def prior_rating(conn, player_id: int, before_date: str) -> float | None:
    """Average raw_game_score over that player's games strictly before
    before_date. None if the player has no games yet this season."""
    row = conn.execute(
        """SELECT AVG(pgs.raw_game_score)
           FROM player_game_stats pgs JOIN games g ON g.game_id = pgs.game_id
           WHERE pgs.player_id = ? AND g.game_date < ?""",
        (player_id, before_date),
    ).fetchone()
    return row[0]


def league_avg_rating(conn, before_date: str) -> float:
    """League-wide average raw_game_score over all games strictly before
    before_date, used as the fallback rating for players with no history yet
    and as the baseline QoC/QoT are compared against."""
    row = conn.execute(
        """SELECT AVG(pgs.raw_game_score)
           FROM player_game_stats pgs JOIN games g ON g.game_id = pgs.game_id
           WHERE g.game_date < ?""",
        (before_date,),
    ).fetchone()
    return row[0] if row[0] is not None else 0.0


# Empirical-Bayes shrinkage strength, in games, per position group (values in private/formulas.json). The rating is
# (sum of prior game scores + k * position mean) / (games + k): a player with few games is pulled toward the average for his position, a
# veteran barely moves. k is the ratio of within-player game-to-game variance to between-player talent variance, measured on this data and
# confirmed by a sweep on held-out predictions; recency-windowed variants did no better, so ratings use all prior games.
from .formulas import FORMULAS

SHRINKAGE_K = dict(FORMULAS["shrinkage_k"])


def prior_sum_and_games(conn, player_id: int, before_date: str) -> tuple[float, int]:
    """(sum of raw_game_score, number of games) over the player's games strictly
    before before_date. Games without a Game Score (no shift data) don't count."""
    row = conn.execute(
        """SELECT COALESCE(SUM(pgs.raw_game_score), 0), COUNT(pgs.raw_game_score)
           FROM player_game_stats pgs JOIN games g ON g.game_id = pgs.game_id
           WHERE pgs.player_id = ? AND g.game_date < ?""",
        (player_id, before_date),
    ).fetchone()
    return row[0], row[1]


def rating_as_of(conn, player_id: int, before_date: str, group: str, position_means: dict) -> float:
    """Shrunk strength rating for a player ('F' or 'D' group) as of a date.
    position_means = league_avg_rating_by_position(conn, before_date), passed in
    so a whole game's players share one lookup."""
    total, games = prior_sum_and_games(conn, player_id, before_date)
    k = SHRINKAGE_K.get(group, SHRINKAGE_K["F"])
    return (total + k * position_means[group]) / (games + k)


def league_avg_rating_by_position(conn, before_date: str) -> dict:
    """Separate league-wide average raw_game_score for forwards ('F') and
    defensemen ('D'), strictly before before_date. Needed because defensemen
    score less than forwards on average (fewer points), so comparing every
    opponent/teammate against one blended league_avg systematically made
    every defenseman look like below-average competition/teammates, not
    because they actually were, but because the single baseline was pulled
    up by forwards."""
    rows = conn.execute(
        """SELECT CASE WHEN p.position = 'D' THEN 'D' ELSE 'F' END AS grp,
                  AVG(pgs.raw_game_score)
           FROM player_game_stats pgs
           JOIN games g ON g.game_id = pgs.game_id
           JOIN players p ON p.player_id = pgs.player_id
           WHERE g.game_date < ? AND p.position != 'G'
           GROUP BY grp""",
        (before_date,),
    ).fetchall()
    overall = league_avg_rating(conn, before_date)
    result = {"F": overall, "D": overall}
    for grp, avg in rows:
        if avg is not None:
            result[grp] = avg
    return result
