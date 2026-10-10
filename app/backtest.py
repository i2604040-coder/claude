"""매집 신호·점수 백테스트.

- 신호 백테스트: 각 신호 발생일 종가에 매수했다고 보고 N거래일 뒤 수익률을 집계.
- 점수 백테스트: 과거 각 시점까지의 데이터만으로 매집 점수를 다시 계산(미래 데이터 미사용)하고
  점수 구간별 이후 수익률을 집계.
- 비교 기준(baseline): 같은 종목·같은 기간의 '아무 날이나 샀을 때' 수익률.
  신호의 가치는 절대 수익률이 아니라 이 기준 대비 초과분으로 판단해야 한다.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .analysis import SIGNAL_LABELS, Params, analyze, attach_flow, compute_indicators, detect_signals, normalize_ohlcv

HORIZONS = (5, 10, 20)
SCORE_BUCKETS = [(70, 101, "70 이상"), (50, 70, "50~70"), (30, 50, "30~50"), (0, 30, "30 미만")]
# dry_up은 마지막 봉에서만 판정되므로(미래 데이터 의존 없음과 별개로 과거 시점 재현 불가) 신호 백테스트에서 제외
BACKTEST_TYPES = [t for t in SIGNAL_LABELS if t != "dry_up"]


def forward_returns(close: np.ndarray, i: int) -> dict:
    out = {}
    for h in HORIZONS:
        out[f"r{h}"] = float(close[i + h] / close[i] - 1) if i + h < len(close) else None
    return out


def stats(values: list[float]) -> dict:
    arr = np.array([v for v in values if v is not None and np.isfinite(v)], dtype=float)
    if len(arr) == 0:
        return {"n": 0, "mean": None, "median": None, "win_rate": None}
    return {
        "n": int(len(arr)),
        "mean": float(arr.mean()),
        "median": float(np.median(arr)),
        "win_rate": float((arr > 0).mean()),
    }


def signal_events(df: pd.DataFrame, p: Params, flow: pd.DataFrame | None = None, ticker: str = "") -> tuple[list[dict], list[dict]]:
    """(신호 이벤트 목록, 전체 거래일 기준 baseline 표본)."""
    df = normalize_ohlcv(df)
    ind = attach_flow(compute_indicators(df, p), flow)
    sigs = [s for s in detect_signals(ind, p) if s.type in BACKTEST_TYPES]
    close = ind["Close"].to_numpy(dtype=float)
    low = ind["Low"].to_numpy(dtype=float)
    pos = {d: i for i, d in enumerate(ind.index.strftime("%Y-%m-%d"))}

    events = []
    for s in sigs:
        i = pos[s.date]
        ev = {"ticker": ticker, "date": s.date, "type": s.type, "label": s.label,
              "price": s.price, **forward_returns(close, i)}
        # 20일 내 최대 낙폭(진입가 대비 최저가)
        seg = low[i + 1:i + 21]
        ev["mae20"] = float(seg.min() / close[i] - 1) if len(seg) else None
        events.append(ev)

    base = [{"ticker": ticker, **forward_returns(close, i)} for i in range(p.vol_ma, len(close))]
    return events, base


def score_samples(df: pd.DataFrame, p: Params, flow: pd.DataFrame | None = None, step: int = 5, ticker: str = "") -> list[dict]:
    """과거 시점별 매집 점수(그 시점까지의 데이터만 사용) + 이후 수익률."""
    df = normalize_ohlcv(df)
    close = df["Close"].to_numpy(dtype=float)
    start = max(p.lookback + p.vol_ma, 60)
    out = []
    for t in range(start, len(df), step):
        res = analyze(df.iloc[:t + 1], p, flow)
        out.append({"ticker": ticker, "date": df.index[t].strftime("%Y-%m-%d"),
                    "score": res.score, "close": float(close[t]), **forward_returns(close, t)})
    return out


def summarize(events: list[dict], base: list[dict], samples: list[dict]) -> dict:
    baseline = {f"r{h}": stats([b[f"r{h}"] for b in base]) for h in HORIZONS}

    def excess(st: dict, h: int) -> float | None:
        b = baseline[f"r{h}"]["mean"]
        return None if st["mean"] is None or b is None else st["mean"] - b

    by_signal = []
    for typ in BACKTEST_TYPES:
        evs = [e for e in events if e["type"] == typ]
        if not evs:
            continue
        row = {"type": typ, "label": SIGNAL_LABELS[typ], "count": len(evs)}
        for h in HORIZONS:
            st = stats([e[f"r{h}"] for e in evs])
            row[f"r{h}"] = {**st, "excess": excess(st, h)}
        row["mae20"] = stats([e["mae20"] for e in evs])["mean"]
        by_signal.append(row)

    by_score = []
    for lo, hi, label in SCORE_BUCKETS:
        ss = [s for s in samples if lo <= s["score"] < hi]
        row = {"bucket": label, "count": len(ss)}
        for h in HORIZONS:
            st = stats([s[f"r{h}"] for s in ss])
            row[f"r{h}"] = {**st, "excess": excess(st, h)}
        by_score.append(row)

    return {"horizons": list(HORIZONS), "baseline": baseline, "by_signal": by_signal, "by_score": by_score}
