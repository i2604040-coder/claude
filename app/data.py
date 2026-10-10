"""시세 데이터 수집: Yahoo Finance 일봉, CSV 업로드, 데모 데이터."""
from __future__ import annotations

import io
import json
import re
import time
import urllib.parse
import urllib.request

import numpy as np
import pandas as pd

YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range={range}&interval=1d&includePrePost=false"
VALID_RANGES = {"3mo", "6mo", "1y", "2y", "5y"}
_CACHE: dict[tuple[str, str], tuple[float, pd.DataFrame, dict]] = {}
CACHE_TTL = 600


class DataError(Exception):
    pass


def candidate_symbols(ticker: str) -> list[str]:
    """6자리 숫자 종목코드는 코스피(.KS) → 코스닥(.KQ) 순으로 시도."""
    t = ticker.strip().upper()
    if re.fullmatch(r"\d{6}", t):
        return [f"{t}.KS", f"{t}.KQ"]
    return [t]


def _fetch_yahoo(symbol: str, rng: str) -> tuple[pd.DataFrame, dict]:
    url = YAHOO_URL.format(symbol=urllib.parse.quote(symbol), range=rng)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (accumulation-tracker)"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.load(resp)
    except Exception as e:  # noqa: BLE001
        raise DataError(f"{symbol} 시세 조회 실패: {e}") from e

    chart = payload.get("chart") or {}
    if chart.get("error") or not chart.get("result"):
        raise DataError(f"{symbol}: 종목을 찾을 수 없습니다")
    res = chart["result"][0]
    ts = res.get("timestamp") or []
    quote = (res.get("indicators", {}).get("quote") or [{}])[0]
    if not ts or not quote:
        raise DataError(f"{symbol}: 시세 데이터가 비어 있습니다")
    meta = res.get("meta", {})
    tz = meta.get("exchangeTimezoneName") or "UTC"
    idx = pd.to_datetime(ts, unit="s", utc=True).tz_convert(tz).tz_localize(None).normalize()
    df = pd.DataFrame({
        "Open": quote.get("open"), "High": quote.get("high"), "Low": quote.get("low"),
        "Close": quote.get("close"), "Volume": quote.get("volume"),
    }, index=idx).dropna()
    info = {
        "symbol": meta.get("symbol", symbol),
        "name": meta.get("longName") or meta.get("shortName") or symbol,
        "currency": meta.get("currency", ""),
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName", ""),
        "source": "Yahoo Finance",
    }
    return df, info


def fetch_ticker(ticker: str, rng: str = "1y") -> tuple[pd.DataFrame, dict]:
    if not ticker or not ticker.strip():
        raise DataError("종목코드를 입력하세요")
    if rng not in VALID_RANGES:
        rng = "1y"
    if ticker.strip().lower() == "demo":
        return demo_data(), {"symbol": "DEMO", "name": "데모 종목 (가상 매집 시나리오)",
                             "currency": "KRW", "exchange": "DEMO", "source": "synthetic"}
    errors = []
    for sym in candidate_symbols(ticker):
        key = (sym, rng)
        hit = _CACHE.get(key)
        if hit and time.time() - hit[0] < CACHE_TTL:
            return hit[1].copy(), dict(hit[2])
        try:
            df, info = _fetch_yahoo(sym, rng)
        except DataError as e:
            errors.append(str(e))
            continue
        if len(df) == 0:
            errors.append(f"{sym}: 데이터 없음")
            continue
        _CACHE[key] = (time.time(), df, info)
        return df.copy(), dict(info)
    raise DataError(" / ".join(errors))


def parse_csv(content: bytes) -> pd.DataFrame:
    """Date,Open,High,Low,Close,Volume (또는 날짜,시가,고가,저가,종가,거래량) 형식 CSV."""
    text = None
    for enc in ("utf-8-sig", "cp949"):
        try:
            text = content.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise DataError("CSV 인코딩을 인식할 수 없습니다 (UTF-8 또는 CP949)")
    df = pd.read_csv(io.StringIO(text), thousands=",")
    date_col = next((c for c in df.columns if str(c).strip().lower() in ("date", "datetime", "날짜", "일자")), None)
    if date_col is None:
        raise DataError("CSV에 날짜 컬럼(Date/날짜/일자)이 없습니다")
    df.index = pd.to_datetime(df.pop(date_col), errors="coerce")
    df = df[df.index.notna()]
    return df


