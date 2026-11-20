const DATA = __DATA_JSON__;
const INITIAL_HASH = location.hash; // before the tab code rewrites it

// --- season handling: every per-season thing (leaderboards, indexes, team and
// game files) is looked up through SEASON, so switching seasons is just
// re-rendering with a different key.
let SEASON = DATA.default;
try {
  const saved = localStorage.getItem("shiftscore-season");
  if (saved && DATA.by_season[saved]) SEASON = saved;
} catch (e) {}
const S = () => DATA.by_season[SEASON];
// The leaderboard boards (best and worst single games, lines, pairs, special teams, season averages...) are most of a season's data and only the
// Leaderboards tab reads them, so they live in data/{season}/boards.json and are fetched when that tab opens (a season built before that change
// still carries them inline, and needs no fetch).
const boardsLoading = {};
async function ensureBoards(season) {
  const by = DATA.by_season[season || SEASON];
  if (!by || by.lines !== undefined || by.boards_loaded) return;
  const id = season || SEASON;
  boardsLoading[id] = boardsLoading[id] || fetchJson(`data/${id}/boards.json`).then(b => { Object.assign(by, b); by.boards_loaded = true; }, () => { delete boardsLoading[id]; });
  await boardsLoading[id];
}

const TABS = [
  {
    key: "home", label: "Home", title: "Scoreboard", special: "home",
    caption: "Today's games, live as they play. Browse other days with the date bar. Tap a finished game to open it; the card buttons on each game show its shareable cards when they are ready.",
  },
  {
    key: "live", label: "Live", title: "Live Games", special: "live",
    caption: "Games in progress, updated about once a minute while the live feed is running (game nights). Open a game for the full box score with period and situation filters.",
  },
  {
    key: "games", label: "Games", title: "Games", special: "games",
    caption: "Every game of the season, newest first. Open one for the full box score — scoring, team stats, every skater's Game Score and Adjusted Impact, goalies, and line / pair / special-teams unit scores.",
  },
  {
    key: "player_games", label: "Player Games", title: "Top Player Games",
    caption: "Best single-game performances, adjusted for the quality of the competition faced (Adjusted = Raw Game Score + credit for the competition faced - the average for his position, so 0 is average for a forward or defenseman). Click a date to open that game's box score.",
    cols: [
      { k: "player", label: "Player" },
      { k: "team", label: "Team" },
      { k: "date", label: "Date" },
      { k: "toi", label: "TOI", num: true },
      { k: "raw", label: "Raw", num: true, dec: 2 },
      { k: "qoc", label: "QoC", num: true, dec: 2 },
      { k: "qot", label: "QoT", num: true, dec: 2 },
      { k: "adjusted", label: "Adjusted", num: true, signed: true, gs: "adj" },
      { k: "ixg", label: "ixG", num: true, dec: 2 },
    ],
  },
  {
    key: "season_xg", label: "Season xG", title: "Season Expected-Goals Leaders",
    caption: "“Goals − ixG” is a rough finishing indicator — positive means scoring above what shot quality alone predicts.",
    cols: [
      { k: "player", label: "Player" },
      { k: "team", label: "Team" },
      { k: "gp", label: "GP", num: true },
      { k: "toi", label: "TOI", num: true },
      { k: "goals", label: "Goals", num: true },
      { k: "shots", label: "Shots", num: true },
      { k: "total_ixg", label: "Total ixG", num: true, dec: 2 },
      { k: "goals_above_ixg", label: "Goals − ixG", num: true, signed: true },
    ],
  },
  {
    key: "season_avg", label: "Season Averages", title: "Average Game Score",
    caption: "Each skater's average Game Score per game this season. Adjusted adds credit for the quality of the competition faced and subtracts the average for his position, so 0 is an average forward's or defenseman's game; raw is the plain score.",
    cols: [
      { k: "player", label: "Player" },
      { k: "team", label: "Team" },
      { k: "gp", label: "GP", num: true },
      { k: "avg_adjusted", label: "Avg Adjusted", num: true, signed: true, gs: "avg" },
      { k: "avg_raw", label: "Avg Raw", num: true, dec: 2 },
      { k: "goals", label: "G", num: true },
      { k: "assists", label: "A", num: true },
      { k: "toi", label: "TOI", num: true },
    ],
  },
  {
    key: "goalies", label: "Goalies", title: "Goalies",
    caption: "GSAx (Goals Saved Above Expected) = the chance each shot on goal he faced had of scoring (from the shot-quality model), added up, minus the goals he allowed.",
    cols: [
      { k: "goalie", label: "Goalie" },
      { k: "team", label: "Team" },
      { k: "gp", label: "GP", num: true },
      { k: "sf", label: "Shots Faced", num: true },
      { k: "ga", label: "Goals Allowed", num: true },
      { k: "xga", label: "xGA", num: true, dec: 2 },
      { k: "gsax", label: "GSAx", num: true, signed: true },
      { k: "sv_pct", label: "Sv%", num: true },
    ],
  },
  {
    key: "goalie_games", label: "Goalie Games", title: "Top Goalie Games",
    caption: "Single games by a goalie, ranked by GSAx (Goals Saved Above Expected): the chance each shot on goal he faced had of scoring, added up, minus the goals he allowed. Goalies who faced at least 10 shots.",
    cols: [
      { k: "goalie", label: "Goalie" },
      { k: "team", label: "Team" },
      { k: "date", label: "Date" },
      { k: "opp", label: "Opp" },
      { k: "sf", label: "Shots", num: true },
      { k: "ga", label: "GA", num: true },
      { k: "xga", label: "xGA", num: true, dec: 2 },
      { k: "gsax", label: "GSAx", num: true, signed: true },
      { k: "sv_pct", label: "Sv%", num: true },
      { k: "grade", label: "Grade" },
    ],
  },
  {
    key: "goalie_avg", label: "Goalie Averages", title: "Goalie Season Averages",
    caption: "Each goalie's goals saved above expected (GSAx) per game this season: the chance each shot on goal he faced had of scoring, added up, minus the goals he allowed, divided by games played.",
    cols: [
      { k: "goalie", label: "Goalie" },
      { k: "team", label: "Team" },
      { k: "gp", label: "GP", num: true },
      { k: "gsax", label: "GSAx", num: true, signed: true, dec: 1 },
      { k: "gsax_pg", label: "GSAx / game", num: true, signed: true, dec: 2 },
      { k: "sv_pct", label: "Sv%", num: true },
    ],
  },
  {
    key: "lines_avg", label: "Lines Averages", title: "Forward Line Season Ratings",
    caption: "Each forward line's season rating: its Unit Score per 60 minutes together, pulled toward zero as if it had 100 more minutes of average play, so a short stretch can't top the list.",
    cols: [
      { k: "unit", label: "Unit" },
      { k: "team", label: "Team" },
      { k: "gp", label: "GP", num: true },
      { k: "toi", label: "TOI", num: true },
      { k: "rating", label: "Rating / 60", num: true, signed: true, dec: 2 },
      { k: "avg", label: "Avg / game", num: true, signed: true, dec: 2 },
    ],
  },
  {
    key: "pairs_avg", label: "D Pairs Averages", title: "Defense Pair Season Ratings",
    caption: "Each defense pair's season rating: its Unit Score per 60 minutes together, pulled toward zero as if it had 100 more minutes of average play, so a short stretch can't top the list.",
    cols: [
      { k: "unit", label: "Unit" },
      { k: "team", label: "Team" },
      { k: "gp", label: "GP", num: true },
      { k: "toi", label: "TOI", num: true },
      { k: "rating", label: "Rating / 60", num: true, signed: true, dec: 2 },
      { k: "avg", label: "Avg / game", num: true, signed: true, dec: 2 },
    ],
  },
  {
    key: "pp_avg", label: "Power Play Averages", title: "Power Play Unit Season Ratings",
    caption: "Each power-play unit's season rating: its Unit Score per 60 minutes together, pulled toward zero as if it had 100 more minutes of average play, so a short stretch can't top the list.",
    cols: [
      { k: "unit", label: "Unit" },
      { k: "team", label: "Team" },
      { k: "gp", label: "GP", num: true },
      { k: "toi", label: "TOI", num: true },
      { k: "rating", label: "Rating / 60", num: true, signed: true, dec: 2 },
      { k: "avg", label: "Avg / game", num: true, signed: true, dec: 2 },
    ],
  },
  {
    key: "pk_avg", label: "Penalty Kill Averages", title: "Penalty Kill Unit Season Ratings",
    caption: "Each penalty-kill unit's season rating: its Unit Score per 60 minutes together, pulled toward zero as if it had 100 more minutes of average play, so a short stretch can't top the list.",
    cols: [
      { k: "unit", label: "Unit" },
      { k: "team", label: "Team" },
      { k: "gp", label: "GP", num: true },
      { k: "toi", label: "TOI", num: true },
      { k: "rating", label: "Rating / 60", num: true, signed: true, dec: 2 },
      { k: "avg", label: "Avg / game", num: true, signed: true, dec: 2 },
    ],
  },
  {
    key: "team_stats", label: "Team Stats", title: "Team Leaderboards",
    caption: "Pick a stat to rank all 32 teams by it. The same rankings show next to each stat on every team's page.",
    cols: [],
  },
  {
    key: "lines", label: "Lines", title: "Forward Lines",
    caption: "Best single-game line performances by on-ice differential (min. 60s together). Click a unit's name for its season page and game-by-game scores (units with 10+ min together on the season); click a date for the game.",
    cols: unitCols(),
  },
  {
    key: "pairs", label: "D Pairs", title: "Defense Pairs",
    caption: "Best single-game D-pair performances by on-ice differential (min. 60s together). Click a unit's name for its season page and game-by-game scores.",
    cols: unitCols(),
  },
  {
    key: "pp", label: "Power Play", title: "Power Play Units",
    caption: "Best single-game power-play performances by on-ice differential (min. 20s together). Click a unit's name for its season page (units with 3+ min together on the season).",
    cols: unitCols(),
  },
  {
    key: "pk", label: "Penalty Kill", title: "Penalty Kill Units",
    caption: "Best single-game penalty-kill performances by on-ice differential (min. 20s together). Click a unit's name for its season page (units with 3+ min together on the season).",
    cols: unitCols(),
  },
  {
    key: "teams", label: "Teams", title: "Teams", special: "teams",
    caption: "Every team's roster, goalies, lines and special-teams units, and full schedule with results. Click a team to open it, click any player to see their own page.",
  },
  {
    key: "how", label: "How It Works", title: "How It Works", static: true,
    caption: "What each score means, and what the numbers can and can't tell you.",
  },
];

// --- Navigation: seven top-level tabs (Home, Games, Teams, Skaters, Goalies, Units, Methodology).
// The ranking tables above are not tabs of their own: each sits inside the tab it ranks (skater boards under Skaters, the goalie
// board under Goalies, lines, pairs and special teams under Units, the team board under Teams). BOARDS keeps their definitions;
// TABS is rebuilt as the real tabs.
const BOARDS = TABS.filter(t => !t.special && !t.static);
const SPECIAL = Object.fromEntries(TABS.filter(t => t.special || t.static).map(t => [t.key, t]));
TABS.length = 0;
TABS.push(
  SPECIAL.home,
  SPECIAL.games,
  SPECIAL.teams,
  {
    key: "power", label: "Power Rankings", title: "Power Rankings", special: "power",
    caption: "Every team ranked by a power rating, with the stats behind it. Click a column to sort, switch to league ranks, or click a team to open it.",
  },
  {
    key: "odds", label: "Playoff Odds", title: "Playoff Odds", special: "odds",
    caption: "Each team's chance of making the playoffs, winning its division and finishing with the most points, from simulating the rest of the season 10,000 times. Click a column to sort, or click a team to open it.",
  },
  {
    key: "leaderboards", label: "Leaderboards", title: "Leaderboards", special: "leaderboards",
    caption: "The best and worst of the season: single games and season averages by Game Score, forward lines, defense pairs, power-play and penalty-kill units by Unit Score, and goalies by goals saved above expected.",
  },
  {
    key: "skaters", label: "Skaters", title: "Skaters", special: "skaters",
    caption: "Every skater who played this season. Click a column to sort; click a name for the full season summary and game-by-game log.",
  },
  {
    key: "goalies", label: "Goalies", title: "Goalies", special: "goalies",
    caption: "Every goalie who played this season. Click a column to sort; click a name for the goalie's page.",
  },
  {
    key: "units", label: "Units", title: "Units", special: "units",
    caption: "Every regular forward line, defense pair, power-play and penalty-kill unit this season, with season totals. Click a column to sort; click a unit to open it.",
  },
  { key: "glossary", label: "Glossary", title: "Glossary", static: true, html: () => glossaryHtml(),
    caption: "Every stat name on the site, in plain words. Hover any underlined heading elsewhere for the same definition." },
  Object.assign(SPECIAL.how, { label: "Methodology", title: "Methodology" })
);

function unitCols() {
  return [
    { k: "unit", label: "Unit" },
    { k: "team", label: "Team" },
    { k: "date", label: "Date" },
    { k: "toi", label: "TOI" },
    { k: "cf", label: "CF", num: true },
    { k: "ca", label: "CA", num: true },
    { k: "gf", label: "GF", num: true },
    { k: "ga", label: "GA", num: true },
    { k: "xgf", label: "xGF", num: true, dec: 2 },
    { k: "xga", label: "xGA", num: true, dec: 2 },
    { k: "hdcf", label: "HDC For", num: true },
    { k: "hdca", label: "HDC Agn", num: true },
    { k: "score", label: "Unit Score", num: true, signed: true },
  ];
}

function fmt(v, signed) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    const s = String(v);
    return signed && v > 0 ? "+" + s : s;
  }
  return String(v);
}
function numClass(col, val) {
  if (!col.signed || typeof val !== "number") return "";
  if (val > 0) return "pos";
  if (val < 0) return "neg";
  return "";
}
// links that open things elsewhere in the page — handled by one document-level
// listener (see bottom), so they work from any tab
const gameLink = (gid, home, text) => `<a class="row-link" data-open-game="${gid}" data-game-home="${home}">${escapeHtml(text)}</a>`;
// Team logos and player photos: the page can only show images that ship with it, so they are fetched once
// (data/logos.json, data/photos/{TEAM}.json) and swapped into empty placeholders by hydrateImages() below.
const initials = (name) => { const w = String(name || "").trim().split(/\s+/); return ((w[0] || "")[0] || "") + ((w.length > 1 ? w[w.length - 1] : "")[0] || ""); };
const logoSpan = (abbrev, extra) => `<span class="tlogo${extra ? " " + extra : ""}" data-team="${abbrev}"></span>`;
const avatarSpan = (id, name, extra) => `<span class="avatar${extra ? " " + extra : ""}" data-pid="${id}" data-ini="${escapeHtml(initials(name))}"></span>`;
const playerLink = (id, team, text) => `<a class="row-link" data-open-player="${id}" data-player-team="${team}">${avatarSpan(id, text)}${escapeHtml(text)}</a>`;
const playerTextLink = (id, team, text) => `<a class="row-link" data-open-player="${id}" data-player-team="${team}">${escapeHtml(text)}</a>`;
const TEAM_NAMES = { ANA: "Anaheim Ducks", BOS: "Boston Bruins", BUF: "Buffalo Sabres", CGY: "Calgary Flames", CAR: "Carolina Hurricanes", CHI: "Chicago Blackhawks",
  COL: "Colorado Avalanche", CBJ: "Columbus Blue Jackets", DAL: "Dallas Stars", DET: "Detroit Red Wings", EDM: "Edmonton Oilers", FLA: "Florida Panthers",
  LAK: "Los Angeles Kings", MIN: "Minnesota Wild", MTL: "Montr\u00e9al Canadiens", NSH: "Nashville Predators", NJD: "New Jersey Devils", NYI: "New York Islanders",
  NYR: "New York Rangers", OTT: "Ottawa Senators", PHI: "Philadelphia Flyers", PIT: "Pittsburgh Penguins", SJS: "San Jose Sharks", SEA: "Seattle Kraken",
  STL: "St. Louis Blues", TBL: "Tampa Bay Lightning", TOR: "Toronto Maple Leafs", UTA: "Utah Mammoth", VAN: "Vancouver Canucks", VGK: "Vegas Golden Knights",
  WSH: "Washington Capitals", WPG: "Winnipeg Jets" };
const teamName = (abbrev) => (abbrev === "UTA" && SEASON === "20242025" ? "Utah Hockey Club" : TEAM_NAMES[abbrev] || abbrev);
const teamLink = (abbrev) => `<a class="row-link" data-open-team="${abbrev}">${logoSpan(abbrev)}${abbrev}</a>`;
// a unit's key ends with its players' ids (TEAM-type-id-id-id), so a unit can show its players' headshots without carrying them separately
// the row above a detail page: the back button, and a button that copies this page's address
const detailNav = (backHtml) => `<div class="detail-nav">${backHtml}<button type="button" class="copy-link" data-copy-link>Copy link</button></div>`;
const unitFaces = (key, text) => { const ids = String(key).split("-").slice(2), names = String(text).split(", ");
  return `<span class="faces">${ids.map((id, i) => avatarSpan(id, names[i] || "")).join("")}</span>`; };
const unitLink = (key, team, text) => unitFaces(key, text) + `<a class="row-link" data-open-unit="${key}" data-unit-team="${team}">${escapeHtml(text)}</a>`;

// Leaderboards ship a deeper pool of rows than they show (see site_export.POOL) so the ice-time
// qualifier slider can drop low-TOI rows and still fill the list. The pool is already ranked by the board's metric.
const BOARD_LIMIT = { player_games: 150 };
const boardLimit = (key) => BOARD_LIMIT[key] || 75;
// Each board's qualifier: ice time for skaters and units (whole-season totals use a coarser step than one game),
// games played for goalies.
const QUALIFIERS = {
  player_games: { field: "toi_sec", step: 30, label: "Minimum ice time in the game", fmt: (v) => toiStr(v) },
  lines: { field: "toi_sec", step: 30, label: "Minimum ice time together in the game", fmt: (v) => toiStr(v) },
  pairs: { field: "toi_sec", step: 30, label: "Minimum ice time together in the game", fmt: (v) => toiStr(v) },
  pp: { field: "toi_sec", step: 10, label: "Minimum ice time together in the game", fmt: (v) => toiStr(v) },
  pk: { field: "toi_sec", step: 10, label: "Minimum ice time together in the game", fmt: (v) => toiStr(v) },
  season_xg: { field: "toi_sec", step: 600, label: "Minimum season ice time", fmt: (v) => toiStr(v) },
  goalies: { field: "gp", step: 1, label: "Minimum games played", fmt: (v) => String(v) },
  goalie_games: { field: "sf", step: 1, label: "Minimum shots faced in the game", fmt: (v) => String(v) },
  goalie_avg: { field: "gp", step: 1, label: "Minimum games played", fmt: (v) => String(v) },
  lines_avg: { field: "toi_sec", step: 60, label: "Minimum season ice time together", fmt: (v) => toiStr(v) },
  pairs_avg: { field: "toi_sec", step: 60, label: "Minimum season ice time together", fmt: (v) => toiStr(v) },
  pp_avg: { field: "toi_sec", step: 30, label: "Minimum season ice time together", fmt: (v) => toiStr(v) },
  pk_avg: { field: "toi_sec", step: 30, label: "Minimum season ice time together", fmt: (v) => toiStr(v) },
  season_avg: { field: "gp", step: 1, label: "Minimum games played", fmt: (v) => String(v) },
};
// Boards with a "worst" side: the export ships ranked best-first lists (and, for the single-game and unit boards, a worst-first list
// of its own); the season averages and goalies are full lists the page sorts itself.
const HAS_WORST = new Set(["player_games", "goalie_games", "goalie_avg", "season_avg", "goalies", "lines", "pairs", "pp", "pk", "lines_avg", "pairs_avg", "pp_avg", "pk_avg"]);
const SORT_FIELD = { season_avg: "avg_adjusted", goalies: "gsax", goalie_avg: "gsax_pg" };
const ROWS_SRC = { goalie_avg: "goalies" };   // boards the page sorts itself from another board's rows
const BOARD_TITLES = {
  player_games: ["Best Single Games", "Worst Single Games"],
  season_avg: ["Best Average Game Scores", "Worst Average Game Scores"],
  goalies: ["Best Goalies by GSAx", "Worst Goalies by GSAx"],
  goalie_games: ["Best Goalie Games", "Worst Goalie Games"],
  goalie_avg: ["Best Goalie Averages", "Worst Goalie Averages"],
  lines_avg: ["Best Forward Line Ratings", "Worst Forward Line Ratings"], pairs_avg: ["Best D Pair Ratings", "Worst D Pair Ratings"],
  pp_avg: ["Best Power Play Unit Ratings", "Worst Power Play Unit Ratings"], pk_avg: ["Best Penalty Kill Unit Ratings", "Worst Penalty Kill Unit Ratings"],
  lines: ["Best Forward Lines", "Worst Forward Lines"], pairs: ["Best D Pairs", "Worst D Pairs"],
  pp: ["Best Power Play Units", "Worst Power Play Units"], pk: ["Best Penalty Kill Units", "Worst Penalty Kill Units"],
};
function boardRows(tab, dir) {
  const key = tab.key, worst = dir === "worst" && HAS_WORST.has(key);
  if (SORT_FIELD[key]) { const f = SORT_FIELD[key]; return (S()[ROWS_SRC[key] || key] || []).slice().sort((a, b) => (worst ? a[f] - b[f] : b[f] - a[f])); }
  return worst ? (S()[key + "_worst"] || []) : (S()[key] || []);
}
function toiSlider(tab) {
  const q = QUALIFIERS[tab.key];
  if (!q) return null;
  const rows = boardRows(tab, "best").concat(HAS_WORST.has(tab.key) ? boardRows(tab, "worst") : []);
  const max = rows.reduce((m, r) => Math.max(m, r[q.field] || 0), 0);
  return Object.assign({ max: Math.ceil(max / q.step) * q.step }, q);
}
function toiQualified(tab, minValue, dir) {
  const rows = boardRows(tab, dir), q = QUALIFIERS[tab.key];
  return q && minValue > 0 ? rows.filter(r => (r[q.field] || 0) >= minValue) : rows;
}

function renderTable(tab, filterText, minToi, dir, limitRows) {
  const rows = toiQualified(tab, minToi || 0, dir);
  const q = (filterText || "").trim().toLowerCase();
  const nameKey = tab.cols[0].k;
  const matched = q ? rows.filter(r => String(r[nameKey]).toLowerCase().includes(q)) : rows;
  const limit = limitRows || boardLimit(tab.key);
  const filtered = matched.slice(0, limit);

  if (!filtered.length) {
    return '<div class="empty">' + (rows.length ? 'No rows match &ldquo;' + escapeHtml(filterText) + '&rdquo;.'
      : boardRows(tab, dir).length ? 'Nobody meets that minimum.' : 'Not enough games played yet this season.') + '</div>';
  }

  let html = '<div class="table-scroll"><table class="auto-sort"><thead><tr><th class="rank">#</th>';
  for (const c of tab.cols) html += `<th class="${c.num ? "num" : ""}">${c.label}</th>`;
  html += "</tr></thead><tbody>";
  filtered.forEach((row, i) => {
    const opens = row.pid && row.team && ["player_games", "goalie_games", "goalie_avg", "season_xg", "season_avg", "goalies"].includes(tab.key);
    html += `<tr${opens ? ` class="clickable" data-open-player="${row.pid}" data-player-team="${row.team}"` : ""}><td class="rank">${i + 1}</td>`;
    for (const c of tab.cols) {
      const val = row[c.k];
      let text;
      if (c.k === "unit" && row.unit_key) text = unitLink(row.unit_key, row.team, val);
      else if ((c.k === "player" || c.k === "goalie") && row.pid) text = avatarSpan(row.pid, val) + escapeHtml(val);   // headshot, or initials until it loads
      else if (c.k === "team" && val) text = teamLink(val);
      else if (c.k === "date" && row.gid) text = gameLink(row.gid, row.home, val);
      else if (c.k === "opp" && val) text = `<span class="detail-sub">${escapeHtml(row.loc || "")}</span> ${teamLink(val)}`;
      else if (c.k === "grade" && typeof row.gsax === "number") text = gradeChip(goalieGrade(row.gsax));
      else if (typeof val === "number" && c.gs) text = gsCell(val, c.gs, true);
      else if (typeof val === "number" && (c.dec || c.signed)) text = (c.signed && val > 0 ? "+" : "") + val.toFixed(c.dec || 2);   // scores always show two decimals (-2 reads as -2.00)
      else text = escapeHtml(fmt(val, c.signed));
      html += `<td class="${c.num ? "num " : ""}${c.gs ? "" : numClass(c, val)}">${text}</td>`;
    }
    html += "</tr>";
  });
  html += "</tbody></table></div>";
  if (tab.cols.some(c => c.gs)) html += gsKeyHtml("Adjusted colors");
  return html;
}

// --- Teams / Players / Games: per-team and per-game detail is too much data to
// embed in the page, so it lives in per-season files fetched on demand and
// cached for the session:
//   data/{season}/teams/{ABBREV}.json  (roster, schedule, player logs, units)
//   data/{season}/games/{HOME}.json    (full box scores of that team's home games)
// The page itself embeds only light indexes so list views render instantly.
const fileCache = {};
function fetchJson(path) {
  // the cache holds the request itself, so several callers asking for one file at once (the Home tiles, cards and stars) share a single download
  if (!fileCache[path]) {
    fileCache[path] = fetch(path).then(resp => { if (!resp.ok) throw new Error("couldn't load " + path); return resp.json(); })
      .catch(err => { delete fileCache[path]; throw err; });
  }
  return fileCache[path];
}
const fetchTeam = (abbrev) => fetchJson(`data/${SEASON}/teams/${abbrev}.json`);
// the long tail of short-lived units is a separate file per team (names shared, players as ids)
async function fetchExtraUnits(abbrev) {
  let d;
  try { d = await fetchJson(`data/${SEASON}/units/${abbrev}.json`); } catch (e) { return []; }
  if (!d.hydrated) {
    for (const u of d.units) u.players = u.p.map(id => ({ id, name: d.names[id][0], pos: d.names[id][1] }));
    d.hydrated = true;
  }
  return d.units;
}
async function withAllUnits(data) {
  if (data.allUnits) return data;
  return Object.assign({}, data, { units: data.units.concat(await fetchExtraUnits(data.abbrev)), allUnits: true });
}
// Game shards drop trailing zeros from every cell array to stay small; pad them back to full length (once per shard).
const GAME_CELL_LEN = { sk: 37, tc: 15, gl: 13 };
function padGameShard(shard) {
  if (!shard || shard.__padded) return shard;
  const pad = (cells, n) => { for (const k in cells) { const a = cells[k]; while (a.length < n) a.push(0); } };
  for (const id in shard) {
    const g = shard[id];
    if (!g || typeof g !== "object") continue;
    for (const side of ["home", "away"]) {
      if (g.tc && g.tc[side]) pad(g.tc[side], GAME_CELL_LEN.tc);
      if (g.sk && g.sk[side]) g.sk[side].forEach(r => pad(r[8], GAME_CELL_LEN.sk));
    }
    (g.gl || []).forEach(r => pad(r[3], GAME_CELL_LEN.gl));
  }
  Object.defineProperty(shard, "__padded", { value: true, enumerable: false });
  return shard;
}
const fetchGameShard = async (season, home) => padGameShard(await fetchJson(`data/${season}/games/${home}.json`));
const fetchGame = async (home, gid) => (await fetchGameShard(SEASON, home))[String(gid)];

const UNIT_LABELS = { line: "Forward Lines", pair: "D Pairs", pp: "Power Play Units", pk: "Penalty Kill Units", ev4: "4-on-4 Units", ev3: "3-on-3 Units" };
const UNIT_LABEL_SINGULAR = { line: "Forward line", pair: "D pair", pp: "Power play unit", pk: "Penalty kill unit", ev4: "4-on-4 unit", ev3: "3-on-3 unit" };

// a per-60 rate over a few minutes together is noise, so units show one only after 10 minutes on the ice
const UNIT_RATE_MIN_SEC = 600;
function unitSummaryTable(units, abbrev) {
  const sorted = units.slice().sort((a, b) => b.summary.toi_sec - a.summary.toi_sec);
  // a team can have hundreds of units: the table scrolls in a short box with its header pinned
  return `<div class="unit-scroll">${unitSummaryRows(sorted, abbrev)}</div>`
    + (sorted.length > 10 ? `<div class="scroll-hint">${sorted.length} units &middot; scroll the table to see them all</div>` : "");
}
function unitSummaryRows(sorted, abbrev) {
  return statTable(
    [{ label: "Unit" }, { label: "GP", num: true }, { label: "TOI", num: true }, { label: "GF", num: true }, { label: "GA", num: true },
     { label: "xGF", num: true }, { label: "xGA", num: true }, { label: "Total", num: true }, { label: "Avg / GM", num: true }, { label: "Per 60", num: true }],
    sorted.map(u => {
      const s = u.summary;
      return [unitLink(u.key, abbrev, u.players.map(p => p.name).join(", ")),
        s.gp, toiStr(s.toi_sec), s.gf, s.ga, s.xgf.toFixed(1), s.xga.toFixed(1),
        scoreCell(s.total_score), scoreCell(s.avg_score), s.toi_sec >= UNIT_RATE_MIN_SEC ? scoreCell(s.score_per60) : "&ndash;"];
    })
  );
}

// The team page shows the units that actually carried the team, not every combination that ever shared the ice:
// forward lines and D pairs are the top 10 by ice time, power-play, penalty-kill and 3-on-3 / 4-on-4 units are all of the
// regular ones, and anything that played a sliver of the team's time in that situation is left out. "Show every unit"
// brings back the full list.
const UNIT_CARRY = {   // share of the team's time for that kind of unit, an absolute floor in seconds, and a cap on how many show
  line: { share: 0.03, floor: 180, top: 10 },
  pair: { share: 0.03, floor: 180, top: 10 },
  pp: { share: 0.015, floor: 60, top: 15 },
  pk: { share: 0.015, floor: 60, top: 15 },
  ev4: { share: 0.05, floor: 60, top: 6 },
  ev3: { share: 0.05, floor: 60, top: 6 },
};
function mainUnits(group, type) {
  const rule = UNIT_CARRY[type], total = group.reduce((a, u) => a + u.summary.toi_sec, 0);
  return group.filter(u => u.summary.toi_sec >= Math.max(rule.floor, rule.share * total))
    .sort((a, b) => b.summary.toi_sec - a.summary.toi_sec).slice(0, rule.top);
}
function unitSectionsHtml(units, abbrev, more, everything, types) {
  const moreBtn = more ? `<div class="panel-caption"><button class="back-btn" data-all-units="1">Show every unit, including short-lived combinations</button></div>` : "";
  return (types || ["line", "pair", "pp", "pk", "ev4", "ev3"]).map(t => {
    const all = (units || []).filter(u => u.type === t);
    if (!all.length) return "";
    if (everything) return `<div class="detail-h3">${UNIT_LABELS[t]} (${all.length})</div>${unitSummaryTable(all, abbrev)}`;
    const group = mainUnits(all, t);
    if (!group.length) return "";
    const note = t === "line" || t === "pair" || t === "pp" || t === "pk" ? `Top ${UNIT_CARRY[t].top} by time together` : "Every regular unit, by ice time";
    return `<div class="detail-h3">${UNIT_LABELS[t]} <span class="detail-sub">${note}</span></div>${unitSummaryRows(group, abbrev)}`;
  }).join("") + moreBtn;
}

