// GET /api/subscribers?games=<id>,<id>,...   (Authorization: Bearer SEND_SECRET)
// Every confirmed subscriber, each with `sent` (which of the listed games they have already been emailed) and `since` (when they
// confirmed, in ms, so the sender only emails games that finish after that, not a backlog). Also `sent_today`, how many
// emails the sending job has recorded today (UTC), so it can stay under the email service's daily cap. Used only by the sending job.
import { json, authorized } from "../_shared/lib.js";

export async function onRequestGet({ request, env }) {
  if (!authorized(request, env)) return json({ ok: false }, 401);
  const games = (new URL(request.url).searchParams.get("games") || "").split(",").filter(Boolean);
  if (!games.length || games.length > 200 || !games.every((g) => /^\d{6,12}$/.test(g))) return json({ ok: false, error: "games=id,id,..." }, 400);
  const out = []; let cursor;
  do {
    const page = await env.SUBS.list({ prefix: "sub:", cursor });
    for (const k of page.keys) {
      const rec = JSON.parse((await env.SUBS.get(k.name)) || "null");
      if (!rec || !rec.confirmed || !rec.teams || !rec.teams.length) continue;
      const id = k.name.slice(4), sent = [];
      for (const g of games) if (await env.SUBS.get(`sent:${g}:${id}`)) sent.push(g);
      out.push({ id, email: rec.email, teams: rec.teams, ut: rec.ut, sent, since: rec.confirmedAt || 0 });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  const today = new Date().toISOString().slice(0, 10);
  return json({ ok: true, subscribers: out, sent_today: parseInt((await env.SUBS.get("count:" + today)) || "0", 10) });
}
