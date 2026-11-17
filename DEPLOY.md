# Hosting Shift Score on Cloudflare Pages, with scheduled updates

What runs where:

| Piece | Where | How often |
|---|---|---|
| The site (page and data files) | Cloudflare Pages | redeployed after each update run |
| Update job: ingest finished games, rebuild, deploy | GitHub Actions (`.github/workflows/update-site.yml`) | every 2 hours, and on demand |
| Live scores and live box scores | GitHub Actions (`.github/workflows/live.yml`) writing to a public Cloudflare R2 bucket the site polls | every minute while games are in play |
| The database and last build, kept between runs | a private Cloudflare R2 bucket (`state/state.tar.zst`, about 130 MB) | updated after any run that ingests games |

You need a free Cloudflare account and a GitHub account. Everything below is a one-time setup, about 30 minutes.

## 1. Put the code on GitHub

Create an empty repository (for example `shiftscore`) and push this folder to it:

```bash
git remote add origin https://github.com/<you>/shiftscore.git
git push -u origin main
```

Make the repository **public**: the live job runs about 5 hours on game nights, roughly 8,000 to 10,000 Actions minutes a month,
and public repositories get unlimited minutes (private ones get 2,000 free, then about $0.008 a minute).

The Game Score weights and the other scoring constants are **not** in the repository. They live in `private/formulas.json`
(gitignored), which the code reads through `nhl_impact/formulas.py`. The cloud jobs restore it from the private state bucket
(step 5). METHODOLOGY.md and the `scratch/` experiments are also kept out of the repository, and the repository starts from a
fresh history so earlier commits (which held the weights) are never pushed. Never push the `history-private` branch.

## 2. Cloudflare Pages project

Cloudflare dashboard, Workers & Pages, Create, Pages, **Upload assets** (Direct Upload). Name the project `shiftscore`
(the site will be `https://shiftscore.pages.dev`). Upload any one file to create it (for example `site/favicon.svg` after
running `python build_site.py`); the workflow replaces it. Note your **Account ID** (right sidebar of the dashboard).

## 3. Cloudflare API token

My Profile, API Tokens, Create Token, custom token. Permission: **Account, Cloudflare Pages, Edit**. Copy the token.

## 4. Two R2 buckets

Dashboard, R2 Object Storage, Create bucket:

* `shiftscore-state` (leave private).
* `shiftscore-live`: in its Settings, enable the **Public Development URL** (an `r2.dev` address; or connect a custom
  domain). Add a CORS policy so the site can read it:

  ```json
  [{"AllowedOrigins": ["*"], "AllowedMethods": ["GET"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 30}]
  ```

Then R2 overview, **Manage R2 API Tokens**, Create API token with **Object Read & Write** on both buckets. Copy the
**Access Key ID**, the **Secret Access Key** and the **S3 endpoint** (`https://<account-id>.r2.cloudflarestorage.com`).

## 5. Upload the first state bundle

On the Mac, in this folder:

```bash
python3 ci/state.py pack          # writes state.tar.zst (about 130 MB: the database, last build, update bookkeeping, images)
```

In the dashboard open the `shiftscore-state` bucket, Objects, Upload, and put the file at **`state/state.tar.zst`**
(create a folder named `state` first). Then upload `private/formulas.json` (the scoring constants) into the same folder, so it
sits at **`state/formulas.json`**; the live job downloads it from there, and the update job gets its own copy from the bundle.
Do this right before step 7 so the database is current. Stop `update_watch.py` before packing, so the database and the staged data
agree.

## 6. GitHub secrets and variables

Repository, Settings, Secrets and variables, Actions.

Secrets: `CLOUDFLARE_API_TOKEN` (step 3), `CLOUDFLARE_ACCOUNT_ID` (step 2), `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY` (step 4).

Variables: `CF_PAGES_PROJECT` = `shiftscore`, `R2_STATE_BUCKET` = `shiftscore-state`, `R2_LIVE_BUCKET` = `shiftscore-live`,
`SITE_URL` = `https://shiftscore.pages.dev` (your address), `LIVE_URL` = the live bucket's public address plus `/live`
(for example `https://pub-xxxxxxxx.r2.dev/live`).

## 7. First runs

Actions tab, **Update site**, Run workflow. When it finishes the site is at your Pages address. On a game night, run
**Live scores** as well (it also starts itself on the schedule); Home then shows games in progress and opens live box scores.

## 8. Stop the Mac-side jobs

Once the cloud jobs work, stop `update_watch.py` and `live_watch.py` on the Mac and do not publish from there any more: the
cloud now owns the database, and a second copy would drift. To work on the Mac again, restore the current state first:

```bash
pip install boto3
R2_ENDPOINT=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_STATE_BUCKET=shiftscore-state python3 ci/state.py pull
```

## 9. Email cards (optional)

Visitors pick teams on Home and get an email with the cards for their teams' games soon after each game is processed. The pieces:

* `functions/` (Cloudflare Pages Functions, deployed with the site): `/api/subscribe` (sends a confirmation email), `/api/confirm`,
  `/api/unsubscribe` (also the one-click unsubscribe mail apps use), and two secret-protected ones the sender uses
  (`/api/subscribers`, `/api/sent`). Subscribers live in a Workers KV namespace; nobody gets mail before clicking the confirmation link.
