"""유명 매매 기법 20가지 백테스트 비교.

python -m research.techniques --market kr
python -m research.techniques --market nasdaq

방법
- 신호: 각 기법의 '매수 신호'가 처음 성립한 날(t). 데드크로스·과매수 등 매도성 신호도 '그날 샀다면'으로 동일하게 평가.
- 진입: t+1일 시가 매수(신호를 본 뒤 실제로 살 수 있는 가장 빠른 가격). 보유 H=20거래일 후 종가 청산.
- 포트폴리오: 매일 보유 중인 모든 신호 포지션을 동일비중으로 보유(달력 포트폴리오) → 신호가 겹쳐도 통계가 부풀지 않음.
  보유 종목이 없는 날은 현금(수익 0).
- 비용: 진입 시 왕복 비용 차감 (한국 0.3%, 미국 0.1%).
- 비교: 유니버스 동일가중 시장. 알파 = 전략 일수익률을 시장 일수익률에 회귀한 절편(연율), t값.
- 구간: 학습(~2024-09) / 검증(2024-10~) 각각 계산해 일관성 확인.
"""
from __future__ import annotations

import argparse
import json
import pickle
from pathlib import Path

import numpy as np
import pandas as pd

from app.analysis import Params, compute_indicators, detect_signals

from .collect import CACHE, universe_file

OUT = Path(__file__).resolve().parent / "results" / "techniques"
H = 20
SPLIT = pd.Timestamp("2024-10-01")
COST = {"kr": 0.003, "nasdaq": 0.001}


# ---------------------------------------------------------------- 데이터

def load_panel(market: str, years: str = "5y") -> dict[str, pd.DataFrame]:
    uni = pickle.loads((CACHE / universe_file(market)).read_bytes())
    frames = {}
    for u in uni:
        f = CACHE / f"px_{u['code']}_{years}.pkl"
        if not f.exists():
            continue
        df = pickle.loads(f.read_bytes())
        df = df[~df.index.duplicated(keep="last")].sort_index()
        df = df[(df["Volume"] > 0) & (df["High"] >= df["Low"])]
        if len(df) >= 300:
            frames[u["code"]] = df
    panel = {k: pd.DataFrame({c: d[k] for c, d in frames.items()}).sort_index()
             for k in ("Open", "High", "Low", "Close", "Volume")}
    return panel


# ---------------------------------------------------------------- 지표

def rsi(c: pd.DataFrame, n: int = 14) -> pd.DataFrame:
    d = c.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    return 100 - 100 / (1 + up / dn.replace(0, np.nan))


def cross_up(a: pd.DataFrame, b) -> pd.DataFrame:
    b_prev = b.shift(1) if isinstance(b, pd.DataFrame) else b
    return (a > b) & (a.shift(1) <= b_prev)


def first(cond: pd.DataFrame) -> pd.DataFrame:
    """조건이 새로 성립한 날만 True."""
    return cond & ~cond.shift(1, fill_value=False)


