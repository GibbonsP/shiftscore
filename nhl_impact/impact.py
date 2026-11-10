from . import strength
from .shifts import pairwise_shared_toi

# Competition credit and teammate adjustment (values in private/formulas.json). The credit for the quality of the opposition was measured with a
# within-player regression, so tougher opponents really do depress a game and deserve credit. Teammate quality is shown as context but not
# subtracted (doing so made season averages less repeatable). See the private INTERNAL_FORMULAS.md.
from .formulas import FORMULAS

QOC_WEIGHT = FORMULAS["qoc_weight"]
QOT_WEIGHT = FORMULAS["qot_weight"]

# POSITION AVERAGE: defensemen produce less of what Game Score counts, so a cross-position ranking buried them. Adjusted Game Score subtracts the
# average raw score for the player's position (forward or defenseman; values in private/formulas.json), so 0 means an average forward's or
# defenseman's game and a ranking compares each player with his own kind. Re-measure after any change to the weights.
POSITION_BASELINE = dict(FORMULAS["position_baseline"])


def position_group(position: str | None) -> str:
    return "D" if position == "D" else "F"


def split_teammates_opponents(
    overlap: dict[int, int], player_team: dict[int, int], team_id: int
) -> tuple[dict, dict]:
    """Splits one player's {other_player_id: overlap_seconds} row (from
    pairwise_shared_toi) into teammate vs. opponent overlap."""
    teammate_sec, opponent_sec = {}, {}
    for other_pid, secs in overlap.items():
        if player_team.get(other_pid) == team_id:
            teammate_sec[other_pid] = secs
        else:
            opponent_sec[other_pid] = secs
    return teammate_sec, opponent_sec


def weighted_avg_rating(overlap_sec: dict, ratings: dict[int, float]) -> float | None:
    total = sum(overlap_sec.values())
    if total == 0:
        return None
    return sum(ratings[pid] * sec for pid, sec in overlap_sec.items()) / total


def compute_game_impacts(conn, game_id: int) -> None:
    row = conn.execute("SELECT game_date FROM games WHERE game_id = ?", (game_id,)).fetchone()
    if row is None:
        return  # game failed to ingest — nothing to compute
    game_date = row[0]
    if conn.execute("SELECT 1 FROM shifts WHERE game_id = ? LIMIT 1", (game_id,)).fetchone() is None:
        # no shift data published for this game: no on-ice context, no impact
        conn.execute("DELETE FROM player_game_impact WHERE game_id = ?", (game_id,))
        conn.commit()
        return
    league_avg = strength.league_avg_rating(conn, game_date)
    pos_avg = strength.league_avg_rating_by_position(conn, game_date)

    # goalies are excluded throughout: the skater-weighted Game Score doesn't
    # apply to them, and — more importantly — a goalie is on the ice for
    # nearly the whole game, so leaving them in would quietly dominate every
    # teammate's QoT and every opponent's QoC with a rating that isn't
    # measuring the same thing as a skater's
    player_rows = conn.execute(
        """SELECT pgs.player_id, pgs.team_id, COALESCE(pgs.raw_game_score, 0)
           FROM player_game_stats pgs JOIN players p ON p.player_id = pgs.player_id
           WHERE pgs.game_id = ? AND p.position != 'G'""",
        (game_id,),
    ).fetchall()

    shift_rows = conn.execute(
        """SELECT s.player_id, s.team_id, s.period, s.start_sec, s.end_sec
           FROM shifts s JOIN players p ON p.player_id = s.player_id
           WHERE s.game_id = ? AND p.position != 'G'""",
        (game_id,),
    ).fetchall()
    player_team = {r[0]: r[1] for r in shift_rows}
    # 'D' or 'F' per player — this is what lets QoC/QoT compare each
    # opponent/teammate against the league average for THEIR OWN position
    # instead of one blended average (see strength.league_avg_rating_by_position)
    positions = dict(
        conn.execute(
            "SELECT player_id, CASE WHEN position = 'D' THEN 'D' ELSE 'F' END FROM players "
            "WHERE player_id IN (" + ",".join("?" * len(player_team)) + ")",
            list(player_team),
        ).fetchall()
    ) if player_team else {}

    pairwise = pairwise_shared_toi(shift_rows)
    # one rating lookup per player in the game instead of one per teammate/
    # opponent reference (the same handful of players recur across many rows)
    ratings = {pid: strength.rating_as_of(conn, pid, game_date, positions.get(pid, "F"), pos_avg) for pid in player_team}
    position_baseline_ratings = {pid: pos_avg[positions.get(pid, "F")] for pid in player_team}

    for player_id, team_id, raw_score in player_rows:
        teammate_sec, opponent_sec = split_teammates_opponents(
            pairwise.get(player_id, {}), player_team, team_id
        )
        qot = weighted_avg_rating(teammate_sec, ratings)
        qoc = weighted_avg_rating(opponent_sec, ratings)
        qot_baseline = weighted_avg_rating(teammate_sec, position_baseline_ratings)
        qoc_baseline = weighted_avg_rating(opponent_sec, position_baseline_ratings)

        qot = qot if qot is not None else league_avg
        qoc = qoc if qoc is not None else league_avg
        qot_baseline = qot_baseline if qot_baseline is not None else league_avg
        qoc_baseline = qoc_baseline if qoc_baseline is not None else league_avg

        adjusted = (raw_score + QOC_WEIGHT * (qoc - qoc_baseline) - QOT_WEIGHT * (qot - qot_baseline)
                    - POSITION_BASELINE[position_group(positions.get(player_id))])

        conn.execute(
            """INSERT OR REPLACE INTO player_game_impact
               (game_id, player_id, game_date, raw_game_score, qoc, qot, qoc_baseline, qot_baseline, adjusted_impact)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (game_id, player_id, game_date, raw_score, qoc, qot, qoc_baseline, qot_baseline, adjusted),
        )

    conn.commit()
