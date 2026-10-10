"""FastAPI 웹 서버: 세력 매집 흔적 탐지 API + 정적 대시보드."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .analysis import Params, analyze, result_to_json
from .data import DataError, fetch_ticker, parse_csv

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(title="세력 매집 탐지기", version="1.0.0")


def _params(lookback: int, spike: float) -> Params:
    return Params(lookback=lookback, spike_ratio=spike)


@app.get("/api/analyze")
def api_analyze(
    ticker: str = Query(..., description="종목코드(예: 005930, AAPL) 또는 demo"),
    range: str = Query("1y", pattern="^(3mo|6mo|1y|2y|5y)$"),
    lookback: int = Query(60, ge=20, le=250),
    spike: float = Query(2.5, ge=1.5, le=10),
):
    try:
        df, info = fetch_ticker(ticker, range)
        res = analyze(df, _params(lookback, spike))
    except (DataError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"info": info, **result_to_json(res)}


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


@app.post("/api/scan")
def api_scan(req: ScanRequest):
    p = _params(req.lookback, req.spike)
    tickers = list(dict.fromkeys(t.strip() for t in req.tickers if t.strip()))

    def one(t: str) -> dict:
        try:
            df, info = fetch_ticker(t, req.range)
            res = analyze(df, p)
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
            "last_signal": recent[-1].to_dict() if recent else None,
        }

    with ThreadPoolExecutor(max_workers=6) as ex:
        results = list(ex.map(one, tickers))
    results.sort(key=lambda r: r.get("score", -1), reverse=True)
    return {"results": results}


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