def techniques(p: dict) -> dict[str, tuple[str, str, pd.DataFrame]]:
    """{key: (이름, 설명, 신호 bool 행렬)}"""
    o, h, l, c, v = p["Open"], p["High"], p["Low"], p["Close"], p["Volume"]
    ma = {n: c.rolling(n).mean() for n in (5, 20, 50, 60, 120, 200)}
    r = rsi(c)
    ema12, ema26 = c.ewm(span=12, adjust=False).mean(), c.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    sig = macd.ewm(span=9, adjust=False).mean()
    sd20 = c.rolling(20).std()
    bb_up, bb_dn = ma[20] + 2 * sd20, ma[20] - 2 * sd20
    bw = (bb_up - bb_dn) / ma[20]
    lo14, hi14 = l.rolling(14).min(), h.rolling(14).max()
    k_fast = 100 * (c - lo14) / (hi14 - lo14).replace(0, np.nan)
    k_slow = k_fast.rolling(3).mean()
    d_slow = k_slow.rolling(3).mean()
    body = (c - o).abs()
    rng = (h - l).replace(0, np.nan)
    lower = np.minimum(o, c) - l
    upper = h - np.maximum(o, c)
    down = c < c.shift(1)

    t = {}
    t["gc_5_20"] = ("골든크로스 (5일·20일)", "5일선이 20일선을 상향 돌파", cross_up(ma[5], ma[20]))
    t["gc_50_200"] = ("골든크로스 (50일·200일)", "50일선이 200일선을 상향 돌파", cross_up(ma[50], ma[200]))
    t["dc_50_200"] = ("데드크로스 (50일·200일)", "50일선이 200일선을 하향 돌파 — '그날 샀다면'", cross_up(ma[200], ma[50]))
    t["align"] = ("정배열 진입", "5>20>60>120일선 정배열이 처음 성립",
                  first((ma[5] > ma[20]) & (ma[20] > ma[60]) & (ma[60] > ma[120])))
    t["rsi_30"] = ("RSI 과매도 탈출", "RSI(14)가 30을 아래에서 위로 돌파", cross_up(r, 30))
    t["rsi_70"] = ("RSI 70 돌파 (모멘텀)", "RSI(14)가 70을 위로 돌파 — 과매수 진입", cross_up(r, 70))
    t["macd_sig"] = ("MACD 시그널 돌파", "MACD가 시그널선을 상향 돌파", cross_up(macd, sig))
    t["macd_zero"] = ("MACD 0선 돌파", "MACD가 0을 상향 돌파", cross_up(macd, 0))
    t["bb_lower"] = ("볼린저 하단 반등", "전일 하단밴드 아래 → 당일 하단 위로 복귀",
                     (c > bb_dn) & (c.shift(1) < bb_dn.shift(1)))
    t["bb_upper"] = ("볼린저 상단 돌파", "종가가 상단밴드를 처음 돌파", first(c > bb_up))
    t["bb_squeeze"] = ("볼린저 스퀴즈 돌파", "밴드폭이 120일 하위 10%인 상태에서 상단 돌파",
                       first(c > bb_up) & (bw.shift(1) <= bw.shift(1).rolling(120).quantile(0.1)))
    t["high_52w"] = ("52주 신고가 돌파", "종가가 직전 252일 최고 종가를 돌파",
                     first(c > c.shift(1).rolling(252).max()))
    t["donchian_20"] = ("20일 신고가 돌파 (터틀)", "종가가 직전 20일 최고가를 돌파",
                        first(c > h.shift(1).rolling(20).max()))
    t["disparity"] = ("이격도 과대 하락", "종가가 20일선보다 10% 이상 아래로 처음 내려감",
                      first(c / ma[20] < 0.9))
    t["stoch"] = ("스토캐스틱 과매도 골든크로스", "슬로우 %K가 %D를 상향 돌파 (%D<20)",
                  cross_up(k_slow, d_slow) & (d_slow.shift(1) < 20))
    t["hammer"] = ("망치형 캔들", "5일간 5% 이상 하락 후 아래꼬리 ≥ 몸통 2배·봉의 60%",
                   (c.shift(1) / c.shift(6) - 1 < -0.05) & (lower >= 2 * body) & (lower / rng >= 0.6) & (upper <= body.clip(lower=rng * 0.05)))
    t["down3"] = ("3일 연속 하락 후 매수", "종가 3일 연속 하락한 날",
                  first(down & down.shift(1, fill_value=False) & down.shift(2, fill_value=False)))
    t["gap_up"] = ("갭상승 3%+", "시가가 전일 고가 위, 전일 종가 대비 +3% 이상",
                   (o > h.shift(1)) & (o / c.shift(1) - 1 >= 0.03))
    t["vol_spike"] = ("거래량 급증 양봉", "거래량 20일 평균 3배 + 양봉 (단순판)",
                      (v > 3 * v.shift(1).rolling(20).mean()) & (c > o))

    # 이 프로젝트의 매집 신호 (세력 진입봉, OBV 다이버전스) — app.analysis 그대로 사용
    ent = pd.DataFrame(False, index=c.index, columns=c.columns)
    obv = ent.copy()
    pr = Params()
    for code in c.columns:
        df = pd.DataFrame({k: p[k][code] for k in ("Open", "High", "Low", "Close", "Volume")}).dropna()
        if len(df) < 60:
            continue
        for s in detect_signals(compute_indicators(df, pr), pr):
            d = pd.Timestamp(s.date)
            if s.type == "entry":
                ent.at[d, code] = True
            elif s.type == "obv_divergence":
                obv.at[d, code] = True
    t["entry"] = ("세력 진입봉 (본 도구)", "거래량 3배+, 몸통 5%+ 장대양봉, 고가 근처 마감", ent)
    # 20번째: OBV 다이버전스
    t["obv_div"] = ("OBV 상승 다이버전스 (본 도구)", "20일 주가 횡보·하락, OBV 순유입 25%+", obv)
    # 데이터 없는 칸(상장 전 등) 신호 제거
    valid = c.notna() & o.notna()
    return {k: (n, d, (s.fillna(False).astype(bool) & valid)) for k, (n, d, s) in t.items()}


