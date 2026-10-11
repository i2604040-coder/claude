"""매집 점수 가중치 보정 + 표본 외(out-of-sample) 검증.

python -m research.calibrate [--split 2024-10-01] [--write]

방법 (데이터를 보기 전에 정한 규칙):
1. 유니버스 각 종목에 대해 5거래일 간격으로, 그 시점까지의 데이터만으로 점수 구성요소(0~1)를 계산.
2. 목표값 = 20거래일 뒤 수익률 - 같은 날 유니버스 평균 (시장 대비 초과수익).
3. 각 구성요소의 날짜별 횡단면 순위상관(IC)을 구해 평균, t값(보유기간 겹침 보정: 유효 표본 = 날짜수/4).
4. 분할일 이전(학습 구간) IC로 가중치 = max(0, IC) 비례, 합계 100.
5. 분할일 이후(검증 구간)에서 기존 배점 점수와 새 배점 점수를 비교. 새 배점이 IC와 상위 20% 초과수익 모두 나을 때만 --write로 반영.
"""
from __future__ import annotations

import argparse
import json
import pickle
from datetime import date
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import pandas as pd

from app.analysis import LEGACY_WEIGHTS, WEIGHTS_FILE, Params, analyze

EVIDENCE_FILE = WEIGHTS_FILE.parent / "signal_evidence.json"
from app.backtest import signal_events

from .collect import CACHE, universe_file

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "results"
H = 20                 # 평가 보유기간(거래일)
STEP = 5               # 표본 간격(거래일)
BIG = 0.20             # '급등' 기준: 20거래일 시장 대비 +20% 초과
WARMUP = 130           # 점수 계산에 필요한 최소 과거 일수
CANDIDATES = ["ev_entry", "ev_absorption", "ev_lower_tail", "obv", "cmf", "updown", "dry_up", "base", "avwap", "flow"]
EXTRA = ["entry_recent", "smart_recent"]   # v2에서 추가된 항목 (IC 규칙 후보에는 넣지 않음 — 최초 규칙 재현성 유지)
LEGACY_P = Params(weights=LEGACY_WEIGHTS)


def load(code: str, years: str, flow_days: int):
    px = CACHE / f"px_{code}_{years}.pkl"
    fl = CACHE / f"flow_{code}_{flow_days}.pkl"
    if not px.exists():
        return None, None
    return pickle.loads(px.read_bytes()), (pickle.loads(fl.read_bytes()) if fl.exists() else None)


def sample_ticker(job) -> tuple[list[dict], list[dict]]:
    code, years, flow_days, grid = job
    df, flow = load(code, years, flow_days)
    if df is None or len(df) < WARMUP + H:
        return [], []
    df = df[~df.index.duplicated(keep="last")].sort_index()
    close = df["Close"].to_numpy(dtype=float)
    pos = {d: i for i, d in enumerate(df.index)}
    rows = []
    for d in grid:
        t = pos.get(d)
        if t is None or t < WARMUP:
            continue
        try:
            res = analyze(df.iloc[:t + 1], LEGACY_P, flow)
        except ValueError:
            continue
        rows.append({"code": code, "date": d, "legacy": res.score, **res.summary["components"],
                     "r20": close[t + H] / close[t] - 1 if t + H < len(close) else np.nan})
    events, _ = signal_events(df, Params(), flow, code)
    return rows, events


def ic_table(s: pd.DataFrame, cols: list[str], target: str = "x20", min_n: int = 30) -> pd.DataFrame:
    """날짜별 횡단면 Spearman IC → 평균, t값(겹침 보정), 양(+)인 날짜 비율."""
    out = {}
    for c in cols:
        if c not in s:
            out[c] = {"ic": np.nan, "t": np.nan, "pos": np.nan, "dates": 0}
            continue
        ics = []
        for _, g in s[[c, target]].dropna().groupby(s["date"]):
            if len(g) >= min_n and g[c].nunique() > 1:
                ics.append(g[c].rank().corr(g[target].rank()))
        ics = np.array([x for x in ics if np.isfinite(x)])
        if len(ics) < 5:
            out[c] = {"ic": np.nan, "t": np.nan, "pos": np.nan, "dates": len(ics)}
            continue
        eff_n = max(len(ics) / (H / STEP), 1)
        out[c] = {"ic": ics.mean(), "t": ics.mean() / (ics.std(ddof=1) / np.sqrt(eff_n)), "pos": (ics > 0).mean(), "dates": len(ics)}
    return pd.DataFrame(out).T


