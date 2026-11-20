// Shared game box-score view. Used by the hosted site (inlined into the page) and
// by the static report's game pages (inlined into each file), so both render
// identical numbers. The host supplies how links work:
//   links = { player(id, team, text), team(abbrev), unit(key, team, text), backHtml }
//
// Counting stats arrive as (period x situation) "cells"; a filter is the sum of
// the matching cells. Cell index = periodIndex * 5 + situation, with
// situations 0=5v5, 1=other even strength (4v4/3v3), 2=power play,
// 3=penalty kill, 4=other (empty net etc.), seen from the player's own team.
// Field order below must match nhl_impact/game_slices.py.

function escapeHtml(s) {
  return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function toiStr(sec) { sec = Math.round(sec); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }
function signed2(v) { return (v > 0 ? "+" : "") + v.toFixed(2); }
function scoreCell(v) {
  if (v === null || v === undefined) return "";
  return `<span class="${v > 0 ? "pos" : v < 0 ? "neg" : ""}">${signed2(v)}</span>`;
}
const f2 = (v) => (v === null || v === undefined ? "" : v.toFixed(2));

// Game Score colors: seven tiers by where a value falls among every skater-game since 2024-25 (or every season average with 20+ games), so the
// color says how good it was at a glance. Cut points are the 5th, 20th, 40th, 60th, 80th and 95th percentiles (bottom 5% awful, 5-20% poor,
// 20-40% below average, 40-60% average, 60-80% good, 80-95% great, top 5% elite). Adjusted is judged against all skaters; raw Game Score is judged
// against his own position (defensemen score less of what raw counts). Re-measure these from the database now and then (scratch/gs_cuts.py).
const GS_CUTS = {
  adj: [-1.12, -0.69, -0.33, 0.09, 0.71, 1.72],          // Adjusted Game Score, one game
  avg: [-0.51, -0.31, -0.15, 0.04, 0.31, 0.71],             // Adjusted Game Score, a season average
  rawF: [-0.54, -0.12, 0.24, 0.69, 1.36, 2.43],             // raw Game Score, one game, forwards
  rawD: [-0.67, -0.22, 0.13, 0.49, 1.02, 1.89],            // ... defensemen
  rawAvgF: [0.09, 0.27, 0.45, 0.65, 0.94, 1.33],          // raw season average, forwards
  rawAvgD: [0.02, 0.15, 0.26, 0.41, 0.61, 0.99],         // ... defensemen
};
// Unit Score, one game, for the units ranked by ice time that game (forward lines L1-L4, defense pairs P1-P3): the same seven tiers and the
// same percentiles (5, 20, 40, 60, 80, 95) as the Game Score colors, measured within each slot over every game since 2024-25 so a fourth
// line is judged against fourth lines. Re-measure now and then (scratch/unit_cuts.py).
const UNIT_CUTS = {
  L1: [-1.46, -0.65, -0.05, 0.45, 1.09, 2.0], L2: [-1.49, -0.69, -0.17, 0.31, 0.84, 1.72], L3: [-1.39, -0.67, -0.2, 0.19, 0.71, 1.52], L4: [-1.27, -0.62, -0.21, 0.1, 0.5, 1.18],
  P1: [-1.93, -0.93, -0.25, 0.39, 1.1, 2.15], P2: [-1.92, -0.98, -0.32, 0.26, 0.91, 1.94], P3: [-1.73, -0.9, -0.32, 0.14, 0.73, 1.62],
};
const unitTier = (v, slot) => { const cuts = UNIT_CUTS[slot]; let t = 0; while (t < cuts.length && v >= cuts[t]) t += 1; return t; };
// the grade chip for a line or pair's Unit Score in one game, by the slot it held (L1-L4, P1-P3); "-" for any other unit
const unitGradeHtml = (score, slot) => (slot && UNIT_CUTS[slot] ? `<span class="gs gs-t${unitTier(score, slot)}" title="Graded against every ${slot} since 2024-25">${GS_TIER_NAME[unitTier(score, slot)]}</span>` : "&ndash;");
// the slot a unit held in a game: its rank by ice time among its team's lines or pairs that game (null beyond L4 / P3)
function unitSlotInGame(g, u) {
  if (u[1] !== "line" && u[1] !== "pair") return null;
  const same = g.units.filter(x => x[0] === u[0] && x[1] === u[1]).sort((a, b) => b[2] - a[2]);
  const i = same.findIndex(x => x === u || (u[13] && x[13] === u[13]));
  return i >= 0 && i < (u[1] === "line" ? 4 : 3) ? (u[1] === "line" ? "L" : "P") + (i + 1) : null;
}
const GS_TIER_NAME = ["Awful", "Poor", "Below average", "Average", "Good", "Great", "Elite"];
const GS_CARD_COLORS = ["#ff5d5d", "#f2805f", "#e8b86c", "#dbe6f0", "#b4e07a", "#55d49a", "#19e6c8"];   // the same tiers on the dark share cards
function gsTier(v, kind) {
  const cuts = GS_CUTS[kind];
  let t = 0;
  while (t < cuts.length && v >= cuts[t]) t += 1;
  return t;
}
const gsKind = (pos, avg) => (avg ? (pos === "D" ? "rawAvgD" : "rawAvgF") : (pos === "D" ? "rawD" : "rawF"));
// a colored score: kind is a GS_CUTS key; signed shows a + on positive values (Adjusted), unsigned is for raw Game Score
function gsCell(v, kind, signed) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "";
  const n = Number(v);
  return `<span class="gs gs-t${gsTier(n, kind)}" title="${GS_TIER_NAME[gsTier(n, kind)]}">${signed && n > 0 ? "+" : ""}${n.toFixed(2)}</span>`;
}
const gsColor = (v, kind) => GS_CARD_COLORS[gsTier(v, kind)];
// a small key for the page: what the colors mean
const gsKeyHtml = (what) => `<div class="gs-key">${what || "Score colors"}: ${GS_TIER_NAME.map((n, i) => `<span class="gs gs-t${i}">${n}</span>`).join(" ")} <span class="detail-sub">(where the score falls among every skater game since 2024-25: top 5% elite, bottom 5% awful)</span></div>`;

// --- Goalie start grades. The grade is the goals saved above expected in one game (expected goals against minus goals allowed):
// Great more than +1.5, Quality +0.5 to +1.5, Average within 0.5, Bad -0.5 to -1.5, Blown worse than -1.5.
const GRADE_LABEL = { great: "Great", quality: "Quality", average: "Average", bad: "Bad", blown: "Blown" };
const goalieGrade = (gsax) => (gsax > 1.5 ? "great" : gsax >= 0.5 ? "quality" : gsax > -0.5 ? "average" : gsax >= -1.5 ? "bad" : "blown");
function goalieTags(g) {
  const gr = goalieGrade(g.gsax), tags = [];
  if (g.relief) tags.push("Relief");
  if (g.win && (gr === "great" || gr === "quality") && g.txf !== null && g.txf - g.txa <= -1) tags.push("Stolen win");
  if (g.win && (gr === "bad" || gr === "blown")) tags.push("Bailed out");
  return tags;
}
const gradeChip = (gr) => `<span class="grade g-${gr}">${GRADE_LABEL[gr]}</span>`;

// Tables of comparable rows (a game log, a roster, a unit list...) sort when a column header is clicked: anything with at least four rows, unless the
// caller opts out ({ sort: false }) because the rows are labels, not records (a stat-by-stat comparison). The click handler is at the bottom of this file.
function statTable(headers, rows, opts) {
  if (!rows.length) return '<div class="empty">No rows.</div>';
  let html = `<div class="table-scroll"><table${rows.length >= 4 && !(opts && opts.sort === false) ? ' class="auto-sort"' : ""}><thead><tr>`;
  headers.forEach(h => { html += `<th class="${h.num ? "num" : ""}">${h.label}</th>`; });
  html += "</tr></thead><tbody>";
  rows.forEach(r => {
    html += "<tr>" + r.map((c, i) => `<td class="${headers[i].num ? "num" : ""}">${c}</td>`).join("") + "</tr>";
  });
  html += "</tbody></table></div>";
  return html;
}

