"""유니버스 전체 현재 시점 스캔 (캐시된 최신 데이터 기준).

python -m research.scan_now --market kr --only KOSDAQ
python -m research.scan_now --market nasdaq
(최신 데이터가 필요하면 먼저 python -m research.collect --market ... --refresh)
"""
from __future__ import annotations

import argparse
import json
import pickle
from multiprocessing import Pool

import numpy as np
import pandas as pd

from app.analysis import Params, analyze

from .calibrate import OUT, load
from .collect import CACHE, universe_file

P = Params()
FRESH_DAYS = 5


def one(job):
    u, years, flow_days = job
    df, flow = load(u["code"], years, flow_days)
    if df is None or len(df) < 130:
        return None
    df = df[~df.index.duplicated(keep="last")].sort_index()
    try:
        res = analyze(df, P, flow)
    except ValueError:
        return None
    ind = res.indicators
    last = len(ind) - 1
    pos = {d: i for i, d in enumerate(ind.index.strftime("%Y-%m-%d"))}
    fresh = [s for s in res.signals if s.date in pos and last - pos[s.date] < FRESH_DAYS and s.type != "dry_up"]
    entry = [s for s in fresh if s.type == "entry"]
    smart = [s for s in res.signals if s.type == "smart_money" and s.date in pos and last - pos[s.date] < 20]
    vol20 = float(ind["Close"].pct_change().iloc[-20:].std() * np.sqrt(252))
    close = ind["Close"]
    return {
        "code": u["code"], "name": u["name"], "market": u.get("market", ""),
        "date": res.summary["last_date"], "close": res.summary["last_close"], "score": res.score,
        "chg_20d": float(close.iloc[-1] / close.iloc[-21] - 1),
        "vol_ann": vol20,
        "entry_date": entry[-1].date if entry else None,
        "entry_detail": entry[-1].detail if entry else None,
        "fresh_signals": ", ".join(f"{s.label}({s.date[5:]})" for s in fresh),
        "smart_warn": smart[-1].date if smart else None,
        "smart_ratio_20": (res.summary["flow"] or {}).get("smart_ratio_20"),
        "components": res.summary["components"],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--market", choices=["kr", "nasdaq"], default="kr")
    ap.add_argument("--only", default=None, help="kr에서 KOSPI 또는 KOSDAQ만")
    ap.add_argument("--years", default="5y")
    ap.add_argument("--flow-days", type=int, default=800)
    ap.add_argument("--top", type=int, default=15)
    args = ap.parse_args()

    uni = pickle.loads((CACHE / universe_file(args.market)).read_bytes())
    if args.only:
        uni = [u for u in uni if u.get("market") == args.only]
    with Pool() as pool:
        rows = [r for r in pool.map(one, [(u, args.years, args.flow_days) for u in uni]) if r]
    df = pd.DataFrame(rows)
    latest = df["date"].max()
    stale = df[df["date"] < latest]
    df = df[df["date"] == latest]

    tag = args.only or args.market
    out = OUT / "scan"
    out.mkdir(parents=True, exist_ok=True)
    df.drop(columns=["components"]).sort_values("score", ascending=False).to_csv(out / f"scan_{tag.lower()}_{latest}.csv", index=False)

    pd.set_option("display.width", 220)
    pd.set_option("display.max_colwidth", 60)
    cols = ["code", "name", "close", "score", "chg_20d", "vol_ann"]
    print(f"== {tag} {latest} 기준 {len(df)}종목 (데이터 지연 {len(stale)}종목 제외) ==")
    print(f"\n[최근 {FRESH_DAYS}거래일 세력 진입봉] {df['entry_date'].notna().sum()}종목")
    e = df[df["entry_date"].notna()].sort_values("score", ascending=False)
    print(e[cols + ["entry_date", "entry_detail"]].to_string(index=False) if len(e) else "없음")
    print(f"\n[매집 점수 상위 {args.top}]")
    print(df.sort_values("score", ascending=False).head(args.top)[cols + ["fresh_signals"]].to_string(index=False))
    if df["smart_warn"].notna().any():
        w = df[df["smart_warn"].notna()].sort_values("smart_warn", ascending=False)
        print(f"\n[기관·외국인 매수에도 주가 정체 — 최근 20거래일, 과거 검증상 평균 약세] {len(w)}종목")
        print(w[cols + ["smart_warn", "smart_ratio_20"]].head(args.top).to_string(index=False))
    print(f"\n[유니버스 중앙값] 20일 등락 {df['chg_20d'].median():+.1%}, 연환산 변동성 {df['vol_ann'].median():.0%}")
    if len(e):
        print(f"[진입봉 종목 중앙값] 20일 등락 {e['chg_20d'].median():+.1%}, 연환산 변동성 {e['vol_ann'].median():.0%}")
    summary = {"market": tag, "date": latest, "n": len(df),
               "entries": e[cols + ["entry_date", "entry_detail"]].to_dict("records"),
               "top": df.sort_values("score", ascending=False).head(args.top)[cols + ["fresh_signals"]].to_dict("records")}
    (out / f"scan_{tag.lower()}_{latest}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1, default=float), encoding="utf-8")


if __name__ == "__main__":
    main()