// The shot danger breakout used on unit pages and the team special-teams section: the three danger bands across the top (high 14%+ to
// score, medium 7-14%, low under 7%), one row per measure. cells are [count, small text, shade (-1..1, optional)].
// shading for a count of goals against what the shots were worth: 0 for an ordinary result, up to +/-1 (the sign says more or fewer goals than
// expected) for an unusual one, judged against the size of the expectation so a one-goal gap on 0.5 expected goals counts for more than on 3
function bandShade(g, x) {
  const d = g - x, z = d / Math.sqrt(Math.max(x, 0.5));
  return Math.abs(z) >= 0.75 && Math.abs(d) >= 0.3 ? Math.sign(d) * (0.15 + 0.85 * Math.min(1, (Math.abs(z) - 0.75) / 1.5)) : 0;
}
function dangerCardHtml(rows, total) {
  const head = `<div class="dz-head"><span></span>${[["h", "High", "14%+"], ["m", "Medium", "7&ndash;14%"], ["l", "Low", "under 7%"]].map(([b, n, r]) => `<span class="dz-h ${b}"><i class="dz-dot"></i>${n}<small>${r}</small></span>`).join("")}<span class="dz-h t">${total || "Total"}<small>shots on goal</small></span></div>`;
  // goals against what the shots were worth, written as a small +/- chip ("9 G · 3.48 xG" becomes +5.5)
  // the chip's color follows the cell's shading (good for the team or bad), not the sign: more goals allowed than expected is a +, but a bad one
  const gap = (text, sh) => { const m = /(\d+)\s*G\s*(?:&middot;|·)\s*([\d.]+)\s*xG/.exec(text || ""); if (!m) return ""; const d = Number(m[1]) - Number(m[2]);
    return Math.abs(d) < 0.05 ? "" : `<em class="dz-gap ${sh > 0.12 ? "up" : sh < -0.12 ? "down" : ""}">${d > 0 ? "+" : "&minus;"}${Math.abs(d).toFixed(1)}</em>`; };
  const cell = (c, cls, bar) => { const sh = c[2], on = sh !== undefined && sh !== null && Math.abs(sh) > 0.12;
    return `<span class="dz-c ${cls}${on ? (sh > 0 ? " over" : " under") : ""}"${on ? ` style="--sh:${Math.round(14 + 30 * Math.min(1, Math.abs(sh)))}%"` : ""}><b>${c[0]}</b>${bar || ""}<small>${c[1] || "&nbsp;"}${gap(c[1], sh)}</small></span>`; };
  const body = rows.map(r => {
    // a thin bar under each count: how big that band is next to the row's biggest, or, on a share row, the share itself with a mark at 50%
    const nums = r.cells.slice(0, 3).map(c => Number(String(c[0]).replace(/[^0-9.]/g, "")));
    const isShare = r.cells.slice(0, 3).some(c => /%$/.test(String(c[0])));
    const max = Math.max(1, ...nums);
    return `<div class="dz-team${isShare ? " share" : ""}"><span class="dz-name">${r.name}</span>${r.cells.map((c, i) => {
      if (i === 3) return cell(c, "t");
      const v = nums[i], ok = Number.isFinite(v) && String(c[0]).indexOf("&") !== 0;
      const bar = !ok ? "" : isShare ? `<i class="dz-bar share"><u class="${v >= 50 ? "up" : "down"}" style="width:${Math.min(100, v)}%"></u></i>` : `<i class="dz-bar"><u style="width:${(100 * v / max).toFixed(0)}%"></u></i>`;
      return cell(c, ["h", "m", "l"][i], bar);
    }).join("")}</div>`;
  }).join("");
  const legend = `<div class="dz-legend"><span>Bars: how many shots in each danger band${rows.some(r => r.cells.some(c => /%$/.test(String(c[0])))) ? ", and the share of them (the mark is 50%)" : ""}.</span><span><i class="over"></i>More goals than the shots were worth</span><span><i class="under"></i>Fewer</span></div>`;
  return `<div class="dz-wrap"><div class="dz" style="--dz-n:4">${head}${body}</div></div>${legend}`;
}

// --- Unit pages: best and worst games, and who the unit played against.
// Best and worst nights by Unit Score from the unit's own game log (every kind of unit, special teams included). A night needs a minimum of time
// together so a few seconds can't make a unit's best or worst game.
const UNIT_GAME_MIN_SEC = { line: 60, pair: 60, pp: 20, pk: 20, ev4: 20, ev3: 20 };
function unitBestWorstHtml(u) {
  const min = UNIT_GAME_MIN_SEC[u.type] || 20, games = (u.log || []).filter(g => g[4] >= min);
  const n = Math.min(5, Math.floor(games.length / 2));
  if (n < 2) return "";
  const graded = u.type === "line" || u.type === "pair", tag = (g) => (graded && g[20] ? `${u.type === "line" ? "L" : "P"}${g[20]}` : "");
  const head = [{ label: "Date" }, { label: "Opp" }, { label: "Result" }, { label: "TOI", num: true }, { label: "Unit Score", num: true }, { label: "xGF&ndash;xGA", num: true }, { label: "GF&ndash;GA", num: true }, ...(graded ? [{ label: "Grade" }] : [])];
  const table = (list) => statTable(head, list.map(g => [gameLink(g[14], g[15], g[0]), g[2] + " " + teamLink(g[1]), g[3], toiStr(g[4]), scoreCell(g[13]), `${g[9].toFixed(2)}&ndash;${g[10].toFixed(2)}`, `${g[7]}&ndash;${g[8]}`,
    ...(graded ? [g[20] ? `<span class="detail-sub">${tag(g)}</span> ${unitGradeHtml(g[13], tag(g))}` : "&ndash;"] : [])]));
  const sorted = games.slice().sort((a, b) => b[13] - a[13]);
  return `<div class="detail-h3">Best and worst games</div>
    <div class="board-sub">Best ${n}</div>${table(sorted.slice(0, n))}
    <div class="board-sub" style="margin-top:14px">Worst ${n}</div>${table(sorted.slice(-n).reverse())}
    <div class="panel-caption">Ranked by Unit Score, with at least ${toiStr(min)} together in the game.${graded ? " The grade is where that night falls among every game by a unit in the same slot since 2024-25." : ""}</div>`;
}
// For a forward line or defense pair: its 5-on-5 time against each of the other team's forward lines and defense pairs (ranked by time together
// that night), with how the chances went. u.vs is built into the team file (nhl_impact/matchups.season_vs_by_unit).
const VS_NAMES = { L1: "Top line", L2: "Second line", L3: "Third line", L4: "Fourth line", P1: "Top pair", P2: "Second pair", P3: "Third pair" };
function unitVsHtml(u) {
  if (!u.vs || (u.type !== "line" && u.type !== "pair")) return "";
  const groups = [["Against forward lines", ["L1", "L2", "L3", "L4"]], ["Against defense pairs", ["P1", "P2", "P3"]]];
  const tot = (tags) => tags.reduce((a, t) => a + ((u.vs[t] || [0])[0]), 0);
  const tl = tot(["L1", "L2", "L3", "L4"]);
  if (!tl) return "";
  const top2 = tot(["L1", "L2"]), xf = ["L1", "L2"].reduce((a, t) => a + ((u.vs[t] || [0, 0, 0, 0, 0, 0, 0])[5]), 0), xa = ["L1", "L2"].reduce((a, t) => a + ((u.vs[t] || [0, 0, 0, 0, 0, 0, 0])[6]), 0);
  const sentence = `Spends <b>${Math.round(100 * top2 / tl)}%</b> of its 5-on-5 time against the other team's top two lines${xf + xa >= 0.5 ? `, with <b>${Math.round(100 * xf / (xf + xa))}%</b> of the expected goals in those minutes` : ""}.`;
  const body = groups.map(([title, tags]) => {
    const gt = tot(tags);
    const rows = tags.filter(t => u.vs[t]).map(t => { const r = u.vs[t], [toi, cf, ca, gf, ga, xgf, xga] = r, share = gt ? toi / gt : 0, small = toi < 120;
      return `<tr class="${small ? "vs-small" : ""}"><td><b>${t}</b> <span class="detail-sub">${VS_NAMES[t]}</span></td><td class="num">${toiStr(toi)}</td>
        <td class="num"><span class="vs-bar"><i style="width:${Math.round(100 * share)}%"></i></span> ${Math.round(100 * share)}%</td>
        <td class="num">${xgf.toFixed(2)}&ndash;${xga.toFixed(2)}</td><td class="num">${xgf + xga >= 0.3 ? `<span class="${xgf > xga ? "pos" : xgf < xga ? "neg" : ""}">${Math.round(100 * xgf / (xgf + xga))}%</span>` : "&ndash;"}</td>
        <td class="num">${gf}&ndash;${ga}</td></tr>`; }).join("");
    return rows ? `<tr class="vs-group"><td colspan="6">${title}</td></tr>${rows}` : "";
  }).join("");
  return `<div class="detail-h3">Who it plays against</div><div class="panel-caption vs-sentence">${sentence}</div>
    <div class="table-scroll"><table class="vs-table"><thead><tr><th>Opposing unit</th><th class="num">Time</th><th class="num">Share of its time</th><th class="num">xGF&ndash;xGA</th><th class="num">xGF%</th><th class="num">GF&ndash;GA</th></tr></thead><tbody>${body}</tbody></table></div>
    <div class="panel-caption">Five-on-five only. Opposing units are grouped by the slot they held that night, ranked by time together among their team's lines or pairs. Only games where this unit was one of its own team's top four lines or three pairs are counted, so the times are what it spent against regulars. Faded rows have under 2:00, too little to read much into.</div>`;
}
function unitDetailHtml(data, key) {
  const u = (data.units || []).find(x => x.key === key);
  const back = `<button class="back-btn" data-open-team="${data.abbrev}">&larr; ${data.abbrev}</button>`;
  if (!u) return back + '<div class="empty">Unit not found.</div>';
  const s = u.summary;
  const title = u.players.map(p => p.name.split(" ").slice(-1)[0]).join(" / ");
  const names = u.players.map(p => playerLink(p.id, data.abbrev, p.name)).join(", ");
  const summary = statTable(
    ["GP", "TOI", "CF", "CA", "GF", "GA", "xGF", "xGA", "Total Score", "Avg Score / GM", "Score / 60"].map(label => ({ label, num: true })),
    [[s.gp, toiStr(s.toi_sec), s.cf, s.ca, s.gf, s.ga, s.xgf.toFixed(1), s.xga.toFixed(1),
      scoreCell(s.total_score), scoreCell(s.avg_score), s.toi_sec >= UNIT_RATE_MIN_SEC ? scoreCell(s.score_per60) : "&ndash;"]]
  );
  // shot danger while this unit was on the ice: shots on goal for and against in each band, and the share of the shots it got
  const band = [[s.hdcf, s.hdca], [s.mdcf || 0, s.mdca || 0], [s.ldcf || 0, s.ldca || 0]];
  const sum = (i) => band.reduce((a, b) => a + b[i], 0);
  const shareCell = (f, a) => (f + a ? [Math.round(100 * f / (f + a)) + "%", `${f} of ${f + a}`, (f / (f + a) - 0.5) * 4] : ["&ndash;", "", null]);
  const bx = s.bx || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];   // goals then xG by band: [hdgf, hdga, mdgf, mdga, ldgf, ldga, hdxgf, hdxga, mdxgf, mdxga, ldxgf, ldxga]
  const uG = [[bx[0], bx[1]], [bx[2], bx[3]], [bx[4], bx[5]]];
  const uX = [[bx[6], bx[7]], [bx[8], bx[9]], [bx[10], bx[11]]];
  const uCell = (n, g, x, against) => [n, `${Math.round(g)} G &middot; ${x.toFixed(2)} xG`, (against ? -1 : 1) * bandShade(g, x)];
  const uSum = (arr, i) => arr.reduce((t, v) => t + v[i], 0);
  const dangerCard = dangerCardHtml([
    { name: "Shots for", cells: [...band.map((b, k) => uCell(b[0], uG[k][0], uX[k][0], false)), uCell(sum(0), uSum(uG, 0), uSum(uX, 0), false)] },
    { name: "Shots against", cells: [...band.map((b, k) => uCell(b[1], uG[k][1], uX[k][1], true)), uCell(sum(1), uSum(uG, 1), uSum(uX, 1), true)] },
    { name: "Share", cells: [...band.map(b => shareCell(b[0], b[1])), shareCell(sum(0), sum(1))] },
  ], "Total");
  const log = statTable(
    [{ label: "Date" }, { label: "Opp" }, { label: "Result" }, ...["TOI", "CF", "CA", "GF", "GA", "xGF", "xGA", "HD", "MD", "LD", "Unit Score"].map(label => ({ label, num: true })), ...(u.type === "line" || u.type === "pair" ? [{ label: "Slot / grade" }] : [])],
    u.log.map(g => { const pair = (f, a) => (f > a ? `<span class="pos">${f}&ndash;${a}</span>` : f < a ? `<span class="neg">${f}&ndash;${a}</span>` : `${f}&ndash;${a}`);
      return [gameLink(g[14], g[15], g[0]), g[2] + " " + teamLink(g[1]), g[3], toiStr(g[4]), g[5], g[6], g[7], g[8], g[9].toFixed(2), g[10].toFixed(2),
        pair(g[11], g[12]), pair(g[16] || 0, g[17] || 0), pair(g[18] || 0, g[19] || 0), scoreCell(g[13])]
        // lines and pairs: where he ranked that night (by ice time among the team's lines or pairs) and the grade it earned
        .concat(u.type === "line" || u.type === "pair" ? [g[20] ? `<span class="detail-sub">${u.type === "line" ? "L" : "P"}${g[20]}</span> ${unitGradeHtml(g[13], (u.type === "line" ? "L" : "P") + g[20])}` : "&ndash;"] : []); })
  );
  return `
    ${back}
    ${u.card ? unitCardHtml(u, data, title) : `<div class="detail-title">${escapeHtml(title)} <span class="detail-sub">${data.abbrev} &middot; ${UNIT_LABEL_SINGULAR[u.type]}</span></div>`}
    <div class="panel-caption">${names}</div>
    <div class="panel-caption">Unit Score counts what this unit earned and allowed over its time together in each game: expected goals and goals, plus shot attempts for lines, pairs and penalty-kill units. It's a running count, so more ice time means a bigger swing &mdash; Score / 60 normalizes for that.</div>
    <div class="detail-h3">Season Summary</div>${summary}
    ${unitBestWorstHtml(u)}
    <div class="detail-h3">Shot danger</div>${dangerCard}
    <div class="panel-caption">Shots on goal for and against while this unit was on the ice, by how likely each shot was to score, with the goals and expected goals (xG) from them. Under shots for, green means more goals than the shots were worth; under shots against, green means fewer goals allowed than expected. Share is the unit's part of the shots in each band; green means it got more than half, red less. In the game log, HD, MD and LD are the high-, medium- and low-danger shots for&ndash;against.</div>
    ${unitVsHtml(u)}
    <div class="detail-h3">Game Log (${s.gp} games)</div>${log}
  `;
}

const pctOf = (a, b) => (a + b > 0 ? (100 * a / (a + b)).toFixed(1) : "&ndash;");
const orDash = (v, f) => (v === null || v === undefined ? "&ndash;" : f ? f(v) : v);

// league table: record plus the shot-quality numbers; click a column to sort by it (again to flip)
const TEAM_COLS = [
  { k: "gp", label: "GP" }, { k: "w", label: "W" }, { k: "l", label: "L" }, { k: "otl", label: "OTL" }, { k: "pts", label: "PTS" },
  { k: "gf", label: "GF" }, { k: "ga", label: "GA" }, { k: "xgf_pct", label: "xGF%", d: 1 }, { k: "cf_pct", label: "CF%", d: 1 },
  { k: "hdcf_pct", label: "HDCF%", d: 1 }, { k: "pdo5", label: "PDO", d: 1 }, { k: "pp_pct", label: "PP%", d: 1 },
  { k: "pk_pct", label: "PK%", d: 1 }, { k: "fo_pct", label: "FO%", d: 1 },
];

function teamsListHtml(filterText) {
  const q = (filterText || "").trim().toLowerCase();
  const st = specialState.teams;
  const key = st.sort || "pts", dir = st.dir === "asc" ? 1 : -1;
  const rows = (S().teams_index || []).filter(t => !q || t.abbrev.toLowerCase().includes(q))
    .slice().sort((a, b) => dir * ((a[key] ?? -1) - (b[key] ?? -1)) || (b.xgf_pct ?? 0) - (a.xgf_pct ?? 0));
  if (!rows.length) return '<div class="empty">No teams match that filter.</div>';
  const head = TEAM_COLS.map(c => `<th class="num sortable${key === c.k ? " sorted" : ""}" data-sort-team="${c.k}" title="Sort by ${c.label}">${c.label}${key === c.k ? (dir < 0 ? " &#9660;" : " &#9650;") : ""}</th>`).join("");
  let html = `<div class="table-scroll"><table><thead><tr><th>Team</th>${head}</tr></thead><tbody>`;
  rows.forEach(t => {
    const cells = TEAM_COLS.map(c => `<td class="num">${orDash(t[c.k], v => (c.d ? Number(v).toFixed(c.d) : v))}</td>`).join("");
    html += `<tr class="clickable" data-open-team="${t.abbrev}"><td>${logoSpan(t.abbrev)}${t.abbrev}</td>${cells}</tr>`;
  });
  html += "</tbody></table></div>";
  return html + '<div class="panel-caption">xGF%, CF% and HDCF% are each team\'s share of expected goals, shot attempts and high-danger shots on goal, all situations. PDO is shooting plus save percentage at 5v5 (100 is average; far from it is mostly luck). PP% is power-play goals over power plays; PK% is the share of times shorthanded that the team did not allow a goal.</div>';
}

// --- team rankings. Every team-level stat is ranked across the season's teams, client-side from teams_index.
// hi = true means a bigger number is better (so it ranks 1st); false means smaller is better (goals against, penalty minutes).
// A few stats are per-game rates derived from season totals.
const TEAM_DERIVED = {
  pts_pct: (t) => (t.gp ? t.pts / (2 * t.gp) : null),
  gf_pg: (t) => (t.gp ? t.gf / t.gp : null), ga_pg: (t) => (t.gp ? t.ga / t.gp : null),
  diff_pg: (t) => (t.gp ? (t.gf - t.ga) / t.gp : null),
  ppo_pg: (t) => (t.gp && t.ppo != null ? t.ppo / t.gp : null), pko_pg: (t) => (t.gp && t.pko != null ? t.pko / t.gp : null),
  xgf_pg: (t) => (t.gp && t.xgf != null ? t.xgf / t.gp : null), xga_pg: (t) => (t.gp && t.xga != null ? t.xga / t.gp : null),
};
const TEAM_STATS = [
  { k: "pts", label: "Points", d: 0, hi: true, group: "Results" },
  { k: "pts_pct", label: "Points percentage", d: 3, hi: true, group: "Results" },
  { k: "gf_pg", label: "Goals for per game", d: 2, hi: true, group: "Results" },
  { k: "ga_pg", label: "Goals against per game", d: 2, hi: false, group: "Results" },
  { k: "diff_pg", label: "Goal differential per game", d: 2, hi: true, group: "Results", signed: true },
  { k: "xgf_pct", label: "Expected goals share (xGF%)", d: 1, hi: true, group: "Shot quality" },
  { k: "xgf_pct5", label: "Expected goals share, 5v5", d: 1, hi: true, group: "Shot quality" },
  { k: "xgf_pg", label: "Expected goals for per game", d: 2, hi: true, group: "Shot quality" },
  { k: "xga_pg", label: "Expected goals against per game", d: 2, hi: false, group: "Shot quality" },
  { k: "cf_pct", label: "Shot attempt share (CF%)", d: 1, hi: true, group: "Shot quality" },
  { k: "cf_pct5", label: "Shot attempt share, 5v5", d: 1, hi: true, group: "Shot quality" },
  { k: "hdcf_pct", label: "High-danger chance share (HDCF%)", d: 1, hi: true, group: "Shot quality" },
  { k: "hdcf_pct5", label: "High-danger chance share, 5v5", d: 1, hi: true, group: "Shot quality" },
  { k: "sf_pct", label: "Shots on goal share (SF%)", d: 1, hi: true, group: "Shot quality" },
  { k: "pdo5", label: "PDO (5v5)", d: 1, hi: true, group: "Shot quality" },
  { k: "pp_pct", label: "Power play percentage (PP%)", d: 1, hi: true, group: "Special teams" },
  { k: "pk_pct", label: "Penalty kill percentage (PK%)", d: 1, hi: true, group: "Special teams" },
  { k: "ppo_pg", label: "Power plays per game", d: 2, hi: true, group: "Special teams" },
  { k: "pko_pg", label: "Times shorthanded per game", d: 2, hi: false, group: "Special teams" },
  { k: "fo_pct", label: "Faceoff percentage", d: 1, hi: true, group: "Play style" },
  { k: "hits_pg", label: "Hits per game", d: 1, hi: true, group: "Play style" },
  { k: "blocks_pg", label: "Blocked shots per game", d: 1, hi: true, group: "Play style" },
  { k: "tk_pg", label: "Takeaways per game", d: 1, hi: true, group: "Play style" },
  { k: "gv_pg", label: "Giveaways per game", d: 1, hi: false, group: "Play style" },
  { k: "pim_pg", label: "Penalty minutes per game", d: 1, hi: false, group: "Play style" },
];
const TEAM_STAT = Object.fromEntries(TEAM_STATS.map(s => [s.k, s]));
const teamValue = (t, k) => (TEAM_DERIVED[k] ? TEAM_DERIVED[k](t) : t[k]);
const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
// {abbrev: rank} for one stat; ties share a rank, teams without the stat are left out
function teamRanks(k) {
  const stat = TEAM_STAT[k], rows = (S().teams_index || []).map(t => [t.abbrev, teamValue(t, k)]).filter(r => r[1] !== null && r[1] !== undefined);
  rows.sort((a, b) => (stat.hi ? b[1] - a[1] : a[1] - b[1]));
  const out = {};
  rows.forEach((r, i) => { out[r[0]] = i > 0 && r[1] === rows[i - 1][1] ? out[rows[i - 1][0]] : i + 1; });
  return out;
}
const fmtTeamStat = (stat, v) => (v === null || v === undefined ? "&ndash;" : (stat.signed && v > 0 ? "+" : "") + Number(v).toFixed(stat.d));
// a team's value for a stat with its league rank, e.g. 55.5 (1st)
function rankedValue(abbrev, k) {
  const t = (S().teams_index || []).find(x => x.abbrev === abbrev), stat = TEAM_STAT[k];
  const v = t ? teamValue(t, k) : null;
  if (v === null || v === undefined) return "&ndash;";
  const r = teamRanks(k)[abbrev];
  return `${fmtTeamStat(stat, v)}${r ? ` <span class="rank-tag">(${ordinal(r)})</span>` : ""}`;
}

// --- Power Rankings. The power rating is how many goals per game better than an average team this one has been:
// 0.75 x (expected goals for minus against, per game) + 0.25 x (goals for minus against, per game). The blend came out best when
// each candidate rating, computed on a team's first 15 to 55 games of 2024-25 and 2025-26, was correlated with its points percentage
// over the rest of the season (r 0.52, against 0.45 for points percentage and for goal differential alone); weighting recent games
// more added nothing. See METHODOLOGY.md.
const POWER_XG_WEIGHT = 0.75;
function powerRating(t) {
  const xf = teamValue(t, "xgf_pg"), xa = teamValue(t, "xga_pg"), d = teamValue(t, "diff_pg");
  if ([xf, xa, d].some(v => v === null || v === undefined)) return null;
  return POWER_XG_WEIGHT * (xf - xa) + (1 - POWER_XG_WEIGHT) * d;
}
function powerColumns(state, ranksOf) {
  const ranks = state.view === "ranks";
  // a stat column: the value, or the team's league rank in it (with a pill coloured by tier) when "League ranks" is chosen
  const stat = (k, label, get, fmtv, hi = true, extra = {}) => ({ k, label, num: true, get,
    cell: (t) => { const v = get(t); if (v === null || v === undefined) return "&ndash;";
      if (!ranks) return fmtv(v);
      const r = ranksOf(k, get, hi)[t.abbrev], n = (S().teams_index || []).length, tier = r <= Math.ceil(n / 4) ? " rk-top" : r > n - Math.ceil(n / 4) ? " rk-low" : "";
      return `<span class="rk${tier}">${r}</span>`; }, ...extra });
  const f1 = (v) => Number(v).toFixed(1), f2 = (v) => Number(v).toFixed(2);
  return [
    { k: "team", label: "Team", get: t => teamName(t.abbrev), cell: t => `<span class="pr-n">${t._pr}</span>${logoSpan(t.abbrev)}<strong>${escapeHtml(teamName(t.abbrev))}</strong>` },
    stat("power", "Power rating", t => t._power, (v) => (v > 0 ? "+" : "") + v.toFixed(2), true, { signed: true }),
    { k: "gp", label: "GP", num: true, get: t => t.gp },
    { k: "rec", label: "W-L-OTL", num: true, get: t => teamValue(t, "pts_pct"), cell: t => `${t.w}&ndash;${t.l}&ndash;${t.otl}` },
    stat("pts", "PTS", t => t.pts, (v) => v),
    stat("l10", "Last 10", t => (t.l10_gp ? t.l10_pts / (2 * t.l10_gp) : null), () => "", true, { cell: (t) => {
      if (!t.l10_gp) return "&ndash;";
      if (!ranks) return `${t.l10.replace(/-/g, "&ndash;")}`;
      const r = ranksOf("l10", (x) => (x.l10_gp ? x.l10_pts / (2 * x.l10_gp) : null), true)[t.abbrev], n = (S().teams_index || []).length;
      return `<span class="rk${r <= Math.ceil(n / 4) ? " rk-top" : r > n - Math.ceil(n / 4) ? " rk-low" : ""}">${r}</span>`; } }),
    stat("gf_pg", "GF/G", t => teamValue(t, "gf_pg"), f2), stat("ga_pg", "GA/G", t => teamValue(t, "ga_pg"), f2, false),
    stat("diff_pg", "GD/G", t => teamValue(t, "diff_pg"), (v) => (v > 0 ? "+" : "") + v.toFixed(2), true, { signed: true }),
    stat("xgf_pct", "xGF%", t => teamValue(t, "xgf_pct"), f1), stat("xgf_pct5", "xGF% 5v5", t => teamValue(t, "xgf_pct5"), f1),
    stat("cf_pct", "CF%", t => teamValue(t, "cf_pct"), f1), stat("hdcf_pct", "HDCF%", t => teamValue(t, "hdcf_pct"), f1),
    stat("pdo5", "PDO", t => teamValue(t, "pdo5"), f1),
    stat("pp_pct", "PP%", t => teamValue(t, "pp_pct"), f1), stat("pk_pct", "PK%", t => teamValue(t, "pk_pct"), f1),
    stat("gsax", "Goalie GSAx", t => t.gsax, (v) => (v > 0 ? "+" : "") + Number(v).toFixed(1), true, { signed: true }),
  ];
}
function powerHtml(state) {
  const teams = (S().teams_index || []).filter(t => t.pts !== undefined && t.pts !== null);
  if (!teams.length) return '<div class="empty">Not enough games played yet this season.</div>';
  // the power rank is fixed (best rating first); sorting only reorders the rows
  teams.forEach(t => { t._power = powerRating(t); });
  teams.slice().sort((a, b) => (b._power ?? -99) - (a._power ?? -99)).forEach((t, i) => { t._pr = i + 1; });
  const cache = {};
  const ranksOf = (k, get, hi) => {
    if (cache[k]) return cache[k];
    const rows = teams.map(t => [t.abbrev, get(t)]).filter(r => r[1] !== null && r[1] !== undefined).sort((a, b) => (hi ? b[1] - a[1] : a[1] - b[1])), out = {};
    rows.forEach((r, i) => { out[r[0]] = i > 0 && r[1] === rows[i - 1][1] ? out[rows[i - 1][0]] : i + 1; });
    return (cache[k] = out);
  };
  const q = (state.filter || "").trim().toLowerCase();
  const rows = teams.filter(t => !q || (t.abbrev + " " + teamName(t.abbrev)).toLowerCase().includes(q));
  const chips = `<div class="chips board-chips" role="group" aria-label="Show">${[["values", "Values"], ["ranks", "League ranks"], ["reality", "Results vs. chances"]].map(([k, label]) =>
    `<button type="button" class="chip" aria-pressed="${state.view === k}" data-tab-view="power|${k}">${label}</button>`).join("")}</div>`;
  if (state.view === "reality") return chips + realityHtml(teams, q);
  const note = `<div class="panel-caption"><strong>Power rating</strong> is how many goals per game better than an average team this one has been: three quarters its expected-goal difference per game plus one quarter its goal difference per game. Expected goals count the quality of the chances, so the rating leans on how a team plays and only partly on how the bounces went. Tested on the last two full seasons, it predicted a team's later results better than points percentage or goal difference alone. The number beside each team is its power rank, which stays fixed when you sort. Green and red mark the top and bottom quarter of the league when ranks are shown. Goalie GSAx is the team's goalies combined.</div>`;
  return chips + sortableTable("power", powerColumns(state, ranksOf), rows, state.sort, t => `data-open-team="${t.abbrev}"`) + note;
}


