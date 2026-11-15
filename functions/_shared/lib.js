// Shared helpers for the email subscription functions (Cloudflare Pages Functions, see DEPLOY.md "Email cards").
// Subscribers live in one Workers KV namespace bound to the Pages project as SUBS:
//   sub:<id>            {email, teams, pendingTeams, confirmed, token, ut, created, confirmedAt}   id = first 32 hex of sha256(lowercased email)
//   sent:<gameId>:<id>  "1", kept 14 days: that subscriber was already emailed that game's cards
//   count:<UTC date>    how many emails the sending job sent that day (for the daily cap)
// Secrets and settings (Pages project settings): RESEND_API_KEY, EMAIL_FROM, SEND_SECRET, EMAIL_POSTAL (a mailing address for the footer).

export const TEAMS = ["ANA", "BOS", "BUF", "CGY", "CAR", "CHI", "COL", "CBJ", "DAL", "DET", "EDM", "FLA", "LAK", "MIN", "MTL", "NSH",
  "NJD", "NYI", "NYR", "OTT", "PHI", "PIT", "SJS", "SEA", "STL", "TBL", "TOR", "UTA", "VAN", "VGK", "WSH", "WPG"];

export const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const page = (title, body, status = 200) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{font:17px/1.5 -apple-system,Helvetica,Arial,sans-serif;background:#0b1c2c;color:#eef5fb;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{max-width:520px;padding:32px 24px}h1{font-size:26px;margin:0 0 12px}a{color:#8cc8f0}p{color:#c3d3e0}</style></head><body><main><h1>${esc(title)}</h1>${body}</main></body></html>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const normEmail = (e) => String(e || "").trim().toLowerCase();
export const validEmail = (e) => e.length <= 254 && /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]{2,}$/.test(e);

export async function subId(email) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normEmail(email)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// constant-time comparison of two strings
export function same(a, b) {
  a = String(a || ""); b = String(b || "");
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function authorized(request, env) {
  const h = request.headers.get("authorization") || "";
  return !!env.SEND_SECRET && same(h, "Bearer " + env.SEND_SECRET);
}

export async function getSub(env, id) {
  const raw = await env.SUBS.get("sub:" + id);
  return raw ? JSON.parse(raw) : null;
}
// an address that never confirms is forgotten after a week; a confirmed one is kept until it unsubscribes
export const putSub = (env, id, rec) => env.SUBS.put("sub:" + id, JSON.stringify(rec), rec.confirmed ? undefined : { expirationTtl: 7 * 86400 });

// send one email through Resend; returns true on success
export async function sendEmail(env, { to, subject, html, text, headers }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html, text, headers }),
  });
  if (!r.ok) console.error("Resend refused the email:", r.status, (await r.text()).slice(0, 300));   // shows in the Pages function logs
  return r.ok;
}

export const teamLabel = (teams) => teams.length === 1 ? teams[0] : teams.length <= 3 ? teams.join(", ") : teams.length + " teams";
