import io
import json

import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from app import data
from app.analysis import Params, analyze, detect_signals, attach_flow, compute_indicators
from app.backtest import score_samples, signal_events, summarize, stats
from app.data import demo_data, fetch_investor_flow
from app.main import app


def flat_df(days=120, price=10000.0, vol=100_000, seed=0):
    idx = pd.bdate_range("2026-01-01", periods=days)
    rng = np.random.default_rng(seed)
    c = price * (1 + rng.normal(0, 0.003, days)).cumprod()
    return pd.DataFrame({"Open": c, "High": c * 1.005, "Low": c * 0.995, "Close": c,
                         "Volume": vol * rng.uniform(0.9, 1.1, days)}, index=idx)


def flow_for(df, smart_per_day):
    return pd.DataFrame({"Foreign": smart_per_day / 2, "Organ": smart_per_day / 2,
                         "Individual": -smart_per_day, "ForeignHold": np.linspace(10, 11, len(df))},
                        index=df.index)


def test_smart_money_signal_and_flow_score():
    df = flat_df()
    # 매일 거래량의 15%를 기관+외국인이 순매수, 주가는 횡보
    res = analyze(df, flow=flow_for(df, 15_000.0))
    assert any(s.type == "smart_money" for s in res.signals)
    flow_item = next(b for b in res.breakdown if b.key == "flow")
    assert flow_item.score == flow_item.max_score
    assert res.summary["flow"]["smart_ratio_20"] > 0.1

    sold = analyze(df, flow=flow_for(df, -15_000.0))
    assert not any(s.type == "smart_money" for s in sold.signals)
    assert sold.score < res.score


def test_score_is_normalized_to_100_with_flow():
    df = demo_data()
    res = analyze(df, flow=flow_for(df, 1e9))
    assert 0 <= res.score <= 100
    assert sum(b.max_score for b in res.breakdown) == 120


def test_no_flow_keeps_previous_behaviour():
    df = demo_data()
    assert analyze(df).score == analyze(df, flow=None).score
    assert "flow" not in {b.key for b in analyze(df).breakdown}


def test_signals_are_causal():
    """dry_up 외의 신호는 이후 데이터를 잘라내도 똑같이 나와야 백테스트가 유효하다."""
    df = demo_data()
    p = Params()
    full = {(s.date, s.type) for s in detect_signals(compute_indicators(df, p), p) if s.type != "dry_up"}
    cut = df.index[180].strftime("%Y-%m-%d")
    part = {(s.date, s.type) for s in detect_signals(compute_indicators(df.iloc[:181], p), p) if s.type != "dry_up"}
    assert {x for x in full if x[0] <= cut} == part


def test_signal_event_forward_returns():
    df = flat_df()
    d = 60
    df.iloc[d, df.columns.get_loc("Volume")] = 600_000  # 흡수형 매집봉
    df.iloc[d + 5:, [0, 1, 2, 3]] *= 1.10              # 5일 뒤 10% 상승
    events, base = signal_events(df, Params())
    ev = next(e for e in events if e["type"] == "absorption")
    assert ev["date"] == df.index[d].strftime("%Y-%m-%d")
    assert abs(ev["r5"] - 0.10) < 0.03
    assert len(base) == len(df) - Params().vol_ma


def test_score_samples_match_point_in_time_analysis():
    df = demo_data()
    p = Params()
    samples = score_samples(df, p, step=40)
    s = samples[1]
    t = df.index.get_loc(pd.Timestamp(s["date"]))
    assert s["score"] == analyze(df.iloc[:t + 1], p).score
    assert samples[-1]["r20"] is None or len(df) - t > 20


def test_summarize_excess_vs_baseline():
    events = [{"type": "absorption", "r5": 0.05, "r10": 0.05, "r20": 0.05, "mae20": -0.01}]
    base = [{"r5": 0.01, "r10": 0.01, "r20": 0.01}] * 10
    samples = [{"score": 75, "r5": 0.02, "r10": 0.02, "r20": 0.02}]
    r = summarize(events, base, samples)
    assert abs(r["by_signal"][0]["r20"]["excess"] - 0.04) < 1e-9
    assert r["by_score"][0]["count"] == 1
    assert stats([None, 1.0, -1.0])["win_rate"] == 0.5


def test_fetch_investor_flow_parses_and_pages(monkeypatch):
    data._FLOW_CACHE.clear()
    days = pd.bdate_range("2026-01-01", periods=100)[::-1]

    def page(rows):
        return [{"bizdate": d.strftime("%Y%m%d"), "foreignerPureBuyQuant": "+1,000",
                 "organPureBuyQuant": "-200", "individualPureBuyQuant": "-800",
                 "foreignerHoldRatio": "12.5%"} for d in rows]

    calls = []

    def fake_urlopen(req, timeout=0):
        calls.append(req.full_url)
        rows = days[:60] if "bizdate" not in req.full_url else days[59:100]
        return io.BytesIO(json.dumps(page(rows)).encode())

    monkeypatch.setattr(data.urllib.request, "urlopen", fake_urlopen)
    f = fetch_investor_flow("005930", 90)
    assert len(calls) == 2 and len(f) == 100 and f.index.is_unique
    assert f["Foreign"].iloc[0] == 1000 and f["Organ"].iloc[0] == -200 and f["ForeignHold"].iloc[0] == 12.5
    fetch_investor_flow("005930", 60)  # 캐시 사용
    assert len(calls) == 2
    assert fetch_investor_flow("AAPL") is None


def test_api_backtest_demo():
    client = TestClient(app)
    r = client.post("/api/backtest", json={"tickers": ["demo"], "range": "1y"})
    assert r.status_code == 200
    body = r.json()
    assert body["by_signal"] and body["score_history"] and body["baseline"]["r20"]["n"] > 0
    r = client.post("/api/backtest", json={"tickers": ["demo", "demo"], "range": "1y"})
    assert r.status_code == 200 and len(r.json()["tickers"]) == 1
