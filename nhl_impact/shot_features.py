import json
import math

from .units import team_states

# xG applies to Fenwick (unblocked) attempts only — a blocked shot never
# reached the goalie, so "would it have been a goal" is undefined for it and
# it can never be labeled a goal. Including blocked shots as shot_type
# "unknown" (they carry no shotType field) let a model trivially learn
# "unknown shot_type -> never a goal", inflating test AUC to ~0.96 on a
# feature that isn't really predictive of anything.
FENWICK_TYPES = {"goal", "shot-on-goal", "missed-shot"}

REBOUND_WINDOW_SEC = 3
RUSH_WINDOW_SEC = 5
RUSH_ZONES = {"N", "D"}


def attacking_net_x(home_defending_side: str | None, is_home: bool) -> float:
    """Empirically verified against 20 real goals across multiple games and
    periods: when a team's defending side is 'right' they attack negative x;
    when 'left' they attack positive x. Defaults to the more common 'right'
    convention if the field is missing (pre-fix ingested data)."""
    home_net_x = -89.0 if home_defending_side != "left" else 89.0
    return home_net_x if is_home else -home_net_x


def distance_and_angle(x: float, y: float, home_defending_side: str | None, is_home: bool) -> tuple[float, float]:
    net_x = attacking_net_x(home_defending_side, is_home)
    dx = net_x - x
    dy = -y
    distance = math.hypot(dx, dy)
    angle = math.degrees(math.atan2(abs(dy), abs(dx))) if distance > 0 else 0.0
    return distance, angle


