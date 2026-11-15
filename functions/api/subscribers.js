// GET /api/subscribers?date=YYYY-MM-DD   (Authorization: Bearer SEND_SECRET)
// The confirmed subscribers who have not yet been sent the digest for that date. Used only by the sending job.
import { json, authorized } from "../_shared/lib.js";

export async function onRequestGet({ request, env }) {
  if (!authorized(request, env)) return json({ ok: false }, 401);
  const date = new URL(request.url).searchParams.get("date") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: "date=YYYY-MM-DD" }, 400);
  const out = []; let cursor;
  do {
    const page = await env.SUBS.list({ prefix: "sub:", cursor });
    for (const k of page.keys) {
      const rec = JSON.parse((await env.SUBS.get(k.name)) || "null");
      if (!rec || !rec.confirmed || !rec.teams || !rec.teams.length) continue;
      const id = k.name.slice(4);
      if (await env.SUBS.get(`sent:${date}:${id}`)) continue;
      out.push({ id, email: rec.email, teams: rec.teams, ut: rec.ut });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return json({ ok: true, subscribers: out });
}
