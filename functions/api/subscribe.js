// POST /api/subscribe  {email, teams: ["TOR", ...], website: ""}   (website is a honeypot field real visitors leave empty)
// Stores the request as pending and emails a confirmation link; nothing is sent to anyone who has not clicked it.
import { TEAMS, json, normEmail, validEmail, subId, randomToken, getSub, putSub, sendEmail, esc, teamLabel } from "../_shared/lib.js";

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ ok: false, error: "Not allowed." }, 403);
  if (!env.SUBS || !env.RESEND_API_KEY || !env.EMAIL_FROM) return json({ ok: false, error: "Email signup is not set up yet." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  if (body.website) return json({ ok: true });                    // a bot filled the hidden field: pretend it worked
  const email = normEmail(body.email);
  if (!validEmail(email)) return json({ ok: false, error: "That email address doesn't look right." }, 400);
  const teams = [...new Set((Array.isArray(body.teams) ? body.teams : []).map((t) => String(t).toUpperCase()))].filter((t) => TEAMS.includes(t));
  if (!teams.length) return json({ ok: false, error: "Pick at least one team." }, 400);

  const id = await subId(email);
  const now = Date.now();
  const rec = (await getSub(env, id)) || { email, teams: [], confirmed: false, ut: randomToken(), created: now };
  // one confirmation email per address every ten minutes, so the form can't be used to flood someone's inbox
  if (rec.lastRequest && now - rec.lastRequest < 10 * 60 * 1000) return json({ ok: true });
  rec.pendingTeams = teams;
  rec.token = randomToken();
  rec.lastRequest = now;
  await putSub(env, id, rec);

  const link = `${url.origin}/api/confirm?h=${id}&t=${rec.token}`;
  const what = rec.confirmed ? "change the teams you get cards for" : "get game cards by email";
  const ok = await sendEmail(env, {
    to: email,
    subject: rec.confirmed ? "Confirm your Shift Score team change" : "Confirm your Shift Score email cards",
    text: `Confirm that you want to ${what} (${teams.join(", ")}):\n\n${link}\n\nIf you didn't ask for this, ignore this email and nothing will happen.`,
    html: `<p>Confirm that you want to ${what} (<b>${esc(teams.join(", "))}</b>):</p><p><a href="${link}" style="background:#12304a;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block">Confirm</a></p><p style="color:#667">If you didn't ask for this, ignore this email and nothing will happen.</p>`,
  });
  if (!ok) return json({ ok: false, error: "We couldn't send the confirmation email. Try again in a few minutes." }, 502);
  return json({ ok: true });
}