// --- Results vs. chances: for every team, its record against what its chances say the record should be, in three groups by record (bad, middle,
// good), so you can see who is really bad or good and who is just unlucky or riding results. The "chances" line is points share predicted from
// expected-goals share (xGF%), fitted on the completed seasons; the gap is the part of a record that isn't explained by how the team has played.
function realityFit() {
  const pts = [];
  DATA.seasons.filter(x => !x.in_progress).forEach(sx => ((DATA.by_season[sx.id] || {}).teams_index || []).forEach(t => { if (t.gp && t.xgf_pct !== null && t.xgf_pct !== undefined) pts.push([t.xgf_pct - 50, t.pts / (2 * t.gp)]); }));
  if (pts.length < 20) return { a: 0.557, b: 0.018, sd: 0.058 };       // the fit from 2024-25 and 2025-26, if there aren't enough completed seasons loaded
  const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  const b = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0), a = my - b * mx;
  const sd = Math.sqrt(pts.reduce((acc, p) => acc + (p[1] - (a + b * p[0])) ** 2, 0) / n);
  return { a, b, sd };
}
function realityHtml(teams, q) {
  const fit = realityFit(), clear = 0.06;                                  // a gap of 6 points of points share (about 10 points over a season) is more than the usual miss
  const rows = teams.filter(t => t.gp && t.xgf_pct !== null && t.xgf_pct !== undefined).map(t => {
    const act = t.pts / (2 * t.gp), exp = fit.a + fit.b * (t.xgf_pct - 50);
    return Object.assign({}, t, { act, exp, gap: act - exp });
  }).sort((a, b) => b.act - a.act);
  if (!rows.length) return '<div class="empty">Not enough games played yet this season.</div>';
  const n = rows.length, nGood = Math.round(n * 0.31), nBad = Math.round(n * 0.31);
  const tiers = [["good", "Good teams", "Are they really that good, or are the results flattering them?", rows.slice(0, nGood)],
    ["mid", "Middle teams", "Is the middle where they belong, or are they better or worse than the standings show?", rows.slice(nGood, n - nBad)],
    ["bad", "Bad teams", "Are they really that bad, or are they unlucky?", rows.slice(n - nBad)]];
  const lo = 0.2, hi = 0.85, pos = (v) => Math.max(0, Math.min(100, 100 * (v - lo) / (hi - lo)));
  const avg = rows.reduce((a, t) => a + t.act, 0) / n;
  const verdict = (tier, g) => {
    if (g >= clear) return tier === "bad" ? ["Record flatters them", "even worse than the record", "up"] : ["Riding results", "the chances don't back the record", "up"];
    if (g <= -clear) return tier === "good" ? ["Better than the record", "the chances are even stronger", "down"] : ["Unlucky", "playing better than the record", "down"];
    return tier === "good" ? ["Really good", "results match the chances", ""] : tier === "bad" ? ["Really bad", "results match the chances", ""] : ["About right", "results match the chances", ""];
  };
  const ticks = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map(v => `<span style="left:${pos(v)}%">${Math.round(100 * v)}%</span>`).join("");
  const sign = (v, d = 1) => (v > 0 ? "+" : "") + v.toFixed(d);
  const section = ([key, title, ask, list]) => {
    const shown = list.filter(t => !q || (t.abbrev + " " + teamName(t.abbrev)).toLowerCase().includes(q));
    return `<div class="rv-section rv-${key}"><div class="detail-h3">${title} <span class="detail-sub">${ask}</span></div>
      <div class="rv-axis"><span class="rv-axis-l"></span><div class="rv-ticks">${ticks}</div><span class="rv-axis-r"></span></div>
      ${shown.map(t => { const [label, why, dir] = verdict(key, t.gap), fin = t.gf - t.xgf, goalie = t.xga - t.ga;
        return `<div class="rv-row" data-open-team="${t.abbrev}" role="button" tabindex="0">
          <div class="rv-team">${logoSpan(t.abbrev)}<span><strong>${escapeHtml(teamName(t.abbrev))}</strong><small>${t.w}&ndash;${t.l}&ndash;${t.otl} &middot; ${Math.round(100 * t.act)}% of points</small></span></div>
          <div class="rv-track" title="Record ${(100 * t.act).toFixed(0)}% of points; its chances say ${(100 * t.exp).toFixed(0)}%">
            <i class="rv-avg" style="left:${pos(avg)}%"></i>
            <i class="rv-link ${dir}" style="left:${Math.min(pos(t.act), pos(t.exp))}%;width:${Math.abs(pos(t.act) - pos(t.exp))}%"></i>
            <i class="rv-ring" style="left:${pos(t.exp)}%"></i><i class="rv-dot ${dir}" style="left:${pos(t.act)}%"></i></div>
          <div class="rv-verdict ${dir}"><b>${label}</b><small>${sign(100 * t.gap, 0)} pts of share &middot; scoring ${sign(fin)} goals, goaltending ${sign(goalie)}</small></div></div>`; }).join("") || '<div class="empty">No teams match.</div>'}</div>`;
  };
  const legend = `<div class="rv-legend"><span><i class="rv-dot"></i> Actual record (share of possible points)</span><span><i class="rv-ring"></i> What its chances say the record should be</span><span><i class="rv-avg"></i> League average</span></div>`;
  const note = `<div class="panel-caption"><strong>How to read it.</strong> The ring is the share of points a team would typically have given its expected-goals share so far (fitted on the last completed seasons: chances explain about half of the spread in standings, and a record usually misses by about ${Math.round(100 * fit.sd)} points of share, roughly ${Math.round(164 * fit.sd)} standings points over a season). The dot is where the record actually is. Dot to the right of the ring means results are ahead of the chances; to the left means the team has played better than its record. The small print is what is driving the gap: goals scored above or below what the shots were worth, and goals allowed against what the shots against were worth (a hot or cold goalie). Early in the season a few games can swing all of this, so give a gap more weight the more games have been played.</div>`;
  return `${legend}${tiers.map(section).join("")}${note}`;
}
// --- Playoff Odds: the rest of the regular season simulated 10,000 times (nhl_impact/playoff_odds.py, built into data/{season}/odds.json on every
// update): each team's chance to make the playoffs, win its division and finish first overall, with its projected points.
const oddsPct = (p) => (p >= 0.995 ? "99+" : p < 0.005 ? "&lt;1" : p >= 0.1 ? String(Math.round(100 * p)) : (100 * p).toFixed(1));
const oddsCell = (p, hue) => `<td class="num odds-cell" data-sort="${p}" style="--p:${(100 * p).toFixed(1)}%;--c:${hue}"><span>${oddsPct(p)}%</span></td>`;
function oddsTableHtml(rows, rankOf, withDiv) {
  const head = ["Team", "GP", "Record", "PTS", "Proj. PTS", "Playoffs", "Division", "First overall", "Games left", "Schedule"];
  const sosAll = rankOf.sos;
  const body = rows.map(t => `<tr data-open-team="${t.abbrev}" role="button" tabindex="0">
      <td><span class="pr-n">${rankOf.rank[t.abbrev]}</span>${logoSpan(t.abbrev)}<strong>${escapeHtml(teamName(t.abbrev))}</strong>${withDiv ? ` <span class="detail-sub">${t.div}</span>` : ""}</td>
      <td class="num">${t.gp}</td><td class="num" data-sort="${t.pts / Math.max(1, 2 * t.gp)}">${t.w}&ndash;${t.l}&ndash;${t.otl}</td><td class="num">${t.pts}</td>
      <td class="num" data-sort="${t.pts_mean}">${Math.round(t.pts_mean)} <span class="detail-sub">${t.pts_p10}&ndash;${t.pts_p90}</span></td>
      ${oddsCell(t.playoffs, "79,191,133")}${oddsCell(t.division, "90,163,214")}${oddsCell(t.pres, "232,184,108")}
      <td class="num">${t.rem}</td>
      <td class="num" data-sort="${t.sos === null ? "" : t.sos}">${t.sos === null ? "&ndash;" : sosAll[t.abbrev] <= 8 ? '<span class="pos">Easier</span>' : sosAll[t.abbrev] > 24 ? '<span class="neg">Harder</span>' : "Average"}</td></tr>`).join("");
  return `<div class="table-scroll"><table class="auto-sort odds-table"><thead><tr>${head.map((h, i) => `<th class="${i ? "num" : ""}">${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
}
function oddsHtml(state, data) {
  const cur = DATA.seasons.find(x => x.id === SEASON);
  if (!data || !data.teams) {
    return `<div class="empty">${cur && !cur.in_progress ? `The ${cur.label} regular season is over, so there are no odds to show.` : "Playoff odds appear once the season's schedule is loaded."}</div>`;
  }
  const q = (state.filter || "").trim().toLowerCase();
  const all = data.teams.slice().sort((a, b) => b.playoffs - a.playoffs || b.pts - a.pts);
  const rank = {}; all.forEach((t, i) => { rank[t.abbrev] = i + 1; });
  const sosOrder = data.teams.filter(t => t.sos !== null).sort((a, b) => a.sos - b.sos), sos = {}; sosOrder.forEach((t, i) => { sos[t.abbrev] = i + 1; });   // 1 = the easiest remaining schedule
  const info = { rank, sos };
  const match = (t) => !q || (t.abbrev + " " + teamName(t.abbrev)).toLowerCase().includes(q);
  const view = state.view || "league";
  const chips = `<div class="chips board-chips" role="group" aria-label="Group by">${[["league", "League"], ["conference", "By conference"], ["division", "By division"]].map(([k, label]) =>
    `<button type="button" class="chip" aria-pressed="${view === k}" data-odds-view="${k}">${label}</button>`).join("")}</div>`;
  let body;
  if (view === "league") body = oddsTableHtml(all.filter(match), info, true);
  else if (view === "conference") body = ["Eastern", "Western"].map(c => `<div class="detail-h3">${c} Conference <span class="detail-sub">about ${data.cutoff[c]} points has been the cutoff in the simulations</span></div>${oddsTableHtml(all.filter(t => t.conf === c && match(t)), info, true)}`).join("");
  else body = ["Atlantic", "Metropolitan", "Central", "Pacific"].map(d => `<div class="detail-h3">${d} Division</div>${oddsTableHtml(all.filter(t => t.div === d && match(t)), info, false)}`).join("");
  const note = `<div class="panel-caption"><strong>How it works.</strong> The rest of the schedule (${data.games_left} games) is played out ${data.sims.toLocaleString()} times. Each game uses the same model as the game predictions: both teams' recent expected goals (older games count less, and last season counts too), a small home edge, and a penalty for the road team on the second night of a back-to-back; a tie after regulation is an overtime or shootout coin flip. Standings and tiebreakers come from the NHL; the top three in each division and the next two in the conference make the playoffs. Ties are broken by points, regulation wins, regulation-plus-overtime wins, then a coin flip, so the NHL's later tiebreakers (head to head and goal differential) are not modeled. Proj. PTS is the average final total, with the range the middle 80% of outcomes. Schedule compares the opponents each team still has to play: easier is the easiest quarter of the league. It doesn't know injuries, trades or who starts in goal, and it treats a team's strength as fixed for the rest of the season. Updated ${data.standings_date}.</div>`;
  return `${chips}${body}${note}`;
}
// a team's value for a stat plus a league-rank pill (green for the top quarter, red for the bottom quarter)
function rankCell(abbrev, k) {
  const t = (S().teams_index || []).find(x => x.abbrev === abbrev), stat = TEAM_STAT[k];
  const v = t ? teamValue(t, k) : null;
  if (v === null || v === undefined) return `<span class="sr-v sr-none">&ndash;</span>`;
  const r = teamRanks(k)[abbrev], n = (S().teams_index || []).length;
  const tier = !r ? "" : r <= Math.ceil(n / 4) ? " rk-top" : r > n - Math.ceil(n / 4) ? " rk-low" : "";
  return `<span class="sr-v"><b>${fmtTeamStat(stat, v)}</b>${r ? `<span class="rk${tier}">${ordinal(r)}</span>` : ""}</span>`;
}
function teamAdvancedHtml(abbrev) {
  const t = (S().teams_index || []).find(x => x.abbrev === abbrev);
  if (!t || t.xgf_pct === undefined) return "";
  const n = (S().teams_index || []).length;
  const row = (label, ...keys) => `<div class="sr"><span class="sr-l">${label}</span>${keys.map(k => k ? rankCell(abbrev, k) : '<span class="sr-v sr-none">&ndash;</span>').join("")}</div>`;
  const card = (title, head, rows) => `<section class="stat-card"><h4>${title}</h4>${head ? `<div class="sr sr-head"><span class="sr-l"></span>${head.map(h => `<span class="sr-v">${h}</span>`).join("")}</div>` : ""}${rows.join("")}</section>`;
  const results = card("Results", null, [
    row("Points", "pts"), row("Points percentage", "pts_pct"), row("Goals for per game", "gf_pg"), row("Goals against per game", "ga_pg"),
    row("Goal differential per game", "diff_pg"), row("Expected goals for per game", "xgf_pg"), row("Expected goals against per game", "xga_pg")]);
  const shares = card("Share of the play", ["All situations", "5v5"], [
    row("Expected goals (xGF%)", "xgf_pct", "xgf_pct5"), row("Shot attempts (CF%)", "cf_pct", "cf_pct5"),
    row("High-danger chances (HDCF%)", "hdcf_pct", "hdcf_pct5"), row("Shots on goal (SF%)", "sf_pct", null), row("PDO", null, "pdo5")]);
  const other = card("Special teams and play style", null, [
    row("Power play %", "pp_pct"), row("Power plays per game", "ppo_pg"), row("Penalty kill %", "pk_pct"), row("Times shorthanded per game", "pko_pg"),
    row("Faceoff %", "fo_pct"), row("Hits per game", "hits_pg"), row("Blocks per game", "blocks_pg"), row("Takeaways per game", "tk_pg"),
    row("Giveaways per game", "gv_pg"), row("Penalty minutes per game", "pim_pg")]);
  return `<div class="detail-h3">Team stats and league rank</div>
    <div class="stat-cards">${results}${shares}${other}</div>
    <div class="panel-caption">The pill is the team's rank among ${n} teams this season, where 1st is best: for goals against, expected goals against, times shorthanded, giveaways and penalty minutes that means the lowest. Hits and blocks rank the most as 1st. Green is the top quarter of the league, red the bottom quarter.</div>`;
}

// the Teams board under Leaderboards: all teams ranked by whichever stat is picked
function teamBoardHtml(state) {
  const k = TEAM_STAT[state.teamStat] ? state.teamStat : "xgf_pct", stat = TEAM_STAT[k];
  const teams = (S().teams_index || []).filter(t => teamValue(t, k) !== null && teamValue(t, k) !== undefined);
  if (!teams.length) return '<div class="empty">Not enough games played yet this season.</div>';
  const ranks = teamRanks(k);
  teams.sort((a, b) => ranks[a.abbrev] - ranks[b.abbrev] || a.abbrev.localeCompare(b.abbrev));
  const vals = teams.map(t => teamValue(t, k)), lo = Math.min(...vals), hi = Math.max(...vals);
  // bar length shows how far a team is toward the best value, so a bar is longest for the best team in either direction
  const bar = (v) => { const f = hi === lo ? 1 : stat.hi ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo); return `<span class="tbar"><i style="width:${(8 + 92 * f).toFixed(0)}%"></i></span>`; };
  const groups = [...new Set(TEAM_STATS.map(s => s.group))];
  const picker = `<div class="team-stat-pick"><label for="team-stat">Rank teams by</label>
      <select id="team-stat" data-team-stat>${groups.map(g => `<optgroup label="${g}">${TEAM_STATS.filter(s => s.group === g).map(s => `<option value="${s.k}"${s.k === k ? " selected" : ""}>${s.label}</option>`).join("")}</optgroup>`).join("")}</select></div>`;
  const rows = teams.map(t => `<tr class="clickable" data-open-team="${t.abbrev}"><td class="rank">${ordinal(ranks[t.abbrev])}</td><td>${logoSpan(t.abbrev)}${t.abbrev}</td>
      <td class="num strong">${fmtTeamStat(stat, teamValue(t, k))}</td><td class="barcell">${bar(teamValue(t, k))}</td>
      <td class="num">${t.w}&ndash;${t.l}&ndash;${t.otl}</td><td class="num">${orDash(t.pts)}</td><td class="num">${orDash(t.xgf_pct, v => Number(v).toFixed(1))}</td></tr>`).join("");
  return `${picker}<div class="table-scroll"><table class="auto-sort"><thead><tr><th class="rank">Rank</th><th>Team</th><th class="num">${stat.label}</th><th></th><th class="num">W&ndash;L&ndash;OTL</th><th class="num">PTS</th><th class="num">xGF%</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="panel-caption">${stat.hi ? "Higher is better." : "Lower is better."} Ranks run 1st to ${ordinal(teams.length)} across this season's teams; ties share a rank. Click a team to see all of its ranks.</div>`;
}

// best and worst player games and season averages for one team, by Game Score. No minimum games: a player with one
// game can top (or bottom) the averages. Only games played for this team count, and goalies have no Game Score.
function teamPlayerBoardsHtml(data) {
  const games = [], avg = {};
  for (const [pid, p] of Object.entries(data.players)) {
    for (const g of p.game_log) {
      if (g.team !== data.abbrev || g.raw === null || g.raw === undefined) continue;
      games.push({ pid, name: p.name, g });
      const a = avg[pid] || (avg[pid] = { pid, name: p.name, n: 0, sum: 0 });
      a.n += 1; a.sum += g.raw;
    }
  }
  if (!games.length) return "";
  const top = (arr, cmp) => arr.slice().sort(cmp).slice(0, 10);
  const gameTable = (list) => statTable(
    [{ label: "Player" }, { label: "Date" }, { label: "G", num: true }, { label: "A", num: true }, { label: "Game Score", num: true }],
    list.map(x => [playerLink(x.pid, data.abbrev, x.name), gameLink(x.g.gid, x.g.home, x.g.date), x.g.goals, x.g.assists, scoreCell(x.g.raw)]));
  const avgRows = Object.values(avg).map(a => Object.assign(a, { mean: a.sum / a.n }));
  const avgTable = (list) => statTable(
    [{ label: "Player" }, { label: "GP", num: true }, { label: "Avg Game Score", num: true }],
    list.map(a => [playerLink(a.pid, data.abbrev, a.name), a.n, scoreCell(Math.round(a.mean * 100) / 100)]));
  const byRawDesc = (a, b) => b.g.raw - a.g.raw || a.g.date.localeCompare(b.g.date);
  const byRawAsc = (a, b) => a.g.raw - b.g.raw || a.g.date.localeCompare(b.g.date);
  const byAvgDesc = (a, b) => b.mean - a.mean || b.n - a.n;
  const byAvgAsc = (a, b) => a.mean - b.mean || b.n - a.n;
  return `<div class="detail-h3">Player Game Score leaders</div>
    <div class="two-up">
      <div><div class="board-sub">Best games</div>${gameTable(top(games, byRawDesc))}</div>
      <div><div class="board-sub">Worst games</div>${gameTable(top(games, byRawAsc))}</div>
    </div>
    <div class="two-up">
      <div><div class="board-sub">Best average Game Score</div>${avgTable(top(avgRows, byAvgDesc))}</div>
      <div><div class="board-sub">Worst average Game Score</div>${avgTable(top(avgRows, byAvgAsc))}</div>
    </div>
    <div class="panel-caption">Raw Game Score (before the credit for quality of competition), games played for ${data.abbrev} only. No minimum games, so a player with a single game can appear in the averages.</div>`;
}

// within-team rankings: forwards, defensemen, forward lines and defense pairs. Players rank by season-average Adjusted Game
// Score with a games-played minimum (a call-up with two games shouldn't top a list); lines and pairs rank by Unit Score
// per 60 minutes together, with a minimum of 30 minutes (10 if the team doesn't have three that qualify yet).
// a player's numbers with this team: for someone traded this season, the games he played for it (his page combines his teams)
const teamSummary = (p, abbrev) => (p.by_team && p.by_team[abbrev]) || p.summary;
function teamQualified(data) {
  const posOf = {};
  (data.roster || []).forEach(r => { posOf[String(r.player_id)] = r.position; });
  const minGp = Math.max(5, Math.round(0.25 * (data.games_played || 0)));
  const everyone = Object.entries(data.players).map(([pid, p]) => ({ pid, p: Object.assign({}, p, { summary: teamSummary(p, data.abbrev) }), pos: posOf[pid] })).filter(x => x.pos && x.pos !== "G" && x.p.summary.gp > 0);
  return { players: everyone.filter(x => x.p.summary.gp >= minGp), everyone, minGp };
}
function teamSkaterTablesHtml(data) {
  const { everyone, minGp } = teamQualified(data);
  // every skater who played for the team, none left out for a short stay: the regulars (minGp+ games) ranked by Avg Adjusted first, then the rest by games played
  const playerTable = (list) => {
    const sorted = list.filter(x => x.p.summary.gp >= minGp).sort((a, b) => b.p.summary.avg_adjusted - a.p.summary.avg_adjusted)
      .concat(list.filter(x => x.p.summary.gp < minGp).sort((a, b) => b.p.summary.gp - a.p.summary.gp || b.p.summary.avg_adjusted - a.p.summary.avg_adjusted));
    return statTable(
      [{ label: "#", num: true }, { label: "Player" }, { label: "Pos" }, ...["GP", "G", "A1", "A2", "P", "TOI / GP", "xGF%", "Avg Game Score", "Avg Adjusted"].map(label => ({ label, num: true }))],
      sorted.map(({ pid, p, pos }, i) => { const s = p.summary;
        return [s.gp >= minGp ? i + 1 : "&ndash;", playerLink(pid, data.abbrev, p.name), pos, s.gp, s.goals, s.a1, s.a2, s.points, s.gp ? toiStr(Math.round(s.toi / s.gp)) : "&ndash;", pctOf(s.xgf, s.xga), scoreCell(s.avg_raw), gsCell(s.avg_adjusted, "avg", true)]; }));
  };
  const fwd = everyone.filter(x => x.pos !== "D"), def = everyone.filter(x => x.pos === "D");
  return `<div class="detail-h3">Forwards <span class="detail-sub">${fwd.length} who played &middot; ranked by Avg Adjusted among those with ${minGp}+ games</span></div>${fwd.length ? playerTable(fwd) : '<div class="empty">No forwards yet.</div>'}
    <div class="detail-h3">Defensemen <span class="detail-sub">${def.length} who played &middot; ranked by Avg Adjusted among those with ${minGp}+ games</span></div>${def.length ? playerTable(def) : '<div class="empty">No defensemen yet.</div>'}
    <div class="panel-caption">Every skater who played for ${data.abbrev} is listed. Those with ${minGp} or more games are ranked by season-average Adjusted Game Score, so a call-up with two games doesn't top the list; everyone else follows, most games first, with a dash for the rank. A player traded this season shows only his games with ${data.abbrev} here. Click any column to sort.</div>`;
}
function teamUnitRankHtml(data) {
  const unitTable = (type) => {
    let list = (data.units || []).filter(u => u.type === type && u.summary.toi_sec >= 1800);
    if (list.length < 3) list = (data.units || []).filter(u => u.type === type && u.summary.toi_sec >= 600);
    // a rate over a few dozen minutes is mostly luck, so each unit's Score / 60 is pulled toward zero by how little time it has
    // (as if it had 100 more minutes of average play): 48 minutes keeps a third of its rate, 300 minutes keeps three quarters
    const shrunk = (u) => u.summary.score_per60 * u.summary.toi_sec / (u.summary.toi_sec + 6000);
    list = list.sort((a, b) => shrunk(b) - shrunk(a)).slice(0, 15);
    if (!list.length) return '<div class="empty">Not enough games together yet.</div>';
    return statTable(
      [{ label: "#", num: true }, { label: "Unit" }, ...["GP", "TOI", "GF", "GA", "xGF", "xGA", "Rating / 60", "Raw / 60", "Total"].map(label => ({ label, num: true }))],
      list.map((u, i) => { const s = u.summary;
        return [i + 1, unitLink(u.key, data.abbrev, u.players.map(x => x.name).join(", ")), s.gp, toiStr(s.toi_sec), s.gf, s.ga, s.xgf.toFixed(1), s.xga.toFixed(1), scoreCell(Math.round(shrunk(u) * 100) / 100), scoreCell(s.score_per60), scoreCell(s.total_score)]; }));
  };
  return `<div class="detail-h3">Best forward lines <span class="detail-sub">by Rating / 60</span></div>${unitTable("line")}
    <div class="detail-h3">Best defense pairs <span class="detail-sub">by Rating / 60</span></div>${unitTable("pair")}
    <div class="panel-caption">Rating / 60 is the Unit Score earned per 60 minutes together (expected goals and goals for and against, plus shot attempts for lines, pairs and penalty-kill units), pulled toward zero for units with little time together, since a rate over a few dozen minutes is mostly luck. Raw / 60 is the unadjusted rate. Units need 30 minutes together (10 when the team has fewer than three that qualify).</div>`;
}

// --- the team page: a header with the season's key numbers and league ranks, then one section at a time
const TEAM_SECTIONS = [["overview", "Overview"], ["skaters", "Skaters"], ["goalies", "Goalies"], ["units", "Lines & pairs"], ["special", "Special teams"], ["leaders", "Leaders"], ["schedule", "Game log"]];
const TEAM_TILES = [["pts", "Points"], ["gf_pg", "Goals for / game"], ["ga_pg", "Goals against / game"], ["xgf_pct", "xGF%"], ["pp_pct", "Power play %"], ["pk_pct", "Penalty kill %"]];
function teamTilesHtml(abbrev) {
  return `<div class="team-tiles">${TEAM_TILES.map(([k, label]) => {
    const t = (S().teams_index || []).find(x => x.abbrev === abbrev), v = t ? teamValue(t, k) : null;
    if (v === null || v === undefined) return "";
    const r = teamRanks(k)[abbrev], stat = TEAM_STAT[k];
    return `<div class="team-tile"><span class="tt-label">${label}</span><b class="tt-val">${fmtTeamStat(stat, v)}</b><span class="tt-rank">${r ? ordinal(r) + " in the league" : ""}</span></div>`;
  }).join("")}</div>`;
}
function teamOverviewHtml(data) {
  const { players } = teamQualified(data);
  const top = players.slice().sort((a, b) => b.p.summary.avg_adjusted - a.p.summary.avg_adjusted).slice(0, 5);
  const topTable = top.length ? statTable(
    [{ label: "Player" }, { label: "Pos" }, { label: "GP", num: true }, { label: "P", num: true }, { label: "Avg Adjusted", num: true }],
    top.map(({ pid, p, pos }) => [playerLink(pid, data.abbrev, p.name), pos, p.summary.gp, p.summary.points, gsCell(p.summary.avg_adjusted, "avg", true)])) : '<div class="empty">Not enough games yet.</div>';
  const recent = data.schedule.slice(-5).reverse();
  const recentTable = recent.length ? statTable(
    [{ label: "Date" }, { label: "Opponent" }, { label: "Score" }, { label: "Result" }],
    recent.map(s => [gameLink(s.gid, s.home, s.date), `${s.loc} ${teamLink(s.opponent)}`, s.score + (s.outcome === "REG" ? "" : " (" + s.outcome + ")"), s.result])) : '<div class="empty">No games yet.</div>';
  return `<div class="two-up">
      <div><div class="detail-h3">Top performers</div>${topTable}</div>
      <div><div class="detail-h3">Last 5 games</div>${recentTable}</div>
    </div>
    ${teamTrendHtml(data)}
    ${teamAdvancedHtml(data.abbrev)}`;
}
function teamTrendHtml(data) {
  const games = data.schedule.filter(g => g.xgf !== null && g.xgf !== undefined && g.xga !== null && g.xga !== undefined);
  const chart = trendChartHtml({
    title: "Chances game by game", bars: true, base: 0, rolling: 5, include: [-1.5, 1.5], fmt: (v) => (v > 0 ? "+" : "") + v.toFixed(1),
    points: games.map(g => { const d = g.xgf - g.xga;
      return { y: d, date: g.date, grade: d >= 0 ? "great" : "blown", letter: g.result === "W" ? "W" : "L",
        tip: `${g.date} ${g.loc} ${g.opponent} · ${g.result === "W" ? "won" : "lost"} ${g.score} · expected goals ${g.xgf.toFixed(2)} for, ${g.xga.toFixed(2)} against (${d > 0 ? "+" : ""}${d.toFixed(2)})` }; }),
    key: `<span class="grade g-great">Better chances</span><span class="grade g-blown">Worse chances</span><span class="tr-k tr-k-line">5-game average</span>`,
  });
  return chart ? `<div class="detail-h3">Season trend</div>${chart}
    <div class="panel-caption">Each bar is one game. A bar above the line means the team created more expected goals than it allowed (it had the better chances); below the line, the other team did. The letter is the result, so an L on an upward bar is a game the team should have won, and a W on a downward bar is one it was lucky to win. The line is the average of the last five games.</div>` : "";
}
// The team game log: one row per game, newest first, with the result, shots, expected goals, shot danger, the special teams and the
// night's best skater, line, pair and goalie (with his start grade). Two columns stay in view while the rest scrolls sideways.
function teamGameLogHtml(data) {
  const games = data.schedule;
  if (!games.length) return '<div class="empty">No games yet.</div>';
  const nm = (id) => (data.players[String(id)] || {}).name || String(id);
  const last = (id) => nm(id).split(" ").slice(-1)[0];
  const dash = "&ndash;", fx = (v, d) => (v === null || v === undefined ? dash : Number(v).toFixed(d));
  let w = 0, l = 0, otl = 0;
  const recs = games.map(g => { if (g.result === "W") w++; else if (g.outcome === "REG") l++; else otl++; return `${w}&ndash;${l}&ndash;${otl}`; });
  const goals = (g) => g.score.split("-").map(Number);
  const pctCell = (a, b, d = 1) => (a + b > 0 ? (100 * a / (a + b)).toFixed(d) : dash);
  const cmp = (a, b) => (a === undefined || a === null ? dash : `<span class="${a > b ? "pos" : a < b ? "neg" : ""}">${a}&ndash;${b}</span>`);
  const unitCell = (u) => {
    if (!u) return dash;
    const names = u[2].map(last).join(", "), faces = `<span class="faces">${u[2].map(id => avatarSpan(id, nm(id))).join("")}</span>`;
    return `<span class="gl-unit">${u[0] ? unitLink(u[0], data.abbrev, names) : faces + escapeHtml(names)} <span class="gl-sc">${scoreCell(u[1])}</span></span>`;
  };
  const rows = games.map((g, i) => {
    const [gf, ga] = goals(g), chip = g.result === "W" ? "w" : g.outcome === "REG" ? "l" : "o", label = g.result === "W" ? "W" : g.outcome === "REG" ? "L" : "OTL";
    const xs = g.xgf !== null && g.xgf !== undefined && g.xga !== null && g.xga !== undefined, xp = xs && g.xgf + g.xga > 0 ? 100 * g.xgf / (g.xgf + g.xga) : null;
    const gk = g.gk, grade = gk ? goalieGrade(gk[4]) : null;
    return `<tr><td class="gl-date">${gameLink(g.gid, g.home, g.date)}</td>
      <td class="gl-opp">${g.loc === "@" ? "@" : "vs"} ${teamLink(g.opponent)}</td>
      <td><span class="res-chip ${chip}">${label}</span> ${g.score}${g.outcome === "REG" ? "" : ` <span class="detail-sub">${g.outcome}</span>`}</td>
      <td class="num">${gf}</td><td class="num">${ga}</td>
      <td class="num">${g.sf === undefined ? dash : g.sf}</td><td class="num">${g.sa === undefined ? dash : g.sa}</td><td class="num">${g.cf === undefined ? dash : pctCell(g.cf, g.ca)}</td>
      <td class="num">${fx(g.xgf, 2)}</td><td class="num">${fx(g.xga, 2)}</td><td class="num ${xp === null ? "" : xp >= 50 ? "pos" : "neg"}">${xp === null ? dash : xp.toFixed(0)}</td>
      <td class="num">${cmp(g.hdf, g.hda)}</td><td class="num">${cmp(g.mdf, g.mda)}</td><td class="num">${cmp(g.ldf, g.lda)}</td>
      <td class="num">${g.ppg === undefined ? dash : `${g.ppg}&ndash;${g.ppga}`}</td><td class="num">${g.pim === undefined ? dash : g.pim}</td><td class="num">${g.fow === undefined ? dash : pctCell(g.fow, g.fol)}</td>
      <td class="gl-best">${g.bs ? `${playerLink(g.bs[0], data.abbrev, nm(g.bs[0]))} <span class="gl-sc">${scoreCell(g.bs[1])}</span>` : dash}</td>
      <td class="gl-best">${unitCell(g.bl)}</td><td class="gl-best">${unitCell(g.bp)}</td>
      <td class="gl-best">${gk ? `${playerLink(gk[0], data.abbrev, nm(gk[0]))} <span class="detail-sub">${gk[1] - gk[2]}/${gk[1]}</span>` : dash}</td>
      <td>${gk ? `${gradeChip(grade)} <span class="gl-sc">${scoreCell(gk[4])}</span>` : dash}</td></tr>`;
  });
  // season totals under the log
  const sum = (k) => games.reduce((a, g) => a + (g[k] || 0), 0), tot = { gf: 0, ga: 0 };
  games.forEach(g => { const [a, b] = goals(g); tot.gf += a; tot.ga += b; });
  const xf = games.reduce((a, g) => a + (g.xgf || 0), 0), xa = games.reduce((a, g) => a + (g.xga || 0), 0);
  const totRow = `<tr class="gl-total"><td colspan="3"><strong>Season</strong> <span class="detail-sub">${w}&ndash;${l}&ndash;${otl}</span></td>
      <td class="num">${tot.gf}</td><td class="num">${tot.ga}</td><td class="num">${sum("sf")}</td><td class="num">${sum("sa")}</td><td class="num">${pctCell(sum("cf"), sum("ca"))}</td>
      <td class="num">${xf.toFixed(1)}</td><td class="num">${xa.toFixed(1)}</td><td class="num">${pctCell(xf, xa, 0)}</td>
      <td class="num">${sum("hdf")}&ndash;${sum("hda")}</td><td class="num">${sum("mdf")}&ndash;${sum("mda")}</td><td class="num">${sum("ldf")}&ndash;${sum("lda")}</td>
      <td class="num">${sum("ppg")}&ndash;${sum("ppga")}</td><td class="num">${sum("pim")}</td><td class="num">${pctCell(sum("fow"), sum("fol"))}</td><td colspan="5"></td></tr>`;
  const head1 = `<tr class="gl-group"><th colspan="3">Game</th><th colspan="2" class="num">Score</th><th colspan="3" class="num">Shots</th><th colspan="3" class="num">Expected goals</th>
    <th colspan="3" class="num">Shot danger (shots on goal, for&ndash;against)</th><th colspan="3" class="num">Other</th><th colspan="3">Best of the night</th><th colspan="2">Goalie</th></tr>`;
  const th = (label, num) => `<th${num ? ' class="num"' : ""}>${label}</th>`;
  const head2 = `<tr>${th("Date")}${th("Opponent")}${th("Result")}${th("GF", 1)}${th("GA", 1)}${th("SOG", 1)}${th("SOGA", 1)}${th("CF%", 1)}${th("xGF", 1)}${th("xGA", 1)}${th("xGF%", 1)}
    ${th("HD", 1)}${th("MD", 1)}${th("LD", 1)}${th("PP goals", 1)}${th("PIM", 1)}${th("FO%", 1)}${th("Skater")}${th("Forward line")}${th("D pair")}${th("Goalie")}${th("Grade")}</tr>`;
  return `<div class="detail-h3">Game log <span class="detail-sub">newest first</span></div>
    <div class="table-scroll"><table class="glog auto-sort"><thead>${head1}${head2}</thead><tbody>${rows.reverse().join("")}${totRow}</tbody></table></div>
    <div class="panel-caption">One row per game. Shots are shots on goal (SOG for, SOGA against); CF% is the team's share of shot attempts and xGF% its share of expected goals, green when above 50%. Shot danger counts shots on goal by how likely each was to score: HD is high (14%+), MD medium (7&ndash;14%), LD low (under 7%), green when the team had more than its opponent. PP goals is power-play goals for&ndash;against. Best of the night is the top Adjusted Game Score among skaters, and the best forward line and defense pair by Unit Score (3:00 together at least). The goalie's grade is from goals saved above expected in the game; the small figure beside his name is saves/shots.</div>`;
}
// shot danger on the power play (shots for) and the penalty kill (shots against), season totals for the team
function teamSpecialDangerHtml(data) {
  const sp = data.special;
  if (!sp) return "";
  const row = (name, a, label) => ({ name: `${name}<small class="dz-sub">${toiStr(a[5])} on ice</small>`,
    cells: [[a[0], ""], [a[1], ""], [a[2], ""], [a[0] + a[1] + a[2], `${a[3]} G &middot; ${a[4].toFixed(1)} xG`]] });
  return `<div class="detail-h3">Shot danger on special teams</div>
    ${dangerCardHtml([row("Power play", sp.pp), row("Penalty kill", sp.pk)], "Total")}
    <div class="panel-caption">Shots on goal by danger band. Power play counts the team's own shots while it had the man advantage; penalty kill counts the shots it allowed while shorthanded. The small figures under each total are goals and expected goals from those shots. Unit by unit is below.</div>`;
}
function teamDetailHtml(data) {
  const state = specialState.teams;
  const sec = TEAM_SECTIONS.some(x => x[0] === state.sec) ? state.sec : "overview";
  const t = (S().teams_index || []).find(x => x.abbrev === data.abbrev);
  const record = t ? `${t.w}&ndash;${t.l}&ndash;${t.otl} &middot; ${t.pts} pts &middot; ${t.gp} games` : `${data.wins}&ndash;${data.losses}`;
  const nav = `<nav class="chips team-nav" role="tablist" aria-label="Team sections">${TEAM_SECTIONS.map(([k, label]) =>
    `<button type="button" class="chip" role="tab" aria-pressed="${k === sec}" data-team-sec="${k}">${label}</button>`).join("")}</nav>`;
  const goalies = statTable(
    [{ label: "Goalie" }, { label: "GP", num: true }, { label: "Shots Against", num: true }, { label: "Goals Against", num: true }, { label: "Sv%", num: true }, { label: "GSAx", num: true }],
    data.goalies.map(g => [playerLink(g.player_id, data.abbrev, g.name), g.gp, g.shots_faced, g.goals_allowed, g.sv_pct != null ? g.sv_pct.toFixed(3) : "&ndash;", (g.gsax > 0 ? "+" : "") + g.gsax])
  );
  const sched = statTable(
    [{ label: "Date" }, { label: "Opponent" }, { label: "Score" }, { label: "Result" }],
    data.schedule.map(s => [gameLink(s.gid, s.home, s.date), `${s.loc} ${teamLink(s.opponent)}`, s.score + (s.outcome === "REG" ? "" : " (" + s.outcome + ")"), s.result])
  );
  const body = {
    overview: () => teamOverviewHtml(data),
    skaters: () => teamSkaterTablesHtml(data),
    goalies: () => `<div class="detail-h3">Goalies</div>${goalies}`,
    units: () => teamUnitRankHtml(data) + unitSectionsHtml(data.units, data.abbrev, !data.allUnits, !!data.allUnits, ["line", "pair"]),
    special: () => teamSpecialDangerHtml(data) + (unitSectionsHtml(data.units, data.abbrev, false, !!data.allUnits, ["pp", "pk", "ev4", "ev3"]) || '<div class="empty">No special-teams units yet.</div>'),
    leaders: () => teamPlayerBoardsHtml(data),
    schedule: () => teamGameLogHtml(data),
  }[sec]();
  return `
    ${detailNav('<button class="back-btn" data-back="teams">&larr; All Teams</button>')}
    <div class="team-head">${logoSpan(data.abbrev, "tlogo-lg")}<div><div class="detail-title">${escapeHtml(teamName(data.abbrev))}</div><div class="team-record">${data.abbrev} &middot; ${record}</div></div></div>
    ${teamTilesHtml(data.abbrev)}
    ${nav}
    <div class="team-section">${body}</div>
  `;
}

