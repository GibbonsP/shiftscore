// GET /api/confirm?h=<id>&t=<token>: the link in the confirmation email. Turns the pending request into the live subscription.
import { page, getSub, putSub, same, esc, teamLabel } from "../_shared/lib.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url), id = url.searchParams.get("h") || "", t = url.searchParams.get("t") || "";
  const rec = /^[0-9a-f]{32}$/.test(id) ? await getSub(env, id) : null;
  if (!rec || !rec.token || !same(rec.token, t)) return page("That link has expired", `<p>Sign up again from <a href="/">the site</a> to get a new confirmation email.</p>`, 400);
  rec.teams = rec.pendingTeams && rec.pendingTeams.length ? rec.pendingTeams : rec.teams;
  rec.pendingTeams = [];
  rec.confirmed = true;
  rec.confirmedAt = Date.now();
  rec.token = "";                                                   // a confirmation link works once
  await putSub(env, id, rec);
  return page("You're subscribed", `<p>You'll get an email with the cards for <b>${esc(rec.teams.join(", "))}</b> shortly after each of their games, usually within an hour or two of the final horn.</p>
    <p>To change teams, sign up again with the same address. Every email has an unsubscribe link.</p><p><a href="/">Back to Shift Score</a></p>`);
}
