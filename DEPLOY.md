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

## Limits to know

* Cloudflare Pages' free plan allows 500 deploys a month; the update job deploys every two hours (about 360 a month).
* GitHub scheduled runs can start a few minutes late, and GitHub pauses scheduled workflows in repositories with no activity
  for 60 days (re-enable them in the Actions tab).
* The site's per-game files are fetched by the browser on demand; the largest is about 2 MB (the limit is 25 MB).
* Changing the model or the weights means editing `private/formulas.json`, rebuilding every season locally, then pushing the new
  state with `python3 ci/state.py push` and uploading the new `private/formulas.json` to `state/formulas.json` so both cloud jobs use it.