# ---------------------------------------------------------------- 백테스트

def backtest(p: dict, sig: pd.DataFrame, cost: float) -> dict:
    o, c = p["Open"], p["Close"]
    r_cc = (c / c.shift(1) - 1)
    r_co = (c / o - 1)                       # 진입일(t+1)은 시가→종가
    mkt = r_cc.mean(axis=1)                  # 동일가중 시장

    s = sig.astype(float)
    entry = s.shift(1).fillna(0)             # t+1에 진입
    held = sum(s.shift(k).fillna(0) for k in range(1, H + 1))   # t+1..t+H 보유
    cont = held - entry                      # 진입일 외 보유분
    n = held.sum(axis=1)
    gross = ((entry * r_co).fillna(0).sum(axis=1) + (cont * r_cc).fillna(0).sum(axis=1)) / n.replace(0, np.nan)
    costs = entry.sum(axis=1) * cost / n.replace(0, np.nan)
    port = (gross - costs).fillna(0)         # 보유 없는 날 = 현금
    invested = n > 0

    # 이벤트 단위 (t+1 시가 → t+H 종가)
    fwd = c.shift(-H) / o.shift(-1) - 1
    mkt_fwd = (c.shift(-H) / o.shift(-1) - 1).mean(axis=1)
    ev = (fwd.sub(mkt_fwd, axis=0))[sig].stack().dropna() if sig.values.any() else pd.Series(dtype=float)
    ev_raw = fwd[sig].stack().dropna() if sig.values.any() else pd.Series(dtype=float)

    def stats(mask) -> dict:
        pr, mk, inv = port[mask], mkt[mask].fillna(0), invested[mask]
        if inv.sum() < 20:
            return {"days": int(inv.sum())}
        x = mk[inv]
        y = pr[inv]
        beta = np.cov(y, x)[0, 1] / np.var(x, ddof=1)
        resid = y - beta * x
        alpha_d = resid.mean()
        t_alpha = alpha_d / (resid.std(ddof=1) / np.sqrt(len(resid)))
        years = mask.sum() / 252
        cagr = (1 + pr).prod() ** (1 / years) - 1
        mcagr = (1 + mk).prod() ** (1 / years) - 1
        eq = (1 + pr).cumprod()
        mdd = float((eq / eq.cummax() - 1).min())
        return {"cagr": float(cagr), "mkt_cagr": float(mcagr), "alpha": float(alpha_d * 252), "t_alpha": float(t_alpha),
                "beta": float(beta), "invested": float(inv.mean()), "mdd": mdd, "days": int(inv.sum()),
                "sharpe": float(pr.mean() / pr.std(ddof=1) * np.sqrt(252)) if pr.std() > 0 else 0.0}

    idx = port.index
    out = {"all": stats(np.ones(len(idx), bool)), "train": stats(idx < SPLIT), "test": stats(idx >= SPLIT)}
    n_stocks = int(sig.any().sum()) or 1
    out["events"] = {"n": int(len(ev)), "per_stock_year": float(len(ev) / n_stocks / (len(idx) / 252)),
                     "mean_excess": float(ev.mean()) if len(ev) else None,
                     "median_excess": float(ev.median()) if len(ev) else None,
                     "win_vs_mkt": float((ev > 0).mean()) if len(ev) else None,
                     "win_abs": float((ev_raw > 0).mean()) if len(ev_raw) else None,
                     "mean_raw": float(ev_raw.mean()) if len(ev_raw) else None}
    out["equity"] = {"dates": [d.strftime("%Y-%m-%d") for d in idx[::5]],
                     "strategy": [round(float(x), 4) for x in (1 + port).cumprod().iloc[::5]],
                     "market": [round(float(x), 4) for x in (1 + mkt.fillna(0)).cumprod().iloc[::5]]}
    return out


