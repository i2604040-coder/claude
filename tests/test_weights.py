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
