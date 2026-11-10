import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.metrics import r2_score

from .game_info import game_results

# Full set pulled from player_game_stats — kept broad so the dataset-building
# step doesn't need to change if the predictive feature set below changes.
COMPONENTS = [
    "goals", "primary_assists", "secondary_assists", "shots", "blocks",
    "faceoff_wins", "faceoff_losses", "penalties_drawn", "penalties_taken",
    "cf_5v5", "ca_5v5", "gf_5v5", "ga_5v5", "ixg", "xgf_5v5", "xga_5v5",
]

# Predicted Value (PV) answers: "given this player's recent form, how well will
# THEY do over their next 5 games?" — a ridge regression of each player's own
# next-5-game average Game Score on recency-weighted (EWMA) averages of their
# earlier games' stats. Applying those weights to a single game's stats gives
# that game's PV: the forecast that performance implies.
#
# Design notes (each was tested on held-out data, see METHODOLOGY.md):
# - A team-level version (predict the TEAM's next-5-game goal differential)
#   was tried first. It can't tell a star from his team: a star on a weak team
#   inherits the team's bad on-ice xGA, and including QoT made it worse (QoT
#   mostly proxies team quality), pushing e.g. Bedard to ~611th of 612. Its
#   R^2 was ~0.12-0.14 because 5-game team results are mostly luck.
# - The player-level target is far more stable (R^2 ~0.40) and treats a good
#   player on a bad team fairly: his own production and shot volume drive his
#   forecast, not his team's results.
# - gf/ga/ixg are left out of the inputs — they overlap heavily with xGF/xGA
#   and made coefficients swing and flip sign with the regularization strength.
# - QoT enters as `qot_team_rel` (teammate quality minus the TOI-weighted
#   average QoT of the player's whole team that night), NOT raw QoT. Raw QoT is
#   mostly "how good is my team", so it would penalize good players on bad teams;
#   team-relative QoT measures deployment (playing with better or worse
#   linemates than the rest of the roster), which is a legitimate context signal.
#   QoC enters as-is — opposing strength is mostly the schedule, not the team.
PRIOR_SPAN = 10  # EWMA span in games; spans 5-15 land within ~0.01 R^2 of each other
RIDGE_ALPHA = 500.0
FORECAST_WINDOW = 5

PREDICTIVE_BASE_COMPONENTS = [
    "goals", "primary_assists", "secondary_assists", "shots", "blocks",
    "faceoff_wins", "faceoff_losses", "penalties_drawn", "penalties_taken",
    "cf_5v5", "ca_5v5", "xgf_5v5", "xga_5v5",
]
PREDICTIVE_COMPONENTS = PREDICTIVE_BASE_COMPONENTS + ["qoc_centered", "qot_team_rel"]


def _player_game_rows(conn) -> pd.DataFrame:
    cols = ", ".join(f"pgs.{c}" for c in COMPONENTS)
    rows = conn.execute(
        f"""SELECT pgs.player_id, pgs.game_id, pgs.team_id, gm.game_date, pgs.toi_sec, {cols}
            FROM player_game_stats pgs JOIN games gm ON gm.game_id = pgs.game_id"""
    ).fetchall()
    df = pd.DataFrame(rows, columns=["player_id", "game_id", "team_id", "game_date", "toi_sec"] + COMPONENTS)

    impact_rows = conn.execute(
        "SELECT player_id, game_id, raw_game_score, qoc, qot, qoc_baseline, qot_baseline FROM player_game_impact"
    ).fetchall()
    impact_df = pd.DataFrame(
        impact_rows, columns=["player_id", "game_id", "raw_game_score", "qoc", "qot", "qoc_baseline", "qot_baseline"]
    )
    # centered against each opponent/teammate's OWN position-average baseline
    # (impact.py), not a single league-wide number — see strength.py
    impact_df["qoc_centered"] = impact_df["qoc"] - impact_df["qoc_baseline"]
    impact_df["qot_centered"] = impact_df["qot"] - impact_df["qot_baseline"]

    df = df.merge(
        impact_df[["player_id", "game_id", "raw_game_score", "qoc_centered", "qot_centered"]], on=["player_id", "game_id"]
    )
    # team-relative QoT: this player's teammate quality minus the TOI-weighted
    # average over the whole team that night (see the design notes above)
    w = df["toi_sec"].fillna(0)
    df["_w"], df["_wq"] = w, df["qot_centered"] * w
    team = df.groupby(["game_id", "team_id"])[["_w", "_wq"]].transform("sum")
    team_mean = (team["_wq"] / team["_w"]).where(team["_w"] > 0, 0.0)
    df["qot_team_rel"] = df["qot_centered"] - team_mean
    return df.drop(columns=["_w", "_wq"])