function playersListHtml(filterText) {
  const q = (filterText || "").trim().toLowerCase();
  const rows = (S().players_index || []).filter(p => p.pos !== "G" && (!q || p.name.toLowerCase().includes(q)));
  if (!rows.length) return '<div class="empty">No players match that filter.</div>';
  const sorted = rows.slice().sort((a, b) => b.gp - a.gp);
  let html = '<div class="table-scroll"><table class="auto-sort"><thead><tr><th>Player</th><th>Pos</th><th>Team</th><th class="num">GP</th></tr></thead><tbody>';
  sorted.forEach(p => {
    html += `<tr class="clickable" data-open-player="${p.id}" data-player-team="${p.team}"><td>${avatarSpan(p.id, p.name)}${escapeHtml(p.name)}</td><td>${p.pos}</td><td>${logoSpan(p.team)}${p.team}</td><td class="num">${p.gp}</td></tr>`;
  });
  html += "</tbody></table></div>";
  return html;
}

// Player card: the player's headline numbers plus a percentile bar for each stat against everyone in his group
// (forwards, defensemen or goalies) with a real sample this season. The percentiles are computed at export time.
const POS_LABEL = { L: "LW", C: "C", R: "RW", D: "D", G: "G" };
// the percentile bars of a card (players and units): blue for a low percentile through a neutral grey in the middle to red for a high one
function pctBarsHtml(c) {
  const groupsInOrder = [...new Set(c.m.map(m => m[0]))];
  const pctColor = (pct) => { const t = Math.abs(pct - 50) / 50; return `hsl(${pct < 50 ? 215 : 4} ${(8 + 70 * t).toFixed(0)}% ${(72 - 23 * t).toFixed(0)}%)`; };
  return groupsInOrder.map(g => `<div class="pc-block"><div class="pc-group">${g}</div>` + c.m.filter(m => m[0] === g).map(([, label, text, pct]) =>
    `<div class="pc-row"><span class="pc-label">${label}</span>
      <span class="pc-track">${pct === null ? "" : `<i class="pc-fill" style="width:${pct}%;background:${pctColor(pct)}"></i><b class="pc-dot" style="left:${pct}%;background:${pctColor(pct)}">${pct}</b>`}</span>
      <span class="pc-val">${text}</span></div>`).join("") + "</div>").join("");
}
// the card on screen, so its Save button can draw the same numbers as an image
let lastPctCard = null;
const slugOf = (x) => String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
async function playerPhotoUri(pid) {
  try {   // the full-size photo when the site has one
    const r = await fetch(`data/photos_lg/${pid}.jpg`);
    if (r.ok) { const b = await r.blob(); return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); }); }
  } catch (e) {}
  try {
    IMG.photoTeam = IMG.photoTeam || jsonOrEmpty("data/photo_team.json");
    const t = (await IMG.photoTeam)[pid];
    if (!t) return null;
    IMG.photoFiles[t] = IMG.photoFiles[t] || jsonOrEmpty("data/photos/" + t + ".json");
    const b64 = ((await IMG.photoFiles[t]) || {})[pid];
    return b64 ? "data:image/jpeg;base64," + b64 : null;
  } catch (e) { return null; }
}
async function savePctCard() {
  const c = lastPctCard;
  if (!c) return;
  const logos = await GameView.cardLogos().catch(() => null), season = (DATA.seasons.find(x => x.id === SEASON) || {}).label || "";
  const groups = [...new Set(c.card.m.map(m => m[0]))].map(g => [g, c.card.m.filter(m => m[0] === g).map(m => [m[1], m[2], m[3]])]);
  const how = c.kind === "unit"
    ? `Percentile among the ${c.card.n} ${c.card.pool} with a real sample in ${season} (at least 10% of the busiest one's time together). Blue is low, red is high; 100 is the best in the league, and where less is better a low number earns a high percentile. Rates are per 60 minutes together.`
    : `Percentile among the ${c.card.n} ${c.card.pool} with a real sample in ${season} (at least 10% of the busiest skater's ice time, or a quarter of the busiest goalie's games). Blue is low, red is high; 100 is the best in the league, and where less is better a low number earns a high percentile. Rates are per 60 minutes, all situations.`;
  const opts = { title: c.title, sub: c.sub, date: season, logo: logos && logos[c.team] || null, photo: c.kind === "player" ? await playerPhotoUri(c.playerId) : null,
    stats: c.stats, groups, small: c.card.small, caption: how };
  await GameView.savePctCard(opts, `shift-score-${slugOf(c.title)}-${slugOf(season)}.png`);
}
// a unit's card: where its numbers rank among the units of its own kind this season
function unitCardHtml(u, data, title) {
  const c = u.card;
  if (!c || !c.m.length) return "";
  const s = u.summary;
  const head = [["GP", s.gp], ["TOI", toiStr(s.toi_sec)], ["GF-GA", `${s.gf}-${s.ga}`], ["xGF-xGA", `${s.xgf.toFixed(1)}-${s.xga.toFixed(1)}`]];
  lastPctCard = { kind: "unit", card: c, title, sub: `${data.abbrev} · ${UNIT_LABEL_SINGULAR[u.type]}`, team: data.abbrev, stats: head };
  return `<div class="player-card unit-card">
      <div class="pc-head">
        <span class="faces">${u.players.map(p => avatarSpan(p.id, p.name)).join("")}</span>
        <div class="pc-id"><div class="pc-name">${escapeHtml(title)}</div>
          <div class="pc-sub">${teamLink(data.abbrev)} &middot; ${UNIT_LABEL_SINGULAR[u.type]}</div></div>
        <div class="pc-stats">${head.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join("")}</div>
      </div>
      ${c.small ? `<div class="pc-small">Small sample: this unit is below the ice-time bar for the comparison group, so the rates and percentiles below can swing a lot from a few shifts.</div>` : ""}
      <div class="pc-bars">${pctBarsHtml(c)}</div>
      <div class="pc-actions"><button type="button" class="chip" data-save-pcard="1">Save as image</button></div>
      <div class="panel-caption">Percentile among the ${c.n} ${c.pool} with a real sample this season (at least 10% of the busiest one's time together). Bars run from blue (low) to red (high); 100 is the best in the league at that stat: where less is better (goals against, xGA, shot attempts against) a low number earns a high percentile. Rates are per 60 minutes of this unit's own time together.</div>
    </div>`;
}
function playerCardHtml(playerId, p, teamData) {
  const c = p.card;
  if (!c || !c.m.length) return "";
  const s = p.summary, abbrev = teamData.abbrev;
  const rosterRow = (teamData.roster || []).find(r => String(r.player_id) === String(playerId)), goalieRow = (teamData.goalies || []).find(r => String(r.player_id) === String(playerId));
  const pos = POS_LABEL[goalieRow ? "G" : rosterRow ? rosterRow.position : ""] || "";
  const toiGp = s.gp ? toiStr(Math.round(s.toi / s.gp)) : "&ndash;";
  const head = goalieRow
    ? [["GP", goalieRow.gp], ["Sv%", goalieRow.sv_pct != null ? goalieRow.sv_pct.toFixed(3) : "&ndash;"], ["GSAx", (goalieRow.gsax > 0 ? "+" : "") + goalieRow.gsax], ["SA", goalieRow.shots_faced]]
    : [["GP", s.gp], ["G", s.goals], ["A1", s.a1], ["A2", s.a2], ["P", s.points], ["TOI / GP", toiGp]];
  const bars = pctBarsHtml(c);
  lastPctCard = { kind: "player", card: c, playerId, title: p.name, sub: `${abbrev}${pos ? " · " + pos : ""}`, team: abbrev, stats: head.map(([k, v]) => [k, String(v).replace(/&ndash;/g, "-")]) };
  return `<div class="player-card">
      <div class="pc-head">
        ${avatarSpan(playerId, p.name, "avatar-lg")}
        <div class="pc-id"><div class="pc-name">${escapeHtml(p.name)}</div>
          <div class="pc-sub">${teamLink(abbrev)}${pos ? ` &middot; ${pos}` : ""}</div></div>
        <div class="pc-stats">${head.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join("")}</div>
      </div>
      ${c.small ? `<div class="pc-small">Small sample: this player is below the ice-time bar for the comparison group, so the rates and percentiles below can swing a lot from a few games.</div>` : ""}
      <div class="pc-bars">${bars}</div>
      <div class="pc-actions"><button type="button" class="chip" data-save-pcard="1">Save as image</button></div>
      <div class="panel-caption">Percentile among the ${c.n} ${c.pool} with a real sample this season (at least 10% of the busiest skater's ice time, or a quarter of the busiest goalie's games). Bars run from blue (low) to red (high); 100 is the best in the league at that stat: where less is better (goals against, xGA, giveaways, penalties taken) a low number earns a high percentile. Rates are per 60 minutes of his own ice time, all situations.</div>
    </div>`;
}

