import json

from app import analysis
from app.analysis import LEGACY_WEIGHTS, Params, analyze
from app.data import demo_data


def test_custom_weights_change_score_and_items():
    df = demo_data()
    only_base = analyze(df, Params(weights={"base": 10}))
    assert [b.key for b in only_base.breakdown] == ["base"]
    assert only_base.score == round(only_base.summary["components"]["base"] * 100, 1)
    legacy = analyze(df, Params(weights=LEGACY_WEIGHTS))
    assert {b.key for b in legacy.breakdown} == set(LEGACY_WEIGHTS) - {"flow"}


def test_zero_weight_items_hidden():
    res = analyze(demo_data(), Params(weights={**LEGACY_WEIGHTS, "avwap": 0}))
    assert "avwap" not in {b.key for b in res.breakdown}


def test_components_are_normalized():
    comps = analyze(demo_data()).summary["components"]
    assert comps and all(0 <= v <= 1 for v in comps.values())


def test_load_weights_file_and_fallback(tmp_path, monkeypatch):
    f = tmp_path / "w.json"
    f.write_text(json.dumps({"weights": {"obv": 50, "cmf": 50}}))
    monkeypatch.setattr(analysis, "WEIGHTS_FILE", f)
    analysis.load_weights.cache_clear()
    try:
        assert analysis.load_weights() == {"obv": 50, "cmf": 50}
        monkeypatch.setattr(analysis, "WEIGHTS_FILE", tmp_path / "missing.json")
        analysis.load_weights.cache_clear()
        assert analysis.load_weights() == LEGACY_WEIGHTS
    finally:
        analysis.load_weights.cache_clear()


def _entry_df(days_ago: int):
    import numpy as np
    import pandas as pd
    idx = pd.bdate_range("2026-01-01", periods=120)
    c = 10000 * (1 + np.random.default_rng(1).normal(0, 0.003, 120)).cumprod()
    df = pd.DataFrame({"Open": c, "High": c * 1.005, "Low": c * 0.995, "Close": c, "Volume": 100_000.0}, index=idx)
    i = len(df) - 1 - days_ago
    o = df["Close"].iloc[i - 1]
    df.iloc[i] = [o, o * 1.09, o * 0.99, o * 1.085, 800_000.0]
    df.iloc[i + 1:, :4] *= 1.085
    return df


def test_adopted_weights_reward_fresh_entry_and_decay():
    v2 = Params(weights={"entry_recent": 60, "base": 10, "avwap": 10, "cmf": 10, "flow": 10, "smart_recent": -20})
    fresh = analyze(_entry_df(1), v2).summary["components"]["entry_recent"]
    old = analyze(_entry_df(8), v2).summary["components"]["entry_recent"]
    stale = analyze(_entry_df(15), v2).summary["components"]["entry_recent"]
    assert fresh > old > 0 and stale == 0


def test_negative_weight_is_penalty_and_score_clipped():
    df = demo_data()
    comps = analyze(df, Params(weights={"base": 10})).summary["components"]
    assert comps["base"] > 0
    res = analyze(df, Params(weights={"base": 10, "dry_up": -1000}))
    penalty = next(b for b in res.breakdown if b.key == "dry_up")
    assert penalty.max_score < 0 and penalty.score <= 0
    assert res.score == (0.0 if comps["dry_up"] > 0 else round(comps["base"] * 100, 1))