def _prior_rolling_avg(df: pd.DataFrame, value_cols: list[str]) -> pd.DataFrame:
    """Recency-weighted (EWMA, span PRIOR_SPAN) average of all STRICTLY EARLIER
    games per player (shift(1) excludes the current row from its own average);
    the first 3 games of a player's history give no value (min_periods). Returns a DataFrame of
    just the `{col}_prior` columns, index-aligned with df (groupby().apply()
    returns a MultiIndex that doesn't align with df's index on its own, which
    previously caused a silent all-NaN concat — droplevel+reindex fixes it)."""
    grouped = df.groupby("player_id")[value_cols]
    prior = grouped.apply(lambda g: g.ewm(span=PRIOR_SPAN, min_periods=3).mean().shift(1))
    prior.index = prior.index.droplevel(0)
    prior = prior.loc[df.index]
    prior.columns = [f"{c}_prior" for c in value_cols]
    return prior


def build_team_game_dataset(conn) -> pd.DataFrame:
    """Predictors are each team's players' PRIOR-games rolling average of
    each component (not this game's own stats) — predicting this game's
    outcome from recent form instead of from itself. Using same-game stats
    as predictors of same-game goal differential is tautological: on-ice
    gf_5v5/ga_5v5 and goals are themselves just goal events restated, so a
    same-game regression perfectly "predicts" goals from goals (verified:
    it produced R²=1.0 with the goals coefficient collapsing to 0, the
    signature of that circularity)."""
    df = _player_game_rows(conn)
    df = df.sort_values(["player_id", "game_date", "game_id"])

    value_cols = COMPONENTS + ["qoc_centered", "qot_centered"]
    prior = _prior_rolling_avg(df, value_cols)
    prior_cols = list(prior.columns)

    df = pd.concat([df[["player_id", "game_id", "team_id", "game_date"]], prior], axis=1)
    df = df.dropna(subset=prior_cols)

    team_df = df.groupby(["game_id", "team_id"])[prior_cols].sum().reset_index()

    results = game_results(conn)  # official scores: shootout goals are not goals
    games = conn.execute("SELECT game_id, home_team_id, game_date FROM games").fetchall()
    home_team, date_by_game = {}, {}
    for game_id, home_id, game_date in games:
        home_team[game_id] = home_id
        date_by_game[game_id] = game_date

    def goal_diff(row):
        # team_id/game_id can get upcast to float by the pandas groupby/concat
        # pipeline above (e.g. 1 -> 1.0), which silently breaks dict lookups
        # against the int-keyed tables — cast explicitly rather than rely on
        # dtypes staying consistent through the pipeline
        game_id, team_id = int(row.game_id), int(row.team_id)
        res = results[game_id]
        return res["home"] - res["away"] if home_team[game_id] == team_id else res["away"] - res["home"]

    team_df["goal_diff"] = team_df.apply(goal_diff, axis=1)
    team_df["game_date"] = team_df["game_id"].map(date_by_game)
    team_df = team_df.sort_values(["team_id", "game_date", "game_id"])

    # Smoothed target: this team's average goal differential over its NEXT
    # `window` games (not this single noisy game) — a single game's outcome
    # has huge random variance, which made the fitted coefficients unstable
    # and sign-flipping even under heavy regularization (verified: alpha
    # swept from 10 to 10000 and several coefficients kept flipping sign or
    # growing instead of converging — a regularization-strength problem would
    # stabilize with more alpha; this didn't, meaning the target itself was
    # too noisy, not the regularization). Averaging over several future games
    # is the standard fix for this in sports analytics.
    window = 5
    team_df["future_goal_diff"] = (
        team_df.groupby("team_id")["goal_diff"].transform(lambda s: s.rolling(window).mean().shift(-window))
    )
    team_df = team_df.dropna(subset=["future_goal_diff"])

    return team_df.sort_values("game_date")


