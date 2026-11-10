def mmss_to_sec(mmss: str) -> int:
    m, s = mmss.split(":")
    return int(m) * 60 + int(s)


def group_by_period(shift_rows) -> dict[int, list]:
    """shift_rows: list of (player_id, team_id, period, start_sec, end_sec).
    Splits once per game so per-event lookups only scan their own period's
    shifts instead of the whole game."""
    by_period: dict[int, list] = {}
    for row in shift_rows:
        by_period.setdefault(row[2], []).append(row)
    return by_period


def on_ice_at(period_shift_rows, time_sec: int) -> dict[int, set[int]]:
    """period_shift_rows: shifts already filtered to one period (see
    group_by_period). Returns {team_id: {player_id, ...}} on ice at time_sec.
    An EVENT at second t is attributed to the shift that was running during the
    second BEFORE it: start_sec < t <= end_sec (and start_sec == 0 counts at t == 0).
    This is not a convention choice, it is what the data says. The NHL ends the
    shift of everyone on the ice at the second a goal is scored, so for ~79% of
    goals the scorer's shift ends exactly at the goal time; the earlier [start, end)
    lookup excluded them (and the whole scoring and defending units) and credited the
    goal to nobody. Measured over every shot attempt, the scorer/shooter is found
    by this lookup in 99.96% of goals and ~99.98% of shots, against 21% of goals
    and 99.8% of shots for [start, end). At a line change one shift ends at t and
    the next starts at t; the half-open-on-the-left rule keeps them from both
    counting (an inclusive [start, end] check put 10-12 skaters on the ice).
    Use on_ice_during (not this) when sweeping time segments."""
    on_ice: dict[int, set[int]] = {}
    for player_id, team_id, _period, start_sec, end_sec in period_shift_rows:
        if (start_sec < time_sec or (time_sec == 0 and start_sec == 0)) and time_sec <= end_sec:
            on_ice.setdefault(team_id, set()).add(player_id)
    return on_ice


def on_ice_during(period_shift_rows, t1: int, t2: int) -> dict[int, set[int]]:
    """Returns {team_id: {player_id, ...}} on ice for the ENTIRE segment
    [t1, t2) — i.e. shifts that fully cover it, not just a single instant
    within it. Use this (not on_ice_at) when sweeping consecutive boundary
    segments, since a segment's active set must be checked for coverage of
    the whole segment, not sampled at its start point."""
    on_ice: dict[int, set[int]] = {}
    for player_id, team_id, _period, start_sec, end_sec in period_shift_rows:
        if start_sec <= t1 and end_sec >= t2:
            on_ice.setdefault(team_id, set()).add(player_id)
    return on_ice


def pairwise_shared_toi(shift_rows) -> dict[int, dict[int, int]]:
    """shift_rows: list of (player_id, team_id, period, start_sec, end_sec).
    Returns {player_id: {other_player_id: overlap_seconds}} for every pair of
    players who shared the ice at any point in the game, computed with one
    sweep per period instead of an O(players x shifts) scan per player."""
    shared: dict[int, dict[int, int]] = {}

    def add(a, b, secs):
        shared.setdefault(a, {})
        shared[a][b] = shared[a].get(b, 0) + secs

    for period, rows in group_by_period(shift_rows).items():
        boundaries = sorted({r[3] for r in rows} | {r[4] for r in rows})
        for t1, t2 in zip(boundaries, boundaries[1:]):
            duration = t2 - t1
            if duration <= 0:
                continue
            active = [r for r in rows if r[3] <= t1 and r[4] >= t2]
            for i in range(len(active)):
                pid_a, _team_a, _p, _s, _e = active[i]
                for j in range(i + 1, len(active)):
                    pid_b, _team_b, _p2, _s2, _e2 = active[j]
                    add(pid_a, pid_b, duration)
                    add(pid_b, pid_a, duration)

    return shared