* `ci/send_cards.py` and the **Send cards** workflow: it runs after every **Update site** run. It finds the subscribers who have new
  cards waiting (a finished game of theirs that is on the site and that they were not sent yet), renders those cards in a headless
  browser from the live site, uploads them to the live bucket under `cards/<date>/`, sends each subscriber one email with all their new
  games, and records who got which game. A run with nothing new does nothing. A new subscriber gets every game that finishes after they confirm, with no backlog of earlier games.
* **How soon:** a game is processed about 3.5 hours after the puck drops (about an hour after it ends, once the shift chart is out).
  **Update site** runs every half hour from 5 pm to 3 am Eastern and every two hours by day, so the cards usually arrive within about
  an hour and a half of the final horn.

Setup, once:

1. **Resend** (resend.com, free: 100 emails a day, 3,000 a month): add your domain, put the DNS records it shows (SPF, DKIM) at your
   registrar, wait for "Verified", then create an API key with sending access.
2. **A Workers KV namespace**: Cloudflare dashboard, Storage & databases, KV, Create, name it `shiftscore-subs`. Then your Pages project,
   Settings, Bindings, Add, KV namespace: variable name `SUBS`, namespace `shiftscore-subs` (for Production).
3. **Pages settings** (the project's Settings, Variables and secrets, Production): `RESEND_API_KEY` (secret, the key from step 1),
   `EMAIL_FROM` (for example `Shift Score <cards@yourdomain.com>`), `SEND_SECRET` (secret, any long random string you make up).
4. **GitHub** (repo Settings, Secrets and variables, Actions). Secrets: `SEND_SECRET` (the same string as step 3), `RESEND_API_KEY`.
   Variables: `SITE_URL` (your Pages address, no trailing slash), `EMAIL_FROM` (same as step 3), `EMAIL_POSTAL` (a mailing address for the
   email footer; anti-spam law requires one, a PO box works), and last, `EMAIL_SIGNUP` = `1` (this shows the signup box on Home).
5. Push, run **Update site** (this deploys the functions), then test: subscribe yourself on Home, click the confirmation link, and run
   **Send cards** by hand (try the dry-run option first). In the live bucket, a lifecycle rule that deletes
   `cards/` after 30 days keeps storage tidy.

Limits: a free Resend plan caps sending at 100 a day, so the job stops at 90 emails a day (`MAX_EMAILS`) and the rest wait for the next
run; a paid plan raises the cap. A subscriber who follows several teams can get more than one email in a night, one per update. To stop all email, remove the `EMAIL_SIGNUP` variable and disable the **Send cards** workflow.

## Rebuilding every season's data in the cloud

A normal update only rebuilds the teams that had a new game. After a change to what the data files contain (a new column, a new board),
run **Update site** by hand with **Rebuild every season's data files** ticked: it rebuilds all seasons from the cloud's own database,
deploys, and saves the new state. No upload from the Mac is needed for this.

## Limits to know

* Cloudflare Pages' free plan allows 500 builds a month (direct uploads like ours may not count, but plan as if they do). A scheduled
  update run deploys only when it ingested a new game, plus once every two hours, so a busy month stays around 450.
* GitHub scheduled runs can start a few minutes late, and GitHub pauses scheduled workflows in repositories with no activity
  for 60 days (re-enable them in the Actions tab).
* The site's per-game files are fetched by the browser on demand; the largest is about 2 MB (the limit is 25 MB).
* Changing the model or the weights means editing `private/formulas.json`, rebuilding every season locally, then pushing the new
  state with `python3 ci/state.py push` and uploading the new `private/formulas.json` to `state/formulas.json` so both cloud jobs use it.


## Reliable scheduling (Cloudflare cron)

GitHub's own scheduler skips and delays runs (a finished game can wait hours for the next Update site run). `worker/scheduler.js` is a
small Cloudflare Worker whose cron trigger fires every 10 minutes and starts **Update site** (every 10 minutes from 22:00 to 07:59 UTC, every
2 hours otherwise; it deploys only when a game came in) and **Live scores** (noon to 4 am Eastern), skipping a workflow that is already running
or waiting. The GitHub schedules stay as a backup.

1. GitHub: Settings (your account) > Developer settings > Personal access tokens > Fine-grained tokens > Generate. Repository access: only
   this repository. Permissions: **Actions: Read and write** (nothing else). Expiration: one year (put the date in your calendar).
2. Cloudflare dashboard: Workers & Pages > Create > Create Worker, name it `shiftscore-scheduler`, Deploy, then Edit code, replace everything
   with the contents of `worker/scheduler.js`, Deploy.
3. The worker's Settings > Variables and Secrets > Add: type **Secret**, name `GITHUB_TOKEN`, value the token from step 1. Deploy.
4. Settings > Trigger Events > Add > Cron Triggers: `*/10 * * * *`.
5. Check: open the worker's address (it says whether GitHub answers 200), then Observability > Logs shows one line per run, for example
   `update-site.yml: started | live.yml: already running or waiting`.
