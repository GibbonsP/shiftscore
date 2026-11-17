// Shift Score scheduler: a Cloudflare Worker with a cron trigger that starts the GitHub workflows on time.
// GitHub's own scheduler skips and delays runs; Cloudflare's does not. Every 10 minutes this asks GitHub to run
//   * Update site (ingest finished games, rebuild, deploy only if a game came in), every 10 minutes during game hours and every 2 hours otherwise
//   * Live scores (the loop that feeds the live page), during game hours
// and skips a workflow that is already running or waiting, so nothing piles up. Setup is in DEPLOY.md ("Reliable scheduling").
// Secret needed: GITHUB_TOKEN, a fine-grained token for this one repository with "Actions: Read and write" and nothing else.
const REPO = "GibbonsP/shiftscore";
const REF = "main";

async function gh(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "shiftscore-scheduler", ...(init.headers || {}) },
  });
}
async function busy(env, workflow) {
  for (const status of ["in_progress", "queued"]) {
    const r = await gh(env, `/actions/workflows/${workflow}/runs?status=${status}&per_page=1`);
    if (!r.ok) throw new Error(`list ${workflow} ${status}: HTTP ${r.status}`);
    if ((await r.json()).total_count > 0) return true;
  }
  return false;
}
async function start(env, workflow, inputs) {
  if (await busy(env, workflow)) return `${workflow}: already running or waiting`;
  const r = await gh(env, `/actions/workflows/${workflow}/dispatches`, { method: "POST", body: JSON.stringify({ ref: REF, inputs }) });
  return `${workflow}: ${r.status === 204 ? "started" : "HTTP " + r.status + " " + (await r.text()).slice(0, 200)}`;
}

async function tick(env, now) {
  const h = now.getUTCHours(), m = now.getUTCMinutes();
  const gameHours = h >= 16 || h < 9;            // noon to 4 am Eastern (11 am to 3 am in winter)
  const out = [];
  if ((h >= 22 || h < 8) || (m < 10 && h % 2 === 0)) out.push(await start(env, "update-site.yml", { only_if_new: "true" }));
  if (gameHours) out.push(await start(env, "live.yml", {}));
  console.log(now.toISOString(), out.join(" | "));
  return out;
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(tick(env, new Date(event.scheduledTime)).catch((e) => console.log("scheduler error:", e.message))); },
  // opening the worker's address shows it is alive and what it would do right now (it starts nothing)
  async fetch(request, env) {
    const r = await gh(env, "/actions/workflows/update-site.yml/runs?per_page=1");
    return new Response(`shiftscore scheduler is up; GitHub answers HTTP ${r.status}\n`, { headers: { "content-type": "text/plain" } });
  },
};
