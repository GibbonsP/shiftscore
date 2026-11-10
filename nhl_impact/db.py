import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS games (
    game_id INTEGER PRIMARY KEY,
    season TEXT,
    game_date TEXT,
    home_team_id INTEGER,
    away_team_id INTEGER,
    home_team_abbrev TEXT,
    away_team_abbrev TEXT
);

CREATE TABLE IF NOT EXISTS players (
    player_id INTEGER PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    position TEXT,
    shoots TEXT  -- 'L' | 'R', from the NHL player record (fetch_handedness.py); orders defense pairs LD then RD
);

CREATE TABLE IF NOT EXISTS shifts (
    game_id INTEGER,
    player_id INTEGER,
    team_id INTEGER,
    period INTEGER,
    start_sec INTEGER,
    end_sec INTEGER
);
CREATE INDEX IF NOT EXISTS idx_shifts_game ON shifts(game_id);

CREATE TABLE IF NOT EXISTS events (
    game_id INTEGER,
    event_id INTEGER,
    period INTEGER,
    time_sec INTEGER,
    type TEXT,
    team_id INTEGER,
    situation_code TEXT,
    home_defending_side TEXT,  -- 'left' | 'right' — which side the HOME team defends this play
    details_json TEXT,
    PRIMARY KEY (game_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_events_game ON events(game_id);

CREATE TABLE IF NOT EXISTS player_game_stats (
    game_id INTEGER,
    player_id INTEGER,
    team_id INTEGER,
    goals INTEGER DEFAULT 0,
    primary_assists INTEGER DEFAULT 0,
    secondary_assists INTEGER DEFAULT 0,
    shots INTEGER DEFAULT 0,
    blocks INTEGER DEFAULT 0,
    penalties_taken INTEGER DEFAULT 0,
    penalties_drawn INTEGER DEFAULT 0,
    faceoff_wins INTEGER DEFAULT 0,
    faceoff_losses INTEGER DEFAULT 0,
    cf_5v5 INTEGER DEFAULT 0,
    ca_5v5 INTEGER DEFAULT 0,
    gf_5v5 INTEGER DEFAULT 0,
    ga_5v5 INTEGER DEFAULT 0,
    cf_all INTEGER DEFAULT 0,    -- same on-ice Corsi/goals, but every situation (5v5+PP+PK),
    ca_all INTEGER DEFAULT 0,    -- not just 5v5 — matches how sites like MoneyPuck report
    gf_all INTEGER DEFAULT 0,    -- "All Situations" on-ice stats
    ga_all INTEGER DEFAULT 0,
    ixg REAL DEFAULT 0,          -- individual expected goals from own shots
    xgf_5v5 REAL DEFAULT 0,      -- on-ice expected goals for/against at 5v5
    xga_5v5 REAL DEFAULT 0,
    hdcf_5v5 INTEGER DEFAULT 0,  -- on-ice high/medium/low-danger shots for/against at 5v5
    hdca_5v5 INTEGER DEFAULT 0,
    mdcf_5v5 INTEGER DEFAULT 0,
    mdca_5v5 INTEGER DEFAULT 0,
    ldcf_5v5 INTEGER DEFAULT 0,
    ldca_5v5 INTEGER DEFAULT 0,
    xgf_all REAL DEFAULT 0,      -- same xG/danger stats, all situations
    xga_all REAL DEFAULT 0,
    hdcf_all INTEGER DEFAULT 0,
    hdca_all INTEGER DEFAULT 0,
    mdcf_all INTEGER DEFAULT 0,
    mdca_all INTEGER DEFAULT 0,
    ldcf_all INTEGER DEFAULT 0,
    ldca_all INTEGER DEFAULT 0,
    hits INTEGER DEFAULT 0,
    takeaways INTEGER DEFAULT 0,
    giveaways INTEGER DEFAULT 0,
    giveaways_dzone INTEGER DEFAULT 0,
    pim INTEGER DEFAULT 0,
    missed_shots INTEGER DEFAULT 0,   -- fenwick (unblocked attempts) = shots + missed_shots
    shifts INTEGER DEFAULT 0,
    oz_starts INTEGER DEFAULT 0,      -- shifts starting off an offensive-zone faceoff
    dz_starts INTEGER DEFAULT 0,
    nz_starts INTEGER DEFAULT 0,
    fly_starts INTEGER DEFAULT 0,     -- shifts starting on the fly (no faceoff)
    ixg_rebound REAL DEFAULT 0,       -- ixg specifically from rebound shots
    rebounds_created INTEGER DEFAULT 0,  -- own shots that led to a rebound chance (not the rebound shot itself)
    ixg_adjusted REAL DEFAULT 0,      -- ixg with flurry discount (rebound shots) and score-state
                                       -- normalization applied — see adjustments.py
    toi_sec INTEGER DEFAULT 0,
    raw_game_score REAL,
    predicted_value REAL DEFAULT 0,   -- forecast-calibrated stat: how well this game's
                                       -- stats predict the player's team's next 5 games
                                       -- (see calibrate.py) — a different question from
                                       -- raw_game_score's "how good was this performance"
    PRIMARY KEY (game_id, player_id)
);

CREATE TABLE IF NOT EXISTS player_game_impact (
    game_id INTEGER,
    player_id INTEGER,
    game_date TEXT,
    raw_game_score REAL,
    qoc REAL,
    qot REAL,
    qoc_baseline REAL,  -- position-mix-weighted expected rating for the opponents actually
                         -- faced (not one global league average — see strength.py)
    qot_baseline REAL,  -- same, for the teammates actually played with
    adjusted_impact REAL,
    PRIMARY KEY (game_id, player_id)
);

CREATE TABLE IF NOT EXISTS unit_game_stats (
    game_id INTEGER,
    team_id INTEGER,
    unit_type TEXT,     -- 'line' | 'pair' | 'pp' | 'pk'
    player_ids TEXT,    -- sorted comma-joined player IDs, e.g. "8478483,8479318"
    toi_sec INTEGER DEFAULT 0,
    cf INTEGER DEFAULT 0,
    ca INTEGER DEFAULT 0,
    gf INTEGER DEFAULT 0,
    ga INTEGER DEFAULT 0,
    xgf REAL DEFAULT 0,
    xga REAL DEFAULT 0,
    hdcf INTEGER DEFAULT 0,
    hdca INTEGER DEFAULT 0,
    mdcf INTEGER DEFAULT 0,
    mdca INTEGER DEFAULT 0,
    ldcf INTEGER DEFAULT 0,
    ldca INTEGER DEFAULT 0,
    xgf_adjusted REAL DEFAULT 0,  -- xgf/xga with flurry + score-state adjustment — see adjustments.py
    xga_adjusted REAL DEFAULT 0,
    unit_score REAL,
    PRIMARY KEY (game_id, team_id, unit_type, player_ids)
);

-- the same unit numbers split by period (1-4; the game recap's period filter and overtime section read this).
-- unit_game_stats keeps the full-game totals every other consumer uses.
CREATE TABLE IF NOT EXISTS unit_period_stats (
    game_id INTEGER,
    team_id INTEGER,
    unit_type TEXT,
    player_ids TEXT,
    period INTEGER,
    toi_sec INTEGER DEFAULT 0,
    cf INTEGER DEFAULT 0, ca INTEGER DEFAULT 0, gf INTEGER DEFAULT 0, ga INTEGER DEFAULT 0,
    xgf REAL DEFAULT 0, xga REAL DEFAULT 0,
    hdcf INTEGER DEFAULT 0, hdca INTEGER DEFAULT 0, mdcf INTEGER DEFAULT 0, mdca INTEGER DEFAULT 0,
    ldcf INTEGER DEFAULT 0, ldca INTEGER DEFAULT 0,
    unit_score REAL,
    PRIMARY KEY (game_id, team_id, unit_type, player_ids, period)
);

CREATE TABLE IF NOT EXISTS goalie_game_stats (
    game_id INTEGER,
    goalie_id INTEGER,
    team_id INTEGER,
    shots_faced INTEGER DEFAULT 0,  -- shots on goal faced (saves + goals allowed)
    goals_allowed INTEGER DEFAULT 0,
    xga REAL DEFAULT 0,             -- expected goals against, from the same shot-quality model
    gsax REAL DEFAULT 0,            -- goals saved above expected = xga - goals_allowed
    PRIMARY KEY (game_id, goalie_id)
);
"""


def connect(path: str = "nhl_impact.db") -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    # lightweight self-migration: CREATE TABLE IF NOT EXISTS won't add a
    # column to a table created before that column existed
    migrations = [
        "ALTER TABLE players ADD COLUMN shoots TEXT",
        "ALTER TABLE events ADD COLUMN home_defending_side TEXT",
        "ALTER TABLE player_game_stats ADD COLUMN ixg REAL DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN xgf_5v5 REAL DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN xga_5v5 REAL DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN hdcf_5v5 INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN hdca_5v5 INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN mdcf_5v5 INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN mdca_5v5 INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN ldcf_5v5 INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN ldca_5v5 INTEGER DEFAULT 0",
        "ALTER TABLE unit_game_stats ADD COLUMN xgf REAL DEFAULT 0",
        "ALTER TABLE unit_game_stats ADD COLUMN xga REAL DEFAULT 0",
        "ALTER TABLE unit_game_stats ADD COLUMN hdcf INTEGER DEFAULT 0",
        "ALTER TABLE unit_game_stats ADD COLUMN hdca INTEGER DEFAULT 0",
        "ALTER TABLE unit_game_stats ADD COLUMN mdcf INTEGER DEFAULT 0",
        "ALTER TABLE unit_game_stats ADD COLUMN mdca INTEGER DEFAULT 0",
        "ALTER TABLE unit_game_stats ADD COLUMN ldcf INTEGER DEFAULT 0",
        "ALTER TABLE unit_game_stats ADD COLUMN ldca INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN hits INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN takeaways INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN giveaways INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN giveaways_dzone INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN pim INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN missed_shots INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN shifts INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN oz_starts INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN dz_starts INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN nz_starts INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN fly_starts INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN ixg_rebound REAL DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN rebounds_created INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN predicted_value REAL DEFAULT 0",
        "ALTER TABLE player_game_impact ADD COLUMN qoc_baseline REAL",
        "ALTER TABLE player_game_impact ADD COLUMN qot_baseline REAL",
        "ALTER TABLE player_game_stats ADD COLUMN cf_all INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN ca_all INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN gf_all INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN ga_all INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN xgf_all REAL DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN xga_all REAL DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN hdcf_all INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN hdca_all INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN mdcf_all INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN mdca_all INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN ldcf_all INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN ldca_all INTEGER DEFAULT 0",
        "ALTER TABLE player_game_stats ADD COLUMN ixg_adjusted REAL DEFAULT 0",
        "ALTER TABLE unit_game_stats ADD COLUMN xgf_adjusted REAL DEFAULT 0",
        "ALTER TABLE unit_game_stats ADD COLUMN xga_adjusted REAL DEFAULT 0",
    ]
    for stmt in migrations:
        try:
            conn.execute(stmt)
            conn.commit()
        except sqlite3.OperationalError:
            pass  # column already exists
    return conn