// --- Trend charts: inline SVG, no libraries. Dots (or bars) are one game each, in order; an optional line is the trailing average.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (d) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
function trendChartHtml(o) {
  const pts = o.points, n = pts.length;
  if (n < (o.min || 3)) return "";
  // the chart is drawn at the width it will be shown, so its labels stay readable on a phone instead of scaling down with the picture
  const host = document.getElementById("panels"), W = Math.max(300, Math.min(760, Math.round(((host && host.clientWidth) || 760) - 40))), H = W < 500 ? 230 : 250, L = 44, R = 12, T = 18, B = 36;
  let lo = Math.min(...pts.map(p => p.y), ...(o.include || [])), hi = Math.max(...pts.map(p => p.y), ...(o.include || []));
  if (o.base !== undefined) { lo = Math.min(lo, o.base); hi = Math.max(hi, o.base); }
  const raw = ((hi - lo) || 1) / 5, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(v => v >= raw);
  const y0 = Math.floor(lo / step + 1e-9) * step, y1 = Math.ceil(hi / step - 1e-9) * step;
  const band = (W - L - R) / n, X = (i) => L + (i + 0.5) * band, Y = (v) => T + (y1 - v) * (H - T - B) / (y1 - y0);
  const fmt = o.fmt || ((v) => (Math.abs(v) < 10 ? v.toFixed(1) : v.toFixed(0)));
  let grid = "";
  for (let v = y0; v <= y1 + step / 2; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="tr-grid"/><text x="${L - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" class="tr-axis">${fmt(v)}</text>`;
  const base = o.base !== undefined ? `<line x1="${L}" x2="${W - R}" y1="${Y(o.base).toFixed(1)}" y2="${Y(o.base).toFixed(1)}" class="tr-base"/>` : "";
  const nl = Math.min(6, n), labels = Array.from({ length: nl }, (_, k) => Math.round(k * (n - 1) / Math.max(nl - 1, 1)))
    .filter((v, k, a) => a.indexOf(v) === k).map(i => `<text x="${X(i).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="tr-axis">${shortDate(pts[i].date)}</text>`).join("");
  // the trailing average, drawn over the dots or the bars (it starts at the third game)
  let line = "";
  if (o.rolling) {
    let d = "";
    pts.forEach((_, i) => {
      if (i < 2) return;
      const w = pts.slice(Math.max(0, i - o.rolling + 1), i + 1), v = w.reduce((a, q) => a + q.y, 0) / w.length;
      d += `${d ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
    });
    line = `<path d="${d}" class="tr-line"/>`;
  }
  let marks = "";
  if (o.bars) {
    const bw = Math.min(22, band * 0.72), letters = n <= 45;
    marks = pts.map((p, i) => { const yv = Y(p.y), yb = Y(o.base !== undefined ? o.base : 0);
      const letter = letters && p.letter ? `<text x="${X(i).toFixed(1)}" y="${(p.y >= (o.base || 0) ? Math.min(yv, yb) - 5 : Math.max(yv, yb) + 14).toFixed(1)}" text-anchor="middle" class="tr-letter">${p.letter}</text>` : "";
      return `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${Math.min(yv, yb).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(Math.abs(yv - yb), 1.5).toFixed(1)}" rx="2" class="tr-bar g-${p.grade}${p.relief ? " tr-relief" : ""}" data-tip="${escapeHtml(p.tip)}"/>${letter}`; }).join("") + line;
  } else {
    marks = line + pts.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="5" class="tr-dot${p.lost ? " tr-lost" : ""}" data-tip="${escapeHtml(p.tip)}"/>`).join("");
  }
  return `<figure class="trend"><figcaption>${o.title}</figcaption>
    <svg viewBox="0 0 ${W} ${H}" class="tr-svg" role="img" aria-label="${escapeHtml(o.title)}">${grid}${base}${marks}${labels}</svg>
    <div class="tr-key">${o.key || ""}</div></figure>`;
}

// --- Goalie start grades: the grade helpers (goalieGrade, goalieTags, gradeChip) live in artifact_game_view.js, shared with the game pages.
function goalieStartsHtml(log) {
  if (!log || !log.length) return "";
  const gr = log.map(g => goalieGrade(g.gsax)), cnt = (...ks) => gr.filter(k => ks.includes(k)).length, n = log.length;
  const pos = cnt("great", "quality", "average");
  const tile = (label, value, sub, cls) => `<div class="team-tile"><span class="tt-label">${label}</span><b class="tt-val ${cls || ""}">${value}</b><span class="tt-rank">${sub}</span></div>`;
  const tiles = `<div class="team-tiles">${tile("Great or Quality", cnt("great", "quality"), `of ${n} games`, "pos")}${tile("Average", cnt("average"), `of ${n} games`)}${tile("Bad or Blown", cnt("bad", "blown"), `of ${n} games`, "neg")}${tile("Positive games", Math.round(100 * pos / n) + "%", "Great, Quality or Average")}</div>`;
  const chart = trendChartHtml({
    title: "Goals saved above expected, game by game", bars: true, min: 2, base: 0, include: [-2, 2], fmt: (v) => (v > 0 ? "+" : "") + v.toFixed(1),
    points: log.map((g, i) => ({ y: g.gsax, date: g.date, grade: gr[i], relief: g.relief,
      tip: `${g.date} ${g.loc} ${g.opp} · ${GRADE_LABEL[gr[i]]} · ${g.sf} shots, ${g.ga} goals, ${g.xga.toFixed(2)} expected · ${g.gsax > 0 ? "+" : ""}${g.gsax.toFixed(2)}${g.relief ? " · relief" : ""}` })),
    key: `<span class="grade g-great">Great</span><span class="grade g-quality">Quality</span><span class="grade g-average">Average</span><span class="grade g-bad">Bad</span><span class="grade g-blown">Blown</span><span class="tr-note">Faded bars are relief appearances. Above the line means he stopped more than expected.</span>`,
  });
  return `<div class="detail-h3">Start grades</div>${tiles}${chart}
    <div class="panel-caption">Each game is graded by goals saved above expected (the chance each shot on goal had of scoring, added up, minus goals allowed): Great is more than +1.5, Quality +0.5 to +1.5, Average within 0.5, Bad -0.5 to -1.5, Blown worse than -1.5. A Stolen win is a Great or Quality game in a win when the team was out-chanced by a goal or more in expected goals; Bailed out is a Bad or Blown game in a win. Relief means another goalie started and faced more shots.</div>`;
}
function goalieLogTable(log) {
  return statTable(
    [{ label: "Date" }, { label: "Opponent" }, { label: "Shots", num: true }, { label: "Goals", num: true }, { label: "Sv%", num: true },
     { label: "xGA", num: true }, { label: "GSAx", num: true }, { label: "Grade" }],
    log.slice().reverse().map(g => { const gr = goalieGrade(g.gsax), tags = goalieTags(g);
      return [gameLink(g.gid, g.home, g.date), `${g.loc} ${g.opp}`, g.sf, g.ga, g.sf ? (1 - g.ga / g.sf).toFixed(3) : "&ndash;", g.xga.toFixed(2), scoreCell(g.gsax),
        gradeChip(gr) + tags.map(t => ` <span class="grade-tag">${t}</span>`).join("")]; }));
}

// A goalie's season summary: results (record in starts, shots, goals, save percentage against what the shots were worth, goals against
// average, expected goals against, goals saved above expected), then rates and results by shot danger. Skater numbers (goals, assists, Game
// Score) do not apply to a goalie.
function goalieSummaryHtml(p, row) {
  const s = p.summary, log = p.goalie_log || [], d = p.danger || [];
  const gp = row ? row.gp : log.length, starts = log.filter(x => !x.relief), w = starts.filter(x => x.win).length;
  const sa = row ? row.shots_faced : log.reduce((a, x) => a + x.sf, 0), ga = row ? row.goals_allowed : log.reduce((a, x) => a + x.ga, 0);
  const gsax = row ? row.gsax : log.reduce((a, x) => a + x.gsax, 0), xga = ga + gsax, toi = s.toi || 0;
  const svp = (sf, g) => (sf ? (1 - g / sf).toFixed(3) : "&ndash;"), rate = (x) => (toi >= 3600 ? (x * 3600 / toi).toFixed(2) : "&ndash;");
  const results = statTable(
    [{ label: "GP", num: true }, { label: "GS", num: true }, { label: "W-L (starts)", num: true }, { label: "SA", num: true }, { label: "GA", num: true },
     { label: "Sv%", num: true }, { label: "Expected Sv%", num: true }, { label: "GAA", num: true }, { label: "xGA", num: true }, { label: "GSAx", num: true }],
    [[gp, starts.length, `${w}-${starts.length - w}`, sa, ga, svp(sa, ga), svp(sa, xga), rate(ga), xga.toFixed(1), scoreCell(gsax)]]);
  const band = (i) => (d.length ? [svp(d[i], d[i + 1]), svp(d[i], d[i + 2])] : ["&ndash;", "&ndash;"]);
  const [hs, hx] = band(0), [ms, mx] = band(3), [ls, lx] = band(6);
  const rates = statTable(
    [{ label: "TOI", num: true }, { label: "SA / 60", num: true }, { label: "GSAx / 60", num: true }, { label: "High-danger Sv%", num: true }, { label: "Expected", num: true },
     { label: "Medium Sv%", num: true }, { label: "Expected", num: true }, { label: "Low-danger Sv%", num: true }, { label: "Expected", num: true }],
    [[toiStr(toi), rate(sa), toi >= 3600 ? scoreCell(gsax * 3600 / toi) : "&ndash;", hs, hx, ms, mx, ls, lx]]);
  return results + '<div style="height:12px"></div>' + rates + `<div class="panel-caption">W-L counts games he started (a loss includes overtime and shootout losses). Expected Sv% is what an average goalie would save on the same shots: one minus expected goals against over shots. GSAx is expected goals against minus goals allowed. The danger columns split his save percentage by how likely each shot was to score, next to what an average goalie would save on those shots. Rates need an hour of ice time.</div>`;
}
function playerDetailHtml(playerId, teamData, sec, tm) {
  const p0 = teamData.players[playerId];
  if (!p0) return '<div class="empty">Player not found on this roster.</div>';
  // a player traded this season has one page for all his teams: the combined totals, or (tm) only his games with one of them
  const bt = p0.by_team, btTeams = bt ? Object.keys(bt) : [], view = bt && tm && bt[tm] ? tm : null;
  const p = view ? Object.assign({}, p0, { summary: bt[view], splits: bt[view].splits, game_log: p0.game_log.filter(g => g.team === view) }) : p0;
  const s = p.summary;
  const goalieRowHere = (teamData.goalies || []).find(r => String(r.player_id) === String(playerId));
  const posHere = ((teamData.roster || []).find(r => String(r.player_id) === String(playerId)) || {}).position;   // raw Game Score is colored against his own position
  const summary = goalieRowHere || p.goalie_log ? goalieSummaryHtml(p, goalieRowHere) : statTable(
    [{ label: "GP", num: true }, { label: "G", num: true }, { label: "A1", num: true }, { label: "A2", num: true }, { label: "P", num: true },
     { label: "Avg Raw", num: true }, { label: "Avg Adjusted", num: true }, { label: "Total ixG", num: true }],
    [[s.gp, s.goals, s.a1, s.a2, s.points, gsCell(s.avg_raw, gsKind(posHere, true), false), gsCell(s.avg_adjusted, "avg", true), s.total_ixg]]
  );
  // rates need a sample: an hour of ice time for the season, half an hour for a situation (power play, penalty kill)
  const per60 = (x) => (s.toi >= 3600 ? (x * 3600 / s.toi).toFixed(2) : "&ndash;");
  const advanced = s.toi ? statTable(
    [{ label: "TOI / GP", num: true }, { label: "P / 60", num: true }, { label: "SOG / 60", num: true }, { label: "ixG / 60", num: true },
     { label: "G - ixG", num: true }, { label: "CF%", num: true }, { label: "xGF%", num: true }, { label: "HDCF%", num: true },
     { label: "OZ start %", num: true }, { label: "FO%", num: true }, { label: "Pen. drawn / taken", num: true }, { label: "Hits / 60", num: true }, { label: "Blocks / 60", num: true }],
    [[toiStr(Math.round(s.toi / s.gp)), per60(s.points), per60(s.shots), per60(s.total_ixg), signed2(s.goals - s.total_ixg), pctOf(s.cf, s.ca), pctOf(s.xgf, s.xga),
      pctOf(s.hdcf, s.hdca), pctOf(s.oz, s.dz), pctOf(s.fow, s.fol), `${s.pd} / ${s.pt}`, per60(s.hits), per60(s.blk)]]
  ) : "";
  const SPLIT_NAMES = [["EV", "Even strength"], ["PP", "Power play"], ["PK", "Penalty kill"]];
  const splits = p.splits ? statTable(
    [{ label: "Situation" }, ...["TOI", "G", "A", "P", "SOG", "ixG", "CF%", "xGF%", "xGF / 60", "xGA / 60", "HDCF%"].map(label => ({ label, num: true }))],
    SPLIT_NAMES.filter(([k]) => p.splits[k]).map(([k, label]) => {
      const v = p.splits[k]; // toi, g, a, sog, ixg, cf, ca, xgf, xga, gf, ga, hdcf, hdca
      const r = (x) => (v[0] >= 1800 ? (x * 3600 / v[0]).toFixed(2) : "&ndash;");
      return [label, toiStr(v[0]), v[1], v[2], v[1] + v[2], v[3], v[4].toFixed(1), pctOf(v[5], v[6]), pctOf(v[7], v[8]), r(v[7]), r(v[8]), pctOf(v[11], v[12])];
    })
  ) : "";
  // shot danger: the player's own unblocked shots by band (season sums of the per-game splits) beside the chances
  // his team created and allowed while he was on the ice (high 14%+ to score, medium 7-14%, low under 7%)
  const own = p.splits ? ["EV", "PP", "PK"].reduce((a, k) => (p.splits[k] ? [a[0] + p.splits[k][13], a[1] + p.splits[k][14], a[2] + p.splits[k][15]] : a), [0, 0, 0]) : null;
  // flipped: the danger bands run across the top, the measures down the side
  const BANDS_HEAD = ["High", "Medium", "Low"].map(label => ({ label, num: true })).concat([{ label: "Total", num: true }]);
  const dangerTable = s.toi && !p.danger ? (() => {   // goalies get their own table below, not the skater one
    const f = [s.hdcf, s.mdcf || 0, s.ldcf || 0], a = [s.hdca, s.mdca || 0, s.ldca || 0];
    const sum3 = (v) => v[0] + v[1] + v[2];
    // his own shots on goal in each band with the goals he scored and the goals he was expected to score (the summed chance each shot had),
    // shaded green when he scored more than expected and red when fewer
    const spl = (i) => ["EV", "PP", "PK"].reduce((t, k) => t + (p.splits && p.splits[k] ? (p.splits[k][i] || 0) : 0), 0);
    const ownN = [13, 14, 15].map(spl), ownG = [16, 17, 18].map(spl), ownX = [19, 20, 21].map(spl);
    const shade = bandShade;
    const ownCell = (n, g, x) => [n, `${Math.round(g)} G &middot; ${x.toFixed(2)} xG`, shade(g, x)];
    const tot = [sum3(ownN), sum3(ownG), sum3(ownX)];
    const gF = [s.hdgf || 0, s.mdgf || 0, s.ldgf || 0], gA = [s.hdga || 0, s.mdga || 0, s.ldga || 0];
    const xF = [s.hdxgf || 0, s.mdxgf || 0, s.ldxgf || 0], xA = [s.hdxga || 0, s.mdxga || 0, s.ldxga || 0];
    const onCell = (n, g, x, against) => [n, `${Math.round(g)} G &middot; ${x.toFixed(2)} xG`, (against ? -1 : 1) * shade(g, x)];
    const share = (x, y) => (x + y ? [Math.round(100 * x / (x + y)) + "%", `${x} of ${x + y}`, (x / (x + y) - 0.5) * 4] : ["&ndash;", "", null]);
    return dangerCardHtml([
      { name: "Own shots", cells: [...[0, 1, 2].map(i => ownCell(ownN[i], ownG[i], ownX[i])), ownCell(tot[0], tot[1], tot[2])] },
      // on the ice: the chances for and against by band with the goals and the expected goals from them; green when the goals went the team's way
      // by more than the shots were worth, red when against
      { name: "On ice for", cells: [...[0, 1, 2].map(i => onCell(f[i], gF[i], xF[i], false)), onCell(sum3(f), sum3(gF), sum3(xF), false)] },
      { name: "On ice against", cells: [...[0, 1, 2].map(i => onCell(a[i], gA[i], xA[i], true)), onCell(sum3(a), sum3(gA), sum3(xA), true)] },
      { name: "Share", cells: [...f.map((x, i) => share(x, a[i])), share(sum3(f), sum3(a))] },
    ], "Total");
  })() : "";
  // goalies: shots faced, goals allowed and goals saved above expected in each band
  const goalieDangerTable = p.danger ? (() => {
    const d = p.danger; // [sf, ga, xga] for high, medium, low
    const col = (i) => [d[i], d[i + 1], d[i + 2]];
    const cols = [col(0), col(3), col(6)], tot = [0, 1, 2].map(k => cols.reduce((x, c) => x + c[k], 0));
    const cell = (c, k) => k === 0 ? c[0] : k === 1 ? c[1] : k === 2 ? (c[0] ? (1 - c[1] / c[0]).toFixed(3) : "&ndash;") : k === 3 ? c[2].toFixed(1) : scoreCell(c[2] - c[1]);
    return statTable([{ label: "Shot danger" }, ...BANDS_HEAD],
      ["Shots faced", "Goals allowed", "Sv%", "xGA", "GSAx"].map((label, k) => [label, ...cols.map(c => cell(c, k)), cell(tot, k)]), { sort: false });
  })() : "";
  const log = statTable(
    [{ label: "Date" }, { label: "Team" }, { label: "Opp" }, { label: "G", num: true }, { label: "A1", num: true }, { label: "A2", num: true }, { label: "Raw", num: true },
     { label: "QoC", num: true }, { label: "QoT", num: true }, { label: "Adjusted", num: true }, { label: "ixG", num: true }, { label: "Line / pair" }],
    p.game_log.map(g => [gameLink(g.gid, g.home, g.date), teamLink(g.team), g.opp ? `<span class="detail-sub">${escapeHtml(g.loc || "")}</span> ${teamLink(g.opp)}` : "&ndash;", g.goals, g.a1, g.a2, gsCell(g.raw, gsKind(posHere, false), false),
      g.qoc, g.qot, gsCell(g.adjusted, "adj", true), g.ixg,
      // the line or pair he spent the most time with that night, graded against the same slot in every game since 2024-25
      g.u ? `<a class="row-link" data-open-unit="${g.u[2]}" data-unit-team="${g.team}">${g.u[0]}</a> ${unitGradeHtml(g.u[1], g.u[0])} <span class="detail-sub">${signed2(g.u[1])}</span>` : "&ndash;"])
  );
  const isGoalie = (teamData.goalies || []).some(g => String(g.player_id) === String(playerId));
  const glog = isGoalie && p.goalie_log && p.goalie_log.length ? p.goalie_log : null;
  const trend = !isGoalie ? trendChartHtml({
    title: "Game Score trend (Adjusted)", base: 0, rolling: 5, include: [-2, 2],
    points: p.game_log.filter(g => g.adjusted !== null && g.adjusted !== undefined).map(g => ({ y: g.adjusted, date: g.date,
      tip: `${g.date} · Adjusted ${g.adjusted > 0 ? "+" : ""}${g.adjusted.toFixed(2)} (raw ${g.raw.toFixed(2)}) · ${g.goals}G ${g.assists}A` })),
    key: `<span class="tr-k tr-k-dot">One game</span><span class="tr-k tr-k-line">5-game average</span><span class="tr-note">0 is an average forward or defenseman.</span>`,
  }) : "";
  const SECS = isGoalie ? [["overview", "Overview"], ["log", "Game log"], ["danger", "Shot danger"]]
    : [["overview", "Overview"], ["log", "Game log"], ["splits", "Splits & shot danger"], ["units", "Lines & pairs"]];
  const secKey = SECS.some(x => x[0] === sec) ? sec : "overview";
  const nav = `<nav class="chips team-nav" role="tablist" aria-label="Player sections">${SECS.map(([k, label]) =>
    `<button type="button" class="chip" role="tab" aria-pressed="${k === secKey}" data-player-sec="${k}">${label}</button>`).join("")}</nav>`;
  const byTeamHtml = bt ? statTable(
    [{ label: "Team" }, ...["GP", "G", "A", "P", "Avg Raw", "Avg Adjusted", "TOI / GP", "xGF%"].map(label => ({ label, num: true }))],
    btTeams.map(t => { const x = bt[t]; return [`<a class="row-link" data-player-tm="${t}">${logoSpan(t)}${t}</a>`, x.gp, x.goals, x.a1 + x.a2, x.points, gsCell(x.avg_raw, gsKind(posHere, true), false), gsCell(x.avg_adjusted, "avg", true),
      x.gp ? toiStr(Math.round(x.toi / x.gp)) : "&ndash;", pctOf(x.xgf, x.xga)]; })
  ) : "";
  const tmChips = bt ? `<div class="chips board-chips" role="group" aria-label="Team">${[["all", "All teams"], ...btTeams.map(t => [t, t])].map(([k, label]) =>
    `<button type="button" class="chip" aria-pressed="${(view || "all") === k}" data-player-tm="${k}">${label}</button>`).join("")}</div>` : "";
  const unitsHtml = unitSectionsHtml((teamData.units || []).filter(u => u.players.some(x => String(x.id) === String(playerId))), teamData.abbrev, !teamData.allUnits, !!teamData.allUnits);
  const body = {
    overview: () => `<div class="detail-h3">Season Summary${view ? ` <span class="detail-sub">${view} only</span>` : bt ? ' <span class="detail-sub">all teams</span>' : ""}</div>${summary}
      ${bt && !view ? `<div class="detail-h3">By team</div>${byTeamHtml}<div class="panel-caption">He was traded this season. Every number on this page counts all his teams; pick one above to see only his games with that team.</div>` : ""}
      <div class="detail-h3">Seasons</div><div id="player-seasons" data-pid="${playerId}" data-goalie="${isGoalie ? 1 : 0}"><div class="empty">Loading&hellip;</div></div>
      ${glog ? goalieStartsHtml(glog) : ""}
      ${trend ? `<div class="detail-h3">Trend</div>${trend}` : ""}
      ${advanced && !isGoalie ? `<div class="detail-h3">Advanced</div>${advanced}<div class="panel-caption">CF%, xGF% and HDCF% are the team's share of shot attempts, expected goals and high-danger shots on goal while he was on the ice (all situations). OZ start % is offensive-zone shift starts over offensive plus defensive.</div>` : ""}`,
    log: () => `<div class="detail-h3">Game Log (${s.gp} games)</div>${glog ? goalieLogTable(glog) : log + gsKeyHtml("Raw and Adjusted colors")}`,
    splits: () => `${splits ? `<div class="detail-h3">By situation</div>${splits}` : ""}
      ${dangerTable ? `<div class="detail-h3">Shot danger</div>${dangerTable}<div class="panel-caption">Own shots are the shots on goal he took, by how likely each was to score (high 14%+, medium 7-14%, low under 7%). Under each count are his goals and his expected goals (xG) from those shots, the chance each had of scoring added up: green means he scored more than expected, red fewer. On ice for and against are the shots on goal his team took and allowed while he was out there, each with the goals and expected goals from them: for the team, green means more goals than the shots were worth; against it, green means fewer goals allowed than expected. Share is his team's part of the shots.</div>` : ""}`,
    danger: () => goalieDangerTable ? `<div class="detail-h3">Goalie results by shot danger</div>${goalieDangerTable}<div class="panel-caption">GSAx is expected goals against minus goals allowed in each band.</div>` : '<div class="empty">No shot-danger data yet.</div>',
    units: () => (bt ? `<div class="panel-caption">Showing his lines and pairs with ${teamData.abbrev}.${btTeams.length > 1 ? ` Pick another team above and open this tab again to see the others.` : ""}</div>` : "") + (unitsHtml || '<div class="empty">No lines or pairs with enough time together yet.</div>'),
  }[secKey]();
  // the section tabs sit right under the player's name and numbers (inside the card, above the long percentile list); on the other
  // sections the card shrinks to just its header so the tabs stay near the top
  const card = playerCardHtml(playerId, p, teamData);
  let cardHtml = card, navPlaced = false;
  if (card && card.includes('<div class="pc-bars"')) { cardHtml = card.replace('<div class="pc-bars"', nav + '<div class="pc-bars"'); navPlaced = true; }
  if (!card) cardHtml = `<div class="detail-title">${avatarSpan(playerId, p.name, "avatar-lg")}${escapeHtml(p.name)}</div>`;
  if (card && secKey !== "overview") cardHtml = `<div class="pc-compact">${cardHtml}</div>`;
  return `
    ${detailNav(`<button class="back-btn" data-back="${isGoalie ? "goalies" : "skaters"}">&larr; All ${isGoalie ? "Goalies" : "Skaters"}</button>`)}
    ${cardHtml}${navPlaced ? "" : nav}
    ${tmChips}
    <div class="team-section">${body}</div>
  `;
}


// The "Seasons" table on a player's page: one row per season (and per team, when he was traded that year), newest first, so earlier seasons
// are a click away instead of a trip to the season menu. Each season's numbers come from that season's team file; clicking a row opens his
// page for that season.
async function fillPlayerSeasons(seasonAtStart) {
  const box = document.getElementById("player-seasons");
  if (!box) return;
  const pid = box.dataset.pid, isGoalie = box.dataset.goalie === "1";
  const found = [];
  for (const sx of [...DATA.seasons].reverse()) {
    const by = DATA.by_season[sx.id] || {};
    const ent = isGoalie ? (by.goalies || []).find(g => String(g.pid) === String(pid)) : (by.players_index || []).find(x => String(x.id) === String(pid));
    if (ent) found.push({ sx, team: ent.team });
  }
  const loaded = await Promise.all(found.map(f => fetchJson(`data/${f.sx.id}/teams/${f.team}.json`).then(td => ({ ...f, td }), () => null)));
  if (seasonAtStart !== SEASON || !document.body.contains(box) || box.dataset.pid !== pid) return;
  const rows = [];
  const open = (f, team, cur) => `data-open-player="${pid}" data-player-team="${team}" data-player-season="${f.sx.id}" role="button" tabindex="0"${cur ? ' aria-current="true"' : ""}`;
  for (const f of loaded.filter(Boolean)) {
    const cur = f.sx.id === SEASON, p = (f.td.players || {})[pid];
    if (!p) continue;
    if (isGoalie) {
      const g = (f.td.goalies || []).find(x => String(x.player_id) === String(pid));
      if (!g) continue;
      rows.push(`<tr class="season-row${cur ? " cur" : ""}" ${open(f, f.team, cur)}><td>${f.sx.label}</td><td>${teamLink(f.team)}</td><td class="num">${g.gp}</td><td class="num">${g.shots_faced}</td><td class="num">${g.goals_allowed}</td>
        <td class="num">${g.sv_pct === null || g.sv_pct === undefined ? "&ndash;" : g.sv_pct.toFixed(3).replace(/^0/, "")}</td><td class="num">${scoreCell(g.gsax)}</td></tr>`);
      continue;
    }
    const pos = ((f.td.roster || []).find(r => String(r.player_id) === pid) || {}).position;
    const line = (label, team, x, strong) => `<tr class="season-row${cur ? " cur" : ""}${strong ? " season-total" : ""}" ${open(f, team, cur)}><td>${label}</td><td>${team === "all" ? "All teams" : teamLink(team)}</td>
      <td class="num">${x.gp}</td><td class="num">${x.goals}</td><td class="num">${x.a1 + x.a2}</td><td class="num">${x.points}</td>
      <td class="num">${gsCell(x.avg_raw, gsKind(pos, true), false)}</td><td class="num">${gsCell(x.avg_adjusted, "avg", true)}</td><td class="num">${x.toi && x.gp ? toiStr(Math.round(x.toi / x.gp)) : "&ndash;"}</td><td class="num">${pctOf(x.xgf, x.xga)}</td></tr>`;
    if (p.by_team) {
      Object.keys(p.by_team).forEach((t, i) => rows.push(line(i === 0 ? f.sx.label : "", t, p.by_team[t], false)));
      rows.push(line("", "all", p.summary, true));
    } else {
      rows.push(line(f.sx.label, f.team, p.summary, false));
    }
  }
  const head = isGoalie ? ["Season", "Team", "GP", "Shots", "GA", "Sv%", "GSAx"] : ["Season", "Team", "GP", "G", "A", "P", "Avg Raw", "Avg Adjusted", "TOI / GP", "xGF%"];
  box.innerHTML = rows.length
    ? `<div class="table-scroll"><table class="season-table auto-sort"><thead><tr>${head.map((h, i) => `<th class="${i > 1 ? "num" : ""}">${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>
       <div class="panel-caption">Click a season to open his page for that year.</div>`
    : '<div class="empty">No earlier seasons.</div>';
}

// --- Games (box score rendered by the shared GameView in artifact_game_view.js)
const gameViewLinks = {
  backHtml: detailNav('<button class="back-btn" data-back="games">&larr; All Games</button>'),
  onNav: () => syncUrl(true),   // a game's tab is part of its address, but switching tabs doesn't add a history entry
  player: playerLink,
  playerText: playerTextLink,
  team: teamLink,
  unit: unitLink,
  unitFaces,
  unitPageLink: (key, team, text) => `<a class="row-link" title="Open this unit's page" data-open-unit="${key}" data-unit-team="${team}">${text}</a>`,
};

// --- Game previews: an upcoming game's page, shown until the game starts (then the live page and later the box score take over).
// Built in the browser from the two teams' season files and each team's last game, so nothing extra is exported. A preview opens only
// once every earlier game of both teams is processed, so the form, ratings and rest it shows are up to date.
const isUpcomingState = (st) => !st || st === "FUT" || st === "PRE";
const upcomingGame = (gid) => SCHEDULE().find(g => String(g[0]) === String(gid) && isUpcomingState(g[5]));
const dayDiff = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
const prettyDay = (d) => new Date(d + "T12:00:00Z").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const lastName = (n) => String(n).split(" ").slice(-1)[0];
// where a team's number ranks in the league (1 = best); higher or lower is better
function leagueRank(abbrev, field, higherBetter) {
  const rows = (S().teams_index || []).filter(t => t[field] !== null && t[field] !== undefined);
  const me = rows.find(t => t.abbrev === abbrev); if (!me) return null;
  return 1 + rows.filter(t => higherBetter ? t[field] > me[field] : t[field] < me[field]).length;
}
const rankTag = (r) => (r ? ` <small class="detail-sub">${ordinal(r)}</small>` : "");


// Game prediction: 20,000 simulated games from each team's expected-goals ratings. A team's attack and defense are its expected goals for and
// against in recent games (older games count less, 5% per game), pulled toward the league average, with a small home edge. One adjustment, kept
// because it helped in testing: an away team on the second night of a back-to-back scores less. Goalies are left out for now (starters are
// confirmed on game day, so a guess from recent usage added little); the tested goalie version is in scratch/pred_backtest2.py. Goals are drawn from Poisson distributions; a tie after 60 minutes is an overtime/shootout coin flip.
// Tested on every game since 2024-25 using only what was known before each game (scratch/pred_backtest2.py); it beat always picking the home team.
const PRED = { decay: 0.95, shrink: 10, home: 1.03, sims: 20000, awayB2b: 0.90 };
async function predictGame(gid, date, away, home, ta, th) {
  const rows = (S().teams_index || []).filter(t => t.gp && t.xgf !== null && t.xgf !== undefined);
  if (!rows.length) return null;
  const L = rows.reduce((a, t) => a + t.xgf / t.gp, 0) / rows.length;
  const ids = DATA.seasons.map(x => x.id), pi = ids.indexOf(SEASON), prevSeason = pi > 0 ? ids[pi - 1] : null;
  const prev = async (abbr) => { if (!prevSeason) return null; try { return await fetchJson(`data/${prevSeason}/teams/${abbr}.json`); } catch (e) { return null; } };
  const [pA, pH] = await Promise.all([prev(away), prev(home)]);
  const rate = (td, ptd) => { let f = 0, a = 0, w = 0;
    for (const r of [...(ptd ? ptd.schedule : []), ...td.schedule]) { if (r.xgf === null || r.xgf === undefined || r.xga === null || r.xga === undefined) continue;
      f = f * PRED.decay + r.xgf; a = a * PRED.decay + r.xga; w = w * PRED.decay + 1; }
    return { f: (f + PRED.shrink * L) / (w + PRED.shrink), a: (a + PRED.shrink * L) / (w + PRED.shrink) }; };
  const A = rate(ta, pA), H = rate(th, pH);
  let lh = PRED.home * H.f * A.a / L, la = A.f * H.a / (PRED.home * L);
  const lastA = ta.schedule[ta.schedule.length - 1], b2bAway = !!lastA && dayDiff(lastA.date, date) === 1;
  if (b2bAway) { la *= PRED.awayB2b; lh /= Math.sqrt(PRED.awayB2b); }
  let seed = Number(gid) >>> 0;   // the same game always simulates the same way
  const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pois = (lam) => { const lim = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > lim); return k - 1; };
  let hw = 0, ot = 0, hg = 0, ag = 0; const scores = {};
  for (let i = 0; i < PRED.sims; i++) {
    let x = pois(lh), y = pois(la);
    if (x === y) { ot++; if (rnd() < 0.5) x++; else y++; }
    if (x > y) hw++;
    hg += x; ag += y; const key = y + "-" + x; scores[key] = (scores[key] || 0) + 1;   // away-home
  }
  const top = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => ({ score: k, p: n / PRED.sims }));
  return { home: hw / PRED.sims, away: 1 - hw / PRED.sims, ot: ot / PRED.sims, hg: hg / PRED.sims, ag: ag / PRED.sims, top, b2bAway };
}
async function predictionHtml(sch, ta, th) {
  const away = sch[2], home = sch[3], r = await predictGame(sch[0], sch[1], away, home, ta, th);
  if (!r) return "";
  const pa = Math.round(100 * r.away), ph = 100 - pa;
  const fav = r.home >= r.away ? home : away, pf = Math.max(pa, ph);
  return `<div class="detail-h3">Prediction <span class="detail-sub">20,000 simulated games</span></div>
    <div class="pred"><div class="pred-bar" role="img" aria-label="${away} ${pa}%, ${home} ${ph}%"><span class="pred-a" style="width:${pa}%">${away} ${pa}%</span><span class="pred-h" style="width:${ph}%">${home} ${ph}%</span></div>
    <div class="pred-facts"><span>${pf < 53 ? "<b>Toss-up</b>, no clear favorite" : `<b>${teamName(fav)}</b> favored, ${pf}%`}</span><span>Projected score: ${away} ${r.ag.toFixed(1)}, ${home} ${r.hg.toFixed(1)}</span>
    <span>Overtime or shootout in ${Math.round(100 * r.ot)}% of games</span><span>Likeliest finals: ${r.top.map(t => `${away} ${t.score.split("-")[0]}, ${home} ${t.score.split("-")[1]} (${Math.round(100 * t.p)}%)`).join("; ")}</span>
    ${r.b2bAway ? `<span>${away} is on the second night of a back-to-back, which the model counts against them.</span>` : ""}</div>
    <div class="panel-caption">Built from each team's recent expected goals, a small home edge and the second night of a back-to-back for the road team. It does not know who is starting in goal, injuries or lineup changes. Hockey games are close to coin flips: in testing on every game since 2024-25 it picked the winner a bit more than half the time and beat always picking the home team, so treat the percentages as a lean, not a lock.</div></div>`;
}
function previewHeaderHtml(sch, ta, th) {
  const [, date, away, home, start] = sch;
  const when = start ? new Date(start).toLocaleString([], { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) : prettyDay(date);
  const team = (abbr, td) => { const ti = (S().teams_index || []).find(t => t.abbrev === abbr) || {};
    return `<div class="pv-team"><a class="row-link" data-open-team="${abbr}">${logoSpan(abbr)}<span class="pv-name">${teamName(abbr)}</span></a>
      <div class="detail-sub">${ti.w ?? td.wins}-${ti.l ?? td.losses}${ti.otl !== undefined ? "-" + ti.otl : ""} &middot; ${ti.pts ?? ""} pts &middot; last 10: ${ti.l10 || ""}</div></div>`; };
  return `<div class="pv-head"><span class="live-badge">PREVIEW</span> <span class="detail-sub">${escapeHtml(when)}</span>
    <div class="pv-matchup">${team(away, ta)}<span class="pv-at">at</span>${team(home, th)}</div></div>`;
}

// rest: days since each team's last game, and whether this is the second night of a back-to-back
function previewRestHtml(sch, ta, th) {
  const date = sch[1];
  const row = (abbr, td) => { const last = td.schedule[td.schedule.length - 1]; if (!last) return "";
    const rest = dayDiff(last.date, date) - 1;
    const txt = rest <= 0 ? '<b class="neg">Back-to-back</b> (played ' + (rest < 0 ? "today" : "yesterday") + ")" : rest === 1 ? "1 day of rest" : rest + " days of rest";
    return `<tr><td>${teamLink(abbr)}</td><td>${txt}</td><td>${last.loc === "@" ? "@" : "vs"} ${last.opponent}, ${last.score} ${last.result}${last.outcome && last.outcome !== "REG" ? " (" + last.outcome + ")" : ""}</td></tr>`; };
  return `<table><thead><tr><th>Team</th><th>Rest</th><th>Last game</th></tr></thead><tbody>${row(sch[2], ta)}${row(sch[3], th)}</tbody></table>`;
}

function previewComparisonHtml(away, home) {
  const ti = (a) => (S().teams_index || []).find(t => t.abbrev === a) || {};
  const A = ti(away), H = ti(home), gp = (t) => Math.max(1, t.gp || 1);
  const num = (v, d) => (v === null || v === undefined ? "&ndash;" : Number(v).toFixed(d));
  const rows = [
    ["Record", `${A.w}-${A.l}-${A.otl}`, `${H.w}-${H.l}-${H.otl}`],
    ["xGF% (5v5)", num(A.xgf_pct5, 1) + rankTag(leagueRank(away, "xgf_pct5", true)), num(H.xgf_pct5, 1) + rankTag(leagueRank(home, "xgf_pct5", true))],
    ["Shot attempts % (5v5)", num(A.cf_pct5, 1), num(H.cf_pct5, 1)],
    ["Goals for / game", num(A.gf / gp(A), 2), num(H.gf / gp(H), 2)],
    ["Goals against / game", num(A.ga / gp(A), 2), num(H.ga / gp(H), 2)],
    ["Goalie GSAx (season)", signed2(A.gsax || 0), signed2(H.gsax || 0)],
  ];
  return `<table><thead><tr><th></th><th class="num">${away}</th><th class="num">${home}</th></tr></thead><tbody>${
    rows.map(r => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td><td class="num">${r[2]}</td></tr>`).join("")}</tbody></table>`;
}

function previewSpecialHtml(away, home) {
  const ti = (a) => (S().teams_index || []).find(t => t.abbrev === a) || {};
  const f = (v, d) => (v === null || v === undefined ? "&ndash;" : Number(v).toFixed(d));
  const line = (ppT, pkT) => { const P = ti(ppT), K = ti(pkT);
    return `<tr><td>${teamLink(ppT)} power play</td><td class="num">${f(P.pp_xgf60, 1)}${rankTag(leagueRank(ppT, "pp_xgf60", true))}</td><td class="num">${f(P.pp_pct, 1)}%</td>
      <td>${teamLink(pkT)} penalty kill</td><td class="num">${f(K.pk_xga60, 1)}${rankTag(leagueRank(pkT, "pk_xga60", false))}</td><td class="num">${f(K.pk_pct, 1)}%</td></tr>`; };
  return `<div class="table-scroll"><table><thead><tr><th>Power play</th><th class="num">xGF/60</th><th class="num">PP%</th><th>against</th><th class="num">xGA/60</th><th class="num">PK%</th></tr></thead>
    <tbody>${line(away, home)}${line(home, away)}</tbody></table></div>`;
}

function previewFormHtml(abbr, td) {
  const rows = td.schedule.slice(-5).reverse().map(s => {
    const x = s.xgf !== null && s.xgf !== undefined && s.xga !== null && s.xga !== undefined && s.xgf + s.xga > 0 ? (100 * s.xgf / (s.xgf + s.xga)).toFixed(0) + "%" : "";
    return `<tr><td>${s.date.slice(5)}</td><td>${s.loc} ${teamLink(s.opponent)}</td><td class="${s.result === "W" ? "pos" : "neg"}">${s.result} ${s.score}${s.outcome && s.outcome !== "REG" ? " (" + s.outcome + ")" : ""}</td><td class="num">${x}</td></tr>`; }).join("");
  return `<div><div class="detail-h3">${teamLink(abbr)} last 5 games</div><div class="table-scroll"><table class="auto-sort"><thead><tr><th>Date</th><th>Opp</th><th>Result</th><th class="num">xGF%</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

// players to watch: the best and the worst average Adjusted Game Score over the team's last five games (at least three of them played)
function previewWatchHtml(abbr, td) {
  const last5 = new Set(td.schedule.slice(-5).map(s => s.gid));
  const list = Object.entries(td.players || {}).map(([pid, p]) => {
    const games = (p.game_log || []).filter(x => last5.has(x.gid) && x.adjusted !== null && x.adjusted !== undefined);
    if (games.length < 3) return null;
    const avg = games.reduce((a, x) => a + x.adjusted, 0) / games.length;
    return { pid, name: p.name, avg, n: games.length, g: games.reduce((a, x) => a + (x.goals || 0), 0), a: games.reduce((a, x) => a + (x.assists || 0), 0), season: (p.summary || {}).avg_adjusted };
  }).filter(Boolean).sort((a, b) => b.avg - a.avg);
  const pick = (rows, label) => rows.map(r => `<tr><td>${label}</td><td>${playerLink(r.pid, abbr, r.name)}</td><td class="num">${gsCell(r.avg, "avg", true)}</td><td class="num">${r.g}G ${r.a}A in ${r.n}</td><td class="num">${r.season === undefined || r.season === null ? "" : signed2(r.season)}</td></tr>`).join("");
  const hot = list.slice(0, 3), cold = list.slice(-2).filter(r => !hot.includes(r)).reverse();
  return `<div><div class="detail-h3">${teamLink(abbr)}</div><div class="table-scroll"><table class="auto-sort"><thead><tr><th></th><th>Player</th><th class="num">Last 5 avg</th><th class="num">Production</th><th class="num">Season avg</th></tr></thead>
    <tbody>${pick(hot, '<span class="pos">Hot</span>')}${pick(cold, '<span class="neg">Cold</span>')}</tbody></table></div></div>`;
}

// goalies: who has been starting, and how they have played
function previewGoaliesHtml(abbr, td) {
  const recent = td.schedule.slice(-10), lastStarter = (td.schedule[td.schedule.length - 1] || {}).gk;
  const starts = {}; recent.forEach(s => { if (s.gk) starts[s.gk[0]] = (starts[s.gk[0]] || 0) + 1; });
  const rows = (td.goalies || []).slice().sort((a, b) => b.gp - a.gp).map(g => `<tr><td>${playerLink(g.player_id, abbr, g.name)}${lastStarter && lastStarter[0] === g.player_id ? ' <small class="detail-sub">started last game</small>' : ""}</td>
    <td class="num">${g.gp}</td><td class="num">${starts[g.player_id] || 0} of ${recent.length}</td><td class="num">${scoreCell(g.gsax)}</td><td class="num">${g.sv_pct === null || g.sv_pct === undefined ? "" : g.sv_pct.toFixed(3).replace(/^0/, "")}</td></tr>`).join("");
  return `<div><div class="detail-h3">${teamLink(abbr)}</div><div class="table-scroll"><table class="auto-sort"><thead><tr><th>Goalie</th><th class="num">GP</th><th class="num">Last 10 starts</th><th class="num">GSAx</th><th class="num">Sv%</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

// the lines and pairs from a team's last game, graded the way the lines & pairs card grades them
async function previewLineupHtml(abbr, td) {
  const last = td.schedule[td.schedule.length - 1];
  if (!last) return "";
  let g; try { g = await fetchGame(last.home, last.gid); } catch (e) { g = null; }
  if (!g) return "";
  const side = g.home === abbr ? "home" : "away", sk = g.sk[side] || [];
  const nameOf = (id) => (sk.find(x => x[0] === id) || [id, "?"])[1];
  const pick = (type, n, tag) => g.units.filter(u => u[0] === abbr && u[1] === type).sort((a, b) => b[2] - a[2]).slice(0, n).map((u, i) => ({ slot: tag + (i + 1), u, tier: unitTier(u[12], tag + (i + 1)) }));
  const row = (r) => `<tr><td><b>${r.slot}</b></td><td>${r.u[3].map(id => playerTextLink(id, abbr, lastName(nameOf(id)))).join(", ")}</td><td class="num">${toiStr(r.u[2])}</td>
    <td class="num"><span class="gs gs-t${r.tier}">${r.u[12] > 0 ? "+" : ""}${r.u[12].toFixed(2)} ${GS_TIER_NAME[r.tier]}</span></td></tr>`;
  return `<div><div class="detail-h3">${teamLink(abbr)} <span class="detail-sub">from ${last.loc === "@" ? "@" : "vs"} ${last.opponent}, ${prettyDay(last.date)}</span></div>
    <div class="table-scroll"><table class="auto-sort"><thead><tr><th></th><th>Players</th><th class="num">TOI</th><th class="num">Unit score</th></tr></thead><tbody>${pick("line", 4, "L").map(row).join("")}${pick("pair", 3, "P").map(row).join("")}</tbody></table></div></div>`;
}

function previewMeetingsHtml(sch, th) {
  const away = sch[2], meetings = (th.schedule || []).filter(s => s.opponent === away);
  const body = meetings.length ? `<table class="auto-sort"><thead><tr><th>Date</th><th>Where</th><th>Result for ${sch[3]}</th></tr></thead><tbody>${meetings.map(s =>
    `<tr><td>${prettyDay(s.date)}</td><td>${s.loc === "@" ? "at " + away : "at " + sch[3]}</td><td class="${s.result === "W" ? "pos" : "neg"}">${s.result} ${s.score}${s.outcome && s.outcome !== "REG" ? " (" + s.outcome + ")" : ""}</td></tr>`).join("")}</tbody></table>`
    : '<div class="empty">These teams have not played each other yet this season.</div>';
  return `<div class="detail-h3">Head to head <span class="detail-sub">this season</span></div>${body}`;
}

async function previewHtml(sch) {
  const [gid, date, away, home] = sch;
  const [ta, th] = await Promise.all([fetchTeam(away), fetchTeam(home)]);
  const header = previewHeaderHtml(sch, ta, th);
  // the preview waits for every earlier game of both teams to be processed
  const waiting = [];
  for (const [abbr, td] of [[away, ta], [home, th]]) {
    const done = new Set(td.schedule.map(s => s.gid));
    SCHEDULE().filter(g => g[1] < date && (g[2] === abbr || g[3] === abbr) && g[5] !== "PPD" && !done.has(g[0])).forEach(g => waiting.push([abbr, g]));
  }
  if (waiting.length) {
    return header + `<div class="empty">The preview opens once ${[...new Set(waiting.map(w => w[0]))].join(" and ")}'s earlier ${waiting.length > 1 ? "games are" : "game is"} processed (${waiting.map(w => `${w[1][2]} at ${w[1][3]}, ${prettyDay(w[1][1])}`).join("; ")}), usually overnight.</div>`;
  }
  const started = LIVE.index && (LIVE.index.games || []).find(g => Number(g.id) === Number(gid) && !isUpcomingState(g.state));
  const [lineA, lineH] = await Promise.all([previewLineupHtml(away, ta), previewLineupHtml(home, th)]);
  return header
    + (started ? `<div class="live-warn">This game has started. <a class="row-link" data-open-live="${gid}">Watch it live &rsaquo;</a></div>` : "")
    + await predictionHtml(sch, ta, th)
    + `<div class="detail-h3">Rest</div>${previewRestHtml(sch, ta, th)}`
    + `<div class="detail-h3">Season so far</div>${previewComparisonHtml(away, home)}`
    + `<div class="detail-h3">Recent form</div><div class="two-up">${previewFormHtml(away, ta)}${previewFormHtml(home, th)}</div>`
    + `<div class="detail-h3">Special teams matchup <span class="detail-sub">expected goals per 60 minutes; rank among all teams</span></div>${previewSpecialHtml(away, home)}`
    + `<div class="detail-h3">Players to watch <span class="detail-sub">Adjusted Game Score over each team's last five games</span></div><div class="two-up">${previewWatchHtml(away, ta)}${previewWatchHtml(home, th)}</div>`
    + `<div class="detail-h3">Goalies</div><div class="two-up">${previewGoaliesHtml(away, ta)}${previewGoaliesHtml(home, th)}</div><div class="panel-caption">Starters are not announced until game day, so this shows who has been playing.</div>`
    + `<div class="detail-h3">Lines and pairs <span class="detail-sub">each team's last game; lines change, so check the lineup news</span></div><div class="two-up">${lineA}${lineH}</div>`
    + previewMeetingsHtml(sch, th)
    + `<div class="panel-caption">The preview is replaced by the live page when the game starts, then by the full box score and cards once it is processed.</div>`;
}

function gamesListHtml(filterText) {
  const q = (filterText || "").trim().toLowerCase();
  const all = S().games_index || [];
  // [id, date, away, awayScore, home, homeScore, outcome, topPerformer]
  const rows = all
    .filter(g => !q || (g[2] + " " + g[4] + " " + g[1] + " " + g[7]).toLowerCase().includes(q))
    .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : b[0] - a[0]));
  if (!rows.length) return '<div class="empty">No games match that filter.</div>';
  let html = '<div class="table-scroll"><table class="auto-sort"><thead><tr><th>Date</th><th>Away</th><th class="num"></th><th>Home</th><th class="num"></th><th>Top performer</th><th class="num">Raw</th><th class="num">Adjusted</th></tr></thead><tbody>';
  rows.forEach(g => {
    const tag = g[6] === "REG" ? "" : ` <span class="detail-sub">${g[6]}</span>`;
    html += `<tr class="clickable" data-open-game="${g[0]}" data-game-home="${g[4]}"><td>${g[1]}</td><td>${teamLink(g[2])}</td><td class="num">${g[3]}</td><td>${logoSpan(g[4])}${g[4]}</td><td class="num">${g[5]}${tag}</td><td>${g[10] ? avatarSpan(g[10], g[7]) : ""}${escapeHtml(g[7])}</td><td class="num">${g[8] === null || g[8] === undefined ? "&ndash;" : g[8].toFixed(2)}</td><td class="num">${g[9] === null || g[9] === undefined ? "&ndash;" : gsCell(g[9], "adj", true)}</td></tr>`;
  });
  html += "</tbody></table></div>";
  return html;
}

// list/detail state per special tab, so switching tabs and coming back
// doesn't lose where you were
function freshState() {
  return {
    teams: { mode: "list", abbrev: null, sec: "overview", unitKey: null, filter: "", sort: "pts", dir: "desc", view: "list", toi: {} },
    skaters: { mode: "list", playerId: null, teamAbbrev: null, sec: "overview", filter: "", pos: "all", sort: { k: "avg_adj", d: -1 } },
    goalies: { mode: "list", playerId: null, teamAbbrev: null, sec: "overview", filter: "", sort: { k: "gsax", d: -1 } },
    units: { mode: "list", filter: "", view: "line", sort: { k: "toi_sec", d: -1 } },
    leaderboards: { mode: "list", more: {} },
    games: { mode: "list", gameId: null, home: null, filter: "" },
    power: { mode: "list", filter: "", view: "values", sort: { k: "power", d: -1 } },
    odds: { mode: "list", filter: "", view: "league" },
    home: { date: null, open: {} },
  };
}
let specialState = freshState();

// --- Home: one day's games (today by default), with a date browser into the past and the days ahead.
// Each game is a box like the Live tab's. Finished games the site has processed open into their shareable cards; games in
// the live feed update live; the rest (not started, or finished but not processed yet) come from the schedule.
let homeToken = 0;
const homeSeasonId = () => [...DATA.seasons].reverse().map(x => x.id).find(id => ((DATA.by_season[id] || {}).games_index || []).length) || SEASON;
const todayET = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const shiftDay = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const homeDate = () => specialState.home.date || todayET();
const SCHEDULE = () => DATA.schedule || [];   // [id, date, away, home, startUTC, state, awayScore, homeScore, lastPeriodType]
// the processed games on a date (from whichever season has them): {season, rows} with rows [id, date, away, aS, home, hS, outcome, top]
function homeProcessed(date) {
  for (const sx of [...DATA.seasons].reverse()) {
    const rows = ((DATA.by_season[sx.id] || {}).games_index || []).filter(g => g[1] === date);
    if (rows.length) return { season: sx.id, rows: rows.slice().sort((a, b) => a[0] - b[0]) };
  }
  return { season: homeSeasonId(), rows: [] };
}
const finalTag = (o) => (!o || o === "REG" ? "FINAL" : "FINAL/" + o);
const schedTime = (g) => { try { return new Date(g[4]).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch (e) { return "Scheduled"; } };
// a game that is not processed yet and not in the live feed: scheduled, in progress with the feed off, or finished and waiting to be processed
function schedTileHtml(g) {
  const st = g[5], live = st === "LIVE" || st === "CRIT", done = st === "OFF" || st === "FINAL", started = live || done;
  const badge = live ? '<span class="live-badge on">IN PROGRESS</span>' : done ? `<span class="live-badge">${finalTag(g[8])}</span>`
    : st === "PPD" ? '<span class="live-badge">POSTPONED</span>' : `<span class="live-badge">${schedTime(g)}</span>`;
  const prev = isUpcomingState(st) ? ` data-open-game="${g[0]}" data-game-home="${g[3]}" data-game-season="${homeSeasonId()}" role="button" tabindex="0"` : "";
  return `<div class="live-card${prev ? " clickable" : ""}"${prev}>
      <div class="live-status">${badge}</div>
      <div class="live-teams"><span>${logoSpan(g[2])}${g[2]}</span><b>${started && g[6] !== null ? g[6] : ""}</b></div>
      <div class="live-teams"><span>${logoSpan(g[3])}${g[3]}</span><b>${started && g[7] !== null ? g[7] : ""}</b></div>
      ${done ? '<div class="live-sub">Cards and the box score appear once the game is processed, usually overnight.</div>' : prev ? '<div class="live-sub">Preview &rsaquo;</div>' : ""}</div>`;
}
// live feed games and schedule-only games for the shown date (everything that is not a processed game)
function liveSectionHtml() {
  const D = homeDate(), done = new Set(homeProcessed(D).rows.map(g => Number(g[0])));
  const feed = (LIVE.available !== false && LIVE.index && LIVE.index.date === D) ? LIVE.index.games : [];
  const feedIds = new Set(feed.map(g => Number(g.id)));
  const fromFeed = feed.filter(g => !done.has(Number(g.id)))
    .sort((a, b) => (isInPlay(b) - isInPlay(a)) || String(a.start).localeCompare(String(b.start)));
  const fromSched = SCHEDULE().filter(g => g[1] === D && !done.has(g[0]) && !feedIds.has(g[0])).sort((a, b) => String(a[4]).localeCompare(String(b[4])));
  if (!fromFeed.length && !fromSched.length) return "";
  const meta = fromFeed.length ? `<div class="live-meta">Live feed updated ${clockTime(LIVE.index.updated)}</div><div id="live-banner">${liveBannerHtml()}</div>` : "";
  return `${meta}<div class="live-grid">${fromFeed.map(liveCardHtml).join("")}${fromSched.map(schedTileHtml).join("")}</div>`;
}
// Under the day's games: the night's five best Adjusted Game Scores and five best goalie games (filled in by homeNightFill from the day's
// game files, for the latest day with results on or before the shown day), then the season's best skaters and goalies.
function homeExtrasHtml(D, hasResults) {
  const days = [...new Set([].concat(...DATA.seasons.map(x => ((DATA.by_season[x.id] || {}).games_index || []).filter(g => g[9] !== null && g[9] !== undefined).map(g => g[1]))))].sort();
  const day = [...days].reverse().find(d => d <= D);
  const dayName = !day ? "" : day === todayET() ? "Today" : day === shiftDay(todayET(), -1) ? "Last night" : day;
  // the latest results, when the shown day has none of its own yet (an evening before the first puck drops)
  let results = "";
  if (day && !hasResults) {
    const rows = homeProcessed(day).rows;
    results = `<div class="detail-h3">${dayName === "Last night" ? "Last night's results" : "Latest results"} <span class="detail-sub">${day}</span></div>
      <div class="res-grid">${rows.map(g => {
        const aw = g[3] > g[5], tag = g[6] === "REG" ? "FINAL" : "FINAL/" + g[6];
        return `<a class="res" data-open-game="${g[0]}" data-game-home="${g[4]}" data-game-season="${homeProcessed(day).season}" role="button" tabindex="0">
          <span class="res-teams"><span class="${aw ? "win" : ""}">${logoSpan(g[2])}${g[2]} <b>${g[3]}</b></span><span class="${aw ? "" : "win"}">${logoSpan(g[4])}${g[4]} <b>${g[5]}</b></span></span>
          <span class="res-tag">${tag}</span>
</a>`; }).join("")}</div>
      <div class="panel-caption"><a class="row-link" data-home-nav="${day}">Open this day's cards &rsaquo;</a></div>`;
  }
  // stars and top goalies of the night: filled in once the night's game files are loaded (homeNightFill)
  const night = day ? `<div id="home-night" data-day="${day}"><div class="empty">Loading the night's stars&hellip;</div></div>` : "";
  // season leaders: who has been best, by average Adjusted Game Score for skaters and goals saved above expected for goalies
  const players = (S().players_index || []), maxGp = Math.max(0, ...players.map(p => p.gp));
  const skaters = players.filter(p => p.avg_adj !== null && p.avg_adj !== undefined && p.gp >= Math.max(5, Math.round(0.6 * maxGp))).sort((a, b) => b.avg_adj - a.avg_adj).slice(0, 5);
  const goalies = (S().goalies || []).filter(g => g.gp >= 3).slice().sort((a, b) => b.gsax - a.gsax).slice(0, 5);
  const leadRow = (p, id, name, team, value, label) => `<a class="lead" data-open-player="${id}" data-player-team="${team}" role="button" tabindex="0">
    <span class="lead-n">${p}</span>${avatarSpan(id, name)}<span class="lead-who"><span class="lead-name">${escapeHtml(name)}</span><span class="lead-team">${logoSpan(team)}${team}</span></span>
    <span class="lead-val">${value}<small>${label}</small></span></a>`;
  const leaders = skaters.length || goalies.length ? `<div class="two-up home-extras">
    <div><div class="detail-h3">Best skaters <span class="detail-sub">average Adjusted Game Score</span></div>
      <div class="lead-list">${skaters.map((p, i) => leadRow(i + 1, p.id, p.name, p.team, scoreCell(p.avg_adj), `${p.gp} GP`)).join("")}</div>
      <div class="panel-caption"><a class="row-link" data-goto-tab="skaters">All skaters &rsaquo;</a></div></div>
    <div><div class="detail-h3">Best goalies <span class="detail-sub">goals saved above expected</span></div>
      <div class="lead-list">${goalies.map((g, i) => leadRow(i + 1, g.pid, g.goalie, g.team, scoreCell(g.gsax), `${g.gp} GP`)).join("")}</div>
      <div class="panel-caption"><a class="row-link" data-goto-tab="goalies">All goalies &rsaquo;</a></div></div></div>` : "";
  return `${results}${night}${leaders}${emailSignupHtml()}`;
}
// The email signup box (only on the hosted site, and only once the signup functions are set up: build_site.py turns it on with EMAIL_SIGNUP=1).
// The visitor picks teams and gives an address; /api/subscribe sends a confirmation email, and nothing else is sent before it is clicked.
function emailSignupHtml() {
  if (!(window.SHIFTSCORE && window.SHIFTSCORE.signup)) return "";
  const teams = Object.keys(TEAM_NAMES).sort((a, b) => TEAM_NAMES[a].localeCompare(TEAM_NAMES[b]));
  return `<section class="subscribe" id="home-subscribe">
    <div class="detail-h3">Get your team's cards by email</div>
    <div class="panel-caption">Pick your teams and we'll email you the cards for their games shortly after each one ends, usually within an hour or two of the final horn: the skater table, the Game Score bars and the lines, pairs and goalie grades for your team, plus the other team's lines, pairs and goalies.</div>
    <div class="sub-teams" role="group" aria-label="Teams">${teams.map(t => `<label class="sub-team"><input type="checkbox" data-sub-team="${t}"><span>${logoSpan(t)}${escapeHtml(TEAM_NAMES[t])}</span></label>`).join("")}</div>
    <div class="sub-row">
      <input type="email" class="sub-email" id="sub-email" placeholder="you@example.com" autocomplete="email" aria-label="Email address" maxlength="254">
      <button type="button" class="chip" data-sub-submit="1">Subscribe</button>
      <button type="button" class="chip" data-sub-clear="1">Clear teams</button>
    </div>
    <div class="sub-msg" id="sub-msg" role="status" aria-live="polite"></div>
    <div class="panel-caption">We send a confirmation email first, nothing before you click it. Every email has a one-click unsubscribe link. Your address is used only for these emails.</div>
  </section>`;
}
async function submitSignup() {
  const msg = document.getElementById("sub-msg"), btn = document.querySelector("[data-sub-submit]");
  const email = (document.getElementById("sub-email").value || "").trim();
  const teams = [...document.querySelectorAll("[data-sub-team]:checked")].map(x => x.dataset.subTeam);
  const say = (t, bad) => { msg.textContent = t; msg.classList.toggle("bad", !!bad); };
  if (!teams.length) return say("Pick at least one team.", true);
  if (!email) return say("Enter your email address.", true);
  btn.disabled = true; say("Sending…");
  try {
    const r = await fetch("/api/subscribe", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, teams }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok && j.again) say("We already sent a confirmation link to " + email + " in the last ten minutes, so we didn't send another. Check your inbox and spam folder, or try again in a few minutes.");
    else if (r.ok && j.ok) say("Check your inbox: we sent a confirmation link to " + email + ". Click it and you're set.");
    else say(j.error || "Something went wrong. Try again in a few minutes.", true);
  } catch (e) { say("Couldn't reach the signup service. Try again in a few minutes.", true); }
  btn.disabled = false;
}
document.addEventListener("click", (ev) => {
  if (ev.target.closest("[data-sub-submit]")) { submitSignup(); return; }
  if (ev.target.closest("[data-sub-clear]")) document.querySelectorAll("[data-sub-team]").forEach(x => { x.checked = false; });
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.id === "sub-email") submitSignup(); });
// The five best Adjusted Game Scores and the five best goalie games (goals saved above expected, 10+ shots), from every game that day.
async function homeNightFill(token, seasonAtStart) {
  const box = document.getElementById("home-night");
  if (!box) return;
  const day = box.dataset.day, { season: HS, rows } = homeProcessed(day);
  const sk = [], gl = [];
  for (const g of rows) {
    try {
      const game = (await fetchGameShard(HS, g[4]))[String(g[0])];
      if (token !== homeToken || seasonAtStart !== SEASON) return;
      if (!game) continue;
      const n = GameView.nightStars(game);
      sk.push(...n.skaters); gl.push(...n.goalies);
    } catch (e) {}
  }
  if (token !== homeToken || seasonAtStart !== SEASON || !document.body.contains(box)) return;
  const when = day === todayET() ? "today" : day;
  const topS = sk.sort((a, b) => b.adj - a.adj).slice(0, 5), topG = gl.filter(x => x.sf >= 10).sort((a, b) => b.gsax - a.gsax).slice(0, 5);
  const starCard = (p) => `<a class="star" data-open-player="${p.pid}" data-player-team="${p.team}" role="button" tabindex="0">
      ${avatarSpan(p.pid, p.name, "avatar-lg")}<span class="star-name">${escapeHtml(p.name)}</span>
      <span class="star-team">${logoSpan(p.team)}${p.team} <small>${p.loc} ${p.opp}</small></span>
      <span class="star-adj">${gsCell(p.adj, "adj", true)}</span><span class="star-raw">raw ${p.raw === null || p.raw === undefined ? "&ndash;" : Number(p.raw).toFixed(2)}</span></a>`;
  const goalieCard = (p) => `<a class="star" data-open-player="${p.pid}" data-player-team="${p.team}" role="button" tabindex="0">
      ${avatarSpan(p.pid, p.name, "avatar-lg")}<span class="star-name">${escapeHtml(p.name)}</span>
      <span class="star-team">${logoSpan(p.team)}${p.team} <small>${p.loc} ${p.opp}</small></span>
      <span class="star-adj">${scoreCell(Math.round(p.gsax * 100) / 100)}</span><span class="star-raw">${p.sf} shots, ${p.ga} goal${p.ga === 1 ? "" : "s"}</span>
      <span class="star-grade">${gradeChip(p.gr)}${p.relief ? ' <span class="grade-tag">Relief</span>' : ""}</span></a>`;
  box.innerHTML = topS.length || topG.length ? `<div class="home-night-rows">
      <div><div class="detail-h3">Stars of the night <span class="detail-sub">${when}</span></div>
        <div class="stars">${topS.map(starCard).join("")}</div>
        <div class="panel-caption">The five best Adjusted Game Scores of the night.</div></div>
      <div><div class="detail-h3">Top goalies of the night <span class="detail-sub">${when}</span></div>
        <div class="stars">${topG.map(goalieCard).join("") || '<div class="empty">No goalie faced 10 shots.</div>'}</div>
        <div class="panel-caption">The five best goalie games by goals saved above expected (at least 10 shots).</div></div></div>` : "";
  hydrateImages();
}
const homeFill = {};   // gid -> function that builds that game's cards (run when its box is open)
async function renderHome() {
  const host = document.querySelector("#panel-home .table-host");
  if (!host) return;
  if (LIVE.selected !== null) { renderLiveGame(host); return; }
  const token = ++homeToken, seasonAtStart = SEASON;
  renderTicker();
  const st = specialState.home, D = homeDate(), today = todayET();
  const { season: HS, rows: games } = homeProcessed(D);
  const gameDays = [...new Set([].concat(...DATA.seasons.map(x => ((DATA.by_season[x.id] || {}).games_index || []).map(g => g[1])), SCHEDULE().map(g => g[1])))].sort();
  const prevGame = [...gameDays].reverse().find(d => d < D), nextGame = gameDays.find(d => d > D);
  const label = D === today ? "Today" : D === shiftDay(today, -1) ? "Yesterday" : D === shiftDay(today, 1) ? "Tomorrow" : "";
  const liveHtml = liveSectionHtml();
  const nav = `<div class="home-bar">
    <button type="button" class="chip" data-home-nav="${shiftDay(D, -1)}" aria-label="Previous day">&lsaquo; Day</button>
    <input type="date" class="home-date" aria-label="Date" data-home-date value="${D}">
    <button type="button" class="chip" data-home-nav="${shiftDay(D, 1)}" aria-label="Next day">Day &rsaquo;</button>
    <button type="button" class="chip" data-home-nav="${today}" ${D === today ? "disabled" : ""}>Today</button>
    <span class="detail-sub">${label ? label + " &middot; " : ""}${D}</span>
    ${games.length ? '<span class="home-bar-end"><button type="button" class="chip" data-home-all="open">Open all cards</button><button type="button" class="chip" data-home-all="close">Close all cards</button></span>' : ""}
  </div>`;
  const empty = !liveHtml && !games.length
    ? `<div class="empty">No games on ${D}.${prevGame || nextGame ? ` ${prevGame ? `<button type="button" class="chip" data-home-nav="${prevGame}">&lsaquo; ${prevGame}</button>` : ""} ${nextGame ? `<button type="button" class="chip" data-home-nav="${nextGame}">${nextGame} &rsaquo;</button>` : ""}` : ""}</div>` : "";
  const final = (g) => finalTag(g[6]);
  host.innerHTML = nav + `<div id="home-live">${liveHtml}</div>` + empty + (games.length ? '<div class="live-grid home-grid">' + games.map(g => {
    const o = homeCardsState(g[0]);
    return `<div class="live-card clickable home-tile" id="hr-${g[0]}" data-open-game="${g[0]}" data-game-home="${g[4]}" data-game-season="${HS}" role="link" tabindex="0" aria-label="Open the ${g[2]} at ${g[4]} game">
        <div class="live-status"><span class="live-badge">${final(g)}</span></div>
        <div class="live-teams"><span>${logoSpan(g[2])}${g[2]}</span><b>${g[3]}</b></div>
        <div class="live-teams"><span>${logoSpan(g[4])}${g[4]}</span><b>${g[5]}</b></div>
        <div class="home-tile-more"><div class="live-sub">${g[7] ? "Top: " + escapeHtml(g[7]) : "&nbsp;"}</div></div>
        <div class="home-tile-cards" data-home-cards-for="${g[0]}"></div>
      </div>
      <div class="home-card-row" id="hg-${g[0]}"${Object.values(o).some(Boolean) ? "" : " hidden"}><div class="home-cards"></div></div>`;
  }).join("") + "</div>" : "") + homeExtrasHtml(D, games.length > 0);
  hydrateImages();
  homeNightFill(token, seasonAtStart);
  if (!games.length) return;
  const logos = await GameView.cardLogos();
  // a card is built the first time its button is pressed (one side at a time) and kept; pressing again hides it
  games.forEach(g => {
    homeFill[g[0]] = async (side) => {      // side: a card key ("table", "bars-away", "lines-home", ...)
      const box = host.querySelector(`#hg-${g[0]} .home-cards`);
      if (!box || box.querySelector(`[data-side="${side}"]`)) return;
      const fig = document.createElement("figure");
      fig.className = "home-card"; fig.dataset.side = side; fig.style.order = HOME_CARD_ORDER.indexOf(side);
      fig.innerHTML = '<div class="loading">Loading card&hellip;</div>';
      box.appendChild(fig);
      try {
        const game = (await fetchGameShard(HS, g[4]))[String(g[0])];
        if (token !== homeToken || seasonAtStart !== SEASON) return;
        if (!game) { fig.innerHTML = '<div class="empty">This game is not available yet.</div>'; return; }
        fig.innerHTML = `<div class="gv-card-preview">${GameView.card(game, side, logos)}</div>
          <button type="button" class="chip" data-home-save="${HS}|${g[0]}|${g[4]}|${side}">Save card as image</button>`;
      } catch (e) {
        fig.innerHTML = '<div class="empty">Couldn\'t build the card for this game. Open the game for the box score.</div>';
      }
    };
  });
  // one game at a time (a team's games share a file): shots, xG and the goals fill each tile in; once a game's data is in, its card
  // buttons appear (that is when the cards are ready), and any card left open comes back
  for (const g of games) {
    if (token !== homeToken || seasonAtStart !== SEASON) return;
    try {
      const game = (await fetchGameShard(HS, g[4]))[String(g[0])];
      if (token !== homeToken || seasonAtStart !== SEASON) return;
      const more = host.querySelector(`#hr-${g[0]} .home-tile-more`);
      if (game && more) {
        const t = GameView.tileStats(game);
        more.innerHTML = `<div class="live-sub">Shots ${t.sog[0]}&ndash;${t.sog[1]} &middot; xG ${t.xg[0].toFixed(1)}&ndash;${t.xg[1].toFixed(1)}</div>`
          + t.goals.slice(-3).map(x => `<div class="live-goal">${escapeHtml(x[0])} ${escapeHtml(x[1])} &middot; ${escapeHtml(x[2])} &mdash; ${escapeHtml(x[3])}</div>`).join("")
          + (g[7] ? `<div class="live-sub">Top: ${escapeHtml(g[7])}</div>` : "");
      }
      const slot = host.querySelector(`#hr-${g[0]} .home-tile-cards`);
      if (game && slot) {
        const o = homeCardsState(g[0]);
        slot.innerHTML = homeCardList(game).map(([key, label]) => `<button type="button" class="chip" data-home-card="${g[0]}|${key}" aria-pressed="${!!o[key]}">${escapeHtml(label)}</button>`).join("");
        for (const key of HOME_CARD_ORDER) if (o[key]) await homeFill[g[0]](key);
      }
    } catch (e) {}
  }
}
// the cards a finished game offers on Home, in the order they show: a table of every skater (both teams), then each team's Game Score bars and
// its lines, pairs and goalie grades. (The full game card is on the game page.)
const homeCardList = (game) => [["table", "Skater table"], ["bars-away", `${game.away} Game Scores`], ["bars-home", `${game.home} Game Scores`],
  ["lines-away", `${game.away} lines & goalies`], ["lines-home", `${game.home} lines & goalies`]];