const GameView = (() => {
  const PF = ["toi", "g", "a1", "a2", "sog", "hits", "blk", "tk", "gv", "pim", "fow", "fol", "pd", "pt", "ixg", "cf", "ca", "gf", "ga", "xgf", "xga", "hdcf", "hdca",
                "mdcf", "mdca", "ldcf", "ldca", "ihd", "imd", "ild", "ihg", "img", "ilg", "ihx", "imx", "ilx", "gsc"];
  const TF = ["toi", "goals", "sog", "attempts", "xgf", "hdc", "hits", "blocks", "tk", "gv", "pim", "fow", "fol", "mdc", "ldc"];
  const GF = ["toi", "sf", "ga", "xga", "sfh", "gah", "xgah", "sfm", "gam", "xgam", "sfl", "gal", "xgal"];
  // shot danger bands from the chance a shot on goal scores (s[10], second model; falls back to xG s[5]):
  // low < 7%, medium 7-14%, high >= 14%
  const BAND = (s) => { const p = s[10] != null ? s[10] : s[5]; return p >= 0.14 ? "h" : p >= 0.07 ? "m" : "l"; };
  const BAND_COLOR = { h: "var(--bad)", m: "var(--accent)", l: "var(--muted)" };
  const BAND_NAME = { h: "High danger", m: "Medium danger", l: "Low danger" };
  const idx = (fields) => Object.fromEntries(fields.map((f, i) => [f, i]));
  const PI = idx(PF), TI = idx(TF), GI = idx(GF);

  const PERIODS = [
    { key: "all", label: "All periods", idx: [0, 1, 2, 3] },
    { key: "1", label: "1st", idx: [0] },
    { key: "2", label: "2nd", idx: [1] },
    { key: "3", label: "3rd", idx: [2] },
    { key: "ot", label: "OT", idx: [3] },
  ];
  const SITUATIONS = [
    { key: "all", label: "All situations", idx: [0, 1, 2, 3, 4], unitTypes: ["line", "pair", "pp", "pk", "ev4", "ev3"] },
    { key: "ev", label: "Even strength", idx: [0, 1], unitTypes: ["line", "pair", "ev4", "ev3"] },
    { key: "5v5", label: "5v5", idx: [0], unitTypes: ["line", "pair"] },
    { key: "pp", label: "Power play", idx: [2], unitTypes: ["pp"] },
    { key: "pk", label: "Penalty kill", idx: [3], unitTypes: ["pk"] },
    { key: "ev43", label: "4v4 / 3v3", idx: [1], unitTypes: ["ev4", "ev3"] },
  ];
  const VIEWS = [
    { key: "adv", label: "Advanced" },
    { key: "box", label: "Box score" },
    { key: "ch", label: "Shot danger" },
  ];
  const UNIT_LABEL = { line: "Forward line", pair: "D pair", pp: "Power play unit", pk: "Penalty kill unit" };
  const UNIT_ORDER = { line: 0, pair: 1, pp: 2, pk: 3 };

  // ---- charts. Shots are [period, seconds, side(0 away/1 home), x, y, xG, kind(0 miss/1 save/2 goal), shooterId, cell],
  // already rotated so every team attacks the +x net; one half-rink drawing shows a team's shots.
  const mmss = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  const KIND = ["missed", "on goal", "GOAL"];
  const PERIOD_NAME = { 1: "P1", 2: "P2", 3: "P3", 4: "OT" };

  function shotMapSvg(shots, names) {
    const rink = `
      <path d="M0,-42.5 H72 A28,28 0 0 1 100,-14.5 V14.5 A28,28 0 0 1 72,42.5 H0" fill="var(--surface)" stroke="var(--ink)" stroke-width="1"/>
      <line x1="0" y1="-42.5" x2="0" y2="42.5" stroke="var(--muted)" stroke-width="0.8" stroke-dasharray="3 2"/>
      <line x1="25" y1="-42.5" x2="25" y2="42.5" stroke="var(--accent)" stroke-width="2.2" opacity="0.7"/>
      <line x1="89" y1="-37" x2="89" y2="37" stroke="var(--bad)" stroke-width="0.8" opacity="0.6"/>
      <circle cx="69" cy="-22" r="15" fill="none" stroke="var(--bad)" stroke-width="0.6" opacity="0.45"/>
      <circle cx="69" cy="22" r="15" fill="none" stroke="var(--bad)" stroke-width="0.6" opacity="0.45"/>
      <circle cx="69" cy="-22" r="1.2" fill="var(--bad)" opacity="0.6"/><circle cx="69" cy="22" r="1.2" fill="var(--bad)" opacity="0.6"/>
      <circle cx="20" cy="-22" r="1" fill="var(--bad)" opacity="0.45"/><circle cx="20" cy="22" r="1" fill="var(--bad)" opacity="0.45"/>
      <path d="M89,-6 A6,6 0 0 0 89,6 Z" fill="var(--crease)" opacity="0.8" stroke="var(--bad)" stroke-width="0.5"/>
      <rect x="89" y="-3" width="3.5" height="6" fill="none" stroke="var(--ink)" stroke-width="0.8"/>`;
    // misses and saves first so goals draw on top
    const order = shots.slice().sort((a, b) => a[6] - b[6]);
    const dots = order.map(s => {
      const r = (1.1 + 5.5 * Math.sqrt(s[5])).toFixed(2);
      // shown by the hover card (see wireTooltips); the same text is the accessible label
      const tip = `${names[s[7]] || "Shot"}|${PERIOD_NAME[s[0]] || s[0]} ${mmss(s[1])}|${s[5].toFixed(2)}|${BAND_NAME[BAND(s)]}|${KIND[s[6]]}`;
      // colour = danger band, shape = result: goals are solid with a dark ring, shots on goal shaded, misses hollow
      const col = BAND_COLOR[BAND(s)];
      const style = s[6] === 2 ? `fill="${col}" stroke="var(--ink)" stroke-width="1.6"`
        : s[6] === 1 ? `fill="${col}" fill-opacity="0.45" stroke="${col}" stroke-width="0.6"`
        : `fill="none" stroke="${col}" stroke-width="1" stroke-opacity="0.85"`;
      return `<circle class="gv-shot" cx="${s[3]}" cy="${s[4]}" r="${r}" ${style} pointer-events="all" data-tip="${escapeHtml(tip)}" tabindex="0"></circle>`;
    }).join("");
    return `<svg viewBox="-2 -45 104 90" role="img" aria-label="Shot map" style="width:100%;height:auto;display:block">${rink}${dots}</svg>`;
  }

  function shotMaps(g, shots, names, danger, allInView, player, shooters, mapKind) {
    const chips = ["all", "h", "m", "l"].map(k => {
      const n = k === "all" ? allInView.length : allInView.filter(s => BAND(s) === k).length;
      const label = k === "all" ? "All shots" : BAND_NAME[k];
      return `<button type="button" class="chip" aria-pressed="${danger === k}" data-gv-danger="${k}">${label} (${n})</button>`;
    }).join("");
    const kindBar = `<div class="chips" role="group" aria-label="Which shots">${[["sog", "Shots on goal"], ["all", "All unblocked attempts"]].map(([k, label]) => `<button type="button" class="chip" aria-pressed="${mapKind === k}" data-gv-kind="${k}">${label}</button>`).join("")}</div>`;
    const bar = `${kindBar}<div class="chips gv-danger-chips" role="group" aria-label="Shot danger">${chips}</div>`;
    // player filter: shooters with at least one unblocked shot in the current period/situation, away team first
    const playerOpts = shooters.map(x => `<option value="${x.id}"${String(player) === String(x.id) ? " selected" : ""}>${escapeHtml(x.name)} (${x.team}) &middot; ${x.n} shot${x.n === 1 ? "" : "s"}</option>`).join("");
    const playerBar = `<div class="gv-player-pick"><label>Player <select data-gv-player aria-label="Filter shot map by player"><option value="all">All players</option>${playerOpts}</select></label></div>`;
    if (!shots.length) return `<div class="detail-h3">Shot map</div>${playerBar}${bar}<div class="empty">No shots in this view.</div>`;
    const one = (side) => {
      const mine = shots.filter(s => s[2] === side);
      const goals = mine.filter(s => s[6] === 2).length, xg = mine.reduce((a, s) => a + s[5], 0);
      const n = { h: 0, m: 0, l: 0 }; mine.forEach(s => { n[BAND(s)] += 1; });
      return `<figure class="gv-map"><figcaption><strong>${side ? g.home : g.away}</strong> &middot; ${mine.length} unblocked shots (${n.h} high, ${n.m} medium, ${n.l} low danger), ${goals} goals, ${xg.toFixed(2)} xG</figcaption>${shotMapSvg(mine, names)}</figure>`;
    };
    return `<div class="detail-h3">Shot map</div>${playerBar}${bar}<div class="gv-maps">${one(0)}${one(1)}</div>
      <div class="gv-keys">
        <span class="gv-key"><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="var(--bad)"/></svg>High danger (14%+ to score)</span>
        <span class="gv-key"><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="var(--accent)"/></svg>Medium (7-14%)</span>
        <span class="gv-key"><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="var(--muted)"/></svg>Low (under 7%)</span>
      </div>
      <div class="panel-caption">Every unblocked shot, drawn toward the net it attacked, colored by danger. Solid circles with a dark ring are goals, shaded circles are shots on goal, hollow circles are misses, and bigger circles are higher expected goals. Hover (or tap) a shot to see the shooter, time, xG and result; use the player menu to see one shooter's chances.</div>`;
  }

  // Team expected goals for a game are counted on SHOTS ON GOAL: each shot on goal with the goalie in net is worth the chance a shot on goal
  // becomes a goal (s[10]; s[5] on games saved before that field existed). Misses, blocked shots and empty-net attempts add nothing. This
  // is the same definition as the danger bands, the goalies' expected goals against and the team charts, and it lands within about 0.1 of
  // Clear Sight's xG; the attempt-based xG (every unblocked attempt) stays inside Game Score's on-ice terms and the per-player xGF / xGA.
  const isChance = (s) => s[6] >= 1 && s[9] !== 1;
  const chanceXg = (s) => (s[10] !== null && s[10] !== undefined ? s[10] : s[5]);
  const teamXg = (shots, sideIdx, periods) => (shots || []).filter(s => s[2] === sideIdx && isChance(s) && (!periods || periods.includes(s[0]))).reduce((a, s) => a + chanceXg(s), 0);

  function xgTimeline(g, shots) {
    if (!shots.length) return "";
    const hasOT = shots.some(s => s[0] === 4);
    const T = hasOT ? 3900 : 3600;
    const at = (s) => (s[0] <= 3 ? (s[0] - 1) * 1200 + s[1] : 3600 + s[1]);
    const W = 640, H = 210, L = 38, R = 12, Tp = 14, B = 28;
    const series = [0, 1].map(side => {
      let run = 0;
      return shots.filter(s => s[2] === side && (isChance(s) || s[6] === 2)).sort((a, b) => at(a) - at(b)).map(s => { if (isChance(s)) run += chanceXg(s); return { t: at(s), v: run, goal: s[6] === 2, s }; });
    });
    const ymax = Math.max(1, ...series.map(a => (a.length ? a[a.length - 1].v : 0))) * 1.12;
    const X = (t) => L + (W - L - R) * t / T, Y = (v) => Tp + (H - Tp - B) * (1 - v / ymax);
    const path = (a) => {
      let d = `M${X(0)},${Y(0)}`, last = 0;
      a.forEach(p => { d += ` H${X(p.t).toFixed(1)} V${Y(p.v).toFixed(1)}`; last = p.v; });
      return d + ` H${X(T).toFixed(1)}`;
    };
    const ticks = []; for (let v = 0; v <= ymax; v += (ymax > 6 ? 2 : 1)) ticks.push(v);
    const grid = ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}</text>`).join("");
    const bounds = [1200, 2400, 3600].filter(t => t <= T).map((t, i) => `<line x1="${X(t)}" x2="${X(t)}" y1="${Tp}" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="3 3" stroke-width="1"/>`).join("");
    const plabels = [[0, 1200, "P1"], [1200, 2400, "P2"], [2400, 3600, "P3"], ...(hasOT ? [[3600, 3900, "OT"]] : [])]
      .map(([a, b, n]) => `<text x="${(X(a) + X(b)) / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${n}</text>`).join("");
    const styles = [
      { stroke: "var(--accent)", dash: "", name: g.away }, { stroke: "var(--ink)", dash: ' stroke-dasharray="7 4"', name: g.home },
    ];
    const lines = series.map((a, i) => `<path d="${path(a)}" fill="none" stroke="${styles[i].stroke}" stroke-width="2.6"${styles[i].dash} stroke-linejoin="round"/>`).join("");
    const goals = series.map((a, i) => a.filter(p => p.goal).map(p =>
      `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="5" fill="var(--surface)" stroke="${styles[i].stroke}" stroke-width="2.4"><title>${escapeHtml(styles[i].name)} goal ${PERIOD_NAME[p.s[0]]} ${mmss(p.s[1])} (xG ${p.s[5].toFixed(2)})</title></circle>`).join("")).join("");
    const final = series.map((a, i) => `<span class="gv-key"><svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="${styles[i].stroke}" stroke-width="2.6"${styles[i].dash}/></svg>${styles[i].name} ${(a.length ? a[a.length - 1].v : 0).toFixed(2)} xG</span>`).join("");
    return `<div class="detail-h3" data-gv-sec="maps">Expected goals timeline</div>
      <div class="gv-keys">${final}</div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative expected goals over the game" style="width:100%;height:auto;display:block;max-width:760px">${grid}${bounds}${lines}${goals}${plabels}</svg>
      <div class="panel-caption">Running total of each team's expected goals through the game. Circles mark goals, so a circle sitting above or below the line shows a goal that was more or less likely than the chance suggested. The situation filter applies; the period filter does not.</div>`;
  }

  // The Game Score points earned in the filtered slice. The server stores them per cell ("gsc"), so the page only adds them up. Used only when a
  // filter is active; the unfiltered view shows the stored Game Score (which also includes flurry/score-state adjusted xG and uses 5v5-only on-ice terms).
  function sliceScore(v) { return v.gsc; }

  // sum the cells that fall in the selected periods x situations
  function sum(cells, fields, periodIdx, sitIdx) {
    const out = new Array(fields.length).fill(0);
    for (const k in cells || {}) {
      const c = +k, p = Math.floor(c / 5), s = c % 5;
      if (periodIdx.includes(p) && sitIdx.includes(s)) cells[k].forEach((x, i) => { out[i] += x; });
    }
    return out;
  }
  const named = (arr, fields) => Object.fromEntries(fields.map((f, i) => [f, arr[i]]));

  // ---- hover card for shots: one floating element shared by every box score on the page. Shows on hover, and on
  // focus or tap so it also works without a mouse. data-tip is "player|period time|xG|danger band|result".
  let tipEl = null, scrollWired = false;
  function wireTooltips(root) {
    const tip = () => {
      if (!tipEl) { tipEl = document.createElement("div"); tipEl.className = "gv-tip"; tipEl.setAttribute("role", "tooltip"); document.body.appendChild(tipEl); }
      return tipEl;
    };
    const show = (c, x, y) => {
      const [who, when, xg, band, result] = c.dataset.tip.split("|");
      const t = tip();
      t.innerHTML = `<strong>${escapeHtml(who)}</strong><span>${escapeHtml(when)} &middot; ${escapeHtml(result)}</span><span>xG ${escapeHtml(xg)} &middot; ${escapeHtml(band.toLowerCase())}</span>`;
      t.style.display = "block";
      const w = t.offsetWidth, h = t.offsetHeight;
      t.style.left = Math.max(6, Math.min(x + 14, window.innerWidth - w - 6)) + "px";
      t.style.top = Math.max(6, Math.min(y + 14, window.innerHeight - h - 6)) + "px";
    };
    const hide = () => { if (tipEl) tipEl.style.display = "none"; };
    const at = (ev) => ev.target.closest && ev.target.closest("circle.gv-shot");
    root.addEventListener("mouseover", (ev) => { const c = at(ev); if (c) show(c, ev.clientX, ev.clientY); });
    root.addEventListener("mousemove", (ev) => { const c = at(ev); if (c) show(c, ev.clientX, ev.clientY); });
    root.addEventListener("mouseout", (ev) => { if (at(ev)) hide(); });
    root.addEventListener("focusin", (ev) => { const c = at(ev); if (c) { const r = c.getBoundingClientRect(); show(c, r.right, r.bottom); } });
    root.addEventListener("focusout", hide);
    root.addEventListener("click", (ev) => { const c = at(ev); if (c) show(c, ev.clientX, ev.clientY); else hide(); });
    if (!scrollWired) { scrollWired = true; window.addEventListener("scroll", hide, { passive: true }); }
  }


  // ---- game story: the four questions a recap should answer at a glance. Everything here is whole-game and ignores
  // the period/situation filters, like the linescore.
  // 1) Who deserved to win? Each unblocked shot is a chance to score worth its xG, so a team's goals are a sum of
  //    independent chances; the distribution of that sum for both teams gives the odds the game would have gone each way.
  function goalDistribution(xgs) {
    let d = [1];
    for (const x of xgs) {
      const nd = new Array(d.length + 1).fill(0);
      for (let k = 0; k < d.length; k++) { nd[k] += d[k] * (1 - x); nd[k + 1] += d[k] * x; }
      d = nd;
    }
    return d;
  }
  // [P(away wins in regulation), P(tie after regulation), P(home wins in regulation)] from regulation shots
  function regulationOdds(shots) {
    const da = goalDistribution(shots.filter(s => s[0] <= 3 && s[2] === 0 && isChance(s)).map(chanceXg));
    const dh = goalDistribution(shots.filter(s => s[0] <= 3 && s[2] === 1 && isChance(s)).map(chanceXg));
    let a = 0, t = 0, h = 0;
    for (let i = 0; i < da.length; i++) for (let j = 0; j < dh.length; j++) { const p = da[i] * dh[j]; if (i > j) a += p; else if (i === j) t += p; else h += p; }
    return [a, t, h];
  }
  // 2) A power play or penalty kill's night is judged on the chances it created or allowed, not on whether a goal
  //    went in: expected goals against what the league's average power play makes from the same time (8.1 xG per 60),
  //    scaled by the usual spread for that much time. z >= 0.29 is a good night (top quarter of nights), >= 0.72 great.
  const LEAGUE_PP_XG60 = 8.12;
  function nightRating(surplus, expected) {
    const z = surplus / Math.sqrt(Math.max(expected, 0.05));
    return z >= 0.72 ? ["Great night", "pos"] : z >= 0.29 ? ["Good night", "pos"] : z > -0.36 ? ["Average night", ""] : z > -0.55 ? ["Poor night", "neg"] : ["Bad night", "neg"];
  }


  // ---- shareable game score card: a 1080-wide image of one team's night (final and expected score, the shot-quality
  // verdict, every skater's stats and Game Score, best line and pair, and the power play / penalty kill nights).
  // Drawn as SVG so it can be shown on the page and also saved as a PNG; colors are fixed so it looks the same anywhere.
  const CARD = { bg: "#0b1c2c", band: "#12304a", ink: "#eef5fb", muted: "#8ea6b9", accent: "#8cc8f0", good: "#4fbf85", bad: "#e2766c", row: "#10273a" };
  // the Shift Score mark in the corner of every card: the same image the page header shows, with a thin light outline so its navy
  // edge doesn't disappear into the card's dark band
  function cardMark(x, y, h) {
    const el = typeof document !== "undefined" && document.querySelector("h1 .brand-mark"), uri = el && el.src;
    if (!uri || uri.indexOf("data:") !== 0) return "";
    const w = Math.round(h * 1.3);
    return `<defs><filter id="ssHalo" x="-25%" y="-25%" width="150%" height="150%"><feMorphology in="SourceAlpha" operator="dilate" radius="1.6" result="d"/><feFlood flood-color="#eaf4fc" result="c"/><feComposite in="c" in2="d" operator="in" result="o"/><feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <image href="${uri}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" filter="url(#ssHalo)"/>`;
  }
  function cardVerdict(g, shots) {
    // plain-text verdict and win odds for the card (the page's version formats the same logic as HTML)
    if (!shots.length) return { text: "", wa: 0.5, wh: 0.5 };
    const [pa, pt, ph] = regulationOdds(shots), wa = pa + pt / 2, wh = ph + pt / 2;
    const fav = wa >= wh ? "away" : "home", dog = fav === "away" ? "home" : "away", pf = Math.max(wa, wh), strong = pf >= 0.7, edge = pf >= 0.55;
    const winner = g.as === g.hs ? null : g.as > g.hs ? "away" : "home", T = { away: g.away, home: g.home };
    const live = g.live && (g.live.state === "LIVE" || g.live.state === "CRIT");
    let text;
    if (live) text = edge ? `${T[fav]} ahead on shot quality` : "Even so far on shot quality";
    else if (!edge) text = winner ? `A toss-up on chances; ${T[winner]} won` : "A toss-up on chances";
    else if (winner === fav) text = strong ? `${T[fav]} won and deserved it` : `${T[fav]} won with a modest edge in chances`;
    else text = strong ? `${T[fav]} outplayed ${T[dog]} but lost` : `${T[dog]} won a game ${T[fav]} slightly out-chanced`;
    return { text, wa, wh };
  }
  function cardNight(g, side, kind) {
    const opp = side === "away" ? "home" : "away", cells = kind === "pp" ? g.tc[side] : g.tc[opp];
    const t = named(sum(cells, TF, [0, 1, 2, 3], [2]), TF), exp = LEAGUE_PP_XG60 * t.toi / 3600;
    if (t.toi < 60) return null;
    const [label, cls] = nightRating(kind === "pp" ? t.xgf - exp : exp - t.xgf, exp);
    return { label, cls, xg: t.xgf, exp, goals: t.goals, toi: t.toi };
  }
  // A goalie's grade for the whole game (the same grades as the goalie pages): goals saved above expected, plus whether he relieved a
  // teammate (another goalie on his team faced more shots), and the team's expected goals for the stolen-win / bailed-out tags.
  // null while the game is live or when he faced no shots.
  function gradeForGoalie(g, x) {
    const live = g.live && (g.live.state === "LIVE" || g.live.state === "CRIT");
    if (live) return null;
    const side = x[2] === g.home ? "home" : "away", opp = side === "home" ? "away" : "home", AP = [0, 1, 2, 3], AS = [0, 1, 2, 3, 4];
    const v = named(sum(x[3], GF, AP, AS), GF);
    if (!(v.sf > 0)) return null;
    // relief = he did not start. The starter is flagged by the server (the goalie in net at the opening faceoff); a game shard without the flag falls back
    // to "another goalie on his team faced more shots"
    const relief = x[4] !== undefined ? !x[4] : g.gl.some(y => y[2] === x[2] && y[0] !== x[0] && named(sum(y[3], GF, AP, AS), GF).sf > v.sf);
    const winner = g.hs === g.as ? null : (g.as > g.hs ? "away" : "home");
    const gsax = v.xga - v.ga, o = { gsax, relief, win: winner === side, txf: teamXg(g.shots, side === "away" ? 0 : 1), txa: teamXg(g.shots, side === "away" ? 1 : 0) };
    return { gr: goalieGrade(gsax), tags: goalieTags(o), sf: v.sf, ga: v.ga, gsax, relief };
  }
  function gameCardSvg(g, side, logoUri) {
    const team = g[side], opp = side === "away" ? g.home : g.away, W = 1080, shots = g.shots || [];
    const pctOf = (a, b) => (a + b > 0 ? (100 * a / (a + b)).toFixed(1) : "&ndash;");
    const verdict = cardVerdict(g, shots);
    const rows = [];
    g.sk[side].forEach(r => {
      const v = named(sum(r[8], PF, [0, 1, 2, 3], [0, 1, 2, 3, 4]), PF);
      if (!v.toi && !v.g && !v.sog) return;
      const hasAdj = r[6] !== null && r[6] !== undefined, hasRaw = r[3] !== null && r[3] !== undefined;
      rows.push({ name: r[1], pos: r[2], v, score: hasAdj ? r[6] : (hasRaw ? r[3] : sliceScore(v)), est: !hasAdj && !hasRaw });
    });
    rows.sort((a, b) => b.score - a.score);
    const rh = rows.length > 20 ? 38 : 42, tableTop = 508, tableEnd = tableTop + rows.length * rh;
    // summary lines under the table
    const lines = [];
    const best = (type, label) => {
      const us = g.units.filter(u => u[0] === team && u[1] === type && u[2] >= 180).sort((a, b) => b[12] - a[12]);
      if (us.length) { const u = us[0]; lines.push([label, u[3].map(id => (g.sk[side].find(r => r[0] === id) || [0, "?"])[1].split(" ").slice(-1)[0]).join(", "), `${u[12] > 0 ? "+" : ""}${u[12].toFixed(2)}`, u[12] >= 0 ? CARD.good : CARD.bad]); }
    };
    best("line", "Best line"); best("pair", "Best pair");
    // the team's goalies, starter first: shots, goals, goals saved above expected, and the grade on the right
    g.gl.filter(x => x[2] === team).map(x => ({ x, gg: gradeForGoalie(g, x) })).filter(o => o.gg).sort((a, b) => (a.gg.relief - b.gg.relief) || (b.gg.sf - a.gg.sf)).forEach(({ x, gg }, i) => {
      const name = x[1].split(" ").slice(-1)[0], extra = gg.tags.filter(t => t !== "Relief").map(t => `  \u00b7  ${t}`).join("");
      lines.push([i === 0 && !gg.relief ? "Goalie" : "Relief", `${name}: ${gg.sf} shots, ${gg.ga} goal${gg.ga === 1 ? "" : "s"}, ${gg.gsax > 0 ? "+" : ""}${gg.gsax.toFixed(2)} vs expected${extra}`,
        GRADE_LABEL[gg.gr].toUpperCase(), gg.gr === "great" || gg.gr === "quality" ? CARD.good : gg.gr === "average" ? CARD.ink : CARD.bad]);
    });
    [["pp", "Power play"], ["pk", "Penalty kill"]].forEach(([k, label]) => {
      const n = cardNight(g, side, k);
      if (n) lines.push([label, `${n.label}: ${n.xg.toFixed(2)} xG ${k === "pp" ? "for" : "against"} (typical ${n.exp.toFixed(2)}), ${n.goals} goal${n.goals === 1 ? "" : "s"}`, "", n.cls === "pos" ? CARD.good : n.cls === "neg" ? CARD.bad : CARD.ink]);
    });
    const sumTop = tableEnd + 62;
    // shot danger: this team's shots and the shots against it, on danger-colored half rinks
    const mine = shots.filter(q => q[2] === (side === "away" ? 0 : 1) && q[6] >= 1 && q[9] !== 1), against = shots.filter(q => q[2] === (side === "away" ? 1 : 0) && q[6] >= 1 && q[9] !== 1);
    const mapTop = sumTop + lines.length * 40 + 64;
    // shots on goal by danger band in each period, for this team and against it (empty net excluded); OT only if a shot was taken there
    const cntBands = (arr, per) => { const r = { h: 0, m: 0, l: 0, g: 0 }; arr.forEach(q => { if (per === 0 ? q[0] <= 4 : q[0] === per) { r[BAND(q)] += 1; r.g += q[6] === 2 ? 1 : 0; } }); return r; };
    const perDefs = [[1, "1ST"], [2, "2ND"], [3, "3RD"], [4, "OT"]].filter(([per]) => per < 4 || mine.concat(against).some(q => q[0] === 4));
    const perRows = [...perDefs.map(([per, label]) => [label, cntBands(mine, per), cntBands(against, per), false]), ["TOTAL", cntBands(mine, 0), cntBands(against, 0), true]];
    const perH = shots.length ? 100 + perRows.length * 38 : 0;
    // goals against expected goals by danger band, for this team's shots and the shots against it, shaded like the game page's shot danger card:
    // green with a triangle up when the goals beat the expected goals from those shots, red with a triangle down when they fell short, the darkest
    // shade for an unusual gap (judged against the size of the expectation, so ordinary bounces stay pale)
    const dzBands = [["h", "HIGH", "14%+", CARD.bad], ["m", "MEDIUM", "7-14%", CARD.accent], ["l", "LOW", "under 7%", CARD.muted]];
    const dzOf = (arr, b) => { const q = arr.filter(x => (b === "t" ? true : BAND(x) === b)); return [q.length, q.filter(x => x[6] === 2).length, q.reduce((a, x) => a + (x[10] != null ? x[10] : x[5]), 0)]; };
    const dzH = shots.length ? 312 : 0;
    const dzSvg = shots.length ? (() => {
      const f = 'font-family="Helvetica Neue, Helvetica, Arial, sans-serif"', y1 = mapTop + 62, cx = [366, 558, 750, 942], cw = 180, rowH = 92;
      const heads = [...dzBands, ["t", "TOTAL", "shots on goal", CARD.ink]].map(([, name, rule, col], i) =>
        `<text x="${cx[i]}" y="${y1 + 16}" text-anchor="middle" font-size="17" font-weight="800" letter-spacing="1.5" fill="${col}" ${f}>${name}</text><text x="${cx[i]}" y="${y1 + 36}" text-anchor="middle" font-size="14" fill="${CARD.muted}" ${f}>${rule}</text>`).join("");
      const rowsSvg = [[mine, `${team} shots`], [against, `${opp} shots`]].map(([arr, label], r) => {
        const top = y1 + 48 + r * (rowH + 6);
        const cells = [...dzBands.map(b => b[0]), "t"].map((b, i) => {
          const [n, gl, xg] = dzOf(arr, b), d = gl - xg, z = d / Math.sqrt(Math.max(xg, 0.5)), on = Math.abs(z) >= 0.75 && Math.abs(d) >= 0.3;
          const sh = 0.14 + 0.30 * Math.min(1, (Math.abs(z) - 0.75) / 1.5), col = d > 0 ? CARD.good : CARD.bad;
          return `<rect x="${cx[i] - cw / 2}" y="${top}" width="${cw}" height="${rowH}" rx="12" fill="${on ? col : CARD.row}" fill-opacity="${on ? sh.toFixed(2) : 1}"/>
            <text x="${cx[i]}" y="${top + 38}" text-anchor="middle" font-size="34" font-weight="800" fill="${CARD.ink}" ${f}>${n}</text>
            <text x="${cx[i]}" y="${top + 62}" text-anchor="middle" font-size="17" fill="${CARD.muted}" ${f}>${gl} G &#183; ${xg.toFixed(2)} xG</text>
            ${on ? `<text x="${cx[i]}" y="${top + 82}" text-anchor="middle" font-size="15" font-weight="800" fill="${col}" ${f}>${d > 0 ? "&#9650;" : "&#9660;"} ${Math.abs(d).toFixed(1)} ${d > 0 ? "over" : "under"}</text>` : ""}`;
        }).join("");
        return `<text x="56" y="${top + 42}" font-size="21" font-weight="800" fill="${CARD.ink}" ${f}>${escapeHtml(label)}</text>${cells}`;
      }).join("");
      return `${heads}${rowsSvg}<text x="56" y="${y1 + 48 + 2 * (rowH + 6) + 18}" font-size="15" fill="${CARD.muted}" ${f}>xG: the summed chance each shot on goal had of scoring. Green &#9650;: scored more than expected from those shots; red &#9660;: fewer.</text>
        <text x="56" y="${y1 + 48 + 2 * (rowH + 6) + 38}" font-size="15" fill="${CARD.muted}" ${f}>The darker the shade, the bigger the gap. On the maps, big circles are better chances and a ring marks a goal.</text>`;
    })() : "";
    const mapFor = cardShotMap(mine, 40, mapTop + 44 + perH + dzH, 476, `${team} shots on goal (by danger)`), mapAg = cardShotMap(against, 564, mapTop + 44 + perH + dzH, 476, `Shots against ${team}`);
    const perSvg = shots.length ? (() => {
      const f = 'font-family="Helvetica Neue, Helvetica, Arial, sans-serif"', y0 = mapTop + 70 + dzH, cf = [330, 410, 490, 580], ca = [740, 820, 900, 990];
      const colr = [CARD.bad, CARD.accent, CARD.muted, CARD.ink];
      const heads = (xs) => ["H", "M", "L", "G"].map((t, i) => `<text x="${xs[i]}" y="${y0 + 32}" text-anchor="end" font-size="17" font-weight="800" letter-spacing="1" fill="${colr[i]}" ${f}>${t}</text>`).join("");
      const cells = (xs, c, y, bold) => [c.h, c.m, c.l, c.g].map((v, i) => `<text x="${xs[i]}" y="${y}" text-anchor="end" font-size="22" font-weight="${bold || i === 3 ? 800 : 400}" fill="${i === 3 ? CARD.ink : colr[i]}" ${f}>${v}</text>`).join("");
      const body = perRows.map(([label, a, b, bold], i) => { const top = y0 + 46 + i * 38, y = top + 27;
        return `${i % 2 === 0 ? `<rect x="30" y="${top}" width="1020" height="36" rx="8" fill="${CARD.row}"/>` : ""}
          <text x="56" y="${y}" font-size="20" font-weight="${bold ? 800 : 700}" letter-spacing="1" fill="${bold ? CARD.ink : CARD.muted}" ${f}>${label}</text>${cells(cf, a, y, bold)}${cells(ca, b, y, bold)}`; }).join("");
      return `<text x="455" y="${y0}" text-anchor="middle" font-size="19" font-weight="800" letter-spacing="2" fill="${CARD.accent}" ${f}>${escapeHtml(team)} SHOTS ON GOAL</text>
        <text x="865" y="${y0}" text-anchor="middle" font-size="19" font-weight="800" letter-spacing="2" fill="${CARD.accent}" ${f}>AGAINST ${escapeHtml(team)}</text>
        ${heads(cf)}${heads(ca)}<line x1="640" y1="${y0 - 20}" x2="640" y2="${y0 + 46 + perRows.length * 38}" stroke="${CARD.muted}" stroke-width="1" opacity="0.5"/>${body}`;
    })() : "";
    const dangerBlock = shots.length ? `<text x="56" y="${mapTop + 6}" font-size="26" font-weight="800" fill="${CARD.accent}" letter-spacing="2" ${'font-family="Helvetica Neue, Helvetica, Arial, sans-serif"'}>SHOT DANGER</text>
      <text x="56" y="${mapTop + 32}" font-size="17" fill="${CARD.muted}" ${'font-family="Helvetica Neue, Helvetica, Arial, sans-serif"'}>Every shot on goal (empty net excluded) by chance of scoring: high 14%+, medium 7-14%, low under 7%.</text>
      ${dzSvg}${perSvg}${mapFor.svg}${mapAg.svg}` : "";
    const H = Math.ceil(Math.max(1350, (shots.length ? mapTop + 44 + perH + dzH + mapFor.height + 150 : sumTop + lines.length * 40 + 150)));
    const esc = escapeHtml, font = 'font-family="Helvetica Neue, Helvetica, Arial, sans-serif"';
    // the key to the Game Score colors, under the skater table
    const keyX = [250, 336, 410, 540, 652, 724, 806], keyY = tableEnd + 26;
    const scoreKey = `<text x="56" y="${keyY + 5}" font-size="13" letter-spacing="1.2" fill="${CARD.muted}" ${font}>GAME SCORE COLORS</text>`
      + GS_TIER_NAME.map((n, i) => `<circle cx="${keyX[i]}" cy="${keyY}" r="7" fill="${GS_CARD_COLORS[i]}"/><text x="${keyX[i] + 13}" y="${keyY + 5}" font-size="15" fill="${CARD.muted}" ${font}>${n}</text>`).join("")
      + `<text x="1030" y="${keyY + 5}" text-anchor="end" font-size="13" fill="${CARD.muted}" ${font}>vs all skater games</text>`;
    const live = g.live && (g.live.state === "LIVE" || g.live.state === "CRIT");
    const status = live ? (g.live.status || "LIVE") : g.oc === "REG" ? "FINAL" : "FINAL/" + g.oc;
    const xa = teamXg(g.shots, 0), xh = teamXg(g.shots, 1);
    const logo = (abbr, x) => (logoUri && logoUri[abbr] ? `<image href="${logoUri[abbr]}" x="${x}" y="108" width="130" height="130" preserveAspectRatio="xMidYMid meet"/>` : `<text x="${x + 65}" y="196" text-anchor="middle" font-size="44" font-weight="800" fill="${CARD.accent}" ${font}>${esc(abbr)}</text>`);
    const body = rows.map((r, i) => {
      const y = tableTop + i * rh, mid = y + rh * 0.68, col = r.est ? (r.score >= 0 ? CARD.good : CARD.bad) : gsColor(r.score, "adj");
      const xgf = String(pctOf(r.v.xgf, r.v.xga)).replace("&ndash;", "-"), hd = r.v.hdcf - r.v.hdca;
      const t = (x, txt, size = 21, fill = CARD.ink, weight = 400) => `<text x="${x}" y="${mid}" text-anchor="end" font-size="${size}" font-weight="${weight}" fill="${fill}" ${font}>${txt}</text>`;
      return `${i % 2 === 0 ? `<rect x="30" y="${y}" width="1020" height="${rh}" rx="8" fill="${CARD.row}"/>` : ""}
        <text x="46" y="${mid}" font-size="22" fill="${CARD.ink}" ${font}>${esc(r.name)}</text>
        <text x="326" y="${mid}" font-size="15" fill="${CARD.muted}" ${font}>${esc(r.pos)}</text>
        ${t(440, toiStr(r.v.toi))}${t(490, r.v.g)}${t(540, r.v.a1)}${t(590, r.v.a2)}${t(645, r.v.sog)}${t(712, r.v.ixg.toFixed(2))}
        ${t(805, `<tspan fill="${CARD.bad}">${r.v.ihd}</tspan>-<tspan fill="${CARD.accent}">${r.v.imd}</tspan>-<tspan fill="${CARD.muted}">${r.v.ild}</tspan>`, 20)}
        ${t(865, (hd > 0 ? "+" : "") + hd, 21, hd > 0 ? CARD.good : hd < 0 ? CARD.bad : CARD.muted, 700)}${t(927, xgf)}
        ${t(1038, `${r.score > 0 ? "+" : ""}${r.score.toFixed(2)}${r.est ? "*" : ""}`, 24, col, 800)}`;
    }).join("");
    const heads = [["PLAYER", 46, "start"], ["TOI", 440, "end"], ["G", 490, "end"], ["A1", 540, "end"], ["A2", 590, "end"], ["SOG", 645, "end"], ["ixG", 712, "end"], ["H-M-L", 805, "end"], ["HD +/-", 865, "end"], ["xGF%", 927, "end"], ["GAME SCORE", 1038, "end"]]
      .map(([t, x, a]) => `<text x="${x}" y="${tableTop - 12}" text-anchor="${a}" font-size="14" letter-spacing="1.2" fill="${CARD.muted}" ${font}>${t}</text>`).join("");
    const summary = lines.map(([label, what, val, col], i) => {
      const y = sumTop + 30 + i * 40;
      return `<text x="56" y="${y}" font-size="21" font-weight="700" fill="${CARD.accent}" ${font}>${esc(label.toUpperCase())}</text>
        <text x="236" y="${y}" font-size="22" fill="${val ? CARD.ink : col}" font-weight="${val ? 400 : 700}" ${font}>${esc(what)}</text>
        ${val ? `<text x="1030" y="${y}" text-anchor="end" font-size="22" font-weight="800" fill="${col}" ${font}>${esc(val)}</text>` : ""}`;
    }).join("");
    const wa = Math.round(100 * verdict.wa), wh = 100 - wa;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <rect width="${W}" height="${H}" fill="${CARD.bg}"/>
      <rect width="${W}" height="430" fill="${CARD.band}"/>
      ${cardMark(48, 14, 56)}<text x="136" y="62" font-size="26" font-weight="800" letter-spacing="4" fill="${CARD.accent}" ${font}>SHIFT SCORE</text>
      <text x="1032" y="62" text-anchor="end" font-size="24" fill="${CARD.muted}" ${font}>${esc(g.date || "")}</text>
      ${logo(g.away, 56)}${logo(g.home, 894)}
      <text x="372" y="214" text-anchor="middle" font-size="124" font-weight="800" fill="${CARD.ink}" ${font}>${g.as}</text>
      <text x="540" y="200" text-anchor="middle" font-size="56" fill="${CARD.muted}" ${font}>&#8211;</text>
      <text x="708" y="214" text-anchor="middle" font-size="124" font-weight="800" fill="${CARD.ink}" ${font}>${g.hs}</text>
      <text x="540" y="262" text-anchor="middle" font-size="24" letter-spacing="3" fill="${CARD.muted}" ${font}>${esc(g.away)} AT ${esc(g.home)} &#183; ${esc(status)}</text>
      <text x="540" y="312" text-anchor="middle" font-size="30" fill="${CARD.ink}" ${font}>Expected score (xG)  <tspan font-weight="800">${xa.toFixed(1)} &#8211; ${xh.toFixed(1)}</tspan></text>
      <text x="540" y="356" text-anchor="middle" font-size="28" font-weight="700" fill="${CARD.accent}" ${font}>${esc(verdict.text)}</text>
      <rect x="56" y="374" width="${(968 * verdict.wa).toFixed(1)}" height="10" rx="5" fill="${CARD.accent}"/>
      <rect x="${(56 + 968 * verdict.wa).toFixed(1)}" y="374" width="${(968 * verdict.wh).toFixed(1)}" height="10" rx="5" fill="${CARD.muted}"/>
      <text x="56" y="414" font-size="17" fill="${CARD.muted}" ${font}>${esc(g.away)} ${wa}%</text>
      <text x="1024" y="414" text-anchor="end" font-size="17" fill="${CARD.muted}" ${font}>${wh}% ${esc(g.home)}  chance to win on shot quality</text>
      <text x="56" y="474" font-size="30" font-weight="800" fill="${CARD.ink}" ${font}>${esc(team)} skaters <tspan font-weight="400" font-size="20" fill="${CARD.muted}">vs ${esc(opp)}</tspan></text>
      ${heads}${body}${scoreKey}${summary}${dangerBlock}
      <text x="56" y="${H - 84}" font-size="15" fill="${CARD.muted}" ${font}>H-M-L: his shots on goal by danger.  ixG: expected goals on them.  HD +/-: high-danger shots on goal for minus against while he was on.</text>
      <text x="56" y="${H - 62}" font-size="15" fill="${CARD.muted}" ${font}>Game Score is Adjusted: raw plus credit for the competition, minus his position's average (0 is average).  xGF%: team's xG share while he's on.${rows.some(r => r.est) ? "  * estimated so far." : ""}</text>
      <text x="56" y="${H - 40}" font-size="15" fill="${CARD.muted}" ${font}>Shot-quality odds ignore the goalie and score effects.  A1 / A2: primary and secondary assists.  Source: NHL play-by-play and shift data.</text>
      <text x="56" y="${H - 18}" font-size="15" fill="${CARD.muted}" ${font}>Goalie grade (goals saved above expected): Great over +1.5, Quality +0.5 to +1.5, Average within 0.5, Bad -0.5 to -1.5, Blown worse.</text>
    </svg>`;
  }
  // ---- the card set for a finished game: a table of every skater for both teams, a Game Score bar graph per team, and the lines, pairs and
  // goalie grades per team. (The full game card, with shot danger and special teams, is still on the game page.) Shared building blocks first.
  const CARD_FONT = 'font-family="Helvetica Neue, Helvetica, Arial, sans-serif"';
  const cardStatus = (g) => ((g.live && (g.live.state === "LIVE" || g.live.state === "CRIT")) ? (g.live.status || "LIVE") : g.oc === "REG" ? "FINAL" : "FINAL/" + g.oc);
  // one team's skaters with their stats and Game Score, best first (the same numbers as the full game card)
  function cardSkaterRows(g, side) {
    const rows = [];
    g.sk[side].forEach(r => {
      const v = named(sum(r[8], PF, [0, 1, 2, 3], [0, 1, 2, 3, 4]), PF);
      if (!v.toi && !v.g && !v.sog) return;
      const hasAdj = r[6] !== null && r[6] !== undefined, hasRaw = r[3] !== null && r[3] !== undefined;
      // r[10]: [offense, defense, faceoffs and penalties] points; with the competition / position adjustment (adj - raw) they add up to the Adjusted score
      const parts = hasAdj && hasRaw && Array.isArray(r[10]) ? [r[10][0], r[10][1], r[10][2], r[6] - r[3]] : null;
      rows.push({ name: r[1], pos: r[2], v, parts, score: hasAdj ? r[6] : (hasRaw ? r[3] : sliceScore(v)), est: !hasAdj && !hasRaw });
    });
    return rows.sort((a, b) => b.score - a.score);
  }
  // the band at the top of a card about one team: logo, title, the score from that team's side, and a line about what the card shows
  function cardTeamHeader(g, side, logoUri, title, sub) {
    const team = g[side], opp = side === "away" ? g.home : g.away, esc = escapeHtml, font = CARD_FONT;
    const mine = side === "away" ? g.as : g.hs, theirs = side === "away" ? g.hs : g.as;
    const logo = logoUri && logoUri[team] ? `<image href="${logoUri[team]}" x="56" y="92" width="130" height="130" preserveAspectRatio="xMidYMid meet"/>` : `<text x="121" y="180" text-anchor="middle" font-size="44" font-weight="800" fill="${CARD.accent}" ${font}>${esc(team)}</text>`;
    return `<rect width="1080" height="250" fill="${CARD.band}"/>
      ${cardMark(48, 14, 56)}<text x="136" y="62" font-size="26" font-weight="800" letter-spacing="4" fill="${CARD.accent}" ${font}>SHIFT SCORE</text>
      <text x="1032" y="62" text-anchor="end" font-size="24" fill="${CARD.muted}" ${font}>${esc(g.date || "")}</text>
      ${logo}
      <text x="210" y="150" font-size="46" font-weight="800" fill="${CARD.ink}" ${font}>${esc(title)}</text>
      <text x="210" y="196" font-size="26" fill="${CARD.muted}" ${font}>${esc(team)} ${mine}, ${esc(opp)} ${theirs} &#183; ${esc(cardStatus(g))} &#183; ${g.away} at ${g.home}</text>
      <text x="210" y="232" font-size="20" fill="${CARD.muted}" ${font}>${esc(sub)}</text>`;
  }
  // the band at the top of a card about the whole game (both logos, the score, expected score, verdict and win odds)
  function cardTopBand(g, logoUri) {
    const font = CARD_FONT, esc = escapeHtml, verdict = cardVerdict(g, g.shots || []);
    const xa = teamXg(g.shots, 0), xh = teamXg(g.shots, 1), wa = Math.round(100 * verdict.wa), wh = 100 - wa;
    const logo = (abbr, x) => (logoUri && logoUri[abbr] ? `<image href="${logoUri[abbr]}" x="${x}" y="108" width="130" height="130" preserveAspectRatio="xMidYMid meet"/>` : `<text x="${x + 65}" y="196" text-anchor="middle" font-size="44" font-weight="800" fill="${CARD.accent}" ${font}>${esc(abbr)}</text>`);
    return `<rect width="1080" height="430" fill="${CARD.band}"/>
      ${cardMark(48, 14, 56)}<text x="136" y="62" font-size="26" font-weight="800" letter-spacing="4" fill="${CARD.accent}" ${font}>SHIFT SCORE</text>
      <text x="1032" y="62" text-anchor="end" font-size="24" fill="${CARD.muted}" ${font}>${esc(g.date || "")}</text>
      ${logo(g.away, 56)}${logo(g.home, 894)}
      <text x="372" y="214" text-anchor="middle" font-size="124" font-weight="800" fill="${CARD.ink}" ${font}>${g.as}</text>
      <text x="540" y="200" text-anchor="middle" font-size="56" fill="${CARD.muted}" ${font}>&#8211;</text>
      <text x="708" y="214" text-anchor="middle" font-size="124" font-weight="800" fill="${CARD.ink}" ${font}>${g.hs}</text>
      <text x="540" y="262" text-anchor="middle" font-size="24" letter-spacing="3" fill="${CARD.muted}" ${font}>${esc(g.away)} AT ${esc(g.home)} &#183; ${esc(cardStatus(g))}</text>
      <text x="540" y="312" text-anchor="middle" font-size="30" fill="${CARD.ink}" ${font}>Expected score (xG)  <tspan font-weight="800">${xa.toFixed(1)} &#8211; ${xh.toFixed(1)}</tspan></text>
      <text x="540" y="356" text-anchor="middle" font-size="28" font-weight="700" fill="${CARD.accent}" ${font}>${esc(verdict.text)}</text>
      <rect x="56" y="374" width="${(968 * verdict.wa).toFixed(1)}" height="10" rx="5" fill="${CARD.accent}"/>
      <rect x="${(56 + 968 * verdict.wa).toFixed(1)}" y="374" width="${(968 * verdict.wh).toFixed(1)}" height="10" rx="5" fill="${CARD.muted}"/>
      <text x="56" y="414" font-size="17" fill="${CARD.muted}" ${font}>${esc(g.away)} ${wa}%</text>
      <text x="1024" y="414" text-anchor="end" font-size="17" fill="${CARD.muted}" ${font}>${wh}% ${esc(g.home)}  chance to win on shot quality</text>`;
  }
  // the color key for the seven tiers, on one line at y
  function cardTierKey(y, label, what) {
    const font = CARD_FONT, keyX = [250, 336, 410, 540, 652, 724, 806];
    return `<text x="56" y="${y + 5}" font-size="13" letter-spacing="1.2" fill="${CARD.muted}" ${font}>${label}</text>`
      + GS_TIER_NAME.map((n, i) => `<circle cx="${keyX[i]}" cy="${y}" r="7" fill="${GS_CARD_COLORS[i]}"/><text x="${keyX[i] + 13}" y="${y + 5}" font-size="15" fill="${CARD.muted}" ${font}>${n}</text>`).join("")
      + (what ? `<text x="1030" y="${y + 5}" text-anchor="end" font-size="13" fill="${CARD.muted}" ${font}>${what}</text>` : "");
  }
  const cardNotes = (lines, H) => lines.map((t, k) => `<text x="56" y="${H - 22 * lines.length + 4 + k * 22}" font-size="15" fill="${CARD.muted}" ${CARD_FONT}>${escapeHtml(t)}</text>`).join("");

  // ---- card 1: every skater's stats and Game Score, both teams, one image
  function skaterTableSvg(rows, team, opp, top) {
    const esc = escapeHtml, font = CARD_FONT, rh = rows.length > 20 ? 38 : 42, tableTop = top + 34;
    const pctOf = (a, b) => (a + b > 0 ? (100 * a / (a + b)).toFixed(1) : "&ndash;");
    const body = rows.map((r, i) => {
      const y = tableTop + i * rh, mid = y + rh * 0.68, col = r.est ? (r.score >= 0 ? CARD.good : CARD.bad) : gsColor(r.score, "adj");
      const xgf = String(pctOf(r.v.xgf, r.v.xga)).replace("&ndash;", "-"), hd = r.v.hdcf - r.v.hdca;
      const t = (x, txt, size = 21, fill = CARD.ink, weight = 400) => `<text x="${x}" y="${mid}" text-anchor="end" font-size="${size}" font-weight="${weight}" fill="${fill}" ${font}>${txt}</text>`;
      return `${i % 2 === 0 ? `<rect x="30" y="${y}" width="1020" height="${rh}" rx="8" fill="${CARD.row}"/>` : ""}
        <text x="46" y="${mid}" font-size="22" fill="${CARD.ink}" ${font}>${esc(r.name)}</text>
        <text x="326" y="${mid}" font-size="15" fill="${CARD.muted}" ${font}>${esc(r.pos)}</text>
        ${t(440, toiStr(r.v.toi))}${t(490, r.v.g)}${t(540, r.v.a1)}${t(590, r.v.a2)}${t(645, r.v.sog)}${t(712, r.v.ixg.toFixed(2))}
        ${t(805, `<tspan fill="${CARD.bad}">${r.v.ihd}</tspan>-<tspan fill="${CARD.accent}">${r.v.imd}</tspan>-<tspan fill="${CARD.muted}">${r.v.ild}</tspan>`, 20)}
        ${t(865, (hd > 0 ? "+" : "") + hd, 21, hd > 0 ? CARD.good : hd < 0 ? CARD.bad : CARD.muted, 700)}${t(927, xgf)}
        ${t(1038, `${r.score > 0 ? "+" : ""}${r.score.toFixed(2)}${r.est ? "*" : ""}`, 24, col, 800)}`;
    }).join("");
    const heads = [["PLAYER", 46, "start"], ["TOI", 440, "end"], ["G", 490, "end"], ["A1", 540, "end"], ["A2", 590, "end"], ["SOG", 645, "end"], ["ixG", 712, "end"], ["H-M-L", 805, "end"], ["HD +/-", 865, "end"], ["xGF%", 927, "end"], ["GAME SCORE", 1038, "end"]]
      .map(([t, x, a]) => `<text x="${x}" y="${tableTop - 12}" text-anchor="${a}" font-size="14" letter-spacing="1.2" fill="${CARD.muted}" ${font}>${t}</text>`).join("");
    return { svg: `<text x="56" y="${top}" font-size="30" font-weight="800" fill="${CARD.ink}" ${font}>${esc(team)} skaters <tspan font-weight="400" font-size="20" fill="${CARD.muted}">vs ${esc(opp)}</tspan></text>${heads}${body}`, end: tableTop + rows.length * rh };
  }
  function tableCardSvg(g, logoUri) {
    const W = 1080, rowsA = cardSkaterRows(g, "away"), rowsH = cardSkaterRows(g, "home");
    const a = skaterTableSvg(rowsA, g.away, g.home, 474), h = skaterTableSvg(rowsH, g.home, g.away, a.end + 78);
    const keyY = h.end + 34, H = keyY + 128;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <rect width="${W}" height="${H}" fill="${CARD.bg}"/>
      ${cardTopBand(g, logoUri)}${a.svg}${h.svg}${cardTierKey(keyY, "GAME SCORE COLORS", "vs all skater games")}
      ${cardNotes(["H-M-L: his shots on goal by danger.  ixG: expected goals on them.  HD +/-: high-danger shots on goal for minus against while he was on.",
        "Game Score is Adjusted: raw plus credit for the competition faced, minus the average for his position (0 is average).",
        "xGF%: the team's share of expected goals with him on the ice.  A1 / A2: primary and secondary assists.  Source: NHL play-by-play and shift data."], H)}
    </svg>`;
  }

  // ---- card 2: one team's Game Scores as a horizontal bar graph, forwards then defensemen, best first. Each bar is broken out into what he
  // did: offense, defense, faceoffs and penalties, and the competition / position adjustment, stacked from zero (the pieces that add points
  // go right, the ones that cost points go left); a white tick marks where they net out, the Adjusted Game Score, shown at the right.
  const BAR_PARTS = [["Offense", "#4fa8e0"], ["Defense", "#e0a64f"], ["Faceoffs & penalties", "#b58be0"], ["Competition & position", "#7d93a6"]];
  function barsCardSvg(g, side, logoUri) {
    const team = g[side], font = CARD_FONT, esc = escapeHtml, rows = cardSkaterRows(g, side);
    const sections = [["FORWARDS", rows.filter(r => r.pos !== "D")], ["DEFENSEMEN", rows.filter(r => r.pos === "D")]].filter(([, l]) => l.length);
    const stackOf = (r) => (r.parts ? { pos: r.parts.reduce((a, v) => a + Math.max(v, 0), 0), neg: r.parts.reduce((a, v) => a + Math.min(v, 0), 0) } : { pos: Math.max(r.score, 0), neg: Math.min(r.score, 0) });
    const neg = Math.max(2, ...rows.map(r => -stackOf(r).neg)), pos = Math.max(3, ...rows.map(r => stackOf(r).pos));
    const left = 340, right = 950, px = (right - left) / (neg + pos), zeroX = left + neg * px, rh = 52;
    let y = 296; const firstTop = y; let out = "";
    sections.forEach(([title, list]) => {
      out += `<text x="56" y="${y + 6}" font-size="26" font-weight="800" letter-spacing="2" fill="${CARD.accent}" ${font}>${title}</text>`;
      y += 24;
      list.forEach((r, i) => {
        const top = y + i * rh, tier = r.est ? (r.score >= 0 ? CARD.good : CARD.bad) : gsColor(r.score, "adj"), v = r.v;
        const xgf = v.xgf + v.xga > 0 ? (100 * v.xgf / (v.xgf + v.xga)).toFixed(0) + "% xGF" : "";
        let bars = "", xp = zeroX, xn = zeroX;
        if (r.parts) {
          r.parts.forEach((val, k) => {
            const len = Math.abs(val) * px; if (len < 0.5) return;
            const x = val >= 0 ? xp : xn - len;
            bars += `<rect x="${x.toFixed(1)}" y="${top + 9}" width="${len.toFixed(1)}" height="${rh - 18}" fill="${BAR_PARTS[k][1]}" opacity="0.92"/>`;
            if (val >= 0) xp += len; else xn -= len;
          });
        } else {
          const len = Math.abs(r.score) * px;
          bars = `<rect x="${(r.score >= 0 ? zeroX : zeroX - len).toFixed(1)}" y="${top + 9}" width="${Math.max(len, 1).toFixed(1)}" height="${rh - 18}" rx="5" fill="${tier}" opacity="0.9"/>`;
        }
        const netX = zeroX + r.score * px;
        out += `${i % 2 === 0 ? `<rect x="30" y="${top}" width="1020" height="${rh}" rx="8" fill="${CARD.row}"/>` : ""}
          <text x="46" y="${top + 24}" font-size="23" fill="${CARD.ink}" ${font}>${esc(r.name)}</text>
          <text x="46" y="${top + 43}" font-size="14" fill="${CARD.muted}" ${font}>${toiStr(v.toi)}  &#183;  ${v.g}G ${v.a1 + v.a2}A  &#183;  ${v.sog} SOG  &#183;  ${v.ixg.toFixed(2)} ixG${xgf ? "  &#183;  " + xgf : ""}</text>
          ${bars}${r.parts ? `<rect x="${(netX - 2).toFixed(1)}" y="${top + 4}" width="4" height="${rh - 8}" rx="2" fill="#ffffff"/>` : ""}
          <text x="1040" y="${top + 33}" text-anchor="end" font-size="24" font-weight="800" fill="${tier}" ${font}>${r.score > 0 ? "+" : ""}${r.score.toFixed(2)}${r.est ? "*" : ""}</text>`;
      });
      y += list.length * rh + 40;
    });
    const axis = `<line x1="${zeroX}" y1="${firstTop + 14}" x2="${zeroX}" y2="${y - 34}" stroke="${CARD.muted}" stroke-width="1.5" stroke-dasharray="4 5" opacity="0.7"/>
      <text x="${zeroX}" y="${firstTop + 6}" text-anchor="middle" font-size="14" letter-spacing="1.2" fill="${CARD.muted}" ${font}>0</text>
      <text x="1040" y="${firstTop + 6}" text-anchor="end" font-size="14" letter-spacing="1.2" fill="${CARD.muted}" ${font}>GAME SCORE</text>`;
    // the key: what each color is, and the tick
    let kx = 56; const legendY = y + 10;
    const legend = BAR_PARTS.map(([name, col]) => { const x = kx; kx += 40 + name.length * 9.2; return `<rect x="${x}" y="${legendY - 9}" width="18" height="18" fill="${col}"/><text x="${x + 26}" y="${legendY + 5}" font-size="16" fill="${CARD.muted}" ${font}>${esc(name)}</text>`; }).join("")
      + `<rect x="${kx}" y="${legendY - 11}" width="4" height="22" rx="2" fill="#ffffff"/><text x="${kx + 14}" y="${legendY + 5}" font-size="16" fill="${CARD.muted}" ${font}>Net (Adjusted Game Score)</text>`;
    const keyY = legendY + 44, H = keyY + 128;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 ${H}" width="1080" height="${H}">
      <rect width="1080" height="${H}" fill="${CARD.bg}"/>
      ${cardTeamHeader(g, side, logoUri, team + " Game Scores", "What each skater did, stacked to his Adjusted Game Score, best first")}
      ${out}${axis}${legend}${cardTierKey(keyY, "SCORE COLORS", "vs all skater games")}
      ${cardNotes(["Segments to the right added to his Game Score, segments to the left took away; the white tick is where they net out.",
        "Offense: his own scoring and shots and the team's 5v5 chances and goals for while he was on.  Defense: blocks and the same against.",
        "Competition & position: credit for the quality of the opposition, minus the average for a forward or a defenseman (so 0 is average).",
        "Score colors: where the Adjusted score falls among every skater game since 2024-25, top 5% elite, bottom 5% awful."], H)}
    </svg>`;
  }

  // ---- card 3: one team's four forward lines and three defense pairs, ranked by ice time that game, each with its Unit Score and a grade against
  // the same slot in every game since 2024-25 (percentile tiers, colored like the Game Score tiers), then its goalies with their game grades
  function linesCardSvg(g, side, logoUri) {
    const team = g[side], font = CARD_FONT, esc = escapeHtml;
    const last = (id) => { const r = g.sk[side].find(x => x[0] === id); return r ? String(r[1]).split(" ").slice(-1)[0] : "?"; };
    const slots = (type, n, tag) => g.units.filter(u => u[0] === team && u[1] === type).sort((a, b) => b[2] - a[2]).slice(0, n)
      .map((u, i) => ({ slot: tag + (i + 1), u, tier: unitTier(u[12], tag + (i + 1)) }));
    const lines = slots("line", 4, "L"), pairs = slots("pair", 3, "P");
    const goalies = g.gl.filter(x => x[2] === team).map(x => ({ x, gg: gradeForGoalie(g, x) })).filter(o => o.gg).sort((a, b) => (a.gg.relief - b.gg.relief) || (b.gg.sf - a.gg.sf));
    const GC = { great: GS_CARD_COLORS[5], quality: GS_CARD_COLORS[4], average: GS_CARD_COLORS[3], bad: GS_CARD_COLORS[1], blown: GS_CARD_COLORS[0] };
    const rh = 86, colSlot = 46, colNames = 104, colToi = 560, colG = 650, colXg = 770, colScore = 880, chipX = 906, chipW = 144;
    const head = (y, cols) => cols.map(([t, x, a]) => `<text x="${x}" y="${y}" text-anchor="${a}" font-size="14" letter-spacing="1.2" fill="${CARD.muted}" ${font}>${t}</text>`).join("");
    const chip = (y, col, label) => `<rect x="${chipX}" y="${y + 18}" width="${chipW}" height="${rh - 36}" rx="10" fill="${col}" fill-opacity="0.22" stroke="${col}" stroke-width="1.5"/>
        <text x="${chipX + chipW / 2}" y="${y + rh * 0.62}" text-anchor="middle" font-size="${label.length > 9 ? 16 : 19}" font-weight="800" fill="${col}" ${font}>${label}</text>`;
    const txt = (y, x, s, size, fill, weight, anchor) => `<text x="${x}" y="${y + rh * 0.62}" text-anchor="${anchor || "end"}" font-size="${size}" font-weight="${weight || 400}" fill="${fill}" ${font}>${s}</text>`;
    const unitRow = (r, y, i) => {
      const u = r.u, col = GS_CARD_COLORS[r.tier], sc = u[12];
      return `${i % 2 === 0 ? `<rect x="30" y="${y}" width="1020" height="${rh}" rx="8" fill="${CARD.row}"/>` : ""}
        ${txt(y, colSlot, r.slot, 28, CARD.accent, 800, "start")}${txt(y, colNames, esc(u[3].map(last).join(", ")), 25, CARD.ink, 400, "start")}
        ${txt(y, colToi, toiStr(u[2]), 24, CARD.ink)}${txt(y, colG, `${u[6]}-${u[7]}`, 24, CARD.ink)}${txt(y, colXg, `${u[8].toFixed(1)}-${u[9].toFixed(1)}`, 24, CARD.ink)}
        ${txt(y, colScore, `${sc > 0 ? "+" : ""}${sc.toFixed(2)}`, 28, col, 800)}${chip(y, col, GS_TIER_NAME[r.tier].toUpperCase())}`;
    };
    const goalieRow = ({ x, gg }, y, i) => {
      const col = GC[gg.gr], tags = gg.tags.join("  ·  ");
      return `${i % 2 === 0 ? `<rect x="30" y="${y}" width="1020" height="${rh}" rx="8" fill="${CARD.row}"/>` : ""}
        <text x="${colSlot}" y="${y + (tags ? 38 : 54)}" font-size="25" fill="${CARD.ink}" ${font}>${esc(x[1])}</text>
        ${tags ? `<text x="${colSlot}" y="${y + 64}" font-size="16" fill="${CARD.muted}" ${font}>${esc(tags)}</text>` : ""}
        ${txt(y, colToi, gg.sf, 24, CARD.ink)}${txt(y, colG, gg.ga, 24, CARD.ink)}${txt(y, colXg, (gg.ga + gg.gsax).toFixed(2), 24, CARD.ink)}
        ${txt(y, colScore, `${gg.gsax > 0 ? "+" : ""}${gg.gsax.toFixed(2)}`, 28, col, 800)}${chip(y, col, GRADE_LABEL[gg.gr].toUpperCase())}`;
    };
    const unitCols = [["", colSlot, "start"], ["PLAYERS", colNames, "start"], ["TOI", colToi, "end"], ["GF-GA", colG, "end"], ["xGF-xGA", colXg, "end"], ["UNIT", colScore, "end"], ["GRADE", chipX + chipW / 2, "middle"]];
    const goalieCols = [["GOALIE", colSlot, "start"], ["SHOTS", colToi, "end"], ["GA", colG, "end"], ["xGA", colXg, "end"], ["GSAx", colScore, "end"], ["GRADE", chipX + chipW / 2, "middle"]];
    const section = (title, cols, list, rowFn, top) => list.length
      ? `<text x="56" y="${top}" font-size="26" font-weight="800" letter-spacing="2" fill="${CARD.accent}" ${font}>${title}</text>${head(top + 38, cols)}${list.map((r, i) => rowFn(r, top + 50 + i * rh, i)).join("")}`
      : "";
    const y1 = 296, y2 = y1 + 50 + lines.length * rh + 56, y3 = y2 + 50 + pairs.length * rh + 56;
    const keyY = (goalies.length ? y3 + 50 + goalies.length * rh : y2 + 50 + pairs.length * rh) + 40;
    const notes = ["Lines and pairs are the exact groups on the ice together at even strength, ranked by time together this game.",
      "Power-play and penalty-kill units are not included (they are under Lines & special teams on the game page).",
      "Unit Score: how the unit did on chances, goals and shots while together; 0 is an average game. GF-GA: goals for and against.",
      "xGF-xGA: expected goals for and against. Grade: where the Unit Score falls among every line or pair in that slot,",
      "top 5% elite, bottom 5% awful. One game is a small sample."];
    if (goalies.length) notes.push("Goalie grade: goals saved above expected (GSAx) over the game. Great is more than +1.5, Quality +0.5 to +1.5, Average within 0.5,",
      "Bad -0.5 to -1.5, Blown worse. Stolen win: a Great or Quality game in a win when his team was out-chanced by 1+ xG.",
      "Bailed out: a Bad or Blown game in a win. Relief: another goalie on his team faced more shots.");
    notes.push("Source: NHL play-by-play and shift data.");
    const H = keyY + 40 + 22 * notes.length + 18;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 ${H}" width="1080" height="${H}">
      <rect width="1080" height="${H}" fill="${CARD.bg}"/>
      ${cardTeamHeader(g, side, logoUri, team + " lines, pairs & goalies", "Ranked by ice time this game, graded against the same slot since 2024-25")}
      ${section("FORWARD LINES", unitCols, lines, unitRow, y1 + 24)}${section("DEFENSE PAIRS", unitCols, pairs, unitRow, y2 + 24)}${section("GOALIES", goalieCols, goalies, goalieRow, y3 + 24)}
      ${cardTierKey(keyY, "GRADE")}${cardNotes(notes, H)}
    </svg>`;
  }
  // a half-rink with one team's shots, dots colored by danger band (red high, blue medium, gray low); goals have a white ring,
  // shots on goal are shaded and misses are hollow, the same code as the page's shot map but with the card's fixed colors
  function cardShotMap(shots, x, y, w, title) {
    const sc = w / 104, bandCol = { h: CARD.bad, m: CARD.accent, l: CARD.muted };
    const dots = shots.slice().sort((a, b) => a[6] - b[6]).map(q => {
      const col = bandCol[BAND(q)], r = 1.1 + 5.5 * Math.sqrt(q[5]);
      const st = q[6] === 2 ? `fill="${col}" stroke="#ffffff" stroke-width="1.5"` : q[6] === 1 ? `fill="${col}" fill-opacity="0.5" stroke="${col}" stroke-width="0.6"` : `fill="none" stroke="${col}" stroke-width="1" stroke-opacity="0.9"`;
      return `<circle cx="${q[3]}" cy="${q[4]}" r="${r.toFixed(2)}" ${st}/>`;
    }).join("");
    const rink = `<path d="M0,-42.5 H72 A28,28 0 0 1 100,-14.5 V14.5 A28,28 0 0 1 72,42.5 H0" fill="#0f2a40" stroke="${CARD.muted}" stroke-width="0.8"/>
      <line x1="25" y1="-42.5" x2="25" y2="42.5" stroke="${CARD.accent}" stroke-width="1.6" opacity="0.6"/>
      <line x1="89" y1="-37" x2="89" y2="37" stroke="${CARD.bad}" stroke-width="0.7" opacity="0.6"/>
      <circle cx="69" cy="-22" r="15" fill="none" stroke="${CARD.bad}" stroke-width="0.5" opacity="0.4"/><circle cx="69" cy="22" r="15" fill="none" stroke="${CARD.bad}" stroke-width="0.5" opacity="0.4"/>
      <rect x="89" y="-3" width="3.5" height="6" fill="none" stroke="${CARD.ink}" stroke-width="0.7"/>`;
    const n = { h: 0, m: 0, l: 0 }; let xg = 0, goals = 0;
    shots.forEach(q => { n[BAND(q)] += 1; xg += q[5]; goals += q[6] === 2 ? 1 : 0; });
    const font = 'font-family="Helvetica Neue, Helvetica, Arial, sans-serif"', h = 90 * sc;
    return { height: h + 76, svg: `<text x="${x}" y="${y + 24}" font-size="22" font-weight="700" fill="${CARD.ink}" ${font}>${escapeHtml(title)}</text>
      <g transform="translate(${x},${y + 36}) scale(${sc}) translate(2,45)">${rink}${dots}</g>
      <text x="${x}" y="${y + 36 + h + 26}" font-size="18" fill="${CARD.muted}" ${font}><tspan fill="${CARD.bad}" font-weight="700">${n.h} high</tspan>  <tspan fill="${CARD.accent}" font-weight="700">${n.m} medium</tspan>  <tspan font-weight="700">${n.l} low</tspan>  &#183;  ${xg.toFixed(2)} xG  &#183;  ${goals} goal${goals === 1 ? "" : "s"}</text>` };
  }
  let cardLogoUri; // undefined until the logos are requested, then the {team: data URI} map or null

  const shareSvg = (kind, g, side, logos) => (kind === "table" ? tableCardSvg(g, logos) : kind === "bars" ? barsCardSvg(g, side, logos)
    : kind === "lines" ? linesCardSvg(g, side, logos) : gameCardSvg(g, side, logos));
  // a card named by one string, as the Home page keeps them: "table" (both teams), "bars-away", "lines-home", ... ("away" / "home" alone is the full game card)
  const parseCardKey = (key) => { const m = String(key).match(/^(bars|lines|full)-(away|home)$/); return key === "table" ? { kind: "table", side: "home" } : m ? { kind: m[1] === "full" ? "card" : m[1], side: m[2] } : { kind: "card", side: key === "away" ? "away" : "home" }; };
  const cardFileName = (g, kind, side) => `shiftscore-${g.date || "game"}-${g.away}-at-${g.home}-${kind === "table" ? "skater-table" : g[side] + (kind === "bars" ? "-game-scores" : kind === "lines" ? "-lines-pairs-goalies" : "")}.png`;
  async function cardPng(svg, W, H) {
    const img = new Image(), url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement("canvas"); c.width = W * 1; c.height = H * 1;
    c.getContext("2d").drawImage(img, 0, 0, W, H); URL.revokeObjectURL(url);
    return new Promise(res => c.toBlob(res, "image/png"));
  }
  // totals for a game tile on the Home page: shots on goal and expected goals for each team, and the goals in order
  function tileStats(g) {
    const sog = (side) => Object.values(g.bp[side].sog).reduce((x, y) => x + y, 0);
    const xg = (side) => teamXg(g.shots, side === "away" ? 0 : 1);
    return { sog: [sog("away"), sog("home")], xg: [xg("away"), xg("home")], goals: (g.goals || []).map(x => [x.label, x.time, x.team, x.scorer]) };
  }

  // save a card image: on the hosted site a page can't download directly, so the viewer's `downloads` capability asks them
  // to save it; elsewhere (the static report, a local copy) a plain download works
  async function saveCardImage(svg, name) {
    const [, W, H] = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    try {
      const blob = await cardPng(svg, +W, +H);
      if (typeof claude !== "undefined" && claude.use) {
        const dl = await claude.use("downloads").catch(() => null);
        if (dl) { try { await dl.save({ filename: name, data: blob }); } catch (e) { if (!e || e.code !== "declined") alert("Couldn't save the image here."); } return; }
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { alert("Couldn't make the image in this browser."); }
  }
  // logos for the card as data URIs, when the site has loaded them (the static report has none)

  // ---- a percentile card (a player's or a unit's) as a shareable 1080-wide image: the name, a few headline numbers, and the percentile bars
  // grouped like the page's card (blue low, grey middle, red high). o = { title, sub, date, logo, photo, stats: [[label, value]], groups:
  // [[group, [[label, text, pct]]]], small, caption }. logo and photo are data URIs or null.
  function pctCardSvg(o) {
    const font = CARD_FONT, esc = escapeHtml;
    // faded when the player or unit is below the comparison group's bar (o.small), the way Baseball Savant does it
    const color = (pct) => { const t = Math.abs(pct - 50) / 50; return `hsl(${pct < 50 ? 215 : 4} ${(8 + 70 * t).toFixed(0)}% ${(66 - 18 * t).toFixed(0)}%${o.small ? " / 0.4" : ""})`; };
    const wrap = (text, n) => { const out = []; let line = ""; String(text).split(" ").forEach(w => { if ((line + " " + w).trim().length > n) { out.push(line); line = w; } else line = (line + " " + w).trim(); }); if (line) out.push(line); return out; };
    const bandH = 250, statsY = bandH + 14, statsH = 96;
    const face = o.photo
      ? `<clipPath id="pcFace"><circle cx="121" cy="157" r="64"/></clipPath><circle cx="121" cy="157" r="68" fill="${CARD.row}"/><image href="${o.photo}" x="57" y="93" width="128" height="128" preserveAspectRatio="xMidYMin slice" clip-path="url(#pcFace)"/>`
      : (o.logo ? `<image href="${o.logo}" x="56" y="92" width="130" height="130" preserveAspectRatio="xMidYMid meet"/>` : "");
    const miniLogo = o.photo && o.logo ? `<image href="${o.logo}" x="160" y="170" width="54" height="54" preserveAspectRatio="xMidYMid meet"/>` : "";
    const stats = (o.stats || []).slice(0, 6), sw = 968 / Math.max(1, stats.length);
    const statBoxes = stats.map(([k, v], i) => `<text x="${56 + sw * i + sw / 2}" y="${statsY + 52}" text-anchor="middle" font-size="40" font-weight="800" fill="${CARD.ink}" ${font}>${esc(v)}</text>
      <text x="${56 + sw * i + sw / 2}" y="${statsY + 80}" text-anchor="middle" font-size="18" letter-spacing="1.5" fill="${CARD.muted}" ${font}>${esc(k)}</text>`).join("");
    let y = statsY + statsH + 26;
    const rowH = 46, trackX = 400, trackW = 440;
    let bars = "";
    (o.groups || []).forEach(([group, rows]) => {
      bars += `<text x="56" y="${y + 24}" font-size="22" font-weight="800" letter-spacing="3" fill="${CARD.accent}" ${font}>${esc(String(group).toUpperCase())}</text>`;
      y += 40;
      rows.forEach(([label, text, pct], i) => {
        if (i % 2 === 0) bars += `<rect x="40" y="${y - 2}" width="1000" height="${rowH}" rx="8" fill="${CARD.row}"/>`;
        bars += `<text x="56" y="${y + 31}" font-size="23" fill="${CARD.ink}" ${font}>${esc(label)}</text>
          <rect x="${trackX}" y="${y + 17}" width="${trackW}" height="10" rx="5" fill="${CARD.band}"/>`;
        if (pct !== null && pct !== undefined) {
          const c = color(pct), x = trackX + trackW * pct / 100;
          bars += `<rect x="${trackX}" y="${y + 17}" width="${(trackW * pct / 100).toFixed(1)}" height="10" rx="5" fill="${c}"/>
            <circle cx="${x.toFixed(1)}" cy="${y + 22}" r="19" fill="${c}"/><text x="${x.toFixed(1)}" y="${y + 29}" text-anchor="middle" font-size="19" font-weight="800" fill="#0b1c2c" ${font}>${pct}</text>`;
        }
        bars += `<text x="1024" y="${y + 31}" text-anchor="end" font-size="23" font-weight="700" fill="${CARD.ink}" ${font}>${esc(text)}</text>`;
        y += rowH;
      });
      y += 14;
    });
    const notes = (o.small ? ["Small sample: below the ice-time bar for the comparison group, so these can swing a lot."] : []).concat(wrap(o.caption || "", 104), ["Source: NHL play-by-play and shift data."]);
    const H = y + 16 + 22 * notes.length + 22;
    const noteSvg = notes.map((t, i) => `<text x="56" y="${y + 24 + 22 * i}" font-size="17" fill="${CARD.muted}" ${font}>${esc(t)}</text>`).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 ${H}" width="1080" height="${H}">
      <rect width="1080" height="${H}" fill="${CARD.bg}"/>
      <rect width="1080" height="${bandH}" fill="${CARD.band}"/>
      ${cardMark(48, 14, 56)}<text x="136" y="62" font-size="26" font-weight="800" letter-spacing="4" fill="${CARD.accent}" ${font}>SHIFT SCORE</text>
      <text x="1032" y="62" text-anchor="end" font-size="24" fill="${CARD.muted}" ${font}>${esc(o.date || "")}</text>
      ${face}${miniLogo}
      <text x="${o.photo ? 236 : 210}" y="156" font-size="${String(o.title).length > 22 ? 40 : 48}" font-weight="800" fill="${CARD.ink}" ${font}>${esc(o.title)}</text>
      <text x="${o.photo ? 236 : 210}" y="204" font-size="26" fill="${CARD.muted}" ${font}>${esc(o.sub || "")}</text>
      ${statBoxes}${bars}${noteSvg}
    </svg>`;
  }
  const savePctCard = (o, name) => saveCardImage(pctCardSvg(o), name);

  async function cardLogos() {
    try {
      if (typeof IMG === "undefined" || typeof svgUri === "undefined") return null;
      IMG.logos = IMG.logos || jsonOrEmpty("data/logos.json");
      const all = await IMG.logos, out = {};
      for (const k in all) out[k] = svgUri(all[k].d || all[k].l);
      return out;
    } catch (e) { return null; }
  }

  // ---- units by period. A unit row is the full game; its last element (pr) says how that splits by period:
  // the period number when the unit only played one, else a list of [period, toi, cf, ca, gf, ga, xgf, xga,
  // hdcf, hdca, mdcf, mdca, ldcf, ldca, score]. Rows from before the split existed have no pr and stay full-game.
  const UNIT_PERIOD_AT = { toi: 2, cf: 4, ca: 5, gf: 6, ga: 7, xgf: 8, xga: 9, hdcf: 10, hdca: 11, score: 12, mdcf: 14, mdca: 15, ldcf: 16, ldca: 17 };
  const PERIOD_ROW_AT = { toi: 1, cf: 2, ca: 3, gf: 4, ga: 5, xgf: 6, xga: 7, hdcf: 8, hdca: 9, mdcf: 10, mdca: 11, ldcf: 12, ldca: 13, score: 14 };
  function unitInPeriods(u, periods) {
    const pr = u[18];
    if (periods === null || pr === null || pr === undefined) return u; // all periods, or no split available
    if (typeof pr === "number") return periods.includes(pr) ? u : null;
    const rows = pr.filter(r => periods.includes(r[0]));
    if (!rows.length) return null;
    const out = u.slice();
    for (const k in UNIT_PERIOD_AT) out[UNIT_PERIOD_AT[k]] = Math.round(rows.reduce((a, r) => a + r[PERIOD_ROW_AT[k]], 0) * 100) / 100;
    return out;
  }
  // an "other combinations" row: [team, type, n, toi, cf, ca, gf, ga, xgf, xga, hdcf, hdca, mdcf, mdca, ldcf, ldca, score, pr]
  // with pr the period number or a list of [period, n, toi, cf, ...]. n (how many combinations) is per period when split.
  function othersInPeriods(o, periods) {
    const pr = o[17];
    if (periods === null || pr === null || pr === undefined) return o;
    if (typeof pr === "number") return periods.includes(pr) ? o : null;
    const rows = pr.filter(r => periods.includes(r[0]));
    if (!rows.length) return null;
    const out = o.slice(0, 17);
    for (let i = 2; i < 17; i++) out[i] = Math.round(rows.reduce((a, r) => a + r[i - 1], 0) * 100) / 100;
    return out;
  }

  // mount(el, g, links) renders a box score into `el` and returns {update(g2)}, which
  // re-renders with fresher data (a live game) keeping the viewer's period/situation filters.
  // Filter state lives on the element so it also survives a full re-mount of the same game.
  function mount(el, g, links) {
    const state = el._gvState || (el._gvState = { period: "all", sit: "all" });
    state.view = state.view || "adv";
    state.danger = state.danger || "all";
    state.player = state.player || "all";
    let names = {};
    let hasOT = false;

    // The page is split into tabs so only one part shows at a time: a summary of the game (the linescore stays on top of every
    // tab), (story, then the game log: team stats, scoring, penalties), then skaters, lines and special teams, shots and goalies, overtime when there was one, and the game card.
    // Period/situation filters appear only on the tabs they apply to.
    el.innerHTML = '<div class="gv-head"></div><nav class="gv-nav" role="tablist" aria-label="Game sections"></nav><div class="gv-top"></div>'
      + '<div class="gv-filters"></div><div class="gv-body"></div>';
    const headEl = el.querySelector(".gv-head"), navEl = el.querySelector(".gv-nav"), topEl = el.querySelector(".gv-top"),
      filtersEl = el.querySelector(".gv-filters"), bodyEl = el.querySelector(".gv-body");

    // each team's expected goals for the whole game, every period and situation (the shootout isn't included)
    const gameXg = (side) => teamXg(g.shots, side === "away" ? 0 : 1);

    function renderHead() {
      const live = g.live && (g.live.state === "LIVE" || g.live.state === "CRIT");
      const suffix = live ? "" : g.oc === "REG" ? "" : ` &middot; Final/${g.oc}`;
      const badge = g.live ? ` <span class="live-badge${live ? " on" : ""}">${live ? "LIVE" : escapeHtml(g.live.status || "")}</span> <span class="detail-sub">${live ? escapeHtml(g.live.status || "") : ""}</span>` : "";
      headEl.innerHTML = `
        ${links.backHtml || ""}
        <div class="detail-title">${links.team(g.away)} ${g.as} <span class="detail-sub">at</span> ${links.team(g.home)} ${g.hs}${badge}</div>
        <div class="panel-caption">${g.date || ""}${suffix}</div>
        <div class="gv-expected">Expected score (xG) <strong>${escapeHtml(g.away)} ${gameXg("away").toFixed(1)} &ndash; ${gameXg("home").toFixed(1)} ${escapeHtml(g.home)}</strong></div>`;
    }

    function prepare() {
      hasOT = g.oc !== "REG" || (g.live && g.bp && Object.keys(g.bp.home.goals).includes("OT"));
      names = {};
      ["home", "away"].forEach(side => g.sk[side].forEach(r => { names[r[0]] = r[1]; }));
      if (!hasOT && state.period === "ot") state.period = "all";
    }

    // One compact bar instead of a pile of chips: a team picker (skaters, units), then dropdowns for period and situation, and for the
    // skaters tab the stats view. The bar only appears on the tabs these change, and the view menu only where it applies.
    function renderFilters() {
      const tab = state.tab || "summary";
      if (!["skaters", "units", "shots"].includes(tab)) { filtersEl.innerHTML = ""; filtersEl.style.display = "none"; return; }
      filtersEl.style.display = "";
      const sel = (key, label, list) => `<label class="gv-sel"><span>${label}</span><select data-gv-sel="${key}">${list
        .filter(o => !(key === "period" && o.key === "ot" && !hasOT))
        .map(o => `<option value="${o.key}"${state[key] === o.key ? " selected" : ""}>${o.label}</option>`).join("")}</select></label>`;
      const teamSel = state.team || "away";
      const team = tab === "shots" ? "" : `<div class="chips gv-teampick" role="group" aria-label="Team">${[["away", g.away], ["home", g.home], ["both", "Both"]]
        .map(([k, label]) => `<button type="button" class="chip" aria-pressed="${teamSel === k}" data-gv-team="${k}">${label}</button>`).join("")}</div>`;
      filtersEl.innerHTML = `<div class="gv-bar">${team}${sel("period", "Period", PERIODS)}${sel("sit", "Situation", SITUATIONS)}${tab === "skaters" ? sel("view", "Stats", VIEWS) : ""}</div>`;
    }
    filtersEl.addEventListener("change", (ev) => {
      const sel = ev.target.closest("select[data-gv-sel]");
      if (!sel) return;
      state[sel.dataset.gvSel] = sel.value;
      renderBody();
    });

    el.addEventListener("click", async (ev) => {
      const tab = ev.target.closest("button[data-gv-tab]");
      if (tab) { state.tab = tab.dataset.gvTab; renderBody(); if (links.onNav) links.onNav(); return; }
      const tm2 = ev.target.closest("button[data-gv-team]");
      if (tm2) { state.team = tm2.dataset.gvTeam; renderBody(); return; }
      const mub = ev.target.closest("button[data-gv-mu]");
      if (mub) { state.mu = mub.dataset.gvMu; renderBody(); return; }
      const kb = ev.target.closest("button[data-gv-kind]");
      if (kb) { state.mapKind = kb.dataset.gvKind; renderBody(); return; }
      const sh = ev.target.closest("button[data-gv-share]");
      if (sh) { state.share = state.share === sh.dataset.gvShare ? null : sh.dataset.gvShare; renderBody(); return; }
      const cb = ev.target.closest("button[data-gv-card]");
      if (cb) { state.card = cb.dataset.gvCard; renderBody(); return; }
      if (ev.target.closest("button[data-gv-card-save]")) {
        const side = state.card || "home", svg = shareSvg(state.share, g, side, cardLogoUri || null);
        await saveCardImage(svg, cardFileName(g, state.share || "card", side));
        return;
      }
      const b = ev.target.closest("button[data-gv-danger]");
      if (!b) return;
      state.danger = b.dataset.gvDanger;
      renderBody();
    });
    el.addEventListener("change", (ev) => {
      const sel = ev.target.closest("select[data-gv-player]");
      if (!sel) return;
      state.player = sel.value;
      renderBody();
    });
    wireTooltips(el);

    function renderBody() {
      const per = PERIODS.find(p => p.key === state.period), sit = SITUATIONS.find(s => s.key === state.sit);
      const filtered = state.period !== "all" || state.sit !== "all";
      const S = (cells, fields) => sum(cells, fields, per.idx, sit.idx);

      // --- linescore (never filtered)
      const periods = Object.keys(g.bp.home.goals);
      const line = statTable(
        [{ label: "Goals (shots)" }, ...periods.map(p => ({ label: p, num: true })), { label: "Final", num: true }, { label: "xG", num: true }],
        [["away", g.as], ["home", g.hs]].map(([side, final]) => [
          links.team(g[side]),
          ...periods.map(p => `${g.bp[side].goals[p]} <span class="detail-sub">(${g.bp[side].sog[p]})</span>`),
          `<strong>${final}</strong>`,
          gameXg(side).toFixed(2),
        ])
      ) + '<div class="panel-caption">xG: the goals each team should have scored from the quality of its shots on goal (misses, blocks and empty-net shots are not counted).</div>'
        + (g.oc === "SO" ? '<div class="panel-caption">Decided in a shootout; the winner is credited one goal in the final score. xG does not include the shootout.</div>' : "");

      // --- team stats
      // the game log lives on the Summary tab, so it is always the whole game (every period and situation) and ignores the filters
      const ALL_P = [0, 1, 2, 3], ALL_S = [0, 1, 2, 3, 4];
      const T = { away: named(sum(g.tc.away, TF, ALL_P, ALL_S), TF), home: named(sum(g.tc.home, TF, ALL_P, ALL_S), TF) };
      const ppOnly = (cells) => named(sum(cells, TF, ALL_P, [2]), TF);
      const pkOnly = (cells) => named(sum(cells, TF, ALL_P, [3]), TF);
      const fo = (t) => (t.fow + t.fol ? (100 * t.fow / (t.fow + t.fol)).toFixed(1) : "–");
      // head to head: each team's number on its own side of the label, with a bar showing the split; grouped by what the stat is about
      const faceoffNum = (t) => (t.fow + t.fol ? t.fow / (t.fow + t.fol) : 0.5);
      const STAT_GROUPS = [
        ["Chances", [
          ["Goals", s => T[s].goals], ["Shots on goal", s => T[s].sog], ["Shot attempts (Corsi)", s => T[s].attempts],
          ["Expected goals (xG)", s => gameXg(s).toFixed(2), s => gameXg(s)], ["High-danger shots on goal", s => T[s].hdc],
          ["Medium-danger shots on goal", s => T[s].mdc || 0], ["Low-danger shots on goal", s => T[s].ldc || 0]]],
        ["Play", [
          ["Time on ice", s => toiStr(T[s].toi), s => T[s].toi], ["Hits", s => T[s].hits], ["Blocked shots", s => T[s].blocks],
          ["Takeaways", s => T[s].tk], ["Giveaways", s => T[s].gv], ["Faceoff %", s => fo(T[s]), s => faceoffNum(T[s])]]],
        ["Penalties and special teams", [
          ["Penalty minutes", s => T[s].pim], ["Power-play goals", s => ppOnly(g.tc[s]).goals],
          ["Power-play time", s => toiStr(ppOnly(g.tc[s]).toi), s => ppOnly(g.tc[s]).toi], ["Penalty-kill time", s => toiStr(pkOnly(g.tc[s]).toi), s => pkOnly(g.tc[s]).toi]]],
      ];
      const teamStats = `<div class="cmp"><div class="cmp-head"><span>${escapeHtml(g.away)}</span><span></span><span>${escapeHtml(g.home)}</span></div>${STAT_GROUPS.map(([title, rows]) =>
        `<div class="cmp-group">${title}</div>${rows.map(([label, disp, num]) => {
          const a = disp("away"), h = disp("home"), an = Number((num || disp)("away")), hn = Number((num || disp)("home")), tot = an + hn;
          const pa = tot > 0 ? 100 * an / tot : 50;
          return `<div class="cmp-row"><span class="cmp-v">${a}</span><span class="cmp-l">${label}</span><span class="cmp-v">${h}</span>
            <span class="cmp-bar"><i style="width:${pa.toFixed(1)}%"></i></span></div>`;
        }).join("")}`).join("")}</div>`;

      // --- scoring + penalties (filter by period; goals also by situation)
      const shotsAll = g.shots || [];
      // the map shows shots on goal (saves and goals) by default, the way most sites count chances; the toggle adds the misses
      const mapKind = state.mapKind === "all" ? "all" : "sog";
      const shotsView = shotsAll.filter(s => per.idx.includes(s[0] - 1) && sit.idx.includes(s[8] % 5) && (mapKind === "all" || s[6] >= 1) && s[9] !== 1);   // s[9] === 1 marks an empty-net attempt, kept off the maps
      // the shot map also filters by danger band (the tables stay unfiltered by it)
      // ...and by shooter: the menu lists everyone with a shot in this period/situation
      const shooterCount = {};
      shotsView.forEach(s => { const k = s[7]; (shooterCount[k] = shooterCount[k] || { id: k, name: names[k] || "Unknown", side: s[2], n: 0 }).n += 1; });
      const shooters = Object.values(shooterCount).sort((a, b) => a.side - b.side || b.n - a.n || a.name.localeCompare(b.name))
        .map(x => Object.assign(x, { team: x.side ? g.home : g.away }));
      if (state.player !== "all" && !shooterCount[state.player]) state.player = "all";
      const playerShots = state.player === "all" ? shotsView : shotsView.filter(s => String(s[7]) === String(state.player));
      const mapShots = state.danger === "all" ? playerShots : playerShots.filter(s => BAND(s) === state.danger);
      const shotsSit = shotsAll.filter(s => sit.idx.includes(s[8] % 5));
      const chartSections = xgTimeline(g, shotsSit) + shotMaps(g, mapShots, names, state.danger, playerShots, state.player, shooters, mapKind);

      const goalsIn = g.goals;
      const goals = goalsIn.length ? statTable(
        [{ label: "Per" }, { label: "Time" }, { label: "Team" }, { label: "Goal (assists)" }, { label: "Strength" }, { label: "Score (A-H)" }],
        goalsIn.map(x => [x.label, x.time, links.team(x.team),
          links.player(x.scorer_id, x.team, x.scorer) + (x.assists.length
            ? ` <span class="detail-sub">(${x.assists.map(a => (links.playerText || links.player)(a.id, x.team, a.name)).join(", ")})</span>`
            : ' <span class="detail-sub">(unassisted)</span>'),
          x.strength, x.score])
      ) : '<div class="empty">No goals.</div>';

      const pensIn = g.pens;
      const pens = pensIn.length ? statTable(
        [{ label: "Per" }, { label: "Time" }, { label: "Team" }, { label: "Player" }, { label: "Infraction" }, { label: "Min", num: true }],
        pensIn.map(p => [p[1], p[2], links.team(p[3]), p[5] ? (links.playerText || links.player)(p[5], p[3], p[4]) : escapeHtml(p[4]), escapeHtml(p[6]), p[7] || ""])
      ) : '<div class="empty">No penalties.</div>';

      // --- skaters: advanced, box score, shot danger views. Totals only: a per-60 rate from one
      // game (about 16 minutes, or a minute or two in a power-play or penalty-kill filter) is mostly noise.
      const cnt = (x) => x;
      const dec = (x) => x.toFixed(2);
      const pct = (a, b) => (a + b > 0 ? (100 * a / (a + b)).toFixed(1) : "&ndash;");
      const gsLabel = (filtered || g.live) ? "Game Score*" : "Game Score";
      const nums = (labels) => labels.map(label => ({ label, num: true }));
      const SK_HEADERS = {
        adv: [{ label: "Player" }, { label: "Pos" }, ...nums(["TOI", "Chances created", "ixG", "CF", "CA", "CF%", "xGF", "xGA", "xGF%", "HDCF", "HDCA", "MDCF", "MDCA", "LDCF", "LDCA", "GF", "GA", gsLabel, "QoC", "QoT", "Adjusted"])],
        box: [{ label: "Player" }, { label: "Pos" }, ...nums(["TOI", "G", "A1", "A2", "P", "SOG", "Hits", "Blk", "TK", "GV", "PIM", "FO W-L", "FO%", "Pen. drawn", "Pen. taken", "Starts OZ-DZ-NZ", "OZ%"])],
        ch: [{ label: "Player" }, { label: "Pos" }, ...nums(["TOI", "Chances created", "Own: high", "med", "low", "xGF", "xGA", "HDCF", "HDCA", "MDCF", "MDCA", "LDCF", "LDCA", "HDCF%"])],
      };
      const skTable = (side) => {
        const rows = [];
        g.sk[side].forEach(r => {
          const [id, name, pos, raw, qoc, qot, adj] = r;
          const v = named(S(r[8], PF), PF);
          if (filtered && v.toi === 0) return; // didn't play in this view
          const who = [links.player(id, g[side], name), pos, toiStr(v.toi)];
          const toi = v.toi;
          if (state.view === "box") {
            rows.push([...who, cnt(v.g, toi), cnt(v.a1, toi), cnt(v.a2, toi), cnt(v.g + v.a1 + v.a2, toi), cnt(v.sog, toi), cnt(v.hits, toi), cnt(v.blk, toi),
              cnt(v.tk, toi), cnt(v.gv, toi), cnt(v.pim, toi), `${v.fow}-${v.fol}`, pct(v.fow, v.fol), cnt(v.pd, toi), cnt(v.pt, toi),
              ...(filtered || !r[9] ? ["&ndash;", "&ndash;"] : [`${r[9][0]}-${r[9][1]}-${r[9][2]}`, pct(r[9][0], r[9][1])])]);
          } else if (state.view === "ch") {
            rows.push([...who, cnt(v.ihd + v.imd + v.ild, toi), cnt(v.ihd, toi), cnt(v.imd, toi), cnt(v.ild, toi), dec(v.xgf, toi), dec(v.xga, toi),
              cnt(v.hdcf, toi), cnt(v.hdca, toi), cnt(v.mdcf, toi), cnt(v.mdca, toi), cnt(v.ldcf, toi), cnt(v.ldca, toi), pct(v.hdcf, v.hdca)]);
          } else {
            // a live game with no shift chart yet has no stored Game Score: show the slice score instead
            const useSlice = filtered || (raw === null && g.live);
            const score = useSlice ? sliceScore(v) : raw;
            rows.push([...who, cnt(v.ihd + v.imd + v.ild, toi), dec(v.ixg, toi), cnt(v.cf, toi), cnt(v.ca, toi), pct(v.cf, v.ca), dec(v.xgf, toi), dec(v.xga, toi), pct(v.xgf, v.xga),
              cnt(v.hdcf, toi), cnt(v.hdca, toi), cnt(v.mdcf, toi), cnt(v.mdca, toi), cnt(v.ldcf, toi), cnt(v.ldca, toi), cnt(v.gf, toi), cnt(v.ga, toi),
              score === null ? "" : (useSlice ? scoreCell(score) : gsCell(score, gsKind(r[2], false), false)),
              filtered ? "" : f2(qoc), filtered ? "" : f2(qot), filtered ? "" : gsCell(adj, "adj", true)]);
          }
        });
        return statTable(SK_HEADERS[state.view], rows);
      };
      const skNote = state.view === "ch"
        ? '<div class="panel-caption">Shot quality by danger band. Chances created are the shots on goal the player took himself, split by danger below it. xGF and xGA are expected goals over every unblocked attempt; the high, medium and low-danger chances for and against (HDCF, HDCA, MDCF, MDCA, LDCF, LDCA) are the shots on goal his team took and allowed while he was on the ice. High danger is a 14%+ chance for a shot on goal to score, medium 7-14%, low under 7%.' + '</div>'
        : state.view === "adv"
          ? '<div class="panel-caption">CF% and xGF% are the share of shot attempts and expected goals for the team while the player was on the ice.</div>' + gsKeyHtml("Game Score and Adjusted colors")
          : "";

      // --- goalie grades for the whole game (the same grades as the goalie pages): goals saved above expected, plus whether he relieved a
      // teammate (another goalie on his team faced more shots), and the team's expected goals for the stolen-win / bailed-out tags.
      // Not shown while the game is live or under a period / situation filter (a grade is about the whole game).
      const goalieGameGrade = (x) => gradeForGoalie(g, x);
      const gradeCell = (r) => gradeChip(r.gr) + r.tags.map(t => ` <span class="grade-tag">${t}</span>`).join("");

      // --- goalies
      const goalieRows = g.gl.map(x => {
        const v = named(S(x[3], GF), GF);
        if (filtered && v.toi === 0) return null;
        const gg = filtered ? null : goalieGameGrade(x);
        return [links.player(x[0], x[2], x[1]), x[2], toiStr(v.toi), v.sf, v.ga, v.sf ? (1 - v.ga / v.sf).toFixed(3) : "", v.xga.toFixed(2), scoreCell(v.xga - v.ga), gg ? gradeCell(gg) : "&ndash;"];
      }).filter(Boolean);
      const goalies = statTable(
        [{ label: "Goalie" }, { label: "Team" }, ...["TOI", "SF", "GA", "Sv%", "xGA", "GSAx"].map(label => ({ label, num: true })), { label: "Grade" }], goalieRows);

      // --- goalies by shot danger: what each goalie faced and how he did against expected, per band
      const goalieDanger = (() => {
        const rows = [];
        g.gl.forEach(x => {
          const v = named(S(x[3], GF), GF);
          if (filtered && v.toi === 0) return;
          [["h", "sfh", "gah", "xgah"], ["m", "sfm", "gam", "xgam"], ["l", "sfl", "gal", "xgal"]].forEach(([b, sf, ga, xga], i) => {
            rows.push([i === 0 ? links.player(x[0], x[2], x[1]) : "", i === 0 ? x[2] : "", BAND_NAME[b], v[sf], v[ga],
              v[sf] ? (1 - v[ga] / v[sf]).toFixed(3) : "&ndash;", v[xga].toFixed(2), scoreCell(v[xga] - v[ga])]);
          });
        });
        return rows.length ? statTable([{ label: "Goalie" }, { label: "Team" }, { label: "Shot danger" }, ...["SF", "GA", "Sv%", "xGA", "GSAx"].map(label => ({ label, num: true }))], rows) : "";
      })();

      // --- units: follow the period and situation filters. Situation picks which kinds of unit show (a unit's kind
      // is its situation: forward lines and pairs are 5v5, then power play, penalty kill, 4-on-4 and 3-on-3), and
      // the period filter sums each unit's per-period numbers. Each team has its own tables.
      const teamOrder = { [g.away]: 0, [g.home]: 1 };
      const unitPeriods = per.key === "all" ? null : per.idx.map(i => i + 1);
      // one table per team and kind of unit, so each team's lines, pairs and special teams read on their own
      const unitCols = [{ label: "Unit" }, ...["TOI", "CF", "CA", "GF", "GA", "xGF", "xGA", "HDCF", "HDCA", "MDCF", "MDCA", "LDCF", "LDCA", "Unit Score"].map(label => ({ label, num: true }))];
      // lines and pairs also get a grade (whole game only: the cut points are for a full game's Unit Score, not a period's)
      const gradedCols = [...unitCols, { label: "Grade" }];
      const unitRow = (u, text, graded) => [text, toiStr(u[2]), u[4], u[5], u[6], u[7], u[8].toFixed(2), u[9].toFixed(2),
        u[10], u[11], u[14] || 0, u[15] || 0, u[16] || 0, u[17] || 0, scoreCell(u[12])].concat(graded ? [unitGradeHtml(u[12], unitSlotInGame(g, u))] : []);
      const otherRow = (o) => [`<span class="detail-sub">All other combinations (${o[2]})</span>`, toiStr(o[3]), o[4], o[5], o[6], o[7], o[8].toFixed(2), o[9].toFixed(2),
        o[10], o[11], o[12], o[13], o[14], o[15], scoreCell(o[16])];
      // each player's name opens his page; a "unit" link after the names opens the unit's page (on the hosted site; the live view has no pages)
      const unitText = (u) => {
        const text = u[3].map(id => names[id] || id).join(", "), key = u[13];
        if (!key || !links.unitPageLink) return key ? links.unit(key, u[0], text) : escapeHtml(text);
        const who = u[3].map(id => (links.playerText || links.player)(id, u[0], names[id] || id)).join(", ");
        return (links.unitFaces ? links.unitFaces(key, text) : "") + who + ` <span class="detail-sub">${links.unitPageLink(key, u[0], "unit &rsaquo;")}</span>`;
      };
      // table rows for one team's units of one kind in the given periods (null = whole game), longest on the ice first
      const unitBody = (type, periods, team) => {
        const rows = g.units.filter(u => u[1] === type && u[0] === team).map(u => unitInPeriods(u, periods)).filter(Boolean).sort((a, b) => b[2] - a[2]);
        const others = (g.uo || []).filter(o => o[1] === type && o[0] === team).map(o => othersInPeriods(o, periods)).filter(Boolean);
        const graded = !periods && (type === "line" || type === "pair");
        const body = rows.map(u => unitRow(u, unitText(u), graded));
        if (others.length) { const o = otherRow(others[0]); body.push(graded ? o.concat([""]) : o); }
        return body;
      };
      const UNIT_SECTIONS = [["line", "Forward lines"], ["pair", "Defense pairs"], ["pp", "Power-play units"], ["pk", "Penalty-kill units"],
        ["ev4", "4-on-4 units"], ["ev3", "3-on-3 units"]];
      // long unit tables scroll inside a short box with the header pinned, so showing every unit doesn't stretch the page
      const unitTable = (body, graded) => `<div class="unit-scroll">${statTable(graded ? gradedCols : unitCols, body)}</div>`
        + (body.length > 8 ? `<div class="scroll-hint">${body.length} rows &middot; scroll the table to see them all</div>` : "");
      const unitSplitNote = unitPeriods && g.units.some(u => u[18] === undefined)
        ? '<div class="panel-caption">This game predates the per-period unit split, so unit tables show the full game.</div>' : "";
      // ---- matchups: each of a team's lines and pairs against each of the other team's lines and pairs at 5-on-5 (whole game only).
      // Rows are the team's own units, columns the opposing units (L1-L4, P1-P3 by ice time that game); each cell shows the time they shared
      // the ice and, under it, how that stretch went in the chosen measure.
      const MU_METRICS = [["xg", "Expected goals"], ["cf", "Shot attempts"], ["g", "Goals"]];
      const muMetric = state.mu || "xg";
      const muSlots = ["L1", "L2", "L3", "L4", "P1", "P2", "P3"];
      const slotUnitsOf = (team) => { const m = {}; [["line", 4, "L"], ["pair", 3, "P"]].forEach(([t, n, tag]) =>
        g.units.filter(u => u[0] === team && u[1] === t).sort((a, b) => b[2] - a[2]).slice(0, n).forEach((u, i) => { m[tag + (i + 1)] = u; })); return m; };
      const unitNames = (u) => u[3].map(id => String(names[id] || id).split(" ").slice(-1)[0]).join(", ");
      const matchupFor = (sd) => {
        const side = sd === "away" ? 0 : 1, own = slotUnitsOf(g[sd]), opp = slotUnitsOf(g[sd === "away" ? "home" : "away"]);
        const cell = {}; (g.mu || []).filter(r => r[0] === side).forEach(r => { cell[r[1] + "|" + r[2]] = r; });
        const rowsList = muSlots.filter(t => own[t]), colsList = muSlots.filter(t => opp[t]);
        if (!rowsList.length || !colsList.length) return "";
        const fmt = (r) => {
          if (!r) return '<span class="detail-sub">&ndash;</span>';
          const [, , , toi, cf, ca, gf, ga, xgf, xga] = r;
          const [d, txt] = muMetric === "xg" ? [xgf - xga, signed2(xgf - xga)] : muMetric === "cf" ? [cf - ca, `${cf}&ndash;${ca}`] : [gf - ga, `${gf}&ndash;${ga}`];
          return `<span class="mu-toi">${toiStr(toi)}</span><br><span class="${d > 0 ? "pos" : d < 0 ? "neg" : ""}" title="${toiStr(toi)} together &middot; shot attempts ${cf}&ndash;${ca} &middot; goals ${gf}&ndash;${ga} &middot; xG ${xgf.toFixed(2)}&ndash;${xga.toFixed(2)}">${txt}</span>`;
        };
        // shade each cell by how lopsided that stretch was in the chosen measure (green: the row's unit ahead, red: behind); short stretches fade out
        const MU_SCALE = { xg: 0.5, cf: 6, g: 2 };
        const shade = (r) => {
          if (!r) return "";
          const [, , , toi, cf, ca, gf, ga, xgf, xga] = r, d = muMetric === "xg" ? xgf - xga : muMetric === "cf" ? cf - ca : gf - ga;
          const a = Math.min(1, Math.abs(d) / MU_SCALE[muMetric]) * Math.min(1, toi / 180) * 0.45;
          return a < 0.03 ? "" : ` style="background:${d > 0 ? `rgba(79,191,133,${a.toFixed(2)})` : `rgba(226,118,108,${a.toFixed(2)})`}"`;
        };
        const head = `<tr><th></th>${colsList.map(t => `<th class="num"><b>${t}</b><br><span class="detail-sub mu-names">${escapeHtml(unitNames(opp[t]))}</span></th>`).join("")}</tr>`;
        const body = rowsList.map(t => `<tr><td><b>${t}</b> <span class="detail-sub">${escapeHtml(unitNames(own[t]))}</span></td>${colsList.map(c => { const r = cell[t + "|" + c]; return `<td class="num mu-cell"${shade(r)}>${fmt(r)}</td>`; }).join("")}</tr>`).join("");
        // the same pairings as a list with every number, longest time together first
        const pct = (a, b) => (a + b > 0 ? Math.round(100 * a / (a + b)) + "%" : "&ndash;");
        const listRows = (g.mu || []).filter(r => r[0] === side && own[r[1]] && opp[r[2]]).sort((a, b) => b[3] - a[3]).map(r => {
          const [, a, b, toi, cf, ca, gf, ga, xgf, xga] = r;
          return [`<b>${a}</b> <span class="detail-sub">${escapeHtml(unitNames(own[a]))}</span>`, `<b>${b}</b> <span class="detail-sub">${escapeHtml(unitNames(opp[b]))}</span>`, toiStr(toi), cf, ca, pct(cf, ca),
            gf, ga, xgf.toFixed(2), xga.toFixed(2), scoreCell(Math.round((xgf - xga) * 100) / 100), pct(xgf, xga)];
        });
        const listHead = [{ label: "Unit" }, { label: "Against" }, ...["TOI", "CF", "CA", "CF%", "GF", "GA", "xGF", "xGA", "xG +/-", "xGF%"].map(label => ({ label, num: true }))];
        return `<div class="gv-group">${links.team(g[sd])} against ${escapeHtml(g[sd === "away" ? "home" : "away"])}'s lines and pairs</div>
          <div class="table-scroll"><table class="mu-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>
          <div class="board-sub">Every pairing</div><div class="unit-scroll">${statTable(listHead, listRows)}</div>
          ${listRows.length > 8 ? `<div class="scroll-hint">${listRows.length} pairings &middot; scroll the table to see them all</div>` : ""}`;
      };
      const matchupSectionsFor = (teams) => {
        if (unitPeriods || !(g.mu && g.mu.length)) return "";
        const tables = teams.map(matchupFor).join("");
        if (!tables) return "";
        const chips = `<div class="chips gv-mupick" role="group" aria-label="Matchup measure">${MU_METRICS.map(([k, label]) => `<button type="button" class="chip" aria-pressed="${muMetric === k}" data-gv-mu="${k}">${label}</button>`).join("")}</div>`;
        return `<div class="detail-h3">Matchups</div>${chips}${tables}
          <div class="panel-caption">Each row is one of the team's lines or pairs, each column one of the other team's, ranked by ice time that game. Every cell is the time they spent on the ice against each other at 5-on-5, with the shot-quality balance for that stretch under it: expected goals for minus against, shot attempts for&ndash;against, or goals. Green means the row's unit came out ahead, and the shading is darker the bigger the edge and the longer they were together. Under each grid, every pairing is listed with its full numbers: shot attempts (CF, CA and CF%), goals, expected goals (xGF, xGA, the difference and xGF%). Small stretches are small samples, so read the big blocks of time.</div>`;
      };
      const unitSectionsFor = (teams) => teams.map(team => {
        const parts = UNIT_SECTIONS.filter(([t]) => sit.unitTypes.includes(t)).map(([t, title]) => {
          const body = unitBody(t, unitPeriods, team);
          return body.length ? `<div class="detail-h3">${escapeHtml(team)} ${title.toLowerCase()}</div>` + unitTable(body, !unitPeriods && (t === "line" || t === "pair")) : "";
        }).join("");
        return parts ? `<div class="gv-group">${links.team(team)} lines, pairs &amp; special teams</div>${parts}` : "";
      }).join("") || '<div class="detail-h3">Lines, pairs &amp; special teams</div><div class="empty">No unit data in this view.</div>';

      // --- overtime: its own section for games that went past regulation (not while a period filter already narrows the page)
      const otSection = (() => {
        if (!hasOT) return "";
        const OT = [3], ALL = [0, 1, 2, 3, 4];
        const ot = (cells, fields) => named(sum(cells, fields, OT, ALL), fields);
        const ots = { away: ot(g.tc.away, TF), home: ot(g.tc.home, TF) };
        const goalsOT = g.goals.filter(x => Math.floor(x.cell / 5) === 3);
        const result = goalsOT.length
          ? goalsOT.map(x => `<strong>${links.team(x.team)}</strong> won it at ${x.time} of overtime: ${links.player(x.scorer_id, x.team, x.scorer)}${x.assists.length ? ` <span class="detail-sub">(${x.assists.map(a => (links.playerText || links.player)(a.id, x.team, a.name)).join(", ")})</span>` : ""} &middot; ${x.strength}`).join("<br>")
          : g.oc === "SO" ? "Nobody scored in overtime; the game was decided in a shootout." : g.live ? "No goal in overtime yet." : "No goal in overtime.";
        const orow = (label, fn) => [label, fn("away"), fn("home")];
        const otTeam = statTable([{ label: "" }, { label: g.away, num: true }, { label: g.home, num: true }], [
          orow("Time on ice", s2 => toiStr(ots[s2].toi)), orow("Shots on goal", s2 => ots[s2].sog), orow("Shot attempts", s2 => ots[s2].attempts),
          orow("Expected goals (xG)", s2 => teamXg(g.shots, s2 === "away" ? 0 : 1, [4]).toFixed(2)), orow("High-danger shots on goal", s2 => ots[s2].hdc),
          orow("Power-play time", s2 => toiStr(named(sum(g.tc[s2], TF, OT, [2]), TF).toi)),
        ], { sort: false });
        const KIND = { line: "Line", pair: "Pair", pp: "PP", pk: "PK", ev4: "4v4", ev3: "3v3" };
        const otUnitsFor = (team) => {
          const rows = [];
          UNIT_SECTIONS.forEach(([t]) => unitBody(t, [4], team).forEach(r => { r[0] = `<span class="detail-sub">${KIND[t]}</span> ${r[0]}`; rows.push(r); }));
          return rows.length ? unitTable(rows) : '<div class="empty">No unit data for overtime.</div>';
        };
        const otUnits = g.units.some(u => u[18] === undefined) ? '<div class="empty">Per-period unit data isn\'t available for this game yet.</div>'
          : [g.away, g.home].map(team => `<div class="board-sub">${links.team(team)}</div>${otUnitsFor(team)}`).join("");
        const otSk = (side) => {
          const rows = [];
          g.sk[side].forEach(r => {
            const v = named(sum(r[8], PF, OT, ALL), PF);
            if (v.toi === 0 && !v.g && !v.sog) return;
            rows.push([v.toi, [links.player(r[0], g[side], r[1]), r[2], toiStr(v.toi), v.g, v.a1 + v.a2, v.sog, v.xgf.toFixed(2), v.xga.toFixed(2), v.cf, v.ca, v.hdcf, v.hdca]]);
          });
          rows.sort((a, b) => b[0] - a[0]);
          return statTable([{ label: "Player" }, { label: "Pos" }, ...["TOI", "G", "A", "SOG", "xGF", "xGA", "CF", "CA", "HDCF", "HDCA"].map(label => ({ label, num: true }))], rows.map(x => x[1]));
        };
        const otShots = (g.shots || []).filter(x => x[0] === 4);
        const otMaps = otShots.length ? `<div class="gv-maps">${[0, 1].map(side => {
          const mine = otShots.filter(x => x[2] === side);
          return `<figure class="gv-map"><figcaption><strong>${side ? g.home : g.away}</strong> &middot; ${mine.length} unblocked shots in overtime, ${mine.filter(x => x[6] === 2).length} goals, ${mine.reduce((a2, x) => a2 + x[5], 0).toFixed(2)} xG</figcaption>${shotMapSvg(mine, names)}</figure>`;
        }).join("")}</div>` : "";
        return `<div class="gv-group gv-ot" data-gv-sec="ot">Overtime</div>
          <div class="panel-caption gv-ot-result">${result}</div>
          ${otTeam}
          <div class="detail-h3">Overtime shots</div>${otMaps || '<div class="empty">No shots in overtime.</div>'}
          <div class="detail-h3">${g.away} in overtime</div>${otSk("away")}
          <div class="detail-h3">${g.home} in overtime</div>${otSk("home")}
          <div class="detail-h3">Overtime units</div>${otUnits}
          <div class="panel-caption">Overtime only (the shootout is not part of these numbers). The Period filter above can also narrow every table on the page to OT.</div>`;
      })();

      const liveNote = g.live
        ? '<div class="panel-caption">' + (g.live.state === "LIVE" || g.live.state === "CRIT" ? "<strong>Live.</strong> " : "") + 'Game Score* is computed from the events so far; quality of competition/teammates and Adjusted Impact are added once the game is processed overnight.' + (g.ns ? " The NHL hasn't published a shift chart for this game yet, so ice time and on-ice stats will fill in when it does." : "") + '</div>'
        : "";
      const noShiftsNote = g.ns && !g.live
        ? '<div class="panel-caption"><strong>No shift data:</strong> the NHL did not publish a shift chart for this game, so ice time, on-ice stats (CF/CA, xGF/xGA), Game Score, QoC/QoT, Adjusted Impact and unit scores are unavailable. Goals, assists, shots, hits, blocks and the other event stats are real; period/situation filters still work on those.</div>'
        : "";
      const viewLabel = `${per.key === "all" ? "" : per.label + ", "}${sit.label.toLowerCase()}`;
      const filterNote = filtered
        ? `<div class="panel-caption">Showing ${escapeHtml(viewLabel)}. *Game Score is recomputed from just these events with the standard weights (unadjusted xG); QoC, QoT and Adjusted Impact are full-game measures and are hidden while a filter is on. Unit tables follow the period and situation filters.</div>`
        : "";


      // ---- game story
      const gameStory = (() => {
        const ALLS = [0, 1, 2, 3, 4], ALLP = [0, 1, 2, 3];
        const live = g.live && (g.live.state === "LIVE" || g.live.state === "CRIT");
        const finalWinner = g.as === g.hs ? null : (g.as > g.hs ? "away" : "home");
        const tm = { away: g.away, home: g.home };
        const T = { away: named(sum(g.tc.away, TF, ALLP, ALLS), TF), home: named(sum(g.tc.home, TF, ALLP, ALLS), TF) };
        const shots = g.shots || [];
        // --- who deserved to win
        let verdictHtml = "", dangerHtml = "";
        if (shots.length) {
          const [pa, pt, ph] = regulationOdds(shots);
          const wa = pa + pt / 2, wh = ph + pt / 2; // ties go to overtime, a coin flip
          const fav = wa >= wh ? "away" : "home", dog = fav === "away" ? "home" : "away", pf = Math.max(wa, wh);
          const strong = pf >= 0.7, edge = pf >= 0.55;
          const A = (s) => `<strong>${escapeHtml(tm[s])}</strong>`;
          let line;
          if (live) line = !edge ? `Even so far on shot quality.` : `${A(fav)} is ${strong ? "clearly" : "slightly"} ahead on shot quality so far${finalWinner === null && g.as === g.hs ? "" : ""}.`;
          else if (!edge) line = finalWinner ? `A toss-up on shot quality. ${A(finalWinner)} came out on top.` : `A toss-up on shot quality.`;
          else if (finalWinner === fav) line = strong ? `${A(fav)} won and deserved it: they created far the better chances.` : `${A(fav)} won with a modest edge in chances.`;
          else line = strong ? `${A(fav)} outplayed ${A(dog)} but lost. ${A(dog)} got the result the chances didn't earn.` : `${A(dog)} won a game ${A(fav)} slightly out-chanced.`;
          const bar = `<div class="gv-wp" role="img" aria-label="Win probability from shot quality"><span class="gv-wp-a" style="width:${(100 * wa).toFixed(1)}%">${(100 * wa).toFixed(0)}%</span><span class="gv-wp-h" style="width:${(100 * wh).toFixed(1)}%">${(100 * wh).toFixed(0)}%</span></div>`;
          // shot danger by band, whole game: chances are unblocked shot attempts, goals are the ones that scored
          // "chances" are shots on goal (saves plus goals); the band xG is the summed chance that each shot on goal scores (x[10])
          // empty-net attempts (the defending goalie is out) are not ordinary chances, so they get their own row (x[9] === 1)
          const band = (sd, b) => { const q = shots.filter(x => x[2] === sd && x[9] !== 1 && x[6] >= 1 && BAND(x) === b); return [q.length, q.filter(x => x[6] === 2).length, q.reduce((a, x) => a + (x[10] != null ? x[10] : x[5]), 0)]; };
          const enRow = (sd) => { const q = shots.filter(x => x[2] === sd && x[9] === 1); return [q.filter(x => x[6] >= 1).length, q.filter(x => x[6] === 2).length, q.reduce((a, x) => a + x[5], 0)]; };
          // axes: the danger bands run across the top, and each team gets a shots-on-goal, a goals and an xG row
          const bandCols = [["h", "High", "14%+"], ["m", "Medium", "7&ndash;14%"], ["l", "Low", "under 7%"]];
          const hasEmpty = shots.some(x => x[9] === 1);
          // one compact card: a row per team, the three danger bands across the top, and under each team a bar showing how its
          // shots split between the bands (red high, blue medium, gray low, the same colors as the shot maps)
          const dzHead = `<div class="dz-head"><span></span>${bandCols.map(([b, name, rule]) => `<span class="dz-h ${b}">${name}<small>${rule}</small></span>`).join("")}${hasEmpty ? '<span class="dz-h e">Empty net<small>goalie out</small></span>' : ""}<span class="dz-h t">Total<small>shots on goal</small></span></div>`;
          // Each cell is shaded by how the goals compared with the expected goals from those shots: green with a ▲ for more than expected,
          // red with a ▼ for fewer. The gap is judged against the size of the expectation (a one-goal gap on 0.5 expected goals is
          // far more unusual than on 3), so the darkest shade means an unusual result and ordinary bounces stay pale. The arrow
          // carries the meaning too, so it doesn't depend on telling green from red. The empty-net column has no expected goals:
          // whether a team scores on an empty net is decided by the score and the clock, not by shot quality.
          const cellHtml = (c, cls) => {
            const d = c[1] - c[2], z = d / Math.sqrt(Math.max(c[2], 0.5)), on = Math.abs(z) >= 0.75 && Math.abs(d) >= 0.3, sh = Math.round(14 + 30 * Math.min(1, (Math.abs(z) - 0.75) / 1.5));
            return `<span class="dz-c ${cls}${on ? (d > 0 ? " over" : " under") : ""}"${on ? ` style="--sh:${sh}%"` : ""} title="${d > 0 ? "+" : ""}${d.toFixed(2)} goals vs expected"><b>${c[0]}</b><small>${c[1]} G &middot; ${c[2].toFixed(2)} xG</small><small class="dz-gap">${on ? `${d > 0 ? "&#9650;" : "&#9660;"} ${Math.abs(d).toFixed(1)} ${d > 0 ? "over" : "under"}` : "&nbsp;"}</small></span>`;
          };
          const enCell = (c) => `<span class="dz-c e"><b>${c[0]}</b><small>${c[1]} G</small><small class="dz-gap">&nbsp;</small></span>`;
          const dzTeam = (sd, team) => {
            const cols = bandCols.map(([b]) => band(sd, b)), en = hasEmpty ? enRow(sd) : null;
            // the total counts every shot and goal (it matches the scoreboard); its expected goals are the goalie-in-net bands only, so the
            // goals it is compared with leave the empty-net goals out
            const bandTot = [0, 1, 2].map(i => cols.reduce((a, c) => a + c[i], 0));
            const tot = [bandTot[0] + (en ? en[0] : 0), bandTot[1] + (en ? en[1] : 0), bandTot[2]];
            const totCell = cellHtml([tot[0], bandTot[1], bandTot[2]], "t").replace(`${bandTot[1]} G &middot;`, `${tot[1]} G${en && en[1] ? ` (${en[1]} EN)` : ""} &middot;`);
            return `<div class="dz-team"><span class="dz-name">${escapeHtml(team)}</span>${bandCols.map(([b], k) => cellHtml(cols[k], b)).join("")}${en ? enCell(en) : ""}${totCell}</div>`;
          };
          const dangerTable = `<div class="detail-h3" data-gv-sec="danger">Shot danger</div>
            <div class="dz-wrap"><div class="dz" style="--dz-n:${bandCols.length + 1 + (hasEmpty ? 1 : 0)}">${dzHead}${dzTeam(0, g.away)}${dzTeam(1, g.home)}</div></div>
            <div class="panel-caption">Shots on goal with the goalie in net, by how likely each was to score. Under each count: goals scored and the summed chance of scoring (xG) from those shots, which runs a little different from the whole-game expected goals because that counts every unblocked attempt. <span class="dz-key"><i class="over"></i>&#9650; green: scored more than expected from those shots<i class="under"></i>&#9660; red: fewer than expected</span>. Shading is judged against the size of the expectation, so only unusual gaps are marked. Empty-net shots have no expected goals, and the total's expected goals leave them out. Shot attempts ${T.away.attempts}&ndash;${T.home.attempts}. Whole game, every situation.</div>`;
          dangerHtml = dangerTable;
          verdictHtml = `<div class="gv-verdict">${line}</div>
            <div class="gv-wp-head"><span>${escapeHtml(g.away)}</span><span class="detail-sub">chance to win on shot quality (${(100 * pt).toFixed(0)}% chance of overtime; it is split evenly)</span><span>${escapeHtml(g.home)}</span></div>${bar}`;
          dangerHtml = dangerTable;
        }
        // --- best and worst skaters
        const perf = [];
        for (const side of ["away", "home"]) g.sk[side].forEach(r => {
          const v = named(sum(r[8], PF, ALLP, ALLS), PF);
          if (!v.toi && !v.g && !v.sog) return;
          const adj = r[6] !== null && r[6] !== undefined, raw = r[3] !== null && r[3] !== undefined;
          const score = adj ? r[6] : (raw ? r[3] : sliceScore(v));
          perf.push({ id: r[0], name: r[1], pos: r[2], team: g[side], score, raw: raw ? r[3] : null, est: !adj && !raw, v });
        });
        perf.sort((x, y) => y.score - x.score);
        const pline = (p) => `${p.v.g}G ${p.v.a1 + p.v.a2}A, ${p.v.sog} SOG, ${toiStr(p.v.toi)}${p.v.cf + p.v.ca ? `, CF ${pct(p.v.cf, p.v.ca)}%` : ""}`;
        const perfList = (list) => `<ol class="gv-stars">${list.map(p => `<li>${links.player(p.id, p.team, p.name)} (${p.team}, ${p.pos}) &mdash; ${p.est ? scoreCell(Math.round(p.score * 100) / 100) : gsCell(p.score, "adj", true)}${p.est ? "*" : ""} <span class="detail-sub">adjusted${p.raw === null ? "" : ` &middot; raw ${gsCell(p.raw, gsKind(p.pos, false), false)}`}</span><br><span class="detail-sub">${pline(p)}</span></li>`).join("")}</ol>`;
        const nPerf = Math.min(3, Math.floor(perf.length / 2));
        const perfHtml = perf.length >= 2 ? `<div class="detail-h3">Top performers</div><div class="two-up"><div><div class="board-sub">Best skaters</div>${perfList(perf.slice(0, nPerf))}</div>
            <div><div class="board-sub">Worst skaters</div>${perfList(perf.slice(-nPerf).reverse())}</div></div>
            <div class="panel-caption">Ranked by Adjusted Game Score (Game Score plus credit for the competition faced, minus the average for his position)${perf.some(p => p.est) ? "; * is estimated from the events so far, since the full score isn't ready" : ""}.</div>` : "";
        // --- best and worst lines and pairs for each team (at least 3:00 together; 1:30 while the game is on, since the lines have
        // only had a few minutes each early on)
        const unitMinToi = g.live && (g.live.state === "LIVE" || g.live.state === "CRIT") ? 90 : 180, unitMinText = unitMinToi === 90 ? "1:30" : "3:00";
        const teamUnits = (team) => {
          const rows = [];
          [["line", "Forward line"], ["pair", "Defense pair"]].forEach(([type, label]) => {
            const us = g.units.filter(u => u[0] === team && u[1] === type && u[2] >= unitMinToi).sort((a, b) => b[12] - a[12]);
            if (!us.length) return;
            const pick = us.length === 1 ? [["only one", us[0]]] : [["best", us[0]], ["worst", us[us.length - 1]]];
            pick.forEach(([tag, u]) => rows.push([`${label} <span class="detail-sub">${tag}</span>`, unitText(u), toiStr(u[2]), `${u[6]}&ndash;${u[7]}`, `${u[8].toFixed(2)}&ndash;${u[9].toFixed(2)}`, scoreCell(u[12]), unitGradeHtml(u[12], unitSlotInGame(g, u))]));
          });
          return rows.length ? statTable([{ label: "" }, { label: "Unit" }, { label: "TOI", num: true }, { label: "GF&ndash;GA", num: true }, { label: "xGF&ndash;xGA", num: true }, { label: "Unit Score", num: true }, { label: "Grade" }], rows)
            : `<div class="empty">No line or pair had ${unitMinText} together.</div>`;
        };
        const unitsHtml = `<div class="two-up gv-units">${[g.away, g.home].map(team => `<div><div class="board-sub">${links.team(team)}</div>${teamUnits(team)}</div>`).join("")}</div>`;
        // --- special teams: good night or bad night, whatever the score says, for each team's power play and penalty kill
        const stRowsFor = (side, kind) => {
          const rows = [], opp = side === "away" ? "home" : "away", team = tm[side], pk = kind === "pk";
          // power play: this team's cell 2 (xGF); penalty kill: the opponent's power-play cell 2 (what this team allowed)
          const t = pk ? named(sum(g.tc[opp], TF, ALLP, [2]), TF) : named(sum(g.tc[side], TF, ALLP, [2]), TF);
          const toi = t.toi, xg = t.xgf, goals = t.goals;
          const unitsOf = g.units.filter(u => u[0] === team && u[1] === kind && u[2] >= 60).sort((a, b) => b[2] - a[2]);
          const rate = (toi_, x) => nightRating(pk ? LEAGUE_PP_XG60 * toi_ / 3600 - x : x - LEAGUE_PP_XG60 * toi_ / 3600, LEAGUE_PP_XG60 * toi_ / 3600);
          if (toi >= 30) {
            const [lab, cls] = toi >= 60 ? rate(toi, xg) : ["Too little time", ""];
            rows.push([`<strong>${kind === "pp" ? "Whole power play" : "Whole penalty kill"}</strong>`, toiStr(toi), xg.toFixed(2), (LEAGUE_PP_XG60 * toi / 3600).toFixed(2), goals, `<span class="night ${cls}">${lab}</span>`]);
            unitsOf.forEach(u => {
              const ux = pk ? u[9] : u[8], ug = pk ? u[7] : u[6], [l2, c2] = rate(u[2], ux);
              rows.push([unitText(u), toiStr(u[2]), ux.toFixed(2), (LEAGUE_PP_XG60 * u[2] / 3600).toFixed(2), ug, `<span class="night ${c2}">${l2}</span>`]);
            });
          }
          return rows;
        };
        const stTableFor = (side, kind, title, cols) => { const rows = stRowsFor(side, kind); return rows.length ? `<div class="board-sub">${title}</div>` + statTable([{ label: "Unit" }, { label: "TOI", num: true }, { label: cols[0], num: true }, { label: "Typical", num: true }, { label: cols[1], num: true }, { label: "Night" }], rows) : ""; };
        const stBlock = (side) => stTableFor(side, "pp", `${tm[side]} power play`, ["xGF", "Goals"]) + stTableFor(side, "pk", `${tm[side]} penalty kill`, ["xGA", "GA"]);
        const stHtml = (stBlock("away") || stBlock("home")) ? `<div class="two-up"><div>${stBlock("away")}</div><div>${stBlock("home")}</div></div>` : "";
        // the shareable card stays hidden until someone opens it (state.share: null or "card")
        const cardSide = state.card || "home", share = state.share || null;
        const makeSvg = (sd) => shareSvg(share, g, sd, cardLogoUri || null);
        const cardSection = `<div class="detail-h3">Shareable graphics</div>
          <div class="chips" role="group" aria-label="Shareable graphics">
            ${[["table", "Skater table (both teams)"], ["bars", "Game Score bars"], ["lines", "Lines, pairs & goalies"], ["card", "Full game card"]].map(([k, label]) =>
              `<button type="button" class="chip" aria-pressed="${share === k}" data-gv-share="${k}">${share === k ? "Hide " : ""}${label}</button>`).join("")}</div>
          ${share ? `<div class="gv-card-bar">${share === "table" ? "" : `<div class="chips" role="group" aria-label="Team">${["away", "home"].map(sd => `<button type="button" class="chip" aria-pressed="${cardSide === sd}" data-gv-card="${sd}">${escapeHtml(g[sd])}</button>`).join("")}</div>`}
            <button type="button" class="chip gv-card-save" data-gv-card-save="1">Save image (PNG)</button></div>
            <div class="gv-card-preview">${makeSvg(cardSide)}</div>
            <div class="panel-caption">${{
              table: "Every skater on both teams in one image: ice time, goals, assists, shots, shot danger, shot-attempt and chance differentials, and Game Score.",
              bars: "One team's Game Scores as a bar graph, forwards then defensemen, best first, colored by how good the game was. Pick a team, then save it as an image.",
              lines: "One team's four forward lines and three defense pairs by ice time, each with its Unit Score and a grade, then its goalies and their game grades. Pick a team, then save it as an image.",
              card: "The full card for one team's night: score and expected score, the verdict, every skater's stats, shot danger and Game Score, the best line and pair, goalie, power play and penalty kill, and shot maps by danger. Pick a team, then save it as an image."}[share]}</div>` : `<div class="panel-caption">Four shareable images: a table of every skater, a Game Score bar graph per team, lines, pairs and goalie grades per team, and the full game card. Open one to preview and save it.</div>`}`;
        // a compact one-line-per-team version of the special-teams nights for the summary; the per-unit tables live under Lines & special teams
        const stCompact = (() => {
          const cell = (side, kind) => { const r = stRowsFor(side, kind)[0]; return r ? `${r[5]} <span class="detail-sub">${r[2]} xG ${kind === "pp" ? "for" : "against"} (typical ${r[3]}), ${r[4]} goal${r[4] === 1 ? "" : "s"}</span>` : "&ndash;"; };
          const rows = ["away", "home"].map(sd => [links.team(g[sd]), cell(sd, "pp"), cell(sd, "pk")]);
          return rows.some(r => r[1] !== "&ndash;" || r[2] !== "&ndash;")
            ? `<div class="detail-h3">Special teams: good night or bad night?</div>${statTable([{ label: "Team" }, { label: "Power play" }, { label: "Penalty kill" }], rows)}<div class="panel-caption">Judged on the chances, not the score: expected goals against what the league's average power play (8.1 per 60 minutes) makes from the same time. Every unit's night is under Lines &amp; special teams.</div>` : "";
        })();
        // goalie grades for the game, away team first and the starter first within a team (nothing while the game is live)
        const goaliesHtml = (() => {
          const rows = g.gl.map(x => ({ x, gg: goalieGameGrade(x) })).filter(o => o.gg)
            .sort((a, b) => (a.x[2] === b.x[2] ? (a.gg.relief - b.gg.relief) || (b.gg.sf - a.gg.sf) : (a.x[2] === g.away ? -1 : 1)))
            .map(({ x, gg }) => [`${links.player(x[0], x[2], x[1])} <span class="detail-sub">${x[2]}</span>`, gg.sf, gg.ga, scoreCell(gg.gsax), gradeCell(gg)]);
          return rows.length ? `<div class="detail-h3">Goalies</div>${statTable([{ label: "Goalie" }, ...["SF", "GA", "GSAx"].map(label => ({ label, num: true })), { label: "Grade" }], rows)}
            <div class="panel-caption">Graded by goals saved above expected over the whole game: Great is more than +1.5, Quality +0.5 to +1.5, Average within 0.5, Bad -0.5 to -1.5, Blown worse than -1.5. A Stolen win is a Great or Quality game in a win when his team was out-chanced by a goal or more in expected goals; Bailed out is a Bad or Blown game in a win. Relief means another goalie on his team faced more shots.</div>` : "";
        })();
        return { verdict: verdictHtml, danger: dangerHtml, perf: perfHtml, st: stCompact, goalies: goaliesHtml,
          units: unitsHtml ? `<div class="detail-h3">Best and worst lines and pairs</div>${unitsHtml}<div class="panel-caption">Units with at least ${unitMinText} together${unitMinToi === 90 ? " (3:00 once the game is over)" : ""}, ranked by Unit Score. xGF&ndash;xGA shows how the chances went even where the score didn't. Every line and pair is under Lines &amp; special teams.</div>` : "",
          share: cardSection,
          stDetail: stHtml ? `<div class="detail-h3">Special teams nights, unit by unit</div>${stHtml}<div class="panel-caption">Judged on the chances, not the score. "Typical" is the expected goals the league's average power play (8.1 per 60 minutes) makes from the same time. A power play that creates more than that, or a penalty kill that allows less, had a good night, even if nothing went in. Needs a minute of ice time to judge.</div>` : "" };
      })();

      // ---- tabs: one part of the page at a time
      const hasOTtab = !!otSection;
      if (state.tab === "ot" && !hasOTtab) state.tab = "summary";
      // the game card is for a finished game: no tab while the game is in play
      const inPlay = !!(g.live && (g.live.state === "LIVE" || g.live.state === "CRIT"));
      if (state.tab === "share" && inPlay) state.tab = "summary";
      const tab = state.tab || "summary";
      const TABS_GV = [["summary", "Summary"], ["skaters", "Skaters"], ["units", "Lines & special teams"], ["shots", "Shots & goalies"],
        ...(hasOTtab ? [["ot", "Overtime"]] : []), ...(inPlay ? [] : [["share", "Game card"]])];
      navEl.innerHTML = TABS_GV.map(([k, label]) => `<button type="button" role="tab" class="chip" aria-pressed="${tab === k}" aria-selected="${tab === k}" data-gv-tab="${k}">${label}</button>`).join("");
      // the filters only mean something on the tabs whose numbers they change
      renderFilters();
      // the team picker for the skater and unit tabs (one team at a time keeps them short; "Both" shows both)
      const teamSel = state.team || "away";
      const teamSides = teamSel === "both" ? ["away", "home"] : [teamSel];
      const teamPicker = `<div class="chips gv-teampick" role="group" aria-label="Team">${[["away", g.away], ["home", g.home], ["both", "Both teams"]].map(([k, label]) => `<button type="button" class="chip" aria-pressed="${teamSel === k}" data-gv-team="${k}">${escapeHtml(label)}</button>`).join("")}</div>`;
      topEl.innerHTML = `${line}${liveNote}${noShiftsNote}`;
      let pane = "";
      if (tab === "summary") pane = `${gameStory.verdict}
        <div class="detail-h3">Scoring</div>${goals}
        <div class="two-up gv-split"><div><div class="detail-h3">Team stats</div>${teamStats}${gameStory.goalies}</div>
          <div>${gameStory.perf}<div class="detail-h3">Penalties</div>${pens}${gameStory.st}</div></div>
        ${gameStory.danger}${gameStory.units}`;
      else if (tab === "skaters") pane = `${filterNote}${teamSides.map(sd => `<div class="detail-h3">${escapeHtml(g[sd])} skaters</div>${sd === teamSides[0] ? skNote : ""}${skTable(sd)}`).join("")}`;
      else if (tab === "units") pane = `${filterNote}${unitSplitNote}${unitSectionsFor(teamSides.map(sd => g[sd]))}${matchupSectionsFor(teamSides)}${gameStory.stDetail}`;
      else if (tab === "shots") pane = `${filterNote}<div class="detail-h3">Goalies</div>${goalies}
        ${goalieDanger ? `<div class="detail-h3">Goalies by shot danger</div>${goalieDanger}<div class="panel-caption">Shots on goal split by how likely each was to score. GSAx is expected goals against minus goals allowed in that band, so it shows where a goalie won or lost the game: stopping the dangerous shots, or just the routine ones.</div>` : ""}
        ${chartSections}`;
      else if (tab === "ot") pane = otSection;
      else if (tab === "share") pane = gameStory.share;
      bodyEl.innerHTML = `${pane}
        <div class="panel-caption" style="margin-top:20px">Game Score is the descriptive per-game score; Adjusted adds credit for the quality of the competition faced and subtracts the average for the player's position, so 0 is an average forward's or defenseman's game (QoT, the quality of linemates, is shown as context; see Methodology). xG, CF/CA and xGF/xGA are on-ice numbers for each skater in every situation, including empty-net time. Filters sort each event by the situation its own team was in at that moment.</div>`;
    }

    prepare();
    renderHead();
    renderFilters();
    renderBody();
    if (cardLogoUri === undefined) {
      cardLogoUri = null;
      cardLogos().then(u => { cardLogoUri = u; const el = bodyEl.querySelector(".gv-card-preview"); if (el && u) el.innerHTML = shareSvg(state.share, g, state.card || "home", u); });
    }
    return {
      update(g2) {
        g = g2;
        prepare();
        renderHead();
        renderFilters();
        renderBody();
      },
    };
  }

  // the skaters (with their Adjusted Game Score) and goalies (with their grade) of one finished game, for the Home page's stars of the night
  function nightStars(g) {
    const live = g.live && (g.live.state === "LIVE" || g.live.state === "CRIT");
    if (live) return { skaters: [], goalies: [] };
    const skaters = [];
    ["away", "home"].forEach(side => g.sk[side].forEach(r => {
      if (r[6] === null || r[6] === undefined) return;
      skaters.push({ pid: r[0], name: r[1], pos: r[2], team: g[side], opp: side === "away" ? g.home : g.away, loc: side === "away" ? "@" : "vs", adj: r[6], raw: r[3] });
    }));
    const goalies = g.gl.map(x => ({ x, gg: gradeForGoalie(g, x) })).filter(o => o.gg).map(({ x, gg }) => ({
      pid: x[0], name: x[1], team: x[2], opp: x[2] === g.home ? g.away : g.home, loc: x[2] === g.home ? "vs" : "@",
      sf: gg.sf, ga: gg.ga, gsax: gg.gsax, gr: gg.gr, tags: gg.tags, relief: gg.relief }));
    return { skaters, goalies };
  }
  // used by the home page: the shareable card for one team's night, and saving it as an image
  return {
    mount,
    cardLogos,
    pctCardSvg,
    savePctCard,
    tileStats,
    nightStars,
    card: (g, key, logos) => { const { kind, side } = parseCardKey(key); return shareSvg(kind, g, side, logos || null); },
    // the card as a PNG data URL (the email job renders cards through this in a headless browser)
    cardPngDataUrl: async (g, key, logos) => {
      const { kind, side } = parseCardKey(key), svg = shareSvg(kind, g, side, logos || null), [, W, H] = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
      const blob = await cardPng(svg, +W, +H);
      return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
    },
    saveCard: (g, key, logos) => { const { kind, side } = parseCardKey(key); return saveCardImage(shareSvg(kind, g, side, logos || null), cardFileName(g, kind, side)); },
  };
})();