def fit_team_level_weights(conn, alpha: float = RIDGE_ALPHA) -> dict:
    """(Superseded by the player-level fit_predictive_weights; kept for comparison.)
    Fits weights for the team-level forecast: how well a player's
    own-game component stats, run through these weights, forecast their
    team's performance over its NEXT 5 games. Reports an honest held-out R²
    from a chronological train/test split, then refits on the full dataset
    for the weights actually used (standard practice: evaluate on a held-out
    split, deploy a model trained on everything).

    This is NOT the same thing as gamescore.WEIGHTS, which is a descriptive
    "how good was this performance" stat (goals rightly dominate). These
    weights answer a different question — forecasting, not description — and
    on this data goals carry almost no independent predictive weight once
    xGF/xGA are included (a known, legitimate finding in hockey analytics:
    shot quality predicts future results better than goals, which are
    noisier/luck-affected short-term)."""
    df = build_team_game_dataset(conn)
    prior_cols = [f"{c}_prior" for c in PREDICTIVE_BASE_COMPONENTS]

    split_idx = int(len(df) * 0.8)
    train_df, test_df = df.iloc[:split_idx], df.iloc[split_idx:]

    eval_model = Ridge(alpha=alpha)
    eval_model.fit(train_df[prior_cols], train_df["future_goal_diff"])
    preds = eval_model.predict(test_df[prior_cols])
    test_r2 = r2_score(test_df["future_goal_diff"], preds)

    final_model = Ridge(alpha=alpha)
    final_model.fit(df[prior_cols], df["future_goal_diff"])
    weights = {k: round(v, 4) for k, v in zip(PREDICTIVE_BASE_COMPONENTS, final_model.coef_)}

    return {
        "weights": weights,
        "test_r2": test_r2,
        "n_train": len(train_df),
        "n_test": len(test_df),
        "n_total": len(df),
        "alpha": alpha,
    }


def build_player_forecast_dataset(conn) -> pd.DataFrame:
    """One row per (skater, game): that player's recency-weighted averages over
    their EARLIER games (never the current one) as predictors, and their own
    average Game Score over their NEXT FORECAST_WINDOW games as the target.
    Games with no shift data have no Game Score and are skipped."""
    df = _player_game_rows(conn)
    pos = dict(conn.execute("SELECT player_id, position FROM players").fetchall())
    df = df[(df["player_id"].map(pos) != "G") & df["raw_game_score"].notna()]
    df = df.sort_values(["player_id", "game_date", "game_id"])
    prior = _prior_rolling_avg(df, PREDICTIVE_COMPONENTS)
    df = pd.concat([df[["player_id", "game_id", "game_date", "raw_game_score"]], prior], axis=1)
    df["future_score"] = df.groupby("player_id")["raw_game_score"].transform(
        lambda s: s.rolling(FORECAST_WINDOW).mean().shift(-FORECAST_WINDOW)
    )
    return df.dropna().sort_values("game_date")


def fit_predictive_weights(conn, alpha: float = RIDGE_ALPHA) -> dict:
    """Ridge fit of the player-level forecast (see the design notes at the top).
    Reports held-out R^2 from a chronological 80/20 split, then refits on
    everything for the weights actually used."""
    df = build_player_forecast_dataset(conn)
    prior_cols = [f"{c}_prior" for c in PREDICTIVE_COMPONENTS]
    split = int(len(df) * 0.8)
    train, test = df.iloc[:split], df.iloc[split:]

    model = Ridge(alpha=alpha).fit(train[prior_cols], train["future_score"])
    test_r2 = r2_score(test["future_score"], model.predict(test[prior_cols]))
    final = Ridge(alpha=alpha).fit(df[prior_cols], df["future_score"])
    return {
        "weights": {k: round(v, 4) for k, v in zip(PREDICTIVE_COMPONENTS, final.coef_)},
        "test_r2": test_r2,
        "n_train": len(train), "n_test": len(test), "n_total": len(df), "alpha": alpha,
    }