def verdict(r: dict) -> str:
    tr, te = r["train"], r["test"]
    if "alpha" not in tr or "alpha" not in te:
        return "표본 부족"
    if tr["alpha"] > 0 and te["alpha"] > 0 and tr["t_alpha"] >= 2 and te["t_alpha"] >= 2:
        return "두 구간 모두 유의한 알파 (+)"
    if tr["alpha"] < 0 and te["alpha"] < 0 and tr["t_alpha"] <= -2 and te["t_alpha"] <= -2:
        return "두 구간 모두 유의한 손실 (−)"
    if np.sign(tr["alpha"]) == np.sign(te["alpha"]) and r["all"]["t_alpha"] >= 2:
        return "약한 우위 (+)"
    if np.sign(tr["alpha"]) == np.sign(te["alpha"]) and r["all"]["t_alpha"] <= -2:
        return "약한 열위 (−)"
    return "시장과 구별 안 됨"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--market", choices=["kr", "nasdaq"], default="kr")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    p = load_panel(args.market)
    print(f"{args.market}: {p['Close'].shape[1]}종목, {p['Close'].index[0].date()} ~ {p['Close'].index[-1].date()}", flush=True)
    techs = techniques(p)
    results = {}
    for key, (name, desc, sig) in techs.items():
        r = backtest(p, sig, COST[args.market])
        r.update({"name": name, "desc": desc})
        r["verdict"] = verdict(r)
        results[key] = r
        a, tr, te, e = r["all"], r["train"], r["test"], r["events"]
        print(f"{name:24s} n={e['n']:6d} CAGR {a.get('cagr', 0):+.1%} (시장 {a.get('mkt_cagr', 0):+.1%}) "
              f"알파 {a.get('alpha', 0):+.1%} t={a.get('t_alpha', 0):+.1f} | 학습 {tr.get('alpha', 0):+.1%} ({tr.get('t_alpha', 0):+.1f}) "
              f"검증 {te.get('alpha', 0):+.1%} ({te.get('t_alpha', 0):+.1f}) | 20일 승률 {e['win_abs'] or 0:.0%} → {r['verdict']}", flush=True)

    meta = {"market": args.market, "stocks": int(p["Close"].shape[1]), "start": str(p["Close"].index[0].date()),
            "end": str(p["Close"].index[-1].date()), "hold": H, "cost": COST[args.market], "split": str(SPLIT.date())}
    (OUT / f"{args.market}.json").write_text(json.dumps({"meta": meta, "results": results}, ensure_ascii=False, default=float),
                                             encoding="utf-8")


if __name__ == "__main__":
    main()