def demo_data(days: int = 250, seed: int = 7) -> pd.DataFrame:
    """하락 → 바닥권 매집(흡수봉·아래꼬리·거래량 급감) → 박스권 수렴 시나리오의 가상 일봉."""
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range(end=pd.Timestamp("2026-10-09"), periods=days)
    price = 20000.0
    rows = []
    base_vol = 300_000
    for i in range(days):
        phase = i / days
        if phase < 0.4:        # 하락 추세
            drift, vol_mult = -0.0025, 1.0
        elif phase < 0.88:      # 바닥 횡보 + 매집
            drift, vol_mult = 0.0004, 1.0
        else:                   # 거래량 줄며 수렴
            drift, vol_mult = 0.0008, 0.45
        ret = drift + rng.normal(0, 0.012 if phase < 0.88 else 0.006)
        o = price * (1 + rng.normal(0, 0.004))
        c = price * (1 + ret)
        h = max(o, c) * (1 + abs(rng.normal(0, 0.006)))
        l = min(o, c) * (1 - abs(rng.normal(0, 0.006)))
        v = base_vol * vol_mult * rng.lognormal(0, 0.25)

        if 0.4 <= phase < 0.88:
            k = i - int(days * 0.4)
            if k % 13 == 3:     # 흡수형 매집봉: 대량거래, 등락 미미
                c = o * (1 + rng.uniform(-0.008, 0.01))
                h, l = max(o, c) * 1.012, min(o, c) * 0.988
                v = base_vol * rng.uniform(3.2, 5.0)
            elif k % 13 == 9:   # 아래꼬리 매집
                c = o * 1.004
                l = min(o, c) * 0.94
                h = max(o, c) * 1.004
                v = base_vol * rng.uniform(2.0, 3.0)
            elif k == 95:       # 세력 진입봉
                c = o * 1.08
                h, l = c * 1.005, o * 0.995
                v = base_vol * 6
            # 하락일 거래량은 작게, 상승일은 크게 (OBV 유입)
            if c < o:
                v *= 0.6
            else:
                v *= 1.25
        rows.append((dates[i], o, h, l, c, round(v)))
        price = c
    df = pd.DataFrame(rows, columns=["Date", "Open", "High", "Low", "Close", "Volume"]).set_index("Date")
    return df.round({"Open": 0, "High": 0, "Low": 0, "Close": 0})


NAVER_TREND_URL = "https://m.stock.naver.com/api/stock/{code}/trend?pageSize=60{cursor}"
_FLOW_CACHE: dict[str, tuple[float, pd.DataFrame, int]] = {}  # code -> (시각, 데이터, 요청 일수)


def _to_int(s) -> float:
    try:
        return float(str(s).replace(",", "").replace("+", ""))
    except (TypeError, ValueError):
        return float("nan")


def fetch_investor_flow(code: str, days: int = 250) -> pd.DataFrame | None:
    """국내 종목 투자자별 일별 순매수(주) — 네이버 증권. 실패 시 None (분석은 수급 없이 계속).

    columns: Foreign, Organ, Individual, ForeignHold(%)
    """
    code = code.strip()
    if not re.fullmatch(r"\d{6}", code):
        return None
    hit = _FLOW_CACHE.get(code)
    if hit and time.time() - hit[0] < CACHE_TTL and hit[2] >= days:
        return hit[1].copy()
    rows: list[dict] = []
    cursor = ""
    complete = True
    try:
        while len(rows) < days:
            req = urllib.request.Request(NAVER_TREND_URL.format(code=code, cursor=cursor),
                                         headers={"User-Agent": "Mozilla/5.0 (accumulation-tracker)"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                page = json.load(resp)
            if not page:
                break
            rows.extend(page)
            oldest = page[-1]["bizdate"]
            cursor = f"&bizdate={oldest}"
            if len(page) < 60:
                break
    except Exception:  # noqa: BLE001
        complete = False
        if not rows:
            return None
    if not rows:
        return None
    df = pd.DataFrame({
        "Foreign": [_to_int(r.get("foreignerPureBuyQuant")) for r in rows],
        "Organ": [_to_int(r.get("organPureBuyQuant")) for r in rows],
        "Individual": [_to_int(r.get("individualPureBuyQuant")) for r in rows],
        "ForeignHold": [_to_int(str(r.get("foreignerHoldRatio", "")).rstrip("%")) for r in rows],
    }, index=pd.to_datetime([r["bizdate"] for r in rows], format="%Y%m%d"))
    df = df[~df.index.duplicated(keep="first")].sort_index()
    _FLOW_CACHE[code] = (time.time(), df, days if complete else 0)
    return df.copy()
