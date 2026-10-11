"""백테스트용 유니버스·시세·수급 수집 (디스크 캐시).

python -m research.collect --kospi 100 --kosdaq 200 --years 5y --flow-days 800
python -m research.collect --market nasdaq --nasdaq 500 --years 5y
"""
from __future__ import annotations

import argparse
import json
import pickle
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from app import data

CACHE = Path(__file__).resolve().parent / ".cache"
UA = {"User-Agent": "Mozilla/5.0 (accumulation-tracker research)"}


def universe(market: str, n: int) -> list[dict]:
    out, page = [], 1
    while len(out) < n:
        url = f"https://m.stock.naver.com/api/stocks/marketValue/{market}?page={page}&pageSize=100"
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=15) as r:
            stocks = json.load(r).get("stocks", [])
        if not stocks:
            break
        for s in stocks:
            code, name = s["itemCode"], s["stockName"]
            # 보통주만: 우선주(끝자리 0 아님)·스팩·리츠·ETF 제외
            if s.get("stockEndType") != "stock" or not code.isdigit() or code[-1] != "0" or "스팩" in name or "리츠" in name:
                continue
            out.append({"code": code, "name": name, "market": market})
        page += 1
    return out[:n]


NASDAQ_SCREENER = "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&exchange=nasdaq&download=true"
EXCLUDE_WORDS = ("Acquisition", "Warrant", "Right", " Unit", "Preferred", "Depositary", "Trust", "ETF", "Notes")


def nasdaq_universe(n: int) -> list[dict]:
    """나스닥 상장 보통주 시가총액 상위 n개 (스팩·워런트·우선주·ADR·ETF 제외)."""
    with urllib.request.urlopen(urllib.request.Request(NASDAQ_SCREENER, headers=UA), timeout=30) as r:
        rows = json.load(r)["data"]["rows"]

    def cap(r):
        try:
            return float(r.get("marketCap") or 0)
        except ValueError:
            return 0.0

    rows = [r for r in rows if r["symbol"].isalpha() and not any(w in r["name"] for w in EXCLUDE_WORDS)]
    rows.sort(key=cap, reverse=True)
    return [{"code": r["symbol"], "name": r["name"], "market": "NASDAQ", "cap": cap(r)} for r in rows[:n]]


def universe_file(market: str) -> str:
    return "universe.pkl" if market == "kr" else f"universe_{market}.pkl"


REFRESH = False


def cached(name: str, fn):
    path = CACHE / name
    if path.exists() and not (REFRESH and not name.startswith("universe")):
        return pickle.loads(path.read_bytes())
    val = fn()
    path.write_bytes(pickle.dumps(val))
    return val


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--market", choices=["kr", "nasdaq"], default="kr")
    ap.add_argument("--nasdaq", type=int, default=500)
    ap.add_argument("--kospi", type=int, default=100)
    ap.add_argument("--kosdaq", type=int, default=200)
    ap.add_argument("--years", default="5y")
    ap.add_argument("--flow-days", type=int, default=800)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--refresh", action="store_true", help="시세·수급을 다시 받음 (유니버스는 유지 — 전진 검증용)")
    args = ap.parse_args()
    global REFRESH
    REFRESH = args.refresh
    CACHE.mkdir(exist_ok=True)

    if args.market == "kr":
        uni = cached(universe_file("kr"), lambda: universe("KOSPI", args.kospi) + universe("KOSDAQ", args.kosdaq))
    else:
        uni = cached(universe_file("nasdaq"), lambda: nasdaq_universe(args.nasdaq))
    print(f"universe: {len(uni)}")

    def one(s: dict) -> str:
        code = s["code"]
        try:
            cached(f"px_{code}_{args.years}.pkl", lambda: data.fetch_ticker(code, args.years)[0])
        except data.DataError as e:
            return f"{code} price FAIL {e}"
        if args.market != "kr":
            return f"{code} ok"
        flow = cached(f"flow_{code}_{args.flow_days}.pkl", lambda: data.fetch_investor_flow(code, args.flow_days))
        return f"{code} ok flow={0 if flow is None else len(flow)}"

    t0 = time.time()
    with ThreadPoolExecutor(args.workers) as ex:
        for i, msg in enumerate(ex.map(one, uni), 1):
            if "FAIL" in msg or i % 25 == 0:
                print(f"[{i}/{len(uni)} {time.time() - t0:.0f}s] {msg}", flush=True)
    print("done", time.time() - t0)


if __name__ == "__main__":
    main()