const HOME_CARD_ORDER = ["table", "bars-away", "bars-home", "lines-away", "lines-home"];
// which of a game's cards are showing on Home: {card key: true}. (Older state kept {away, home}, the full cards, or a plain true: all closed now.)
function homeCardsState(gid) {
  const o = specialState.home.open[gid];
  return o && typeof o === "object" ? Object.fromEntries(Object.entries(o).filter(([k, v]) => v && HOME_CARD_ORDER.includes(k))) : {};
}
function setHomeCard(gid, key, on) {
  const sec = document.getElementById("hg-" + gid);
  if (!sec) return;
  const o = Object.assign({}, homeCardsState(gid), { [key]: on });
  specialState.home.open[gid] = o;
  const btn = document.querySelector(`[data-home-card="${gid}|${key}"]`);
  if (btn) btn.setAttribute("aria-pressed", on ? "true" : "false");
  sec.hidden = !Object.values(o).some(Boolean);
  const fig = sec.querySelector(`[data-side="${key}"]`);
  if (fig) fig.hidden = !on;
  else if (on && homeFill[gid]) homeFill[gid](key);
}
document.addEventListener("click", async (ev) => {
  const card = ev.target.closest("[data-home-card]");
  if (card) { const [gid, side] = card.dataset.homeCard.split("|"); setHomeCard(gid, side, card.getAttribute("aria-pressed") !== "true"); return; }
  const all = ev.target.closest("[data-home-all]");
  if (all) {
    const on = all.dataset.homeAll === "open";
    document.querySelectorAll("#panel-home [data-home-card]").forEach(b => { const [gid, side] = b.dataset.homeCard.split("|"); setHomeCard(gid, side, on); });
    return;
  }
  const nav = ev.target.closest("[data-home-nav]");
  if (nav && !nav.disabled && nav.dataset.homeNav) { specialState.home.date = nav.dataset.homeNav; renderHome(); return; }
  const save = ev.target.closest("[data-home-save]");
  if (save) {
    const [hs, gid, home, side] = save.dataset.homeSave.split("|");
    const game = (await fetchGameShard(hs, home))[String(gid)];
    if (game) GameView.saveCard(game, side, await GameView.cardLogos());
  }
});
document.addEventListener("click", (ev) => {
  const go = ev.target.closest("[data-goto-tab]");
  if (go) { selectTab(go.dataset.gotoTab); if (TABS.find(t => t.key === go.dataset.gotoTab).special) renderSpecialPanel(go.dataset.gotoTab); }
});
document.addEventListener("change", (ev) => {
  const sel = ev.target.closest("[data-home-date]");
  if (sel && /^\d{4}-\d{2}-\d{2}$/.test(sel.value)) { specialState.home.date = sel.value; renderHome(); }
});

// --- Ticker: a slim strip of the shown day's scores at the top of Home, with day arrows that move the whole page. Clicking a game
// scrolls to it: a processed game opens its cards, a game in progress opens its live box score.
const tickerDay = () => homeDate();   // the ticker and the Home scoreboard share one day
function dayGames(D) {
  const proc = homeProcessed(D).rows, seen = new Set(proc.map(g => Number(g[0])));
  const start = new Map(SCHEDULE().map(g => [Number(g[0]), String(g[4])]));
  const items = proc.map(g => ({ id: Number(g[0]), away: g[2], home: g[4], aS: g[3], hS: g[5], kind: "final", label: finalTag(g[6]), processed: true }));
  const feed = (LIVE.available !== false && LIVE.index && LIVE.index.date === D) ? LIVE.index.games : [];
  feed.forEach(g => {
    const id = Number(g.id); if (seen.has(id)) return; seen.add(id);
    const live = isInPlay(g), fin = g.state === "FINAL" || g.state === "OFF" || g.state === "OVER";
    items.push({ id, away: g.away, home: g.home, aS: live || fin ? g.away_score : null, hS: live || fin ? g.home_score : null,
      kind: live ? "live" : fin ? "final" : "fut", label: live ? String(g.status || "LIVE") : fin ? String(g.status || "FINAL") : (g.start ? clockTime(g.start) : "Scheduled"), canLive: !!g.sog });
  });
  SCHEDULE().filter(g => g[1] === D && !seen.has(Number(g[0]))).forEach(g => {
    const st = g[5], live = st === "LIVE" || st === "CRIT", fin = st === "OFF" || st === "FINAL";
    items.push({ id: Number(g[0]), away: g[2], home: g[3], aS: live || fin ? g[6] : null, hS: live || fin ? g[7] : null,
      kind: live ? "live" : fin ? "final" : "fut", label: live ? "In progress" : fin ? finalTag(g[8]) : st === "PPD" ? "Postponed" : schedTime(g) });
  });
  return items.sort((a, b) => (start.get(a.id) || "9").localeCompare(start.get(b.id) || "9") || a.id - b.id);
}
function renderTicker() {
  const el = document.getElementById("ticker");
  if (!el) return;
  el.hidden = activeTab !== "home";
  if (el.hidden) return;
  const D = tickerDay(), today = todayET(), games = dayGames(D);
  const label = D === today ? "Today" : D === shiftDay(today, -1) ? "Yesterday" : D === shiftDay(today, 1) ? "Tomorrow" : "Scores";
  el.innerHTML = `<div class="tk-head">
      <div class="tk-date">${label}<small>${D}</small></div>
      <div class="tk-ctrls"><button type="button" class="tk-btn" data-tk-nav="-1" aria-label="Previous day">&lsaquo;</button><button type="button" class="tk-btn" data-tk-nav="1" aria-label="Next day">&rsaquo;</button><button type="button" class="tk-btn wide" data-tk-today="1" ${D === today ? "disabled" : ""}>Today</button></div>
    </div>
    <div class="tk-strip">${games.map(g => `<button type="button" class="tk-game ${g.kind}" data-tk-game="${g.id}" data-tk-date="${D}" data-tk-kind="${g.kind}"${g.processed ? ' data-tk-proc="1"' : ""}${g.canLive ? ' data-tk-canlive="1"' : ""}>
        <span class="tk-status">${escapeHtml(g.label)}</span>
        <span class="tk-row"><span>${logoSpan(g.away)}${g.away}</span><b>${g.aS === null || g.aS === undefined ? "" : g.aS}</b></span>
        <span class="tk-row"><span>${logoSpan(g.home)}${g.home}</span><b>${g.hS === null || g.hS === undefined ? "" : g.hS}</b></span>
      </button>`).join("") || `<span class="tk-empty">No games on ${D}.</span>`}</div>`;
  hydrateImages();
}
document.addEventListener("click", (ev) => {
  const nav = ev.target.closest("[data-tk-nav]");
  if (nav) { specialState.home.date = shiftDay(tickerDay(), Number(nav.dataset.tkNav)); renderHome(); return; }
  if (ev.target.closest("[data-tk-today]")) { specialState.home.date = null; renderHome(); return; }
  const g = ev.target.closest("[data-tk-game]");
  if (!g) return;
  const gid = Number(g.dataset.tkGame);
  specialState.home.date = g.dataset.tkDate;
  if (g.dataset.tkKind === "live" && g.dataset.tkCanlive) LIVE.selected = gid;
  else if (g.dataset.tkProc) specialState.home.open[gid] = { away: true, home: true };
  selectTab("home");
  renderHome();
  if (LIVE.selected === null) setTimeout(() => { const t = document.getElementById("hr-" + gid) || document.querySelector("#panel-home .home-bar"); if (t) t.scrollIntoView({ block: "center", behavior: "smooth" }); }, 700);
});

async function renderSpecialPanel(tabKey) {
  syncUrl();
  const host = document.querySelector(`#panel-${tabKey} .table-host`);
  const searchEl = document.querySelector(`#panel-${tabKey} .search`);
  const state = specialState[tabKey] || {};
  const seasonAtStart = SEASON;

  if (tabKey === "home") {
    if (searchEl) searchEl.style.display = "none";
    await renderHome();
    return;
  }

  if (tabKey === "power") {
    if (searchEl) searchEl.style.display = "";
    host.innerHTML = powerHtml(state);
    hydrateImages();
    return;
  }

  if (tabKey === "odds") {
    if (searchEl) searchEl.style.display = "";
    host.innerHTML = '<div class="loading">Loading&hellip;</div>';
    let data = null;
    try { data = await fetchJson(`data/${SEASON}/odds.json`); } catch (e) {}
    if (seasonAtStart !== SEASON) return;
    host.innerHTML = oddsHtml(state, data);
    hydrateImages();
    return;
  }

  if (tabKey === "leaderboards") {
    if (searchEl) searchEl.style.display = "none";
    if (S().lines === undefined && !S().boards_loaded) {
      host.innerHTML = '<div class="loading">Loading&hellip;</div>';
      await ensureBoards();
      if (seasonAtStart !== SEASON) return;
    }
    host.innerHTML = leaderboardsHtml(state);
    hydrateImages();
    return;
  }

  if (state.mode === "list") {
    if (searchEl) searchEl.style.display = "";
    if (tabKey === "skaters") { host.innerHTML = skatersTableHtml(state); return; }
    if (tabKey === "goalies") { host.innerHTML = goaliesTableHtml(state); return; }
    if (tabKey === "units") {
      host.innerHTML = '<div class="loading">Loading&hellip;</div>';
      try {
        const lu = await fetchJson(`data/${SEASON}/league_units.json`);
        if (seasonAtStart !== SEASON) return;
        host.innerHTML = unitsTableHtml(state, lu);
      } catch (e) { host.innerHTML = '<div class="empty">Couldn\'t load the units.</div>'; }
      return;
    }
    if (tabKey === "teams") {
      const views = TAB_VIEWS.teams, cur = views.find(v => v[0] === state.view) || views[0];
      const chips = `<div class="chips board-chips" role="group" aria-label="View">${views.map(([k, label]) =>
        `<button type="button" class="chip" aria-pressed="${k === cur[0]}" data-tab-view="teams|${k}">${label}</button>`).join("")}</div>`;
      host.innerHTML = chips + (cur[2] ? boardViewHtml("teams", cur[2]) : teamsListHtml(state.filter));
      return;
    }
    host.innerHTML = gamesListHtml(state.filter);
    return;
  }

  if (searchEl) searchEl.style.display = "none";
  host.innerHTML = '<div class="loading">Loading&hellip;</div>';
  try {
    let html;
    if (tabKey === "teams") {
      let data = await fetchTeam(state.abbrev);
      // a unit outside the main list (or "show every unit") needs the short-lived units too
      if (state.allUnits || (state.mode === "unit" && !data.units.some(u => u.key === state.unitKey))) data = await withAllUnits(data);
      html = state.mode === "unit" ? unitDetailHtml(data, state.unitKey) : teamDetailHtml(data);
    } else if (tabKey === "skaters" || tabKey === "goalies") {
      let td = await fetchTeam(state.teamAbbrev);
      if (state.allUnits) td = await withAllUnits(td);
      html = playerDetailHtml(String(state.playerId), td, state.sec, state.tm);
    } else {
      const game = await fetchGame(state.home, state.gameId);
      if (seasonAtStart !== SEASON) return;
      if (!game) {
        const up = upcomingGame(state.gameId);
        if (up) {
          const html = await previewHtml(up);
          if (seasonAtStart !== SEASON) return;
          host.innerHTML = gameViewLinks.backHtml + html;
          syncUrl(true);
          window.scrollTo({ top: 0 });
          return;
        }
        host.innerHTML = gameViewLinks.backHtml + '<div class="empty">Game not found.</div>'; return;
      }
      host.innerHTML = "";
      if (pendingGameTab !== null) { host._gvState = host._gvState || { period: "all", sit: "all" }; host._gvState.tab = pendingGameTab; pendingGameTab = null; }
      GameView.mount(host, game, gameViewLinks);
      syncUrl(true);
      window.scrollTo({ top: 0 });
      return;
    }
    if (seasonAtStart !== SEASON) return; // user switched seasons while loading
    host.innerHTML = html;
    window.scrollTo({ top: 0 });
    if (tabKey === "skaters" || tabKey === "goalies") fillPlayerSeasons(seasonAtStart);
  } catch (e) {
    host.innerHTML = '<div class="empty">Couldn\'t load that data.</div>';
  }
}


