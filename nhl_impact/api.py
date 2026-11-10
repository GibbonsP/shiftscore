import time

import requests

WEB_BASE = "https://api-web.nhle.com/v1"
STATS_BASE = "https://api.nhle.com/stats/rest/en"

_session = requests.Session()
_session.headers.update({"User-Agent": "nhl-impact-research/0.1"})


def _get(url, params=None, retries=3):
    for attempt in range(retries):
        resp = _session.get(url, params=params, timeout=15)
        if resp.status_code == 200:
            return resp.json()
        if resp.status_code >= 500 and attempt < retries - 1:
            time.sleep(1.5 * (attempt + 1))
            continue
        resp.raise_for_status()
    raise RuntimeError(f"failed to fetch {url}")


def get_team_schedule(team_abbrev: str, season: str) -> list[dict]:
    """season like '20242025'. Returns regular-season games only."""
    data = _get(f"{WEB_BASE}/club-schedule-season/{team_abbrev}/{season}")
    return [g for g in data["games"] if g["gameType"] == 2]


def get_scoreboard(date: str | None = None) -> dict:
    """Games for a date ('YYYY-MM-DD'), or for the NHL's current hockey day when omitted
    ('score/now' redirects to it). Live games carry period, clock and running scores."""
    return _get(f"{WEB_BASE}/score/{date or 'now'}")


def get_player_landing(player_id: int) -> dict:
    """A player's own record (shooting hand, headshot, bio)."""
    return _get(f"{WEB_BASE}/player/{player_id}/landing")


def get_special_teams(season: str) -> dict[int, dict]:
    """The NHL's official regular-season power-play and penalty-kill numbers, {team_id: {...}}."""
    out: dict[int, dict] = {}
    for report in ("powerplay", "penaltykill"):
        data = _get(f"{STATS_BASE}/team/{report}", params={"cayenneExp": f"seasonId={season} and gameTypeId=2", "limit": -1})
        for row in data["data"]:
            out.setdefault(row["teamId"], {}).update(row)
    return out


def get_goalie_summary(season: str) -> dict[int, dict]:
    """The NHL's official regular-season goalie stats (shots against, goals against, save %), {player_id: row}."""
    data = _get(f"{STATS_BASE}/goalie/summary", params={"cayenneExp": f"seasonId={season} and gameTypeId=2", "limit": -1})
    return {row["playerId"]: row for row in data["data"]}


def get_play_by_play(game_id: int) -> dict:
    return _get(f"{WEB_BASE}/gamecenter/{game_id}/play-by-play")


def get_shifts(game_id: int) -> list[dict]:
    """Returns only real on-ice shifts (typeCode 517) — the feed also embeds
    zero-length goal markers (typeCode matching the goal event's typeCode) that
    aren't shifts and must be filtered out."""
    data = _get(f"{STATS_BASE}/shiftcharts", params={"cayenneExp": f"gameId={game_id}"})
    return [s for s in data["data"] if s["typeCode"] == 517]


def get_current_teams() -> list[str]:
    data = _get(f"{WEB_BASE}/standings/now")
    return sorted(t["teamAbbrev"]["default"] for t in data["standings"])


def get_roster(team_abbrev: str, season: str) -> list[dict]:
    data = _get(f"{WEB_BASE}/roster/{team_abbrev}/{season}")
    players = []
    for group in ("forwards", "defensemen", "goalies"):
        players.extend(data.get(group, []))
    return players


def get_schedule_window(start: str, end: str) -> list[list]:
    """League schedule from `start` to `end` ('YYYY-MM-DD', inclusive), one row per game:
    [game_id, date, away, home, startTimeUTC, gameState, awayScore, homeScore, lastPeriodType].
    The date is the NHL's own hockey day (Eastern). Regular season and preseason games; the site shows these
    on its Home page for any date, including the days ahead."""
    rows, seen, cursor, hops = [], set(), start, 0
    while cursor and cursor <= end and hops < 12:
        data = _get(f"{WEB_BASE}/schedule/{cursor}")
        for day in data.get("gameWeek", []):
            if not (start <= day["date"] <= end):
                continue
            for g in day["games"]:
                if g["id"] in seen or g.get("gameType") not in (1, 2):
                    continue
                seen.add(g["id"])
                rows.append([g["id"], day["date"], g["awayTeam"]["abbrev"], g["homeTeam"]["abbrev"], g.get("startTimeUTC", ""),
                             g.get("gameState", ""), g["awayTeam"].get("score"), g["homeTeam"].get("score"),
                             (g.get("gameOutcome") or {}).get("lastPeriodType", "REG")])
        nxt = data.get("nextStartDate")
        cursor = nxt if nxt and nxt > cursor else None
        hops += 1
    return rows

