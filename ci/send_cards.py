"""Email each subscriber the cards for their teams' games as soon as those games' cards exist.

    python ci/send_cards.py                  # today's and yesterday's finished games (Eastern time)
    python ci/send_cards.py --check-only     # just report whether anything is waiting to be sent (writes pending=true|false to $GITHUB_OUTPUT)
    python ci/send_cards.py --dry-run        # build everything, send nothing (writes previews to email_preview/)

A game is ready once the site has its data (the update job processes a game about an hour after it ends and deploys the site). Each
run sends every subscriber ONE email with the cards for whatever is new and ready for their teams, and records who got which game
(POST /api/sent), so nobody gets a game twice and a run with nothing new sends nothing. It runs after every site update.

How: finished games come from the NHL scoreboard; the site says who is subscribed and what each was already sent (GET /api/subscribers);
whether a game is on the site is read from its data file; the cards are rendered in a headless browser from the live site (so the emailed
cards are exactly the cards on the page), uploaded to the public bucket, and emailed through Resend.

Needs (environment): SITE_URL, SEND_SECRET, RESEND_API_KEY, EMAIL_FROM, EMAIL_POSTAL, LIVE_URL (the public address of the live bucket),
R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_LIVE_BUCKET. Optional: MAX_EMAILS (default 90 a day, to stay under a free plan's cap).
"""
import argparse
import base64
import html
import json
import os
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

FINISHED = {"FINAL", "OFF", "OVER"}
WEB = "https://api-web.nhle.com/v1"
# the cards in an email, per game: the skater table once, then for each followed team its Game Score bars and its lines, pairs and goalies
CARD_TITLES = {"table": "Every skater", "bars": "Game Scores", "lines": "Lines, pairs & goalies"}


def recent_dates() -> list[str]:
    """Yesterday's and today's date in Eastern time: a late game that ended after midnight belongs to yesterday's hockey day."""
    now = datetime.now(ZoneInfo("America/New_York"))
    return [(now - timedelta(days=1)).strftime("%Y-%m-%d"), now.strftime("%Y-%m-%d")]


def finished_games(date: str) -> list[dict]:
    """[{id, date, away, home, away_score, home_score, tag}] for the regular-season and playoff games of that day that are over."""
    r = requests.get(f"{WEB}/score/{date}", timeout=30)
    r.raise_for_status()
    out = []
    for g in r.json().get("games", []):
        if g.get("gameState") not in FINISHED or g.get("gameType", 2) not in (2, 3):
            continue
        pt = (g.get("gameOutcome") or {}).get("lastPeriodType")
        start = g.get("startTimeUTC")
        out.append({"id": g["id"], "date": date, "start_ms": int(datetime.fromisoformat(start.replace("Z", "+00:00")).timestamp() * 1000) if start else 0,
                    "away": g["awayTeam"]["abbrev"], "home": g["homeTeam"]["abbrev"],
                    "away_score": g["awayTeam"].get("score", 0), "home_score": g["homeTeam"].get("score", 0),
                    "tag": "Final" + (f"/{pt}" if pt and pt != "REG" else "")})
    return out


def season_id(game_id: int) -> str:
    y = game_id // 1000000
    return f"{y}{y + 1}"


def on_site(site: str, game: dict, cache: dict) -> bool:
    """True when the site's data file for the game's home team has this game in it (that is, the update job has processed and deployed it)."""
    key = (season_id(game["id"]), game["home"])
    if key not in cache:
        try:
            r = requests.get(f"{site}/data/{key[0]}/games/{key[1]}.json", params={"t": int(datetime.now().timestamp())}, timeout=90)
            cache[key] = set(r.json().keys()) if r.status_code == 200 else set()
        except Exception as e:
            print(f"  couldn't read {key}: {e}", flush=True)
            cache[key] = set()
    return str(game["id"]) in cache[key]


def card_keys_for(sub_teams: set[str], game: dict) -> list[str]:
    """Card keys one subscriber gets for one game: the table, plus bars and lines for each team of the game they follow."""
    keys = ["table"]
    for side in ("away", "home"):
        if game[side] in sub_teams:
            keys += [f"bars-{side}", f"lines-{side}"]
    return keys


def card_object(date: str, game_id: int, key: str) -> str:
    return f"cards/{date}/{game_id}-{key}.png"


