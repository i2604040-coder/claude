"""비교용 시장 데이터(market.json) 생성: Yahoo Finance 월봉 수정주가(배당 재투자 반영).

python3 earn/tools/build_market.py  → earn/market.json
조회에 실패한 종목은 기존 market.json 값을 그대로 유지한다.
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import time
import urllib.parse
import urllib.request

OUT = pathlib.Path(__file__).resolve().parent.parent / "market.json"
URL = "https://query1.finance.yahoo.com/v8/finance/chart/{s}?range=10y&interval=1mo&events=div"
KST = dt.timezone(dt.timedelta(hours=9))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"

# tax: 'free' = 국내주식·국내주식형 ETF 매매차익 비과세, 'dividend' = 이익에 배당소득세 15.4%
PRODUCTS = [
    ("069500.KS", "KODEX 200", "국내주식 ETF", "free", "코스피200 지수 추종 (국내 대표 인덱스펀드 대용)"),
    ("360750.KS", "TIGER 미국S&P500", "해외주식 ETF", "dividend", "미국 S&P500 지수 추종 (해외 인덱스펀드 대용)"),
    ("133690.KS", "TIGER 미국나스닥100", "해외주식 ETF", "dividend", "미국 나스닥100 기술주 지수 추종"),
    ("458730.KS", "TIGER 미국배당다우존스", "해외배당 ETF", "dividend", "미국 배당성장주 (SCHD 전략)"),
    ("005930.KS", "삼성전자", "국내주식", "free", "개별 종목"),
    ("000660.KS", "SK하이닉스", "국내주식", "free", "개별 종목"),
    ("148070.KS", "KIWOOM 국고채10년", "채권 ETF", "dividend", "국고채 10년물 (채권형 펀드 대용)"),
    ("411060.KS", "ACE KRX금현물", "금 ETF", "dividend", "KRX 금 현물 가격 추종"),
    ("459580.KS", "KODEX CD금리액티브", "파킹형 ETF", "dividend", "CD금리 수준의 이자 누적 (MMF 대용)"),
]


def fetch(symbol: str) -> tuple[list[str], list[float]]:
    req = urllib.request.Request(URL.format(s=urllib.parse.quote(symbol)), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        res = json.load(r)["chart"]["result"][0]
    ts = res["timestamp"]
    ind = res["indicators"]
    closes = (ind.get("adjclose") or [{}])[0].get("adjclose") or ind["quote"][0]["close"]
    months: dict[str, float] = {}
    for t, c in zip(ts, closes):
        if c is None:
            continue
        # 한국 시간 기준 월 (같은 월이 두 번 오면 뒤의 값 = 최신가)
        m = dt.datetime.fromtimestamp(t, KST).strftime("%Y-%m")
        months[m] = round(float(c), 4)
    keys = sorted(months)
    if len(keys) < 3:
        raise ValueError("데이터 부족")
    return keys, [months[k] for k in keys]


def main() -> None:
    old = {}
    if OUT.exists():
        old = {p["symbol"]: p for p in json.loads(OUT.read_text()).get("products", [])}
    products = []
    for sym, name, kind, tax, desc in PRODUCTS:
        try:
            dates, close = fetch(sym)
            products.append({"symbol": sym, "name": name, "kind": kind, "tax": tax, "desc": desc,
                             "dates": dates, "close": close})
            print(f"{sym} {name}: {dates[0]}~{dates[-1]} ({len(dates)}개월)")
        except Exception as e:  # noqa: BLE001
            print(f"{sym} 실패: {e}")
            if sym in old:
                products.append(old[sym])
        time.sleep(0.5)
    if not products:
        raise SystemExit("모든 종목 조회 실패")
    now = dt.datetime.now(KST)
    OUT.write_text(json.dumps({"updated": now.strftime("%Y-%m-%d %H:%M KST"), "products": products},
                              ensure_ascii=False, separators=(",", ":")))
    print("저장:", OUT, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