// ---- click-to-sort for every table marked class="auto-sort" (statTable adds it to tables of four or more comparable rows; the hand-built tables
// carry it too). Click a header to sort by that column: numbers and times high-to-low first, text A-Z first; click again to reverse, a third
// time to go back to the original order. Blank cells always sort last, and a totals row ("Season", "Total", "All other ...") stays at the bottom.
(function () {
  if (typeof document === "undefined" || window.__autoSortWired) return;
  window.__autoSortWired = true;
  const cellKey = (td) => {
    const text = td.textContent.replace(/\s+/g, " ").trim();
    if (td.dataset.sort !== undefined) return td.dataset.sort === "" ? null : { n: parseFloat(td.dataset.sort), s: text };   // a cell can say what it sorts by
    if (!text || /^[–—-]$/.test(text)) return null;
    const m = text.replace(/−/g, "-");
    let x;
    if ((x = m.match(/^(\d+):(\d{2})$/))) return { n: +x[1] * 60 + +x[2], s: text };                        // a time on ice
    if ((x = m.match(/^([+\-–]?)(\d+(?:\.\d+)?)%?$/))) return { n: (x[1] === "-" || x[1] === "–" ? -1 : 1) * parseFloat(x[2]), s: text };   // 12, +0.45, 53%
    if ((x = m.match(/^(\d+(?:\.\d+)?)\s*–\s*(\d+(?:\.\d+)?)$/))) return { n: parseFloat(x[1]) - parseFloat(x[2]), s: text };               // 8-6: for minus against
    const tier = td.querySelector('[class*="gs-t"]');
    if (tier) { const t = tier.className.match(/gs-t(\d)/); if (t) return { n: +t[1], s: text }; }                               // a grade chip: by its tier
    if ((x = m.match(/^([+\-]?\d+(?:\.\d+)?)(?!\d)/)) && !/^\d{4}-\d/.test(m) && !/^\d\d-\d\d$/.test(m)) return { n: parseFloat(x[1]), s: text };   // "5 days of rest"
    const who = td.querySelector("[data-open-player]");                                                                            // a player's name: by last name
    if (who) { const w = who.textContent.trim().split(" "); return { n: null, s: (w.slice(-1)[0] + " " + w.slice(0, -1).join(" ")).toLowerCase() }; }
    return { n: null, s: text.toLowerCase() };
  };
  document.addEventListener("click", (ev) => {
    const th = ev.target.closest("table.auto-sort thead th");
    if (!th || ev.target.closest("a, button")) return;
    const table = th.closest("table"), headRows = table.tHead.rows;
    if (th.parentElement !== headRows[headRows.length - 1]) return;      // only the last header row names the columns
    const col = th.cellIndex, tbody = table.tBodies[0];
    if (!tbody) return;
    const all = [...tbody.rows];
    const pinned = all.filter(r => /(^|\s)(gl-total|pin)(\s|$)/.test(r.className) || /^(Total|Season|All other)/i.test((r.cells[0] || {}).textContent.trim() || ""));
    const rows = all.filter(r => !pinned.includes(r) && r.cells.length > col);
    rows.forEach((r, i) => { if (r.dataset.sortI === undefined) r.dataset.sortI = i; });
    const keyed = rows.map(r => ({ r, k: cellKey(r.cells[col]) }));
    const numeric = keyed.filter(o => o.k && o.k.n !== null).length >= keyed.filter(o => o.k).length / 2;
    const st = table.dataset.sortCol === String(col) ? table.dataset.sortDir : "";
    const dir = st === "" ? (numeric ? "desc" : "asc") : st === "desc" ? (numeric ? "asc" : "desc") : st === "asc" ? (numeric ? "none" : "desc") : "none";
    const fin = numeric ? dir : dir;   // (numeric: desc, asc, original; text: asc, desc, original)
    table.querySelectorAll("th").forEach(h => { h.removeAttribute("aria-sort"); const a = h.querySelector(".sort-arrow"); if (a) a.remove(); });
    if (dir === "none") { table.dataset.sortCol = ""; table.dataset.sortDir = ""; keyed.sort((a, b) => a.r.dataset.sortI - b.r.dataset.sortI); }
    else {
      table.dataset.sortCol = String(col); table.dataset.sortDir = fin;
      const sign = fin === "desc" ? -1 : 1;
      keyed.sort((a, b) => {
        if (!a.k && !b.k) return a.r.dataset.sortI - b.r.dataset.sortI;
        if (!a.k) return 1; if (!b.k) return -1;                          // blanks last whichever way it sorts
        const c = numeric && a.k.n !== null && b.k.n !== null ? a.k.n - b.k.n : String(a.k.s).localeCompare(String(b.k.s), undefined, { numeric: true });
        return c ? sign * c : a.r.dataset.sortI - b.r.dataset.sortI;
      });
      th.setAttribute("aria-sort", fin === "desc" ? "descending" : "ascending");
      th.insertAdjacentHTML("beforeend", `<span class="sort-arrow">${fin === "desc" ? "&#9662;" : "&#9652;"}</span>`);
    }
    keyed.forEach(o => tbody.appendChild(o.r));
    pinned.forEach(r => tbody.appendChild(r));                            // totals stay at the bottom
  });
})();