def composite(s: pd.DataFrame, weights: dict) -> pd.Series:
    """app.analysis.score_accumulation과 같은 식: (가점 − 감점) / 가점 배점 합, 0~100으로 자름."""
    num = sum(s[k].fillna(0) * w for k, w in weights.items() if w != 0 and k in s)
    den = sum(s[k].notna() * w for k, w in weights.items() if w > 0 and k in s)
    return (num / den.replace(0, np.nan)).clip(0, 1) * 100


def quintiles(s: pd.DataFrame, col: str) -> pd.Series:
    """날짜별 5분위(1=점수 하위, 5=상위) 평균 초과수익."""
    d = s[["date", col, "x20"]].dropna()
    d = d[d.groupby("date")[col].transform("count") >= 30]
    q = d.groupby("date")[col].transform(lambda x: pd.qcut(x.rank(method="first"), 5, labels=False) + 1)
    return d.groupby(q)["x20"].mean()


def quintile_big(s: pd.DataFrame, col: str) -> pd.Series:
    """날짜별 5분위별 급등(시장 대비 +20% 초과) 비율."""
    d = s[["date", col, "x20"]].dropna()
    d = d[d.groupby("date")[col].transform("count") >= 30]
    q = d.groupby("date")[col].transform(lambda x: pd.qcut(x.rank(method="first"), 5, labels=False) + 1)
    return (d["x20"] > BIG).groupby(q).mean()


