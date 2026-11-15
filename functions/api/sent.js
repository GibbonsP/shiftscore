// POST /api/sent  {games: {"<gameId>": ["<subscriber id>", ...], ...}, emails: <how many emails went out>}   (Authorization: Bearer SEND_SECRET)
// Remembers who has been emailed which game (so nobody gets a game twice) and counts today's emails against the daily cap.
import { json, authorized } from "../_shared/lib.js";

export async function onRequestPost({ request, env }) {
  if (!authorized(request, env)) return json({ ok: false }, 401);
  let body; try { body = await request.json(); } catch { return json({ ok: false }, 400); }
  const games = body && body.games;
  if (!games || typeof games !== "object" || Array.isArray(games)) return json({ ok: false }, 400);
  for (const [gid, ids] of Object.entries(games)) {
    if (!/^\d{6,12}$/.test(gid) || !Array.isArray(ids)) return json({ ok: false }, 400);
    for (const id of ids) if (/^[0-9a-f]{32}$/.test(id)) await env.SUBS.put(`sent:${gid}:${id}`, "1", { expirationTtl: 14 * 86400 });
  }
  const n = Math.max(0, Math.min(10000, parseInt(body.emails, 10) || 0));
  if (n) {
    const key = "count:" + new Date().toISOString().slice(0, 10);
    await env.SUBS.put(key, String(parseInt((await env.SUBS.get(key)) || "0", 10) + n), { expirationTtl: 3 * 86400 });
  }
  return json({ ok: true });
}