// --- Live: games in progress, pushed into the artifact's shared database by the poller
// (live_tick.py + a scheduled loop). The page only reads: one subscription to the index
// document, plus one to the open game's document while its box score is on screen.
const LIVE = { db: null, available: null, index: null, selected: null, unsubGame: null, view: null, firstIndex: true };
const GAME_STALE_SEC = 420; // an in-play game whose feed is older than this shows a paused warning

function isInPlay(g) { return g.state === "LIVE" || g.state === "CRIT"; }
function clockTime(iso) { try { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } }
function liveAgeSec() { return LIVE.index ? (Date.now() - new Date(LIVE.index.updated).getTime()) / 1000 : Infinity; }

const liveLinks = {
  backHtml: '<button class="back-btn" data-live-back="1">&larr; Back to Home</button>',
  player: (id, team, text) => avatarSpan(id, text) + escapeHtml(text),
  playerText: (id, team, text) => escapeHtml(text),
  team: (abbrev) => logoSpan(abbrev) + abbrev,
  unit: (key, team, text) => escapeHtml(text),
};

function liveCardHtml(g) {
  const live = isInPlay(g), final = g.state === "FINAL" || g.state === "OFF" || g.state === "OVER";
  const status = live ? `<span class="live-badge on">LIVE</span> ${escapeHtml(g.status)}` : final ? `<span class="live-badge">${escapeHtml(g.status || "FINAL")}</span>` : `<span class="live-badge">${g.start ? clockTime(g.start) : "Scheduled"}</span>`;
  const started = live || final;
  const shots = g.sog ? `<div class="live-sub">Shots ${g.sog[0]}&ndash;${g.sog[1]} &middot; xG ${g.xg[0].toFixed(1)}&ndash;${g.xg[1].toFixed(1)}</div>` : "";
  const goals = (g.goals || []).slice(-3).map(x => `<div class="live-goal">${escapeHtml(x[0])} ${escapeHtml(x[1])} &middot; ${escapeHtml(x[2])} &mdash; ${escapeHtml(x[3])}</div>`).join("");
  const open = started && g.sog ? ` data-open-live="${g.id}"` : !started && g.home ? ` data-open-game="${g.id}" data-game-home="${g.home}" data-game-season="${homeSeasonId()}"` : "";
  return `<div class="live-card${open ? " clickable" : ""}"${open}>
      <div class="live-status">${status}</div>
      <div class="live-teams"><span>${logoSpan(g.away)}${g.away}</span><b>${started ? g.away_score : ""}</b></div>
      <div class="live-teams"><span>${logoSpan(g.home)}${g.home}</span><b>${started ? g.home_score : ""}</b></div>
      ${shots}${goals}</div>`;
}

function liveBannerHtml() {
  if (!LIVE.index) return "";
  const anyLive = LIVE.index.games.some(isInPlay);
  if (anyLive && liveAgeSec() > GAME_STALE_SEC) {
    return `<div class="live-warn">The live feed looks paused &mdash; last update ${clockTime(LIVE.index.updated)}. Scores shown may be behind.</div>`;
  }
  return "";
}

// the live feed changed: refresh just the live section (the finished games and any open cards stay put)
function renderLive() {
  if (typeof renderTicker === "function") renderTicker();
  const host = document.querySelector("#panel-home .table-host");
  if (!host) return;
  if (LIVE.selected !== null) { renderLiveGame(host); return; }
  const box = host.querySelector("#home-live");
  if (box) { box.innerHTML = liveSectionHtml(); return; }
  if (activeTab === "home") renderHome();
}

function renderLiveGame(host) {
  const id = LIVE.selected;
  host.innerHTML = '<div class="loading">Loading&hellip;</div>';
  LIVE.view = null;
  if (LIVE.unsubGame) { LIVE.unsubGame(); LIVE.unsubGame = null; }
  host._gvState = null; // a different game starts with the filters cleared
  LIVE.unsubGame = LIVE.db.doc("live/g_" + id).onSnapshot((snap) => {
    if (LIVE.selected !== id) return;
    if (!snap.exists) { host.innerHTML = liveLinks.backHtml + '<div class="empty">No live data for this game yet.</div>'; return; }
    const game = snap.data().game;
    if (!game) return;
    padGameShard({ g: game });   // live documents drop trailing zeros from cells just like the game shards
    if (LIVE.view && host.querySelector(".gv-body")) LIVE.view.update(game);
    else LIVE.view = GameView.mount(host, game, liveLinks);
  }, () => { host.innerHTML = liveLinks.backHtml + '<div class="empty">Couldn\'t load that game.</div>'; });
}

function closeLiveGame() {
  LIVE.selected = null;
  if (LIVE.unsubGame) { LIVE.unsubGame(); LIVE.unsubGame = null; }
  LIVE.view = null;
  renderLive();
}

function updateLiveTabBadge() {
  const btn = document.getElementById("tabbtn-home");
  if (!btn) return;
  const n = LIVE.index ? LIVE.index.games.filter(isInPlay).length : 0;
  btn.classList.toggle("has-live", n > 0);
  btn.textContent = n > 0 ? `Home (${n} live)` : "Home";
}