def extract_game_shot_rows(conn, game_id: int) -> list[dict]:
    """Walks one game's events in order and returns one feature row per
    shot-attempt event (goal / shot-on-goal / missed-shot / blocked-shot)."""
    game = conn.execute(
        "SELECT home_team_id, away_team_id FROM games WHERE game_id = ?", (game_id,)
    ).fetchone()
    if game is None:
        return []
    home_team_id, away_team_id = game

    events = conn.execute(
        """SELECT event_id, period, time_sec, type, situation_code, home_defending_side, details_json
           FROM events WHERE game_id = ? ORDER BY period, time_sec, event_id""",
        (game_id,),
    ).fetchall()

    rows = []
    last_shot: dict[tuple[int, int], tuple[int, int]] = {}  # (period, team_id) -> (time_sec, row_index)
    last_faceoff: tuple[int, int, str] | None = None  # (period, time_sec, winning_team_zone)
    last_faceoff_team: int | None = None
    # the most recent event that has coordinates (any type): where the puck was
    # and what happened just before a shot — a cross-slot pass, a takeaway, a
    # faceoff win. (period, time_sec, type, team_id, x, y)
    prev_ev: tuple | None = None
    # events in the shot's own second are held back in `pending_ev` until the clock moves on:
    # NHL event ids aren't chronological within a second (the faceoff that restarts play after
    # a goal can sort BEFORE the goal), so using a same-second event as "what happened before
    # the shot" leaks the label — "a faceoff just happened" == "this shot was a goal". Found
    # when a random train/test split scored AUC 0.89 while train-2024/test-2025 collapsed.
    pending_key: tuple | None = None
    pending_ev: tuple | None = None
    away_score, home_score = 0, 0  # score BEFORE the current event — updated after use, so the
    # goal that ties/takes the lead is itself evaluated at the pre-goal score state

    for event_id, period, time_sec, etype, situation_code, home_defending_side, details_json in events:
        details = json.loads(details_json) if details_json else {}

        if period >= 5:  # shootout — not real shots/goals (see ingest.py)
            continue

        if (period, time_sec) != pending_key:
            if pending_ev is not None:
                prev_ev = pending_ev
            pending_key, pending_ev = (period, time_sec), None

        if etype in FENWICK_TYPES:
            shooter_id = details.get("scoringPlayerId") or details.get("shootingPlayerId")
            team_id = details.get("eventOwnerTeamId")
            is_home = team_id == home_team_id
            x, y = details.get("xCoord"), details.get("yCoord")

            if x is not None and y is not None and shooter_id is not None:
                distance, angle = distance_and_angle(x, y, home_defending_side, is_home)

                is_rebound = False
                rebound_dy = rebound_angle_change = None
                key = (period, team_id)
                prev = last_shot.get(key)
                if prev is not None and time_sec - prev[0] <= REBOUND_WINDOW_SEC:
                    is_rebound = True
                    rows[prev[1]]["created_rebound"] = True
                    # how far the second shot is from the first: a rebound that moves the
                    # goalie across the crease is much more dangerous than one straight back
                    rebound_dy = abs(y - rows[prev[1]]["y"])
                    rebound_angle_change = abs(angle - rows[prev[1]]["angle"])

                # Rush = shooter's team won a defensive/neutral-zone faceoff
                # shortly before shooting. Originally this looked at ANY prior
                # event's zoneCode, but that's ambiguous (zoneCode is relative
                # to whichever team owns that event, not the shooter) and it
                # actively inverted the signal in testing — blocked shots,
                # hits, and penalties near the shooter's own offensive zone
                # got misread as transition play. Narrowing to faceoffs only
                # removes the ambiguity: a faceoff's owning team is the team
                # that won it, so "shooter's team won it, in their own zone"
                # is unambiguous. Also requires a strictly positive time gap:
                # NHL event IDs aren't reliably chronological at same-second
                # ties (verified on real data — the faceoff that RESTARTS
                # play after a goal often has a lower event_id than the goal
                # itself despite coming after it).
                is_rush = False
                if (
                    last_faceoff is not None
                    and last_faceoff[0] == period
                    and last_faceoff_team == team_id
                    and last_faceoff[2] in RUSH_ZONES
                ):
                    gap = time_sec - last_faceoff[1]
                    if 0 < gap <= RUSH_WINDOW_SEC:
                        is_rush = True

                away_state, home_state = team_states(situation_code)
                strength_state = home_state if is_home else away_state

                # skater counts and whether either goalie is in net, from the situation code
                # [awayGoalie][awaySkaters][homeSkaters][homeGoalie]
                own_skaters = opp_skaters = None
                own_goalie = opp_goalie = 1
                if situation_code and len(situation_code) == 4 and situation_code.isdigit():
                    ag, a_sk, h_sk, hg = (int(c) for c in situation_code)
                    own_skaters, opp_skaters = (h_sk, a_sk) if is_home else (a_sk, h_sk)
                    own_goalie, opp_goalie = (hg, ag) if is_home else (ag, hg)

                # what happened immediately before this shot
                prev_type, prev_same_team, prev_gap, prev_dist, prev_dy = "none", None, None, None, None
                prev_net_dist = prev_net_angle = None
                if prev_ev is not None and prev_ev[0] == period:
                    prev_type = prev_ev[2]
                    prev_same_team = int(prev_ev[3] == team_id)
                    prev_gap = min(time_sec - prev_ev[1], 30)
                    prev_dist = math.hypot(x - prev_ev[4], y - prev_ev[5])
                    prev_dy = abs(y - prev_ev[5])
                    # where the puck was, relative to the net being attacked (a pass from behind
                    # the net or from the far side is a different shot than one off a point shot)
                    prev_net_dist, prev_net_angle = distance_and_angle(prev_ev[4], prev_ev[5], home_defending_side, is_home)

                team_score = away_score if not is_home else home_score
                opp_score = home_score if not is_home else away_score
                score_diff = max(-3, min(3, team_score - opp_score))

                rows.append(
                    {
                        "game_id": game_id,
                        "event_id": event_id,
                        "shooter_id": shooter_id,
                        "team_id": team_id,
                        "distance": distance,
                        "angle": angle,
                        "shot_type": details.get("shotType", "unknown"),
                        "period": period,
                        "time_sec": time_sec,
                        "goalie_id": details.get("goalieInNetId"),
                        "is_rebound": int(is_rebound),
                        "is_rush": int(is_rush),
                        "strength_state": strength_state,
                        "score_diff": score_diff,
                        "is_goal": int(etype == "goal"),
                        "on_goal": int(etype in ("goal", "shot-on-goal")),  # a shot on goal (saved or scored), as opposed to a miss
                        "created_rebound": False,
                        "x": x, "y": y,
                        "own_skaters": own_skaters, "opp_skaters": opp_skaters,
                        "own_goalie": own_goalie, "opp_goalie": opp_goalie,
                        "prev_type": prev_type, "prev_same_team": prev_same_team,
                        "prev_gap": prev_gap, "prev_dist": prev_dist, "prev_dy": prev_dy,
                        "prev_net_dist": prev_net_dist, "prev_net_angle": prev_net_angle,
                        "rebound_dy": rebound_dy, "rebound_angle_change": rebound_angle_change,
                    }
                )
                last_shot[key] = (time_sec, len(rows) - 1)

        ex, ey = details.get("xCoord"), details.get("yCoord")
        if ex is not None and ey is not None:
            pending_ev = (period, time_sec, etype, details.get("eventOwnerTeamId"), ex, ey)

        if etype == "faceoff" and details.get("zoneCode") is not None:
            last_faceoff = (period, time_sec, details["zoneCode"])
            last_faceoff_team = details.get("eventOwnerTeamId")

        if etype == "goal":
            away_score = details.get("awayScore", away_score)
            home_score = details.get("homeScore", home_score)

    return rows
