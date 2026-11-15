"""Assemble the standalone site (index.html plus data/) for hosting on Cloudflare Pages.

    python build_site.py            # reads artifact_shift_score_final.html and artifact_data/, writes site/

Run after build_artifact.py (or refresh_schedule.py). The page is the same one published as an Artifact; here it is wrapped in
a full HTML document with the metadata a normal website needs, and the data files are copied next to it.
"""
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
OUT = "site"
SKIP = {"page_data.json", "manifest.json", "changed.json"}   # build bookkeeping, not part of the site

page = open("artifact_shift_score_final.html").read()
marker = '<div class="wrap">'
assert page.count(marker) == 1, "page layout changed: expected one wrap container"
head, body = page.split(marker, 1)
body = marker + body

DESC = "Every NHL game scored player by player: Game Score, shot quality, lines, pairs and special teams, with shareable game cards."
# set SITE_URL (for example https://shiftscore.pages.dev) so link previews can use an absolute image address
SITE_URL = os.environ.get("SITE_URL", "").rstrip("/")
OG_EXTRA = (f'\n<meta property="og:url" content="{SITE_URL}/">\n<meta property="og:image" content="{SITE_URL}/og-image.png">'
            f'\n<meta name="twitter:card" content="summary_large_image">') if SITE_URL else ""
# set LIVE_URL (a public address that serves index.json and g_<gameId>.json from the live job) to turn on live scores and box scores
LIVE_URL = os.environ.get("LIVE_URL", "").rstrip("/")
# set EMAIL_SIGNUP=1 once the email signup functions are set up (DEPLOY.md, "Email cards") to show the signup box on Home
SIGNUP = os.environ.get("EMAIL_SIGNUP") == "1"
LIVE_TAG = f'\n<script>window.SHIFTSCORE = {{ liveUrl: "{LIVE_URL}", signup: {"true" if SIGNUP else "false"} }};</script>' if (LIVE_URL or SIGNUP) else ""
doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="{DESC}">
<meta name="theme-color" content="#0a1f3d">
<meta property="og:type" content="website">
<meta property="og:title" content="Shift Score">
<meta property="og:description" content="{DESC}">
<link rel="icon" href="favicon.png" type="image/png" sizes="64x64">
<link rel="apple-touch-icon" href="apple-touch-icon.png">{OG_EXTRA}{LIVE_TAG}
{head}
</head>
<body>
{body}
</body>
</html>
"""

shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(f"{OUT}/data")
with open(f"{OUT}/index.html", "w") as f:
    f.write(doc)
for name in os.listdir("artifact_data"):
    if name in SKIP:
        continue
    src, dst = f"artifact_data/{name}", f"{OUT}/data/{name}"
    shutil.copytree(src, dst) if os.path.isdir(src) else shutil.copy2(src, dst)

# logo files: the favicon and the images for link previews and home-screen icons (rendered PNGs live in brand/)
for name, dst in (("favicon.png", "favicon.png"), ("og-image.png", "og-image.png"), ("apple-touch-icon.png", "apple-touch-icon.png")):
    if os.path.exists(f"brand/{name}"):
        shutil.copy2(f"brand/{name}", f"{OUT}/{dst}")
os.makedirs(f"{OUT}/brand", exist_ok=True)
for name in os.listdir("brand"):
    if os.path.isfile(f"brand/{name}") and not name.endswith(".py"):
        shutil.copy2(f"brand/{name}", f"{OUT}/brand/{name}")
with open(f"{OUT}/robots.txt", "w") as f:
    f.write("User-agent: *\nAllow: /\n")
# Cloudflare Pages response headers: the page always revalidates; data files are cached briefly so a new build shows up soon
with open(f"{OUT}/_headers", "w") as f:
    f.write("/\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n/data/*\n  Cache-Control: public, max-age=300\n"
            "/data/photos/*\n  Cache-Control: public, max-age=86400\n/data/logos.json\n  Cache-Control: public, max-age=86400\n")

n = sum(len(fs) for _, _, fs in os.walk(OUT))
size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs) / 1e6
biggest = max((os.path.getsize(os.path.join(dp, f)), os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs)
print(f"site/: {n} files, {size:.0f} MB; largest file {biggest[0] / 1e6:.1f} MB ({biggest[1]})")
assert biggest[0] < 25 * 1024 * 1024, "a file is over Cloudflare Pages' 25 MiB limit"
assert n < 20000, "over Cloudflare Pages' 20,000 file limit"
