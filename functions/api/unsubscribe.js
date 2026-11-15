// GET or POST /api/unsubscribe?h=<id>&t=<unsubscribe token>: the link in every email (POST is the one-click unsubscribe mail apps use).
import { page, json, getSub, same } from "../_shared/lib.js";

async function handle({ request, env }) {
  const url = new URL(request.url), id = url.searchParams.get("h") || "", t = url.searchParams.get("t") || "";
  const rec = /^[0-9a-f]{32}$/.test(id) ? await getSub(env, id) : null;
  if (rec && rec.ut && same(rec.ut, t)) await env.SUBS.delete("sub:" + id);
  // the same answer whether or not the address was subscribed, so the link can't be used to check who is on the list
  return request.method === "POST" ? json({ ok: true }) : page("You're unsubscribed", `<p>You won't get any more emails from Shift Score.</p><p><a href="/">Back to Shift Score</a></p>`);
}
export const onRequestGet = handle;
export const onRequestPost = handle;