def event_table(ev: pd.DataFrame) -> pd.DataFrame:
    rows = {}
    for typ, g in ev.groupby("type"):
        x = g["x20"].dropna()
        rows[typ] = {"n": len(x), "mean_excess": x.mean(), "median_excess": x.median(),
                     "t": x.mean() / (x.std(ddof=1) / np.sqrt(len(x))) if len(x) > 2 else np.nan,
                     "win_vs_mkt": (x > 0).mean(), "p_big": (x > BIG).mean(), "p_crash": (x < -BIG).mean()}
    return pd.DataFrame(rows).T


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--market", choices=["kr", "nasdaq"], default="kr")
    ap.add_argument("--years", default="5y")
    ap.add_argument("--flow-days", type=int, default=800)
    ap.add_argument("--split", default="2024-10-01")
    ap.add_argument("--write", action="store_true", help="IC 규칙 배점이 검증 통과 시 app/weights.json 갱신")
    ap.add_argument("--resample", action="store_true", help="캐시된 표본(results/samples.pkl)을 버리고 다시 계산")
    ap.add_argument("--since", default=None, help="이 날짜 이후 표본만으로 현재 배점(app/weights.json)을 평가 (전진 검증)")
    args = ap.parse_args()
    out = OUT if args.market == "kr" else OUT / args.market
    out.mkdir(parents=True, exist_ok=True)
    evidence_file = EVIDENCE_FILE if args.market == "kr" else EVIDENCE_FILE.with_name(f"signal_evidence_{args.market}.json")
    split = pd.Timestamp(args.split)

    uni = pickle.loads((CACHE / universe_file(args.market)).read_bytes())
    ref, _ = load("005930" if args.market == "kr" else uni[0]["code"], args.years, args.flow_days)
    grid = list(ref.index[WARMUP::STEP])

    samples_path = out / "samples.pkl"
    if samples_path.exists() and not args.resample:
        s, ev = pickle.loads(samples_path.read_bytes())
    else:
        with Pool() as pool:
            parts = pool.map(sample_ticker, [(u["code"], args.years, args.flow_days, grid) for u in uni], chunksize=4)
        s = pd.DataFrame([r for rows, _ in parts for r in rows])
        ev = pd.DataFrame([e for _, evs in parts for e in evs])
        samples_path.write_bytes(pickle.dumps((s, ev)))

    # 시장 대비 초과수익: 같은 날짜 유니버스 평균을 뺌
    s["x20"] = s["r20"] - s.groupby("date")["r20"].transform("mean")
    # 신호 이벤트는 매일 발생하므로 일별 유니버스 평균 20일 수익률과 비교
    closes = {}
    for u in uni:
        df, _ = load(u["code"], args.years, args.flow_days)
        if df is not None:
            closes[u["code"]] = df["Close"][~df.index.duplicated(keep="last")]
    px = pd.DataFrame(closes).sort_index()
    fwd = px.shift(-H) / px - 1
    mkt_daily = fwd.mean(axis=1)
    ev["date"] = pd.to_datetime(ev["date"])
    ev["x20"] = ev["r20"] - ev["date"].map(mkt_daily)
    # 기준선: 아무 종목·아무 날의 시장 대비 초과수익 분포 (평균은 0이지만 중앙값은 음수 — 소수 급등주가 평균을 끌어올림)
    allx = fwd.sub(mkt_daily, axis=0)
    def base_stats(mask):
        x = allx[mask].stack().dropna()
        return {"n": int(len(x)), "mean_excess": float(x.mean()), "median_excess": float(x.median()),
                "t": 0.0, "win_vs_mkt": float((x > 0).mean()), "p_big": float((x > BIG).mean()), "p_crash": float((x < -BIG).mean())}
    baseline = {"train": base_stats(allx.index < split), "test": base_stats(allx.index >= split)}

    # 변동성 맞춘 비교: 신호 직전 20일 변동성 10분위가 같은 '아무 종목·아무 날'의 기대값과 비교
    vol = px.pct_change().rolling(20).std()
    X = allx.stack().rename("x").to_frame()
    X["vol"] = vol.stack()
    X = X.dropna()
    edges = X["vol"].quantile(np.linspace(0, 1, 11)).to_numpy()
    X["vb"] = np.clip(np.searchsorted(edges, X["vol"]) - 1, 0, 9)
    X["per"] = np.where(X.index.get_level_values(0) < split, "train", "test")
    vb_base = X.groupby(["per", "vb"])["x"].agg(mean="mean", up=lambda x: (x > BIG).mean(), down=lambda x: (x < -BIG).mean())
    ev["vol"] = [vol.at[d, c] if d in vol.index and c in vol.columns else np.nan for d, c in zip(ev["date"], ev["ticker"])]
    ev["vb"] = np.clip(np.searchsorted(edges, ev["vol"].fillna(np.inf)) - 1, 0, 9)
    ev["per"] = np.where(ev["date"] < split, "train", "test")
    vm: dict = {}
    for (per, typ), g in ev.dropna(subset=["x20", "vol"]).groupby(["per", "type"]):
        b = vb_base.loc[per].reindex(g["vb"])
        adj = g["x20"].to_numpy() - b["mean"].to_numpy()   # 같은 변동성 기대값 대비 초과
        vm_t = adj.mean() / (adj.std(ddof=1) / np.sqrt(len(adj))) if len(adj) > 2 else np.nan
        vm.setdefault(per, {})[typ] = {"vm_mean": float(b["mean"].mean()), "vm_p_big": float(b["up"].mean()),
                                       "vm_p_crash": float(b["down"].mean()), "vm_t": float(vm_t)}

    train, test = s[s["date"] < split], s[s["date"] >= split]
    ic_tr, ic_te = ic_table(train, CANDIDATES + ["legacy"]), ic_table(test, CANDIDATES + ["legacy"])

    raw = {k: max(0.0, float(ic_tr.loc[k, "ic"])) if np.isfinite(ic_tr.loc[k, "ic"]) else 0.0 for k in CANDIDATES}
    tot = sum(raw.values())
    new_w = {k: round(v / tot * 100, 1) for k, v in raw.items()} if tot > 0 else dict(LEGACY_WEIGHTS)

    adopted = json.loads(WEIGHTS_FILE.read_text(encoding="utf-8")) if WEIGHTS_FILE.exists() else None
    adopted_w = adopted["weights"] if adopted else None
    for name, w in (("legacy_c", LEGACY_WEIGHTS), ("new_c", new_w), ("adopted_c", adopted_w)):
        if w:
            s[name] = composite(s, w)
    train, test = s[s["date"] < split], s[s["date"] >= split]
    comps = [c for c in ("legacy_c", "new_c", "adopted_c") if c in s]
    cmp_tr, cmp_te = ic_table(train, comps), ic_table(test, comps)
    q_te = {c: quintiles(test, c) for c in comps}
    q_tr = {c: quintiles(train, c) for c in comps}
    big_tr = {c: quintile_big(train, c) for c in comps}
    big_te = {c: quintile_big(test, c) for c in comps}
    ic_extra = pd.concat({"train": ic_table(train, EXTRA), "test": ic_table(test, EXTRA)}, axis=1)
    forward = None
    if args.since and adopted_w:
        fw = s[s["date"] >= pd.Timestamp(args.since)]
        n_dates = fw.dropna(subset=["x20"])["date"].nunique()
        forward = {"since": args.since, "dates": int(n_dates), "samples": int(fw["x20"].notna().sum())}
        if n_dates >= 5:
            forward["ic"] = ic_table(fw, ["legacy_c", "adopted_c"]).to_dict("index")
            forward["quintiles"] = {c: quintiles(fw, c).to_dict() for c in ("legacy_c", "adopted_c")}

    def top_spread(q):
        return float(q.get(5, np.nan))

    passed = (cmp_te.loc["new_c", "ic"] > cmp_te.loc["legacy_c", "ic"]
              and top_spread(q_te["new_c"]) > top_spread(q_te["legacy_c"]))

    ev_tr, ev_te = event_table(ev[ev["date"] < split]), event_table(ev[ev["date"] >= split])

    result = {
        "generated": date.today().isoformat(),
        "universe": len(uni), "tickers_sampled": int(s["code"].nunique()),
        "samples": {"train": int(train["x20"].notna().sum()), "test": int(test["x20"].notna().sum())},
        "period": {"train": [str(train["date"].min().date()), str(train["date"].max().date())],
                   "test": [str(test["date"].min().date()), str(test["date"].max().date())]},
        "split": args.split, "horizon": H, "step": STEP,
        "ic_train": ic_tr.to_dict("index"), "ic_test": ic_te.to_dict("index"),
        "legacy_weights": LEGACY_WEIGHTS, "new_weights": new_w,
        "composite_train": cmp_tr.to_dict("index"), "composite_test": cmp_te.to_dict("index"),
        "quintiles_train": {k: v.to_dict() for k, v in q_tr.items()},
        "quintiles_test": {k: v.to_dict() for k, v in q_te.items()},
        "quintiles_big_train": {k: v.to_dict() for k, v in big_tr.items()},
        "quintiles_big_test": {k: v.to_dict() for k, v in big_te.items()},
        "events_train": ev_tr.to_dict("index"), "events_test": ev_te.to_dict("index"),
        "passed": bool(passed),
        "adopted_weights": adopted_w, "adopted_meta": {k: v for k, v in (adopted or {}).items() if k != "weights"},
        "ic_extra": {per: ic_extra[per].to_dict("index") for per in ("train", "test")}, "forward": forward,
    }
    (out / "calibration.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, default=float), encoding="utf-8")

    # 신호 유형별 과거 성과 → 화면에 근거로 표시 (가중치 채택 여부와 무관하게 항상 갱신)
    def ev_dict(t, per):
        return {k: {"n": int(v["n"]), "mean_excess": float(v["mean_excess"]), "median_excess": float(v["median_excess"]), "t": float(v["t"]),
                    "win_vs_mkt": float(v["win_vs_mkt"]), "p_big": float(v["p_big"]), "p_crash": float(v["p_crash"]),
                    **vm.get(per, {}).get(k, {})} for k, v in t.to_dict("index").items()}
    evidence_file.write_text(json.dumps({
        "market": args.market,
        "horizon": H, "universe": result["tickers_sampled"], "generated": result["generated"],
        "train": {"period": result["period"]["train"], "by_type": ev_dict(ev_tr, "train"), "baseline": baseline["train"]},
        "test": {"period": result["period"]["test"], "by_type": ev_dict(ev_te, "test"), "baseline": baseline["test"]},
        "score": {c: {"ic_train": float(cmp_tr.loc[c, "ic"]), "ic_test": float(cmp_te.loc[c, "ic"]),
                      "t_train": float(cmp_tr.loc[c, "t"]), "t_test": float(cmp_te.loc[c, "t"]),
                      "top20_train": float(q_tr[c].get(5, np.nan)), "top20_test": float(q_te[c].get(5, np.nan)),
                      "big_top20_train": float(big_tr[c].get(5, np.nan)), "big_top20_test": float(big_te[c].get(5, np.nan)),
                      "big_bottom20_train": float(big_tr[c].get(1, np.nan)), "big_bottom20_test": float(big_te[c].get(1, np.nan))}
                  for c in comps},
        "adopted": {k: v for k, v in (adopted or {}).items() if k in ("version", "adopted", "weights")},
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    pd.set_option("display.width", 200)
    print(f"tickers {result['tickers_sampled']}  samples {result['samples']}  periods {result['period']}")
    print("\n[구성요소 IC] train / test"); print(pd.concat({"train": ic_tr, "test": ic_te}, axis=1).round(4))
    print("\n[가중치] legacy → new"); print({k: (LEGACY_WEIGHTS.get(k, 0), new_w.get(k, 0)) for k in CANDIDATES + ["events"]})
    print("\n[종합 점수 IC] train"); print(cmp_tr.round(4)); print("test"); print(cmp_te.round(4))
    print("\n[5분위 초과수익 20일] test"); print(pd.DataFrame(q_te).round(4)); print("train"); print(pd.DataFrame(q_tr).round(4))
    print("\n[5분위 급등 비율] test"); print(pd.DataFrame(big_te).round(4)); print("train"); print(pd.DataFrame(big_tr).round(4))
    print("\n[신호 이벤트 시장대비 초과수익 20일] train"); print(ev_tr.round(4)); print("test"); print(ev_te.round(4))
    print("\n[변동성 맞춘 기대값]"); print(json.dumps(vm, ensure_ascii=False, indent=1))
    print("\n[기준선: 아무 종목·아무 날]"); print(pd.DataFrame(baseline).T.round(4))
    print("\n[v2 신규 항목 IC]"); print(ic_extra.round(4))
    print("\nOOS 통과(IC 규칙 배점):", passed)
    if adopted_w:
        print(f"\n[현재 적용 배점 {adopted.get('version')}] 채택일 {adopted.get('adopted')} 이전 성과는 사후 확인(표본 내)입니다.")
    if forward:
        print("\n[전진 검증]", json.dumps(forward, ensure_ascii=False, default=float, indent=1))

    if args.write and passed and args.market == "kr":
        WEIGHTS_FILE.write_text(json.dumps({
            "weights": new_w,
            "source": "research/calibrate.py — 학습 구간 IC 비례 배점, 검증 구간에서 기존 배점 대비 우위 확인",
            "generated": result["generated"], "train": result["period"]["train"], "test": result["period"]["test"],
            "universe": result["tickers_sampled"],
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        print("app/weights.json 갱신")


if __name__ == "__main__":
    main()
