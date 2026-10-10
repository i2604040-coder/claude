"""FastAPI 웹 서버: 세력 매집 흔적 탐지 API + 정적 대시보드."""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .analysis import Params, analyze, result_to_json
from .backtest import score_samples, signal_events, summarize
from .data import DataError, fetch_investor_flow, fetch_ticker, parse_csv

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
EVIDENCE_FILE = Path(__file__).resolve().parent / "signal_evidence.json"


@lru_cache(maxsize=1)
def load_evidence() -> dict | None:
    """research/calibrate.py가 만든 신호 유형별 대규모 백테스트 결과 (없으면 None)."""
    try:
        return json.loads(EVIDENCE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None

app = FastAPI(title="세력 매집 탐지기", version="1.0.0")


def _params(lookback: int, spike: float) -> Params:
    return Params(lookback=lookback, spike_ratio=spike)


def _flow(ticker: str, days: int, enabled: bool):
    """국내 6자리 종목코드면 기관·외국인 수급을 가져옴 (실패해도 분석은 계속)."""
    return fetch_investor_flow(ticker, days) if enabled else None


@app.get("/api/analyze")
def api_analyze(
    ticker: str = Query(..., description="종목코드(예: 005930, AAPL) 또는 demo"),
    range: str = Query("1y", pattern="^(3mo|6mo|1y|2y|5y)$"),
    lookback: int = Query(60, ge=20, le=250),
    spike: float = Query(2.5, ge=1.5, le=10),
    flow: bool = Query(True, description="국내 종목 기관·외국인 수급 반영"),
):
    try:
        df, info = fetch_ticker(ticker, range)
        res = analyze(df, _params(lookback, spike), _flow(ticker, len(df), flow))
    except (DataError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"info": info, **result_to_json(res)}


@app.get("/api/evidence")
def api_evidence():
    return load_evidence() or {}


@app.post("/api/upload")
async def api_upload(
    file: UploadFile = File(...),
    lookback: int = Query(60, ge=20, le=250),
    spike: float = Query(2.5, ge=1.5, le=10),
):
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="파일은 5MB 이하만 가능합니다")
    try:
        df = parse_csv(content)
        res = analyze(df, _params(lookback, spike))
    except (DataError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    info = {"symbol": file.filename or "CSV", "name": file.filename or "업로드 데이터",
            "currency": "", "exchange": "CSV", "source": "upload"}
    return {"info": info, **result_to_json(res)}


class ScanRequest(BaseModel):
    tickers: list[str] = Field(..., min_length=1, max_length=50)
    range: str = "1y"
    lookback: int = Field(60, ge=20, le=250)
    spike: float = Field(2.5, ge=1.5, le=10)
    flow: bool = True


@app.post("/api/scan")
def api_scan(req: ScanRequest):
    p = _params(req.lookback, req.spike)
    tickers = list(dict.fromkeys(t.strip() for t in req.tickers if t.strip()))

    def one(t: str) -> dict:
        try:
            df, info = fetch_ticker(t, req.range)
            res = analyze(df, p, _flow(t, req.lookback + 40, req.flow))
        except (DataError, ValueError) as e:
            return {"ticker": t, "error": str(e)}
        recent = [s for s in res.signals if s.date >= res.indicators.index[-min(p.lookback, len(res.indicators))].strftime("%Y-%m-%d")]
        return {
            "ticker": t,
            "name": info["name"],
            "symbol": info["symbol"],
            "currency": info["currency"],
            "score": res.score,
            "grade": res.grade,
            "last_close": res.summary["last_close"],
            "change": res.summary["change"],
            "cmf": res.summary["cmf"],
            "estimated_cost": res.summary["estimated_cost"],
            "cost_gap": res.summary["cost_gap"],
            "signal_count": len(recent),
            "smart_ratio_20": (res.summary["flow"] or {}).get("smart_ratio_20"),
            "last_signal": recent[-1].to_dict() if recent else None,
        }

    with ThreadPoolExecutor(max_workers=6) as ex:
        results = list(ex.map(one, tickers))
    results.sort(key=lambda r: r.get("score", -1), reverse=True)
    return {"results": results}


class BacktestRequest(BaseModel):
    tickers: list[str] = Field(..., min_length=1, max_length=30)
    range: str = Field("2y", pattern="^(1y|2y|5y)$")
    lookback: int = Field(60, ge=20, le=250)
    spike: float = Field(2.5, ge=1.5, le=10)
    flow: bool = True


@app.post("/api/backtest")
def api_backtest(req: BacktestRequest):
    """신호·점수 백테스트. 여러 종목을 넣으면 표본을 합쳐서 집계."""
    p = _params(req.lookback, req.spike)
    tickers = list(dict.fromkeys(t.strip() for t in req.tickers if t.strip()))

    def one(t: str) -> dict:
        try:
            df, info = fetch_ticker(t, req.range)
            fl = _flow(t, len(df), req.flow)
            events, base = signal_events(df, p, fl, t)
            samples = score_samples(df, p, fl, ticker=t)
        except (DataError, ValueError) as e:
            return {"ticker": t, "error": str(e)}
        return {"ticker": t, "name": info["name"], "events": events, "base": base,
                "samples": samples, "has_flow": fl is not None, "days": len(df)}

    with ThreadPoolExecutor(max_workers=6) as ex:
        parts = list(ex.map(one, tickers))
    ok = [x for x in parts if "error" not in x]
    if not ok:
        raise HTTPException(status_code=400, detail=" / ".join(x["error"] for x in parts))

    events = [e for x in ok for e in x["events"]]
    result = summarize(events, [b for x in ok for b in x["base"]], [s for x in ok for s in x["samples"]])
    events.sort(key=lambda e: e["date"], reverse=True)
    result["events"] = events[:300]
    result["tickers"] = [
        {"ticker": x["ticker"], "name": x.get("name"), "error": x.get("error"),
         "signals": len(x.get("events", [])), "days": x.get("days"), "has_flow": x.get("has_flow")}
        for x in parts
    ]
    if len(ok) == 1:
        result["score_history"] = [{"date": s["date"], "score": s["score"], "close": s["close"]} for s in ok[0]["samples"]]
    return result


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
