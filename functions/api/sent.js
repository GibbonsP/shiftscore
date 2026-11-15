// POST /api/sent  {date: "YYYY-MM-DD", ids: [...]}   (Authorization: Bearer SEND_SECRET): remember who got that day's digest.
import { json, authorized } from "../_shared/lib.js";

export async function onRequestPost({ request, env }) {
  if (!authorized(request, env)) return json({ ok: false }, 401);
  let body; try { body = await request.json(); } catch { return json({ ok: false }, 400); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || "") || !Array.isArray(body.ids)) return json({ ok: false }, 400);
  for (const id of body.ids) if (/^[0-9a-f]{32}$/.test(id)) await env.SUBS.put(`sent:${body.date}:${id}`, "1", { expirationTtl: 14 * 86400 });
  return json({ ok: true });
}