def build_email(sub: dict, games: list[dict], site: str, image_base: str, postal: str) -> dict:
    """The subject, HTML, text and headers of one subscriber's email. games: only the new games involving their teams, in order."""
    teams = set(sub["teams"])
    unsub = f"{site}/api/unsubscribe?h={sub['id']}&t={sub['ut']}"
    esc = html.escape
    followed = [t for t in sub["teams"] if any(t in (g["away"], g["home"]) for g in games)]
    scores = [f"{g['away']} {g['away_score']}, {g['home']} {g['home_score']}" for g in games]
    subject = scores[0] + (f" and {len(games) - 1} more" if len(games) > 1 else "") + ": your Shift Score cards"
    blocks, text = [], ["Your Shift Score cards", ""]
    for g in games:
        page = f"{site}/#game/{g['id']}/{g['home']}"
        nice = datetime.strptime(g["date"], "%Y-%m-%d").strftime("%A, %B %-d")
        head = f"{g['away']} {g['away_score']}, {g['home']} {g['home_score']} ({g['tag']})"
        text += [f"{head} - {nice}", page]
        imgs = []
        for key in card_keys_for(teams, g):
            kind = key.split("-")[0]
            who = f" ({g[key.split('-')[1]]})" if "-" in key else ""
            url = f"{image_base}/{card_object(g['date'], g['id'], key)}"
            text.append(f"  {CARD_TITLES[kind]}{who}: {url}")
            imgs.append(f'<p style="margin:14px 0 4px;font:600 13px Helvetica,Arial,sans-serif;color:#5b7083;text-transform:uppercase;letter-spacing:1px">{esc(CARD_TITLES[kind])}{esc(who)}</p>'
                        f'<a href="{page}"><img src="{url}" alt="{esc(CARD_TITLES[kind])} card for {esc(head)}" width="600" style="width:100%;max-width:600px;height:auto;border-radius:10px;display:block"></a>')
        text.append("")
        blocks.append(f'<h2 style="font:700 22px Helvetica,Arial,sans-serif;margin:28px 0 0;color:#0b1c2c"><a href="{page}" style="color:#0b1c2c;text-decoration:none">{esc(head)}</a></h2>'
                      f'<p style="margin:2px 0 0;color:#5b7083;font-size:14px">{esc(nice)}</p>' + "".join(imgs))
    footer_text = ["", f"You get this because you subscribed to cards for {', '.join(followed)} at {site}.", f"Unsubscribe: {unsub}"] + ([postal] if postal else [])
    body = (f'<div style="max-width:620px;margin:0 auto;padding:20px 12px;font-family:Helvetica,Arial,sans-serif;color:#0b1c2c">'
            f'<h1 style="font:800 26px Helvetica,Arial,sans-serif;margin:0 0 4px;color:#0b1c2c">Shift Score</h1>'
            f'<p style="margin:0;color:#5b7083;font-size:16px">{"New cards" if len(games) > 1 else "Your cards"} for {esc(", ".join(followed))}</p>{"".join(blocks)}'
            f'<hr style="border:none;border-top:1px solid #d9e1e4;margin:32px 0 14px">'
            f'<p style="font-size:12px;line-height:1.6;color:#667">You get this because you subscribed to cards for {esc(", ".join(followed))}. '
            f'<a href="{unsub}" style="color:#667">Unsubscribe</a> &middot; <a href="{site}" style="color:#667">Change teams</a>{"<br>" + esc(postal) if postal else ""}</p></div>')
    return {"subject": subject, "html": body, "text": "\n".join(text + footer_text),
            "headers": {"List-Unsubscribe": f"<{unsub}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}}


def render_cards(site: str, wanted: list[tuple[int, str, str]]) -> dict[tuple[int, str], bytes | None]:
    """Render cards in a headless browser from the live site. wanted: [(game_id, home_abbrev, card_key)]. None when one could not be made."""
    from playwright.sync_api import sync_playwright
    out = {}
    js = """async ([season, home, gid, key]) => {
      const logos = await GameView.cardLogos();
      const shard = await fetchGameShard(season, home);
      const g = shard[String(gid)];
      if (!g) return null;
      return await GameView.cardPngDataUrl(g, key, logos);
    }"""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1200, "height": 900})
        page.goto(f"{site}/?cards={int(datetime.now().timestamp())}", wait_until="load", timeout=120000)
        page.wait_for_function("typeof GameView !== 'undefined' && typeof fetchGameShard === 'function'", timeout=60000)
        for gid, home, key in wanted:
            try:
                url = page.evaluate(js, [season_id(gid), home, gid, key])
            except Exception as e:
                print(f"  render failed {gid} {key}: {e}", flush=True)
                url = None
            out[(gid, key)] = base64.b64decode(url.split(",", 1)[1]) if url else None
        browser.close()
    return out


