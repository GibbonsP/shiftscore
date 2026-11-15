"""Email each subscriber last night's cards for the teams they follow (one digest per subscriber per day).

    python ci/send_cards.py                      # yesterday (Eastern time)
    python ci/send_cards.py --date 2026-11-14    # a specific hockey day
    python ci/send_cards.py --dry-run            # build everything, send nothing (writes previews to email_preview/)

What it does: reads the day's finished games from the NHL scoreboard, asks the site for the subscribers who have not been sent that day
(GET /api/subscribers), renders the cards each of them needs in a headless browser straight from the live site (so the emailed cards are
exactly the cards on the page), uploads the PNGs to the public bucket, sends one email per subscriber through Resend and records who was
sent (POST /api/sent). A subscriber is held back, not skipped, when one of their teams' games is not on the site yet; the next run sends it.

Needs (environment): SITE_URL, SEND_SECRET, RESEND_API_KEY, EMAIL_FROM, EMAIL_POSTAL, LIVE_URL (the public address of the live bucket),
R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_LIVE_BUCKET. Optional: MAX_EMAILS (default 90, to stay under a free plan's daily cap).
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


def yesterday_et() -> str:
    return (datetime.now(ZoneInfo("America/New_York")) - timedelta(days=1)).strftime("%Y-%m-%d")


def finished_games(date: str) -> list[dict]:
    """[{id, away, home, away_score, home_score, tag}] for the games of that day that are over."""
    r = requests.get(f"{WEB}/score/{date}", timeout=30)
    r.raise_for_status()
    out = []
    for g in r.json().get("games", []):
        if g.get("gameState") not in FINISHED:
            continue
        pt = (g.get("gameOutcome") or {}).get("lastPeriodType")
        out.append({"id": g["id"], "away": g["awayTeam"]["abbrev"], "home": g["homeTeam"]["abbrev"],
                    "away_score": g["awayTeam"].get("score", 0), "home_score": g["homeTeam"].get("score", 0),
                    "tag": "Final" + (f"/{pt}" if pt and pt != "REG" else "")})
    return out


def season_id(game_id: int) -> str:
    y = game_id // 1000000
    return f"{y}{y + 1}"


def card_keys_for(sub_teams: set[str], game: dict) -> list[str]:
    """Card keys one subscriber gets for one game: the table, plus bars and lines for each team of the game they follow."""
    keys = ["table"]
    for side in ("away", "home"):
        if game[side] in sub_teams:
            keys += [f"bars-{side}", f"lines-{side}"]
    return keys


def card_object(date: str, game_id: int, key: str) -> str:
    return f"cards/{date}/{game_id}-{key}.png"


def build_email(sub: dict, games: list[dict], date: str, site: str, image_base: str, postal: str) -> dict:
    """The subject, HTML, text and headers of one subscriber's digest. games: only the games involving their teams, in order."""
    teams = set(sub["teams"])
    unsub = f"{site}/api/unsubscribe?h={sub['id']}&t={sub['ut']}"
    esc = html.escape
    nice_date = datetime.strptime(date, "%Y-%m-%d").strftime("%A, %B %-d")
    followed = [t for t in sub["teams"] if any(t in (g["away"], g["home"]) for g in games)]
    subject = ("; ".join(f"{g['away']} {g['away_score']}, {g['home']} {g['home_score']}" for g in games[:2]) + (f" and {len(games) - 2} more" if len(games) > 2 else "")
               + f": your cards from {nice_date}")
    blocks, text = [], [f"Your Shift Score cards from {nice_date}", ""]
    for g in games:
        page = f"{site}/#game/{g['id']}/{g['home']}"
        head = f"{g['away']} {g['away_score']}, {g['home']} {g['home_score']} ({g['tag']})"
        text += [head, page]
        imgs = []
        for key in card_keys_for(teams, g):
            kind = key.split("-")[0]
            who = f" ({g[key.split('-')[1]]})" if "-" in key else ""
            url = f"{image_base}/{card_object(date, g['id'], key)}"
            text.append(f"  {CARD_TITLES[kind]}{who}: {url}")
            imgs.append(f'<p style="margin:14px 0 4px;font:600 13px Helvetica,Arial,sans-serif;color:#5b7083;text-transform:uppercase;letter-spacing:1px">{esc(CARD_TITLES[kind])}{esc(who)}</p>'
                        f'<a href="{page}"><img src="{url}" alt="{esc(CARD_TITLES[kind])} card for {esc(head)}" width="600" style="width:100%;max-width:600px;height:auto;border-radius:10px;display:block"></a>')
        text.append("")
        blocks.append(f'<h2 style="font:700 22px Helvetica,Arial,sans-serif;margin:28px 0 0;color:#0b1c2c"><a href="{page}" style="color:#0b1c2c;text-decoration:none">{esc(head)}</a></h2>' + "".join(imgs))
    footer_text = ["", f"You get this because you subscribed to cards for {', '.join(followed)} at {site}.", f"Unsubscribe: {unsub}", postal]
    body = (f'<div style="max-width:620px;margin:0 auto;padding:20px 12px;font-family:Helvetica,Arial,sans-serif;color:#0b1c2c">'
            f'<h1 style="font:800 26px Helvetica,Arial,sans-serif;margin:0 0 4px">Shift Score</h1>'
            f'<p style="margin:0;color:#5b7083;font-size:16px">Your cards from {esc(nice_date)}</p>{"".join(blocks)}'
            f'<hr style="border:none;border-top:1px solid #d9e1e4;margin:32px 0 14px">'
            f'<p style="font-size:12px;line-height:1.6;color:#667">You get this because you subscribed to cards for {esc(", ".join(followed))}. '
            f'<a href="{unsub}" style="color:#667">Unsubscribe</a> &middot; <a href="{site}" style="color:#667">Change teams</a><br>{esc(postal)}</p></div>')
    return {"subject": subject, "html": body, "text": "\n".join(text + footer_text),
            "headers": {"List-Unsubscribe": f"<{unsub}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}}


def render_cards(site: str, wanted: list[tuple[int, str, str]]) -> dict[tuple[int, str], bytes | None]:
    """Render cards in a headless browser from the live site. wanted: [(game_id, home_abbrev, card_key)]. None when the game is not on the site yet."""
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-render", action="store_true", help="dry run without a browser: placeholder image links")
    args = ap.parse_args()
    env = os.environ
    site = env["SITE_URL"].rstrip("/")
    image_base = env.get("LIVE_URL", "").rstrip("/")
    postal = env.get("EMAIL_POSTAL", "")
    date = args.date or yesterday_et()
    games = finished_games(date)
    print(f"{date}: {len(games)} finished games", flush=True)
    if not games:
        return
    sec = {"authorization": f"Bearer {env['SEND_SECRET']}"}
    r = requests.get(f"{site}/api/subscribers", params={"date": date}, headers=sec, timeout=60)
    r.raise_for_status()
    subs = r.json()["subscribers"]
    print(f"{len(subs)} subscribers not yet sent for {date}", flush=True)
    if not subs:
        return

    by_id = {g["id"]: g for g in games}
    plan = []                                                       # (sub, [games of theirs])
    for s in subs:
        mine = [g for g in games if g["away"] in s["teams"] or g["home"] in s["teams"]]
        if mine:
            plan.append((s, mine))
    print(f"{len(plan)} subscribers have a team that played", flush=True)
    if not plan:
        return

    # which cards are needed at all
    wanted = sorted({(g["id"], g["home"], k) for s, mine in plan for g in mine for k in card_keys_for(set(s["teams"]), g)})
    print(f"{len(wanted)} cards to make", flush=True)
    png: dict[tuple[int, str], bytes | None] = {}
    s3 = None
    if not args.dry_run:
        import boto3
        s3 = boto3.client("s3", endpoint_url=env["R2_ENDPOINT"], aws_access_key_id=env["R2_ACCESS_KEY_ID"],
                          aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"], region_name="auto")
    if not args.no_render:
        png = render_cards(site, wanted)
        missing = sorted({gid for (gid, _), data in png.items() if data is None})
        if missing:
            print(f"not on the site yet (holding their subscribers): {missing}", flush=True)
    else:
        png = {(gid, k): b"" for gid, _, k in wanted}
    ready = {gid for gid in by_id if all(png.get((gid, k)) is not None for (g2, _, k) in wanted if g2 == gid)}

    outdir = os.path.join(ROOT, "email_preview")
    if args.dry_run:
        os.makedirs(outdir, exist_ok=True)
    for (gid, key), data in png.items():
        if not data:
            continue
        name = card_object(date, gid, key)
        if args.dry_run:
            with open(os.path.join(outdir, f"{gid}-{key}.png"), "wb") as f:
                f.write(data)
        else:
            s3.put_object(Bucket=env["R2_LIVE_BUCKET"], Key=name, Body=data, ContentType="image/png", CacheControl="public, max-age=31536000")
    if not args.dry_run:
        print(f"uploaded {sum(1 for d in png.values() if d)} cards", flush=True)

    cap = int(env.get("MAX_EMAILS", "90"))
    sent_ids, held, over = [], 0, 0
    batch = []
    for s, mine in plan:
        if not all(g["id"] in ready for g in mine):
            held += 1
            continue
        if len(sent_ids) + len(batch) >= cap:
            over += 1
            continue
        mail = build_email(s, mine, date, site, image_base or "https://example.invalid", postal)
        if args.dry_run:
            with open(os.path.join(outdir, f"email-{s['id'][:8]}.html"), "w") as f:
                f.write(mail["html"])
            print(f"  [dry run] would send to {s['email']}: {mail['subject']}", flush=True)
            continue
        batch.append((s, {"from": env["EMAIL_FROM"], "to": [s["email"]], **{k: mail[k] for k in ("subject", "html", "text", "headers")}}))
    if not args.dry_run:
        for i in range(0, len(batch), 50):
            chunk = batch[i:i + 50]
            resp = requests.post("https://api.resend.com/emails/batch", headers={"authorization": f"Bearer {env['RESEND_API_KEY']}", "content-type": "application/json"},
                                 data=json.dumps([m for _, m in chunk]), timeout=120)
            if resp.status_code == 200:
                sent_ids += [s["id"] for s, _ in chunk]
                print(f"  sent {len(chunk)} emails", flush=True)
            else:
                print(f"  batch failed ({resp.status_code}): {resp.text[:300]}", flush=True)
        if sent_ids:
            requests.post(f"{site}/api/sent", headers=sec, json={"date": date, "ids": sent_ids}, timeout=60).raise_for_status()
    print(f"done: sent {len(sent_ids)}, held for missing games {held}, over the daily cap {over}", flush=True)


if __name__ == "__main__":
    main()
