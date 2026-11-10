import os

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import log_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OrdinalEncoder

from .shot_features import extract_game_shot_rows

# Shot location/type, game context, and — new — what happened just before the
# shot (see shot_features.py): the previous event's type, how long ago, how far
# the puck traveled and from where, and for rebounds how far the goalie had to
# move. Deliberately NOT included: shooter or goalie identity. xG here means
# "how dangerous was this chance", and putting a shooter's finishing history
# or a goalie's save history in it would hand each player credit for their own
# skill inside the baseline that goals-above-expected and GSAx are measured
# against (a goalie model that includes the goalie would make GSAx ~0 by design).
NUMERIC_FEATURES = [
    "distance", "angle", "is_rebound", "is_rush", "score_diff",
    "own_skaters", "opp_skaters", "own_goalie", "opp_goalie",
    "prev_gap", "prev_dist", "prev_dy", "prev_same_team", "prev_net_dist", "prev_net_angle",
    "rebound_dy", "rebound_angle_change",
]
CATEGORICAL_FEATURES = ["shot_type", "strength_state", "prev_type"]
ALL_FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES

# DANGER BANDS (October 2026). A "chance" is a shot on goal, so its danger is the probability that a shot ON GOAL becomes
# a goal, P(goal | shot on goal), from a second gradient-boosted model (danger_model.joblib) trained on shots on goal only
# with the same inputs as the xG model. (xG is P(goal | unblocked attempt), which includes the chance of missing the net,
# so it understates how dangerous a shot that did reach the goalie was.) Cutoffs: low under 9%, medium 9-16%, high 16%+.
# Clear Sight Analytics defines low as 8.99% or less and high as 20%+ by the historical average of each hand-tagged
# shot TYPE (passes, screens, rush); the NHL play-by-play has none of those tags, so a single shot's probability here is
# less sharp than their type average. Fitting the high cutoff against three Clear Sight reports (two games and Flyers'
# first six of 2026-27) put it at 16%: that reproduces their high / mid / low counts (for example Flyers against 61 / 41 /
# 114 here vs 57 / 42 / 110 theirs), where a literal 20% gave 32 / 70 / 114. See METHODOLOGY.md, "Shot danger".
LOW_DANGER_MAX = 0.09
MEDIUM_DANGER_MAX = 0.16
DANGER_MODEL_PATH = "models/danger_model.joblib"
_danger_pipeline = None


def danger_bucket(prob: float) -> str:
    if prob < LOW_DANGER_MAX:
        return "low"
    if prob < MEDIUM_DANGER_MAX:
        return "medium"
    return "high"


def train_danger(df: pd.DataFrame, model_path: str = DANGER_MODEL_PATH) -> dict:
    """Fit P(goal | shot on goal) on shot rows (extract_game_shot_rows format, with is_goal). Chronological 80/20 check,
    then refit on everything and save."""
    d = df[(df["on_goal"] == 1) & (df["opp_goalie"] == 1)]
    cut = int(len(d) * 0.8)
    pipe = build_pipeline().fit(_features(d.iloc[:cut]), d.iloc[:cut]["is_goal"])
    p = pipe.predict_proba(_features(d.iloc[cut:]))[:, 1]
    metrics = {"n": len(d), "test_auc": roc_auc_score(d.iloc[cut:]["is_goal"], p), "test_log_loss": log_loss(d.iloc[cut:]["is_goal"], p),
               "base_rate": float(d["is_goal"].mean())}
    final = build_pipeline().fit(_features(d), d["is_goal"])
    os.makedirs(os.path.dirname(model_path) or ".", exist_ok=True)
    joblib.dump(final, model_path)
    global _danger_pipeline
    _danger_pipeline = None
    return metrics


def predict_danger(rows: list[dict]) -> list[float]:
    """P(goal | shot on goal) for each shot-attempt row; used for the danger band of shots on goal."""
    global _danger_pipeline
    if not rows:
        return []
    if _danger_pipeline is None:
        _danger_pipeline = joblib.load(DANGER_MODEL_PATH)
    return list(_danger_pipeline.predict_proba(_features(pd.DataFrame(rows)))[:, 1])


def build_dataset(conn) -> pd.DataFrame:
    game_ids = [r[0] for r in conn.execute("SELECT game_id FROM games ORDER BY game_date").fetchall()]
    rows = []
    for gid in game_ids:
        rows.extend(extract_game_shot_rows(conn, gid))
    return pd.DataFrame(rows)


def build_pipeline() -> Pipeline:
    # histogram gradient boosting handles missing values natively (a rebound
    # feature is simply missing for a non-rebound) and native categoricals;
    # unseen categories at scoring time become "missing" instead of erroring
    preprocess = ColumnTransformer(
        [("cat", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=np.nan), CATEGORICAL_FEATURES)],
        remainder="passthrough",
    )
    model = HistGradientBoostingClassifier(
        max_iter=400, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=50,
        l2_regularization=1.0, categorical_features=list(range(len(CATEGORICAL_FEATURES))), random_state=0,
    )
    return Pipeline([("preprocess", preprocess), ("model", model)])


def _features(df: pd.DataFrame) -> pd.DataFrame:
    X = df[ALL_FEATURES].copy()
    for c in NUMERIC_FEATURES:
        X[c] = pd.to_numeric(X[c], errors="coerce")  # None -> NaN
    return X


def calibration_table(y_true, y_pred, bins: int = 10) -> list[dict]:
    """Mean predicted vs actual goal rate by prediction decile — the check
    that "0.20 xG" shots really go in ~20% of the time."""
    d = pd.DataFrame({"y": np.asarray(y_true), "p": np.asarray(y_pred)})
    d["bin"] = pd.qcut(d["p"], bins, duplicates="drop")
    g = d.groupby("bin", observed=True).agg(n=("y", "size"), predicted=("p", "mean"), actual=("y", "mean"))
    return [{"predicted": round(r.predicted, 4), "actual": round(r.actual, 4), "n": int(r.n)} for r in g.itertuples()]


def train(conn, model_path: str = "models/xg_model.joblib") -> dict:
    df = build_dataset(conn)
    if len(df) < 500:
        raise ValueError(f"only {len(df)} labeled shots available — need more ingested games first")

    # chronological split (earlier games train, later games test) rather than
    # a random split, so the eval reflects generalizing forward in time
    # instead of leaking future-game patterns into training. The saved model is
    # then refit on everything.
    split_idx = int(len(df) * 0.8)
    train_df, test_df = df.iloc[:split_idx], df.iloc[split_idx:]

    eval_pipe = build_pipeline().fit(_features(train_df), train_df["is_goal"])
    preds = eval_pipe.predict_proba(_features(test_df))[:, 1]
    metrics = {
        "n_train": len(train_df),
        "n_test": len(test_df),
        "test_auc": roc_auc_score(test_df["is_goal"], preds),
        "test_log_loss": log_loss(test_df["is_goal"], preds),
        "test_base_rate": test_df["is_goal"].mean(),
        "calibration": calibration_table(test_df["is_goal"], preds),
    }

    final = build_pipeline().fit(_features(df), df["is_goal"])
    os.makedirs(os.path.dirname(model_path) or ".", exist_ok=True)
    joblib.dump(final, model_path)
    return metrics


def load(model_path: str = "models/xg_model.joblib") -> Pipeline:
    return joblib.load(model_path)


def predict_xg(pipeline: Pipeline, rows: list[dict]) -> list[float]:
    """rows: feature dicts as produced by shot_features.extract_game_shot_rows."""
    if not rows:
        return []
    return list(pipeline.predict_proba(_features(pd.DataFrame(rows)))[:, 1])