def predicted_value(stats: dict, weights: dict) -> float:
    return sum(weights.get(k, 0) * stats.get(k, 0) for k in weights)


def build_player_impact_dataset(conn, window: int = 5) -> pd.DataFrame:
    """One row per (player, game) with that game's raw_game_score/QoC/QoT
    (centered against each opponent/teammate's own position-average baseline,
    same as impact.py — see strength.league_avg_rating_by_position) and the
    player's own average raw_game_score over their NEXT `window` games. No
    tautology risk here the way the team-level same-game regression had: the
    target is a DIFFERENT player's-own-future set of games, not a re-encoding
    of this game's own events."""
    rows = conn.execute(
        "SELECT player_id, game_id, game_date, raw_game_score, qoc, qot, qoc_baseline, qot_baseline "
        "FROM player_game_impact"
    ).fetchall()
    df = pd.DataFrame(
        rows,
        columns=["player_id", "game_id", "game_date", "raw_game_score", "qoc", "qot", "qoc_baseline", "qot_baseline"],
    )
    df["qoc_centered"] = df["qoc"] - df["qoc_baseline"]
    df["qot_centered"] = df["qot"] - df["qot_baseline"]

    df = df.sort_values(["player_id", "game_date", "game_id"])
    df["future_raw_score"] = df.groupby("player_id")["raw_game_score"].transform(
        lambda s: s.rolling(window).mean().shift(-window)
    )
    df = df.dropna(subset=["future_raw_score"])
    return df.sort_values("game_date")


def fit_qoc_qot_weights(conn, alpha: float = 10.0) -> dict:
    """Fits QOC_WEIGHT/QOT_WEIGHT the same way fit_predictive_weights fits
    Game Score: predict a player's own future performance (not this game's
    stats) from this game's raw_game_score, QoC, and QoT, then read off the
    fitted ratio of QoC's/QoT's coefficient to raw_game_score's — same
    rescale-to-an-anchor convention as gamescore.WEIGHTS."""
    df = build_player_impact_dataset(conn)
    predictors = ["raw_game_score", "qoc_centered", "qot_centered"]

    split_idx = int(len(df) * 0.8)
    train_df, test_df = df.iloc[:split_idx], df.iloc[split_idx:]

    eval_model = Ridge(alpha=alpha)
    eval_model.fit(train_df[predictors], train_df["future_raw_score"])
    preds = eval_model.predict(test_df[predictors])
    test_r2 = r2_score(test_df["future_raw_score"], preds)

    final_model = Ridge(alpha=alpha)
    final_model.fit(df[predictors], df["future_raw_score"])
    coefs = dict(zip(predictors, final_model.coef_))
    anchor = coefs["raw_game_score"]

    return {
        "qoc_weight": round(coefs["qoc_centered"] / anchor, 4) if anchor else None,
        "qot_weight": round(-coefs["qot_centered"] / anchor, 4) if anchor else None,
        "raw_coefs": coefs,
        "test_r2": test_r2,
        "n_train": len(train_df),
        "n_test": len(test_df),
        "n_total": len(df),
        "alpha": alpha,
    }


def apply_predicted_value(conn, weights: dict) -> None:
    """PV for every skater-game that has shift data: weights x that game's own
    stats (same components the weights were fit on, including team-relative QoT).
    Goalies and no-shift games get NULL."""
    df = _player_game_rows(conn)
    pos = dict(conn.execute("SELECT player_id, position FROM players").fetchall())
    df = df[(df["player_id"].map(pos) != "G") & df["raw_game_score"].notna()]
    pv = sum(df[k] * v for k, v in weights.items())
    conn.execute("UPDATE player_game_stats SET predicted_value = NULL")
    conn.executemany(
        "UPDATE player_game_stats SET predicted_value = ? WHERE game_id = ? AND player_id = ?",
        [(float(v), int(g), int(p)) for v, g, p in zip(pv, df["game_id"], df["player_id"])],
    )
    conn.commit()