// On the hosted site there is no shared database: the live job writes its JSON files to a public address (window.SHIFTSCORE.liveUrl),
// and this adapter looks like the database (doc(path).onSnapshot) but polls those files.
function httpLiveDb(base) {
  return {
    doc(path) {
      const name = path.replace(/^live\//, ""), url = `${base.replace(/\/$/, "")}/${name}.json`;
      return {
        onSnapshot(ok, err) {
          let stopped = false, timer = null, first = true;
          const tick = async () => {
            if (first || !document.hidden) {   // always load once; after that, skip while the tab is in the background
              first = false;
              try {
                const r = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
                if (r.status === 404) ok({ exists: false, data: () => null });
                else if (!r.ok) throw new Error("HTTP " + r.status);
                else { const d = await r.json(); ok({ exists: true, data: () => d }); }
              } catch (e) { if (err) err(e); }
            }
            if (!stopped) timer = setTimeout(tick, name === "index" ? 30000 : 15000);
          };
          tick();
          return () => { stopped = true; clearTimeout(timer); };
        },
      };
    },
  };
}
async function initLive() {
  const liveUrl = (typeof window !== "undefined" && window.SHIFTSCORE && window.SHIFTSCORE.liveUrl) || "";
  if (typeof claude !== "undefined" && claude.use) LIVE.db = await claude.use("db");   // the Artifact page: the shared database
  else if (liveUrl) LIVE.db = httpLiveDb(liveUrl);                                       // the hosted site: the live job's files
  if (!LIVE.db) { LIVE.available = false; renderLive(); return; }
  LIVE.available = true;
  LIVE.db.doc("live/index").onSnapshot((snap) => {
    LIVE.index = snap.exists ? snap.data() : null;
    updateLiveTabBadge();
    if (LIVE.selected === null) renderLive();
    LIVE.firstIndex = false;
  }, () => { LIVE.available = false; renderLive(); });
  setInterval(() => {
    const el = document.getElementById("live-banner");
    if (el) el.innerHTML = liveBannerHtml();
  }, 30000);
}

// --- Sortable league tables (Skaters, Goalies, Units): every row, click a column heading to sort.
function sortedRows(rows, cols, st) {
  const col = cols.find(c => c.k === st.k) || cols[0];
  return rows.slice().sort((a, b) => {
    const x = col.get(a), y = col.get(b), nx = x === null || x === undefined, ny = y === null || y === undefined;
    if (nx || ny) return nx === ny ? 0 : nx ? 1 : -1;                // missing values always last
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * st.d;
  });
}
function sortableTable(tabKey, cols, rows, st, rowAttrs) {
  const head = cols.map(c => {
    const on = st.k === c.k;
    return `<th class="${c.num ? "num " : ""}sortable" data-sort-tab="${tabKey}" data-sort-key="${c.k}" aria-sort="${on ? (st.d < 0 ? "descending" : "ascending") : "none"}" tabindex="0">${c.label}${on ? `<span class="sort-arrow">${st.d < 0 ? "&#9662;" : "&#9652;"}</span>` : ""}</th>`;
  }).join("");
  const body = sortedRows(rows, cols, st).map(r => `<tr class="clickable" ${rowAttrs(r)}>${cols.map(c => {
    const v = c.get(r);
    return `<td class="${c.num ? "num " : ""}${c.signed ? numClass(c, v) : ""}">${c.cell ? c.cell(r) : escapeHtml(fmt(v, c.signed))}</td>`;
  }).join("")}</tr>`).join("");
  return `<div class="table-scroll sort-scroll"><table><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td colspan="' + cols.length + '"><div class="empty">Nothing matches.</div></td></tr>'}</tbody></table></div>
    <div class="scroll-hint">${rows.length} row${rows.length === 1 ? "" : "s"} &middot; click a column heading to sort</div>`;
}
const num1 = (v) => (v === null || v === undefined ? "&ndash;" : Number(v).toFixed(1));
const num2 = (v) => (v === null || v === undefined ? "&ndash;" : Number(v).toFixed(2));
const SKATER_COLS = [
  { k: "name", label: "Player", get: p => p.name, cell: p => avatarSpan(p.id, p.name) + escapeHtml(p.name) },
  { k: "team", label: "Team", get: p => p.team, cell: p => teamLink(p.team) },
  { k: "pos", label: "Pos", get: p => p.pos },
  { k: "gp", label: "GP", num: true, get: p => p.gp },
  { k: "g", label: "G", num: true, get: p => p.g ?? 0 },
  { k: "a1", label: "A1", num: true, get: p => p.a1 ?? 0 },
  { k: "a2", label: "A2", num: true, get: p => (p.a ?? 0) - (p.a1 ?? 0) },
  { k: "pts", label: "P", num: true, get: p => (p.g ?? 0) + (p.a ?? 0) },
  { k: "sog", label: "SOG", num: true, get: p => p.sog ?? 0 },
  { k: "toi_gp", label: "TOI / GP", num: true, get: p => (p.gp ? (p.toi_sec ?? 0) / p.gp : 0), cell: p => toiStr(Math.round(p.gp ? (p.toi_sec ?? 0) / p.gp : 0)) },
  { k: "ixg", label: "ixG", num: true, get: p => p.ixg ?? 0, cell: p => num1(p.ixg ?? 0) },
  { k: "avg_raw", label: "Avg Raw", num: true, get: p => p.avg_raw, cell: p => num2(p.avg_raw) },
  { k: "avg_adj", label: "Avg Adjusted", num: true, signed: true, get: p => p.avg_adj, cell: p => (p.avg_adj === null || p.avg_adj === undefined ? "&ndash;" : gsCell(p.avg_adj, "avg", true)) },
];
function skatersTableHtml(state) {
  const q = (state.filter || "").trim().toLowerCase(), F = new Set(["C", "L", "R"]);
  const rows = (S().players_index || []).filter(p => p.pos !== "G" && (state.pos === "all" || (state.pos === "f" ? F.has(p.pos) : p.pos === "D"))
    && (!q || (p.name + " " + p.team).toLowerCase().includes(q)));
  const chips = `<div class="chips board-chips" role="group" aria-label="Position">${[["all", "All skaters"], ["f", "Forwards"], ["d", "Defensemen"]].map(([k, label]) =>
    `<button type="button" class="chip" aria-pressed="${state.pos === k}" data-pos-filter="${k}">${label}</button>`).join("")}</div>`;
  return chips + sortableTable("skaters", SKATER_COLS, rows, state.sort, p => `data-open-player="${p.id}" data-player-team="${p.team}"`) + gsKeyHtml("Avg Adjusted colors");
}
const GOALIE_COLS = [
  { k: "goalie", label: "Goalie", get: g => g.goalie, cell: g => avatarSpan(g.pid, g.goalie) + escapeHtml(g.goalie) },
  { k: "team", label: "Team", get: g => g.team, cell: g => teamLink(g.team) },
  { k: "gp", label: "GP", num: true, get: g => g.gp },
  { k: "sf", label: "Shots Faced", num: true, get: g => g.sf },
  { k: "ga", label: "Goals Allowed", num: true, get: g => g.ga },
  { k: "xga", label: "xGA", num: true, get: g => g.xga, cell: g => num1(g.xga) },
  { k: "gsax", label: "GSAx", num: true, signed: true, get: g => g.gsax, cell: g => `<span class="${g.gsax > 0 ? "pos" : g.gsax < 0 ? "neg" : ""}">${g.gsax > 0 ? "+" : ""}${Number(g.gsax).toFixed(1)}</span>` },
  { k: "sv_pct", label: "Sv%", num: true, get: g => g.sv_pct, cell: g => (g.sv_pct ? Number(g.sv_pct).toFixed(3) : "&ndash;") },
];
function goaliesTableHtml(state) {
  const q = (state.filter || "").trim().toLowerCase();
  const rows = (S().goalies || []).filter(g => !q || (g.goalie + " " + g.team).toLowerCase().includes(q));
  return sortableTable("goalies", GOALIE_COLS, rows, state.sort, g => `data-open-player="${g.pid}" data-player-team="${g.team}"`);
}
const UNIT_COLS = [
  { k: "unit", label: "Unit", get: u => u.unit, cell: u => unitFaces(u.key, u.unit) + escapeHtml(u.unit) },
  { k: "team", label: "Team", get: u => u.team, cell: u => teamLink(u.team) },
  { k: "gp", label: "GP", num: true, get: u => u.gp },
  { k: "toi_sec", label: "TOI", num: true, get: u => u.toi_sec, cell: u => toiStr(u.toi_sec) },
  { k: "gf", label: "GF", num: true, get: u => u.gf },
  { k: "ga", label: "GA", num: true, get: u => u.ga },
  { k: "xgf", label: "xGF", num: true, get: u => u.xgf, cell: u => num1(u.xgf) },
  { k: "xga", label: "xGA", num: true, get: u => u.xga, cell: u => num1(u.xga) },
  { k: "total", label: "Total", num: true, signed: true, get: u => u.total, cell: u => scoreCell(u.total) },
  { k: "avg", label: "Avg / GM", num: true, signed: true, get: u => u.avg, cell: u => scoreCell(u.avg) },
  { k: "per60", label: "Per 60", num: true, signed: true, get: u => (u.toi_sec >= UNIT_RATE_MIN_SEC ? u.per60 : null), cell: u => (u.toi_sec >= UNIT_RATE_MIN_SEC ? scoreCell(u.per60) : "&ndash;") },
];
const UNIT_VIEWS = [["line", "Forward lines"], ["pair", "D pairs"], ["pp", "Power play"], ["pk", "Penalty kill"]];
function unitsTableHtml(state, lu) {
  const q = (state.filter || "").trim().toLowerCase();
  const rows = (lu[state.view] || []).filter(u => !q || (u.unit + " " + u.team).toLowerCase().includes(q));
  const chips = `<div class="chips board-chips" role="group" aria-label="Unit type">${UNIT_VIEWS.map(([k, label]) =>
    `<button type="button" class="chip" aria-pressed="${state.view === k}" data-unit-view="${k}">${label}</button>`).join("")}</div>`;
  return chips + sortableTable("units", UNIT_COLS, rows, state.sort, u => `data-open-unit="${u.key}" data-unit-team="${u.team}"`);
}

// --- Leaderboards: the best and worst of the season, side by side. Each section is one ranking, ten rows a side (more on request).
const LB_GROUPS = [
  { key: "skaters", title: "Skaters", parts: [
    { board: "season_avg", title: "Season averages", cols: ["player", "team", "gp", "avg_adjusted", "avg_raw"],
      note: "Average Adjusted Game Score per game across the season; skaters need at least 10 games in a full season (fewer early on)." },
    { board: "player_games", title: "Single games", cols: ["player", "team", "date", "adjusted", "raw"],
      note: "Adjusted Game Score in one game, players with at least 5:00 of ice time. Adjusted adds credit for the quality of the competition faced and subtracts the average for his position." }] },
  { key: "goalies", title: "Goalies", parts: [
    { board: "goalie_avg", title: "Season averages", cols: ["goalie", "team", "gp", "gsax_pg", "sv_pct"], minQual: () => goalieAvgMinGp(),
      note: "Goals saved above expected per game over the season: the chance each shot on goal faced had of scoring, added up, minus goals allowed, divided by games played. Goalies need at least 10 games in a full season (fewer early on)." },
    { board: "goalie_games", title: "Single games", cols: ["goalie", "date", "opp", "sf", "ga", "gsax"],
      note: "Goals saved above expected in one game, goalies who faced at least 10 shots. Great is more than +1.5, Quality +0.5 to +1.5, Average within 0.5, Bad -0.5 to -1.5, Blown worse than -1.5." }] },
  ...[["lines", "Forward lines", "lines", "3:00", "line"], ["pairs", "D pairs", "pairs", "3:00", "pair"], ["pp", "Power play units", "pp", "40 seconds", "power-play unit"], ["pk", "Penalty kill units", "pk", "40 seconds", "penalty-kill unit"]].map(([k, title, single, min, what]) => ({
    key: k, title, parts: [
      { board: k + "_avg", title: "Season averages", cols: ["unit", "team", "gp", "toi", "rating"],
        note: `Season rating: Unit Score per 60 minutes together, pulled toward zero as if the ${what} had 100 more minutes of average play. Needs a minimum of time together on the season (more as the season goes on).` },
      { board: single, title: "Single games", cols: ["unit", "team", "date", "score"], note: `Unit Score for one game, ${what}s with at least ${min} together.`.replace("s with", "s with") }] }))
];
// the games a goalie needs for the season-average boards: 10 in a full season, about a third of the busiest goalie's games early on (never under 3),
// so one relief appearance can't top or bottom the list
function goalieAvgMinGp() {
  const most = Math.max(0, ...(S().goalies || []).map(g => g.gp));
  return Math.min(10, Math.max(3, Math.round(0.35 * most)));
}
function leaderboardsHtml(state) {
  const nav = `<div class="chips board-chips" role="group" aria-label="Jump to">${LB_GROUPS.map(x => `<button type="button" class="chip" data-lb-jump="${x.key}">${x.title}</button>`).join("")}</div>`;
  const part = (sec) => {
    const board = BOARDS.find(b => b.key === sec.board);
    if (!board) return "";
    const view = Object.assign({}, board, { cols: sec.cols.map(k => board.cols.find(c => c.k === k)).filter(Boolean) });
    const more = !!state.more[sec.board], n = more ? 25 : 10;
    const side = (dir, label) => `<div class="lb-col"><div class="lb-sub">${label}</div><div class="board-table">${renderTable(view, "", sec.minQual ? sec.minQual() : 0, dir, n)}</div></div>`;
    return `<div class="lb-part"><div class="lb-part-h">${sec.title}</div>
      <div class="lb-pair">${side("best", "Best")}${side("worst", "Worst")}</div>
      <div class="panel-caption">${sec.note} <button type="button" class="chip" data-lb-more="${sec.board}">${more ? "Show top 10" : "Show top 25"}</button></div></div>`;
  };
  const sections = LB_GROUPS.map(grp => `<section class="lb-sec" id="lb-${grp.key}"><div class="detail-h3">${grp.title}</div>${grp.parts.map(part).join("")}</section>`).join("");
  return nav + sections;
}

// --- Ranking tables live inside the tab they rank. Each tab lists its views: [key, label, board key (null = the plain list)].
const TAB_VIEWS = {
  teams: [["list", "All teams", null], ["team_stats", "Team stats", "team_stats"]],
};
function boardViewHtml(tabKey, boardKey) {
  const state = specialState[tabKey], board = BOARDS.find(b => b.key === boardKey);
  if (!board) return "";
  state.toi = state.toi || {};
  const hasWorst = HAS_WORST.has(board.key), dir = hasWorst && state.dir === "worst" ? "worst" : "best";
  const toggle = hasWorst ? `<div class="chips dir-chips" role="group" aria-label="Best or worst">${[["best", "Best"], ["worst", "Worst"]].map(([k, label]) =>
    `<button type="button" class="chip" aria-pressed="${k === dir}" data-board-dir="${tabKey}|${k}">${label}</button>`).join("")}</div>` : "";
  const title = BOARD_TITLES[board.key] ? BOARD_TITLES[board.key][dir === "worst" ? 1 : 0] : board.title;
  return `${toggle}<div class="board-head"><div class="board-title">${title}</div><div class="panel-caption">${board.caption}</div></div>
    ${board.key === "team_stats" ? teamBoardHtml(state) : `${toiSliderHtml(board, state, dir)}
    <div class="board-table">${renderTable(board, state.filter, state.toi[board.key] || 0, dir)}</div>`}`;
}
document.addEventListener("change", (ev) => {
  const sel = ev.target.closest && ev.target.closest("select[data-team-stat]");
  if (!sel) return;
  specialState.teams.teamStat = sel.value;
  renderSpecialPanel("teams");
});

// the ice-time qualifier: a slider that hides rows with less ice time than the setting
function toiSliderHtml(board, state, dir) {
  const sl = toiSlider(board);
  if (!sl || !sl.max) return "";
  const v = Math.min(state.toi[board.key] || 0, sl.max);
  return `<div class="toi-slider">
      <label for="toi-range">${sl.label}</label>
      <input id="toi-range" type="range" min="0" max="${sl.max}" step="${sl.step}" value="${v}" data-toi-board="${board.key}">
      <output class="toi-value">${v ? sl.fmt(v) : "Any"}</output>
      <span class="toi-count">${toiCountText(board, v, state.filter, dir)}</span>
    </div>`;
}
function toiCountText(board, v, filterText, dir) {
  const qualified = toiQualified(board, v, dir).length;
  const shown = Math.min(qualified, boardLimit(board.key));
  return v ? `Showing ${shown} of ${qualified} qualifying` : `Showing ${shown}`;
}
document.addEventListener("input", (ev) => {
  const r = ev.target.closest && ev.target.closest("input[data-toi-board]");
  if (!r) return;
  const state = specialState[activeTab], board = BOARDS.find(b => b.key === r.dataset.toiBoard);
  if (!board || !state) return;
  const v = Number(r.value);
  state.toi[board.key] = v;
  const wrap = r.closest(".toi-slider");
  wrap.querySelector(".toi-value").textContent = v ? toiSlider(board).fmt(v) : "Any";
  const dir = state.dir || "best";
  wrap.querySelector(".toi-count").textContent = toiCountText(board, v, state.filter, dir);
  document.querySelector(`#panel-${activeTab} .board-table`).innerHTML = renderTable(board, state.filter, v, dir);
});

// --- images
const IMG = { logos: null, photoTeam: null, photoFiles: {} };
const svgUri = (svg) => "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
const jsonOrEmpty = (path) => fetch(path).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
async function hydrateImages() {
  const logoEls = [...document.querySelectorAll(".tlogo[data-team]:not([data-done])")];
  logoEls.forEach(el => { el.dataset.done = "1"; });
  if (logoEls.length) {
    IMG.logos = IMG.logos || jsonOrEmpty("data/logos.json");
    const logos = await IMG.logos;
    logoEls.forEach(el => {
      const l = logos[el.dataset.team];
      if (l) el.innerHTML = `<img class="l" alt="" src="${svgUri(l.l || l.d)}"><img class="d" alt="" src="${svgUri(l.d || l.l)}">`;
    });
  }
  const avEls = [...document.querySelectorAll(".avatar[data-pid]:not([data-done])")];
  avEls.forEach(el => { el.dataset.done = "1"; });
  if (avEls.length) {
    IMG.photoTeam = IMG.photoTeam || jsonOrEmpty("data/photo_team.json");
    const pt = await IMG.photoTeam;
    const teams = [...new Set(avEls.map(el => pt[el.dataset.pid]).filter(Boolean))];
    await Promise.all(teams.map(t => { IMG.photoFiles[t] = IMG.photoFiles[t] || jsonOrEmpty("data/photos/" + t + ".json"); return IMG.photoFiles[t]; }));
    for (const el of avEls) {
      const t = pt[el.dataset.pid], files = t ? await IMG.photoFiles[t] : null, b64 = files && files[el.dataset.pid];
      if (b64) {
        el.style.backgroundImage = `url(data:image/jpeg;base64,${b64})`;
        // a big photo (a player's page, the stars of the night) swaps to the full-size file once it has loaded; the small one shows meanwhile
        if (el.classList.contains("avatar-lg")) { const u = `data/photos_lg/${el.dataset.pid}.jpg`, im = new Image(); im.onload = () => { el.style.backgroundImage = `url(${u})`; }; im.src = u; }
      } else el.textContent = el.dataset.ini || "";
    }
  }
}
let hydrateTimer = null;
const imageObserver = new MutationObserver(() => { clearTimeout(hydrateTimer); hydrateTimer = setTimeout(hydrateImages, 30); });

// one document-level listener for all navigation: team/player/unit/game links
// appear in many tabs (leaderboards, box scores, team pages) and each opens
// its view in the right tab, whichever tab the click came from
document.addEventListener("click", (ev) => {
  const t = ev.target;
  if (t.closest("[data-home-card]")) return;   // the card buttons on a Home tile have their own handler
  const sortTeam = t.closest("[data-sort-team]");
  if (sortTeam) {
    const st = specialState.teams, k = sortTeam.dataset.sortTeam;
    st.dir = st.sort === k && st.dir === "desc" ? "asc" : "desc";
    st.sort = k;
    renderSpecialPanel("teams");
    return;
  }
  const sortTh = t.closest("[data-sort-key]");
  if (sortTh) {
    const tk = sortTh.dataset.sortTab, k = sortTh.dataset.sortKey, st = specialState[tk].sort;
    const textCol = ["name", "team", "pos", "goalie", "unit"].includes(k);
    if (st.k === k) st.d = -st.d; else { st.k = k; st.d = textCol ? 1 : -1; }
    renderSpecialPanel(tk);
    return;
  }
  const posBtn = t.closest("[data-pos-filter]");
  if (posBtn) { specialState.skaters.pos = posBtn.dataset.posFilter; renderSpecialPanel("skaters"); return; }
  const unitView = t.closest("[data-unit-view]");
  if (unitView) { specialState.units.view = unitView.dataset.unitView; renderSpecialPanel("units"); return; }
  const lbMore = t.closest("[data-lb-more]");
  if (lbMore) { const m = specialState.leaderboards.more; m[lbMore.dataset.lbMore] = !m[lbMore.dataset.lbMore]; renderSpecialPanel("leaderboards"); return; }
  const lbJump = t.closest("[data-lb-jump]");
  if (lbJump) { const el = document.getElementById("lb-" + lbJump.dataset.lbJump); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  const dirBtn = t.closest("[data-board-dir]");
  if (dirBtn) {
    const [tk, dk] = dirBtn.dataset.boardDir.split("|");
    specialState[tk].dir = dk;
    renderSpecialPanel(tk);
    return;
  }
  const viewBtn = t.closest("[data-tab-view]");
  if (viewBtn) {
    const [tk, vk] = viewBtn.dataset.tabView.split("|");
    specialState[tk].view = vk;
    renderSpecialPanel(tk);
    return;
  }
  const openLive = t.closest("[data-open-live]");
  const liveBack = t.closest("[data-live-back]");
  if (openLive) { LIVE.selected = Number(openLive.dataset.openLive); renderLive(); syncUrl(); return; }
  if (liveBack) { closeLiveGame(); syncUrl(true); return; }
  const teamSec = t.closest("[data-team-sec]");
  if (teamSec) {      // switch the team page's section and stay where the tab row is
    specialState.teams.sec = teamSec.dataset.teamSec; replaceNextSync = true;
    const keep = window.scrollY;
    renderSpecialPanel("teams").then(() => window.scrollTo(0, keep));
    return;
  }
  const allUnits = t.closest("[data-all-units]");
  if (allUnits) {
    const tab = activeTab === "skaters" || activeTab === "goalies" ? activeTab : "teams";
    specialState[tab].allUnits = true;
    renderSpecialPanel(tab);
    return;
  }
  const openGame = t.closest("[data-open-game]");
  const openUnit = t.closest("[data-open-unit]");
  const openPlayer = t.closest("[data-open-player]");
  const openTeam = t.closest("a[data-open-team]") || t.closest("[data-open-team]");   // a team link inside a row that opens a player or a game still opens the team
  const back = t.closest("[data-back]");
  if (openTeam && openTeam.tagName === "A") {
    if (specialState.teams.abbrev !== openTeam.dataset.openTeam) specialState.teams.sec = "overview";
    Object.assign(specialState.teams, { mode: "detail", abbrev: openTeam.dataset.openTeam, allUnits: false });
    selectTab("teams"); renderSpecialPanel("teams");
  } else if (openGame) {
    // a game opened from Home may belong to a different season than the rest of the site is showing
    const gs = openGame.dataset.gameSeason;
    if (gs && gs !== SEASON && DATA.by_season[gs]) {
      SEASON = gs;
      try { localStorage.setItem("shiftscore-season", SEASON); } catch (e) {}
      document.getElementById("season-select").value = SEASON;
      specialState = freshState();
      activeTab = "games";
      navLock = true; buildPage(); navLock = false;
    }
    Object.assign(specialState.games, { mode: "detail", gameId: openGame.dataset.openGame, home: openGame.dataset.gameHome });
    selectTab("games"); renderSpecialPanel("games");
  } else if (openUnit) {
    Object.assign(specialState.teams, { mode: "unit", abbrev: openUnit.dataset.unitTeam, unitKey: openUnit.dataset.openUnit });
    selectTab("teams"); renderSpecialPanel("teams");
  } else if (openPlayer) {
    // a season row on a player's own page opens that season's page for him (no need for the season menu)
    const ps = openPlayer.dataset.playerSeason;
    const switching = ps && ps !== SEASON && DATA.by_season[ps];
    if (switching) {
      SEASON = ps;
      try { localStorage.setItem("shiftscore-season", SEASON); } catch (e) {}
      document.getElementById("season-select").value = SEASON;
      specialState = freshState();
      navLock = true; buildPage(); navLock = false;
    }
    // a goalie's page lives under Goalies, a skater's under Skaters
    const goalie = (S().goalies || []).some(g => String(g.pid) === String(openPlayer.dataset.openPlayer));
    const tab = goalie ? "goalies" : "skaters";
    if (switching || String(specialState[tab].playerId) !== String(openPlayer.dataset.openPlayer)) { specialState[tab].sec = "overview"; specialState[tab].tm = "all"; }
    Object.assign(specialState[tab], { mode: "detail", playerId: openPlayer.dataset.openPlayer, teamAbbrev: openPlayer.dataset.playerTeam, allUnits: false });
    selectTab(tab); renderSpecialPanel(tab);
  } else if (openTeam) {
    if (specialState.teams.abbrev !== openTeam.dataset.openTeam) specialState.teams.sec = "overview";
    Object.assign(specialState.teams, { mode: "detail", abbrev: openTeam.dataset.openTeam, allUnits: false });
    selectTab("teams"); renderSpecialPanel("teams");
  } else if (back) {
    const key = back.dataset.back;
    specialState[key].mode = "list";
    renderSpecialPanel(key);
  }
});

const HOW_IT_WORKS_HTML = `
<div class="prose">
  <p>Shift Score rates what a player actually did in a single NHL game, then adjusts for <em>who they did it with and against</em>. Everything is built from the NHL's own play-by-play and shift data. There are two player scores, Game Score and Adjusted Impact, plus scores for lines, pairs and special-teams units.</p>

  <h3>1. Game Score &mdash; &ldquo;how good was this performance?&rdquo;</h3>
  <p>One number for what a player did in a single game. It rewards his own production (goals, assists, shots on goal and the chances he generated), what his team did while he was on the ice at 5v5 (shot attempts, goals and expected goals for and against), and the smaller things (blocked shots, penalties drawn and taken, faceoffs). How much each counts was tested against evidence, not guessed: expected goals predict a player's future scoring and his team's future results much better than past goals do, so chances count for more than results, and faceoffs count for almost nothing. A typical game is about +0.4 and a very good one about +1.7. The exact weights are not published.</p>

  <p class="kicker">Expected goals (xG) come from a gradient-boosted model trained on every unblocked shot (distance, angle, shot type, rebounds, rush, skater counts, score, and what happened just before the shot &mdash; the previous event, how far the puck traveled, and from where; held-out AUC 0.78, well calibrated). It deliberately ignores who is shooting or in net, so finishing and goaltending skill show up as goals above or below expected instead of being baked in. &ldquo;Adjusted&rdquo; means rebound shots in the same scramble are discounted, and shot volume is corrected for score state &mdash; trailing teams shoot more just because they're trailing.</p>

  <h3>2. Adjusted Impact &mdash; Game Score, in context</h3>
  <p>Adjusted Impact is Game Score with two corrections: credit for the quality of the competition he faced, and the average for his position taken off, so 0 is an average forward's or defenseman's game.</p>
  <p><strong>QoC</strong> (quality of competition) is the average rating of the opponents a player shared ice with that night, weighted by time on ice. <strong>QoT</strong> is the same for teammates. A player's rating is their average Game Score over games <em>before</em> that date, so nothing is rated using the future, pulled toward the average for his position when he has few games (a call-up's first three games don't make him an elite opponent). Baselines are the league average for the same position mix, since defensemen score lower than forwards across the board.</p>
  <p>Tougher opponents add credit; the size of the credit was measured by comparing each player with himself across thousands of games. QoT is shown as context but is <em>not</em> subtracted: taking it out made a player's results less repeatable, partly because a player's own play feeds his teammates' ratings.</p>
  <p><strong>Position average.</strong> Defensemen produce less of what Game Score counts (goals, assists, shots, their own chances), so their raw scores run lower. Adjusted Game Score takes off the average for the player's position, so a ranking compares each player with his own kind. Without it the best defenseman ranked 19th and none were in the top 10; with it the top defensemen rank 6th and 7th.</p>
  <p>The credit for opponents is a light nudge, usually a tenth of a point or less, because context explains only about 1% of a player's game-to-game swings. Adjusted Game Score is the number to rank players on across positions; raw Game Score is the plain account of what happened.</p>

  <h3>Lines, pairs, power play &amp; penalty kill</h3>
  <p>At even strength each team's skaters split into a forward line (3) and a D pair (2); on the power play and penalty kill the whole on-ice group is one unit. Each combination's score for a game counts the goals and the expected goals it scored and allowed while it was on the ice.</p>
  <p>For forward lines, defense pairs and penalty-kill units, expected goals carry the score and goals and shot attempts count for less, because a unit is together about a minute at a time and a single bounce shouldn't decide its night. Power-play units count goals and expected goals. Unit Score is a running count over the time the unit shared the ice, so use <strong>Score / 60</strong> to compare units with different ice time. Every unit with a meaningful season sample has its own page &mdash; open any team and scroll to its lines, pairs and special-teams units. Lines and pairs need 10+ minutes together on the season, PP/PK units 3+ minutes; shorter combinations are mostly one-off deployments from injuries or penalties ending mid-shift.</p>

  <h3>Game pages</h3>
  <p>Every game has a box score page: score by period, scoring and penalty summaries, team stats (shots, shot attempts, expected goals, high-danger shots on goal, hits, faceoffs, power-play time), every skater's line with their Game Score, QoC, QoT and Adjusted Impact for that night, both goalies with GSAx, and the scores of every line, pair and special-teams unit that played real minutes. Shootouts are not counted as goals for any player or stat; the shootout winner is credited one goal in the final score, as in the official box score.</p>

  <h3>Goalies</h3>
  <p><strong>GSAx</strong> (Goals Saved Above Expected) = expected goals against minus goals actually allowed, where expected goals against add up the chance each <em>shot on goal</em> the goalie faced had of scoring (from the same danger model that sorts shots into high, medium and low). Shots that missed the net were never faced and count for nothing. Positive means stopping more than an average goalie would on the same shots.</p>
  <p><strong>Start grades.</strong> Each goalie game is graded by its GSAx: <em>Great</em> is more than +1.5, <em>Quality</em> +0.5 to +1.5, <em>Average</em> within 0.5, <em>Bad</em> &minus;0.5 to &minus;1.5, and <em>Blown</em> worse than &minus;1.5. A <em>Stolen win</em> is a Great or Quality game in a win when the team was out-chanced by a goal or more in expected goals; <em>Bailed out</em> is a Bad or Blown game in a win; <em>Relief</em> means another goalie started and faced more shots. The cutoffs follow the ones Clear Sight Analytics publishes; we checked them against 20 of their graded Rangers and Maple Leafs starts and agreed exactly on 11 and within one grade on 18, with ours a little kinder to the goalie in most of the differences (their expected goals run a few percent higher than ours). Trend charts on player, goalie and team pages plot each game with a trailing five-game average; one game is a small sample, so read the line, not a single dot.</p>

  <h3>What to keep in mind</h3>
  <p>One game is a small sample &mdash; a single bounce can swing a Game Score. Each season is a regular-season snapshot rebuilt from the NHL's data; the in-progress season updates when the site is rebuilt. Ratings carry over between seasons, so early-season QoC/QoT starts from a player's prior history instead of from zero. The score weights are not published.</p>
</div>
`;

let activeTab = "home";

function buildPage() {
  const tabsEl = document.getElementById("tabs");
  const panelsEl = document.getElementById("panels");
  tabsEl.innerHTML = "";
  panelsEl.innerHTML = "";

  TABS.forEach((tab) => {
    const btn = document.createElement("button");
    btn.textContent = tab.label;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", "false");
    btn.addEventListener("click", () => selectTab(tab.key));
    btn.id = "tabbtn-" + tab.key;
    tabsEl.appendChild(btn);

    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "panel-" + tab.key;
    panel.innerHTML = `
      <div class="panel-head">
        <div>
          <div class="panel-title">${tab.title}</div>
          <div class="panel-caption">${tab.caption}</div>
        </div>
        <input class="search" type="text" placeholder="Filter by name&hellip;" data-tab="${tab.key}">
      </div>
      <div class="table-host"></div>
    `;
    panelsEl.appendChild(panel);
    const search = panel.querySelector(".search");

    if (tab.static) {
      search.style.display = "none";
      panel.querySelector(".table-host").innerHTML = tab.html ? tab.html() : HOW_IT_WORKS_HTML;
    } else if (tab.special) {
      search.placeholder = tab.special === "teams" ? "Filter by team…" : tab.special === "games" ? "Filter by team, date or player…" : "Filter by name…";
      search.addEventListener("input", () => {
        specialState[tab.key].filter = search.value;
        if (specialState[tab.key].mode === "list") renderSpecialPanel(tab.key);
      });
      if ((tab.key !== "home" && tab.key !== "leaderboards") || activeTab === tab.key) renderSpecialPanel(tab.key);   // the nightly cards and the leaderboard boards load only when that tab is the page you land on or open
    } else {
      const host = panel.querySelector(".table-host");
      host.innerHTML = renderTable(tab, "");
      search.addEventListener("input", () => { host.innerHTML = renderTable(tab, search.value); });
    }
  });

  updateLiveTabBadge();
  const meta = S().meta || {};
  document.getElementById("season-tag").textContent = `${meta.games || "?"} games · ${meta.start || ""} → ${meta.end || ""}`;
  selectTab(activeTab);
}

function selectTab(key) {
  activeTab = key;
  TABS.forEach(t => {
    document.getElementById("tabbtn-" + t.key).setAttribute("aria-selected", t.key === key ? "true" : "false");
    document.getElementById("panel-" + t.key).classList.toggle("active", t.key === key);
  });
  if (key === "home" && !document.querySelector("#panel-home .home-tile")) renderHome();
  if (key === "leaderboards" && !document.querySelector("#panel-leaderboards .lb-part")) renderSpecialPanel("leaderboards");
  renderTicker();
  try { localStorage.setItem("shiftscore-tab", key); } catch (e) {}
  syncUrl();
  if (window.scrollY > 200) window.scrollTo({ top: 0 });
}

// --- Hover definitions. Only stats whose name doesn't explain itself get one (Adjusted vs Raw, xGF%, QoC...); GP, G, A, TOI
// and the like don't. Column headings and player-card labels are matched by name after each render, so every table gets them.
const TIP_AVG = "A per-game average over the season. ";
const TIP_RAW = "Game Score as it came: points for goals, assists, shots, blocks, faceoffs and penalties, plus how the team did while he was on the ice (shot attempts, goals, expected goals). No adjustments.";
const TIP_ADJ = "Raw Game Score plus credit for tougher opponents (QoC), minus the average for his position, so 0 is a typical forward or defenseman. This is the number to compare players on.";
const TIP_UNIT = "Unit Score counts what the unit earned and allowed over the time it was together: expected goals and goals, plus shot attempts for lines, pairs and penalty-kill units. Positive is a good night.";
const TIP_DANGER = (band, rule) => `${band} danger: shots on goal ${rule} (low under 7%, medium 7–14%, high 14%+), from the shot-quality model. HDCF / HDGF style counts are chances for and goals that went in.`;
const GLOSSARY = {
  "raw": TIP_RAW, "game score": TIP_RAW, "game score*": TIP_RAW,
  "avg raw": TIP_AVG + TIP_RAW, "avg game score": TIP_AVG + TIP_RAW, "game score (avg)": TIP_AVG + TIP_RAW,
  "adjusted": TIP_ADJ, "avg adjusted": TIP_AVG + TIP_ADJ, "avg adj": TIP_AVG + TIP_ADJ, "adjusted impact (avg)": TIP_AVG + TIP_ADJ,
  "qoc": "Quality of competition: the average rating of the opposing skaters he shared the ice with that night, weighted by time on ice. Higher means a tougher night, and earns Adjusted credit.",
  "qot": "Quality of teammates: the same measure for the players he skated with. Shown for context only; it is not part of Adjusted.",
  "ixg": "Individual expected goals: the combined chance of scoring on the shots he took, from the shot-quality model (distance, angle, shot type, rebounds, rush).",
  "total ixg": "Individual expected goals over the season: the combined chance of scoring on the shots he took, from the shot-quality model.",
  "ixg / 60": "Individual expected goals per 60 minutes: the chance of scoring on his own shots, as a rate.",
  "g - ixg": "Goals minus ixG. Positive means he scored more than his shot quality predicts (finishing luck or skill); negative, fewer.",
  "goals − ixg": "Goals minus ixG. Positive means he scored more than his shot quality predicts (finishing luck or skill); negative, fewer.",
  "xg": "Expected goals: how many goals the quality of a team's shots would normally produce. A better measure of the chances than the shot count. On game pages, cards and the Home scoreboard a team's xG counts shots on goal only; season tables and per-player on-ice numbers count every unblocked attempt, so they run higher.",
  "xgf": "Expected goals for: the scoring chances created while on the ice, counted by shot quality.",
  "xga": "Expected goals against: the scoring chances allowed while on the ice, counted by shot quality.",
  "xgf%": "Share of all expected goals (for plus against) that went the team's way while on the ice. Above 50% means better chances than the other side.",
  "xgf–xga": "Expected goals for minus expected goals against.",
  "xgf / 60": "Expected goals for per 60 minutes on the ice.",
  "xga / 60": "Expected goals against per 60 minutes on the ice.",
  "cf%": "Share of all shot attempts (on goal, missed and blocked) that went the team's way while on the ice. Above 50% means more of the play.",
  "hdcf%": "Share of all high-danger shots on goal (14%+ chance to score) that went the team's way while on the ice.",
  "expected goals (xgf%)": "Share of all expected goals (for plus against) that went the team's way. Above 50% means better chances than the other side.",
  "shot attempts (cf%)": "Share of all shot attempts (on goal, missed and blocked) that went the team's way. Above 50% means more of the play.",
  "high-danger chances (hdcf%)": "Share of all high-danger shots on goal (14%+ chance to score) that went the team's way.",
  "shots on goal (sf%)": "Share of all shots on goal that went the team's way.",
  "expected goals for per game": "Expected goals for per game: the scoring chances the team creates, counted by shot quality rather than just goals.",
  "expected goals against per game": "Expected goals against per game: the scoring chances the team allows, counted by shot quality.",
  "pdo": "Shooting percentage plus save percentage at 5v5. 100 is average; far from 100 is mostly luck and tends to drift back.",
  "oz start %": "Share of his shifts that began in the offensive zone (against the defensive zone). Higher means easier starting spots.",
  "gsax": "Goals saved above expected: the chance each shot on goal he faced had of scoring (from the shot-quality model), added up, minus the goals he actually allowed. Positive means he stopped more than an average goalie would have on the same shots.",
  "grade": "Start grade from goals saved above expected in the game: Great is more than +1.5, Quality +0.5 to +1.5, Average within 0.5, Bad \u22120.5 to \u22121.5, Blown worse than \u22121.5.",
  "hd": TIP_DANGER("High", "with a 14% or better chance of scoring") + " Shown as shots for\u2013against.",
  "md": TIP_DANGER("Medium", "with a 7\u201314% chance of scoring") + " Shown as shots for\u2013against.",
  "ld": TIP_DANGER("Low", "with under a 7% chance of scoring") + " Shown as shots for\u2013against.",
  "a1": "Primary assists: the last pass before a goal.", "a2": "Secondary assists: the pass before the primary assist.",
  "sog": "Shots on goal (saves plus goals).", "soga": "Shots on goal against.", "pp goals": "Power-play goals for\u2013against.",
  "d pair": "The defense pair with the best Unit Score that night (at least 3:00 together).",
  "forward line": "The forward line with the best Unit Score that night (at least 3:00 together).",
  "power rating": "How many goals per game better than an average team this one has been: 75% expected-goal difference per game plus 25% goal difference per game.",
  "last 10": "Record over the last ten games.", "w-l-otl": "Wins, regulation losses and overtime or shootout losses.",
  "unit score": TIP_UNIT, "avg / gm": "Average Unit Score per game. " + TIP_UNIT,
  "rating / 60": "Unit Score per 60 minutes together, pulled toward zero for units with little ice time (a rate over a few dozen minutes is mostly luck).",
  "per 60": "Unit Score per 60 minutes together, pulled toward zero for units with little ice time (a rate over a few dozen minutes is mostly luck).",
  "raw / 60": "Unit Score per 60 minutes together, without the pull toward zero.",
  "high": TIP_DANGER("High", "with a 14% or better chance of scoring"),
  "medium": TIP_DANGER("Medium", "with a 7–14% chance of scoring"),
  "low": TIP_DANGER("Low", "with under a 7% chance of scoring"),
  "high danger hdcf / hdgf": TIP_DANGER("High", "with a 14% or better chance of scoring"),
  "medium danger mdcf / mdgf": TIP_DANGER("Medium", "with a 7–14% chance of scoring"),
  "low danger ldcf / ldgf": TIP_DANGER("Low", "with under a 7% chance of scoring"),
};
// The glossary page: the same definitions as the hover text, grouped. Entries are [term, definition].
function glossaryHtml() {
  const G = (k) => GLOSSARY[k];
  const groups = [
    ["Game Score", [
      ["Raw Game Score", G("raw")], ["Adjusted Game Score", G("adjusted")],
      ["Avg Raw / Avg Adjusted", "The per-game average of Raw or Adjusted Game Score over the season. A good Adjusted average is about +0.5 or better."],
      ["QoC", G("qoc")], ["QoT", G("qot")],
      ["Position average", "Defensemen produce less of what Game Score counts, so each position is measured against its own average, and 0 is an average forward's or defenseman's game."],
    ]],
    ["Shot quality", [
      ["xG (expected goals)", G("xg")], ["ixG", G("ixg")], ["G − ixG", G("g - ixg")],
      ["Shot danger bands", "Every shot on goal is graded by its chance of scoring: High is 14% or better, Medium 7–14%, Low under 7%. HDCF / MDCF / LDCF are chances for each band; the ending A means against."],
      ["xGF / xGA", G("xgf") + " " + G("xga")],
    ]],
    ["Shares and luck", [
      ["CF%", G("cf%")], ["xGF%", G("xgf%")], ["HDCF%", G("hdcf%")], ["SF%", G("shots on goal (sf%)")], ["PDO", G("pdo")], ["OZ start %", G("oz start %")],
      ["Per 60", "A rate per 60 minutes of ice time, so players with different playing time can be compared."],
    ]],
    ["Goalies", [
      ["GSAx", G("gsax")], ["Start grade", G("grade")],
      ["Stolen win", "A Great or Quality game in a win when the team was out-chanced by a goal or more in expected goals."],
      ["Bailed out", "A Bad or Blown game by the goalie in a win."], ["Relief", "Another goalie started the game and faced more shots."],
    ]],
    ["Teams", [
      ["Power rating", "How many goals per game better than an average team this one has been: 75% its expected-goal difference per game plus 25% its goal difference per game."],
      ["Last 10", "The team's record over its last ten games."],
    ]],
    ["Lines, pairs and special teams", [
      ["Unit Score", G("unit score")], ["Rating / 60", G("rating / 60")], ["Raw / 60", G("raw / 60")],
      ["Good night or bad night", "A power play or penalty kill judged on the chances it created or allowed against what the league's average unit does in the same time, whatever the score says."],
    ]],
  ];
  return `<div class="gloss">${groups.map(([title, items]) => `<div class="detail-h3">${title}</div>
    <dl>${items.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join("")}</dl>`).join("")}</div>
    <div class="panel-caption">More on how the scores are built is on the How It Works tab.</div>`;
}
const termKey = (t) => t.replace(/[▾▴▲▼]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
function annotateTerms(root) {
  root.querySelectorAll("th:not([data-tip]), .pc-row > .pc-label:not([data-tip]), .tt-label:not([data-tip]), .sr-l:not([data-tip])").forEach(el => {
    const tip = GLOSSARY[termKey(el.textContent)];
    if (tip) { el.setAttribute("data-tip", tip); el.classList.add("has-tip"); }
  });
}
let termQueued = false;
const termObserver = new MutationObserver(() => {
  if (termQueued) return;
  termQueued = true;
  requestAnimationFrame(() => { termQueued = false; annotateTerms(document.getElementById("panels")); });
});
const tipBox = document.createElement("div");
tipBox.className = "def-tip"; tipBox.setAttribute("role", "tooltip"); tipBox.hidden = true;
document.body.appendChild(tipBox);
let tipFor = null, tipTimer = null;
function showTip(el) {
  tipFor = el; tipBox.textContent = el.getAttribute("data-tip"); tipBox.hidden = false;
  const r = el.getBoundingClientRect(), w = tipBox.offsetWidth, h = tipBox.offsetHeight;
  let x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  let y = r.bottom + 8;
  if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 8);
  tipBox.style.left = x + "px"; tipBox.style.top = y + "px";
}
function hideTip() { tipBox.hidden = true; tipFor = null; clearTimeout(tipTimer); }
document.addEventListener("pointerover", (ev) => {
  if (ev.pointerType === "touch") return;
  const el = ev.target.closest && ev.target.closest("[data-tip]");
  if (el) showTip(el); else if (tipFor) hideTip();
});
document.addEventListener("pointerdown", (ev) => {      // on a phone a tap shows the definition for a few seconds
  const el = ev.pointerType === "touch" && ev.target.closest && ev.target.closest("[data-tip]");
  if (el) { showTip(el); clearTimeout(tipTimer); tipTimer = setTimeout(hideTip, 4500); } else if (tipFor) hideTip();
});
window.addEventListener("scroll", () => { if (tipFor && !tipBox.hidden) hideTip(); }, { passive: true });

function initSeasonSelect() {
  const sel = document.getElementById("season-select");
  sel.innerHTML = DATA.seasons.map(s => `<option value="${s.id}">${s.label}${s.in_progress ? " (in progress)" : ""}</option>`).join("");
  sel.value = SEASON;
  sel.addEventListener("change", () => {
    SEASON = sel.value;
    try { localStorage.setItem("shiftscore-season", SEASON); } catch (e) {}
    specialState = freshState();
    buildPage();
  });
}

// Color theme: light unless a visitor picks Dark or Auto (follow the device) with the button in the header (remembered on this device).
(function () {
  const KEY = "shiftscore-theme", btn = document.getElementById("theme-toggle"), modes = ["light", "dark", "auto"];
  const label = { auto: "◐ Auto", light: "☀ Light", dark: "☾ Dark" };
  let mode = "light";
  try { mode = localStorage.getItem(KEY) || "light"; } catch (e) {}
  if (!modes.includes(mode)) mode = "light";
  function apply() {
    if (mode === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", mode);
    if (btn) { btn.textContent = label[mode]; btn.setAttribute("aria-label", `Color theme: ${mode}. Click to change.`); }
  }
  if (btn) btn.addEventListener("click", () => {
    mode = modes[(modes.indexOf(mode) + 1) % modes.length];
    try { localStorage.setItem(KEY, mode); } catch (e) {}
    apply();
  });
  apply();
})();

initSeasonSelect();
imageObserver.observe(document.getElementById("panels"), { childList: true, subtree: true });
termObserver.observe(document.getElementById("panels"), { childList: true, subtree: true });
initLive();

// --- Addresses. The page's address always names what is on screen, so any game, player, team or unit can be linked to, and the
// back button steps back through where you have been. Forms: #games, #game/<id>/<home>, #player/<id>/<team>, #team/<ABBR>,
// #unit/<key>/<team>; a query adds the season (s=), a section (sec=) or a game tab (tab=).
let routeReady = false, pendingGameTab = null;
function routeOf() {
  const t = activeTab, st = specialState[t] || {}, q = [];
  let path = t;
  if (t === "games" && st.mode === "detail" && st.gameId) {
    path = `game/${st.gameId}/${st.home}`;
    const host = document.querySelector("#panel-games .table-host"), tab = pendingGameTab || (host && host._gvState && host._gvState.tab);
    if (tab && tab !== "summary") q.push("tab=" + tab);
  } else if ((t === "skaters" || t === "goalies") && st.mode === "detail" && st.playerId) {
    path = `player/${st.playerId}/${st.teamAbbrev}`;
    if (st.sec && st.sec !== "overview") q.push("sec=" + st.sec);
  } else if (t === "teams" && st.mode === "detail" && st.abbrev) {
    path = `team/${st.abbrev}`;
    if (st.sec && st.sec !== "overview") q.push("sec=" + st.sec);
  } else if (t === "teams" && st.mode === "unit" && st.unitKey) {
    path = `unit/${st.unitKey}/${st.abbrev}`;
  } else if (t === "home" && LIVE.selected !== null) {
    q.push("live=" + LIVE.selected);                       // a live game open on Home is a page of its own for the Back button
  }
  if (DATA.default && SEASON !== DATA.default) q.push("s=" + SEASON);
  return path + (q.length ? "?" + q.join("&") : "");
}
// Each page the app pushes onto the browser history carries its position in this visit (i, 0 for the page you landed on) and where it was scrolled to
// (y), so the Back buttons can tell whether there is an earlier page of the site to return to, and Back puts you back where you were on the page.
let navIndex = 0, navLock = false, replaceNextSync = false;   // navLock: a page is being rebuilt for a season switch, so its in-between states aren't history entries;   // replaceNextSync: the next address change swaps the current history entry (switching sections or tabs within a page isn't a new page)
function syncUrl(replace) {
  if (navLock) return;
  if (replaceNextSync) { replace = true; replaceNextSync = false; }
  const hash = "#" + routeOf();
  if (location.hash === hash) return;
  try {
    if (routeReady && !replace) {
      history.replaceState({ i: navIndex, y: window.scrollY }, "");      // remember where this page was scrolled to
      navIndex += 1;
      history.pushState({ i: navIndex, y: 0 }, "", hash);
    } else history.replaceState({ i: navIndex, y: 0 }, "", hash);
  } catch (e) {}
}
// read an address into the page's state (before the panels are built, or when the back button is used); returns true if the season changed
function applyRoute(h) {
  const [path, qs = ""] = String(h || "").replace(/^#/, "").split("?"), q = new URLSearchParams(qs), seg = path.split("/");
  let seasonChanged = false;
  // a link to a game, player, team or unit names its season: the address says so, or the game id does (2026020256 is 2026-27), or it is the
  // current season; the season you last looked at doesn't decide what a shared link shows
  const detail = ["game", "player", "team", "unit"].includes(seg[0]);
  let want = q.get("s") || (seg[0] === "game" && /^\d{10}$/.test(seg[1] || "") ? `${seg[1].slice(0, 4)}${Number(seg[1].slice(0, 4)) + 1}` : detail ? DATA.default : null);
  if (!want && routeReady) want = DATA.default;   // stepping back to an address without a season means the current season
  if (want && DATA.by_season[want] && want !== SEASON) {
    SEASON = want; seasonChanged = true;
    try { localStorage.setItem("shiftscore-season", SEASON); } catch (e) {}
    document.getElementById("season-select").value = SEASON;
    specialState = freshState();
  }
  const sec = q.get("sec");
  if (seg[0] === "game" && seg[1] && seg[2]) {
    activeTab = "games"; Object.assign(specialState.games, { mode: "detail", gameId: seg[1], home: seg[2] }); pendingGameTab = q.get("tab") || "summary";
  } else if (seg[0] === "player" && seg[1] && seg[2]) {
    const goalie = (S().goalies || []).some(g => String(g.pid) === String(seg[1])), tab = goalie ? "goalies" : "skaters";
    activeTab = tab; Object.assign(specialState[tab], { mode: "detail", playerId: seg[1], teamAbbrev: seg[2], sec: sec || "overview", allUnits: false });
  } else if (seg[0] === "team" && seg[1]) {
    activeTab = "teams"; Object.assign(specialState.teams, { mode: "detail", abbrev: seg[1], sec: sec || "overview", allUnits: false });
  } else if (seg[0] === "unit" && seg[1] && seg[2]) {
    activeTab = "teams"; Object.assign(specialState.teams, { mode: "unit", abbrev: seg[2], unitKey: seg[1] });
  } else {
    const key = HASH_ALIAS[seg[0]] || seg[0];
    if (TABS.some(t => t.key === key)) {
      activeTab = key;
      if (key === "home" && routeReady) {                     // stepping to or from an open live game (not on first load: the live feed isn't connected yet)
        const want = Number(q.get("live")) || null;
        if (LIVE.selected !== want) {
          LIVE.selected = want;
          if (!want) { if (LIVE.unsubGame) { LIVE.unsubGame(); LIVE.unsubGame = null; } LIVE.view = null; }
        }
      }
      // a bare tab address shows that tab's list
      const st = specialState[key];
      if (st && st.mode && st.mode !== "list" && routeReady) st.mode = "list";
    }
  }
  return seasonChanged;
}
window.addEventListener("popstate", async () => {
  const st = history.state, y = (st && st.y) || 0;
  navIndex = st && typeof st.i === "number" ? st.i : 0;
  const restore = () => { window.scrollTo(0, y); setTimeout(() => { if (Math.abs(window.scrollY - y) > 8) window.scrollTo(0, y); }, 350); };   // twice: some pages fill in after they open
  if (applyRoute(location.hash)) { buildPage(); restore(); return; }
  selectTab(activeTab);
  if (specialState[activeTab] && TABS.find(t => t.key === activeTab).special) await renderSpecialPanel(activeTab);
  restore();
});
// Copy link, and the section chips on player pages
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
  try {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); return ok;
  } catch (e) { return false; }
}
document.addEventListener("click", async (ev) => {
  const cl = ev.target.closest("[data-copy-link]");
  if (cl) {
    const ok = await copyText(location.href);
    cl.textContent = ok ? "Link copied" : "Couldn't copy";
    if (!ok) { try { window.prompt("Copy this link", location.href); } catch (e) {} }
    setTimeout(() => { cl.textContent = "Copy link"; }, 2000);
    return;
  }
  if (ev.target.closest("[data-save-pcard]")) { savePctCard(); return; }
  const oddsView = ev.target.closest("[data-odds-view]");
  if (oddsView) { specialState.odds.view = oddsView.dataset.oddsView; renderSpecialPanel("odds"); return; }
  const ptm = ev.target.closest("[data-player-tm]");
  if (ptm) {
    // a traded player: all his teams combined, or one team (the page loads that team's file so its lines and pairs are the ones shown)
    const tab = activeTab === "goalies" ? "goalies" : "skaters", keep = window.scrollY, t = ptm.dataset.playerTm;
    specialState[tab].tm = t; replaceNextSync = true;
    if (t !== "all") specialState[tab].teamAbbrev = t;
    renderSpecialPanel(tab).then(() => window.scrollTo(0, keep));
    return;
  }
  const ps = ev.target.closest("[data-player-sec]");
  if (ps) {
    const tab = activeTab === "goalies" ? "goalies" : "skaters", keep = window.scrollY;
    specialState[tab].sec = ps.dataset.playerSec; replaceNextSync = true;
    renderSpecialPanel(tab).then(() => window.scrollTo(0, keep));
  }
});


// Back buttons on a game, player, team or unit page: when this visit has an earlier page of the site, they step back to it (the same as the browser's
// Back button, so a player opened from a game returns to the game and Back never loops); otherwise they go to the list they name ("All Skaters").
const IN_PAGE_BACK = ".back-btn[data-back], .back-btn[data-live-back], .back-btn[data-open-team]";
document.addEventListener("click", (ev) => {
  const b = ev.target.closest(IN_PAGE_BACK);
  if (!b || navIndex <= 0 || b.hasAttribute("data-all-units")) return;
  ev.preventDefault(); ev.stopImmediatePropagation();
  history.back();
}, true);
function relabelBackButtons() {
  document.querySelectorAll(IN_PAGE_BACK).forEach(b => {
    if (b.dataset.orig === undefined) b.dataset.orig = b.innerHTML;
    const want = navIndex > 0 ? "\u2190 Back" : b.dataset.orig;   // the character itself, not "&larr;": innerHTML hands the entity back as the character, and a mismatch would rewrite the button forever
    if (b.innerHTML !== want) b.innerHTML = want;
  });
}
try { new MutationObserver(relabelBackButtons).observe(document.getElementById("panels"), { childList: true, subtree: true }); } catch (e) {}

const HASH_ALIAS = { players: "skaters", live: "home" };   // links from before the tabs were reorganized
applyRoute(location.hash);
buildPage();
routeReady = true;
syncUrl();
if (!history.state) { try { history.replaceState({ i: 0, y: 0 }, ""); } catch (e) {} }