def write_output(name: str, value: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a") as f:
            f.write(f"{name}={value}\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-render", action="store_true", help="dry run without a browser: placeholder image links")
    ap.add_argument("--check-only", action="store_true", help="only say whether anything is waiting to be sent")
    args = ap.parse_args()
    env = os.environ
    site = env["SITE_URL"].rstrip("/")
    # LIVE_URL is the address of the live-scores folder (.../live); the card images sit at the bucket root, next to it
    image_base = env.get("LIVE_URL", "").rstrip("/")
    if image_base.endswith("/live"):
        image_base = image_base[: -len("/live")]
    postal = env.get("EMAIL_POSTAL", "")

    games = [g for d in recent_dates() for g in finished_games(d)]
    print(f"{len(games)} finished games in the last two days", flush=True)
    if not games:
        write_output("pending", "false")
        return
    sec = {"authorization": f"Bearer {env['SEND_SECRET']}"}
    r = requests.get(f"{site}/api/subscribers", params={"games": ",".join(str(g["id"]) for g in games)}, headers=sec, timeout=60)
    r.raise_for_status()
    body = r.json()
    subs, sent_today = body["subscribers"], body.get("sent_today", 0)
    print(f"{len(subs)} subscribers; {sent_today} emails sent today", flush=True)

    cache: dict = {}
    # per subscriber: the games of theirs that are on the site and that they have not been sent yet
    plan = []
    for s in subs:
        # only games that finished after they confirmed (a game lasts about 3 hours, so one that started up to 3 hours before counts), never a backlog
        since = s.get("since", 0) - 3 * 3600 * 1000
        mine = [g for g in games if (g["away"] in s["teams"] or g["home"] in s["teams"]) and str(g["id"]) not in s["sent"] and g["start_ms"] >= since]
        mine = [g for g in mine if on_site(site, g, cache)]
        if mine:
            plan.append((s, sorted(mine, key=lambda g: (g["date"], g["id"]))))
    print(f"{len(plan)} subscribers have new cards waiting", flush=True)
    write_output("pending", "true" if plan else "false")
    if args.check_only or not plan:
        return

    wanted = sorted({(g["id"], g["home"], k) for s, mine in plan for g in mine for k in card_keys_for(set(s["teams"]), g)})
    print(f"{len(wanted)} cards to make", flush=True)
    s3 = None
    if not args.dry_run:
        import boto3
        s3 = boto3.client("s3", endpoint_url=env["R2_ENDPOINT"], aws_access_key_id=env["R2_ACCESS_KEY_ID"],
                          aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"], region_name="auto")
    png = {(gid, k): b"" for gid, _, k in wanted} if args.no_render else render_cards(site, wanted)
    failed = sorted({gid for (gid, _), data in png.items() if data is None})
    if failed:
        print(f"couldn't make every card for games {failed}; those wait for the next run", flush=True)

    outdir = os.path.join(ROOT, "email_preview")
    if args.dry_run:
        os.makedirs(outdir, exist_ok=True)
    dates = {g["id"]: g["date"] for _, mine in plan for g in mine}
    for (gid, key), data in png.items():
        if not data:
            continue
        if args.dry_run:
            with open(os.path.join(outdir, f"{gid}-{key}.png"), "wb") as f:
                f.write(data)
        else:
            s3.put_object(Bucket=env["R2_LIVE_BUCKET"], Key=card_object(dates[gid], gid, key), Body=data, ContentType="image/png", CacheControl="public, max-age=31536000")
    if not args.dry_run:
        print(f"uploaded {sum(1 for d in png.values() if d)} cards", flush=True)

    room = max(0, int(env.get("MAX_EMAILS", "90")) - sent_today)
    outgoing, over = [], 0                                          # (subscriber, [games included], message)
    for s, mine in plan:
        ok_games = [g for g in mine if g["id"] not in failed]
        if not ok_games:
            continue
        if len(outgoing) >= room:
            over += 1
            continue
        mail = build_email(s, ok_games, site, image_base or "https://example.invalid", postal)
        if args.dry_run:
            with open(os.path.join(outdir, f"email-{s['id'][:8]}.html"), "w") as f:
                f.write(mail["html"])
            print(f"  [dry run] would send to {s['email']}: {mail['subject']}", flush=True)
            continue
        outgoing.append((s, ok_games, {"from": env["EMAIL_FROM"], "to": [s["email"]], **{k: mail[k] for k in ("subject", "html", "text", "headers")}}))
    sent = 0
    if not args.dry_run:
        for i in range(0, len(outgoing), 50):
            chunk = outgoing[i:i + 50]
            resp = requests.post("https://api.resend.com/emails/batch", headers={"authorization": f"Bearer {env['RESEND_API_KEY']}", "content-type": "application/json"},
                                 data=json.dumps([m for _, _, m in chunk]), timeout=120)
            if resp.status_code != 200:
                print(f"  batch failed ({resp.status_code}): {resp.text[:300]}", flush=True)
                continue
            marks: dict[str, list[str]] = {}
            for s, gs, _ in chunk:
                for g in gs:
                    marks.setdefault(str(g["id"]), []).append(s["id"])
            requests.post(f"{site}/api/sent", headers=sec, json={"games": marks, "emails": len(chunk)}, timeout=60).raise_for_status()
            sent += len(chunk)
            print(f"  sent {len(chunk)} emails", flush=True)
    print(f"done: sent {sent}, over today's cap {over}", flush=True)


if __name__ == "__main__":
    main()
