import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.analysis import Params, analyze, normalize_ohlcv, result_to_json
from app.data import candidate_symbols, demo_data, parse_csv
from app.main import app


def flat_df(days=80, price=10000.0, vol=100_000):
    idx = pd.bdate_range("2026-01-01", periods=days)
    rng = np.random.default_rng(0)
    c = price * (1 + rng.normal(0, 0.003, days)).cumprod()
    return pd.DataFrame({
        "Open": c, "High": c * 1.005, "Low": c * 0.995, "Close": c,
        "Volume": vol * rng.uniform(0.9, 1.1, days),
    }, index=idx)


def test_absorption_candle_detected():
    df = flat_df()
    d = df.index[60]
    df.loc[d, ["Open", "Close"]] = [df.loc[d, "Close"], df.loc[d, "Close"] * 1.005]
    df.loc[d, "Volume"] = 600_000  # 6배, 등락 0.5%
    res = analyze(df)
    types = {(s.date, s.type) for s in res.signals}
    assert (d.strftime("%Y-%m-%d"), "absorption") in types


def test_entry_candle_detected():
    df = flat_df()
    d = df.index[50]
    o = df.loc[d, "Close"]
    df.loc[d, ["Open", "High", "Low", "Close", "Volume"]] = [o, o * 1.09, o * 0.99, o * 1.085, 800_000]
    res = analyze(df)
    assert any(s.type == "entry" and s.date == d.strftime("%Y-%m-%d") for s in res.signals)


def test_lower_tail_detected():
    df = flat_df()
    d = df.index[55]
    o = df.loc[d, "Close"]
    df.loc[d, ["Open", "High", "Low", "Close", "Volume"]] = [o, o * 1.004, o * 0.93, o * 1.003, 250_000]
    res = analyze(df)
    assert any(s.type == "lower_tail" and s.date == d.strftime("%Y-%m-%d") for s in res.signals)


def test_quiet_stock_has_no_spike_signals():
    res = analyze(flat_df())
    assert not [s for s in res.signals if s.type in ("entry", "absorption", "lower_tail")]
    assert res.score < 50


def test_demo_scores_higher_than_quiet_stock():
    demo = analyze(demo_data())
    quiet = analyze(flat_df(250))
    assert demo.score > quiet.score
    assert demo.score >= 50
    assert demo.summary["estimated_cost"] is not None
    assert 0 <= demo.score <= 100
    assert abs(sum(b.score for b in demo.breakdown) - demo.score) < 0.5


def test_too_short_data_rejected():
    with pytest.raises(ValueError):
        analyze(flat_df(10))


def test_korean_columns_and_csv():
    csv = "날짜,시가,고가,저가,종가,거래량\n" + "\n".join(
        f"2026-01-{i + 1:02d},100,105,95,{100 + i % 3},\"1,000\"" for i in range(31)
    )
    df = parse_csv(csv.encode("cp949"))
    norm = normalize_ohlcv(df)
    assert list(norm.columns) == ["Open", "High", "Low", "Close", "Volume"]
    assert norm["Volume"].iloc[0] == 1000


def test_json_has_no_nan():
    out = result_to_json(analyze(demo_data()))
    import json
    json.dumps(out, allow_nan=False)
    assert len(out["series"]["dates"]) == len(out["series"]["close"])


def test_candidate_symbols():
    assert candidate_symbols("005930") == ["005930.KS", "005930.KQ"]
    assert candidate_symbols("aapl") == ["AAPL"]


def test_api_demo_and_upload():
    client = TestClient(app)
    r = client.get("/api/analyze", params={"ticker": "demo"})
    assert r.status_code == 200
    body = r.json()
    assert body["info"]["symbol"] == "DEMO" and body["signals"]

    csv = demo_data().reset_index().to_csv(index=False).encode()
    r = client.post("/api/upload", files={"file": ("x.csv", csv, "text/csv")})
    assert r.status_code == 200 and r.json()["score"] == body["score"]

    r = client.post("/api/scan", json={"tickers": ["demo"]})
    assert r.status_code == 200 and r.json()["results"][0]["score"] == body["score"]

    r = client.post("/api/upload", files={"file": ("x.csv", b"a,b\n1,2", "text/csv")})
    assert r.status_code == 400
