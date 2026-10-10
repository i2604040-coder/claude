"""거래량 기반 세력 매집 흔적 분석 엔진.

입력: 일봉 OHLCV DataFrame (index=DatetimeIndex, columns=Open/High/Low/Close/Volume)
출력: 보조지표 시계열, 날짜별 매집 신호, 종합 매집 점수(0~100)
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

REQUIRED_COLUMNS = ["Open", "High", "Low", "Close", "Volume"]
MIN_BARS = 30


@dataclass
class Params:
    vol_ma: int = 20                 # 기준 평균 거래량 기간
    spike_ratio: float = 2.5         # 거래량 급증 판정 배수
    absorb_max_move: float = 0.02    # 흡수형 매집: 급증일 종가 변동 한도(±2%)
    entry_ratio: float = 3.0         # 세력 진입봉: 거래량 배수
    entry_body: float = 0.05         # 세력 진입봉: 몸통 크기(시가 대비 5%)
    tail_ratio: float = 1.5          # 아래꼬리 매집: 거래량 배수
    lookback: int = 60               # 점수 산정 구간
    cmf_period: int = 20
    divergence_window: int = 20
    base_window: int = 20
    base_width: float = 0.12         # 박스권 폭(고가-저가)/종가 한도


@dataclass
class Signal:
    date: str
    type: str
    label: str
    strength: float
    price: float
    volume: float
    detail: str

    def to_dict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class ScoreItem:
    key: str
    label: str
    score: float
    max_score: float
    detail: str

    def to_dict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class AnalysisResult:
    indicators: pd.DataFrame
    signals: list[Signal]
    score: float
    grade: str
    breakdown: list[ScoreItem]
    summary: dict = field(default_factory=dict)


SIGNAL_LABELS = {
    "absorption": "흡수형 매집봉",
    "entry": "세력 진입봉",
    "lower_tail": "아래꼬리 매집",
    "dry_up": "거래량 급감(물량 잠김)",
    "obv_divergence": "OBV 상승 다이버전스",
}


def normalize_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    """컬럼명 정규화, 결측/0거래량 제거, 날짜 정렬."""
    rename = {}
    aliases = {
        "open": "Open", "시가": "Open",
        "high": "High", "고가": "High",
        "low": "Low", "저가": "Low",
        "close": "Close", "종가": "Close", "adj close": None,
        "volume": "Volume", "거래량": "Volume",
    }
    for col in df.columns:
        key = str(col).strip().lower()
        if key in aliases and aliases[key]:
            rename[col] = aliases[key]
        elif str(col).strip() in aliases and aliases[str(col).strip()]:
            rename[col] = aliases[str(col).strip()]
    df = df.rename(columns=rename)
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"필수 컬럼 누락: {', '.join(missing)}")
    df = df[REQUIRED_COLUMNS].apply(pd.to_numeric, errors="coerce").dropna()
    df = df[(df["Volume"] > 0) & (df["High"] >= df["Low"])]
    df = df[~df.index.duplicated(keep="last")].sort_index()
    return df


def compute_indicators(df: pd.DataFrame, p: Params) -> pd.DataFrame:
    o, h, l, c, v = (df[k] for k in REQUIRED_COLUMNS)
    out = df.copy()

    out["VolMA"] = v.rolling(p.vol_ma, min_periods=5).mean()
    # 당일 제외 평균과 비교해야 급증일 자체가 기준을 끌어올리지 않음
    prev_ma = v.shift(1).rolling(p.vol_ma, min_periods=5).mean()
    out["VolRatio"] = v / prev_ma
    out["Change"] = c.pct_change()

    direction = np.sign(c.diff()).fillna(0)
    out["OBV"] = (direction * v).cumsum()

    rng = (h - l).replace(0, np.nan)
    mfm = (((c - l) - (h - c)) / rng).fillna(0)
    mfv = mfm * v
    out["AD"] = mfv.cumsum()
    out["CMF"] = mfv.rolling(p.cmf_period).sum() / v.rolling(p.cmf_period).sum()

    up_vol = v.where(c.diff() > 0, 0.0)
    down_vol = v.where(c.diff() < 0, 0.0)
    out["UpDownRatio"] = up_vol.rolling(20).sum() / down_vol.rolling(20).sum().replace(0, np.nan)

    body = (c - o).abs()
    out["LowerTail"] = np.minimum(o, c) - l
    out["UpperTail"] = h - np.maximum(o, c)
    out["Body"] = body
    return out


def detect_signals(ind: pd.DataFrame, p: Params) -> list[Signal]:
    signals: list[Signal] = []

    def add(i: int, typ: str, strength: float, detail: str) -> None:
        row = ind.iloc[i]
        signals.append(Signal(
            date=ind.index[i].strftime("%Y-%m-%d"),
            type=typ,
            label=SIGNAL_LABELS[typ],
            strength=round(float(min(max(strength, 0), 1)), 3),
            price=float(row["Close"]),
            volume=float(row["Volume"]),
            detail=detail,
        ))

    n = len(ind)
    last_obv_div = -999
    for i in range(1, n):
        r = ind.iloc[i]
        vr = r["VolRatio"]
        if not np.isfinite(vr):
            continue
        o, h, l, c = r["Open"], r["High"], r["Low"], r["Close"]
        chg = r["Change"]
        rng = h - l

        # 1) 세력 진입봉: 대량 거래 + 장대양봉 + 고가 근처 마감
        if vr >= p.entry_ratio and c > o and (c - o) / o >= p.entry_body and rng > 0 and (h - c) / rng <= 0.3:
            add(i, "entry", (vr - p.entry_ratio) / 7 + 0.4,
                f"거래량 {vr:.1f}배, 양봉 몸통 {(c - o) / o * 100:.1f}%")
        # 2) 흡수형 매집봉: 거래량은 터졌는데 가격은 거의 안 움직임 → 매도 물량을 누군가 받아냄
        elif vr >= p.spike_ratio and abs(chg) <= p.absorb_max_move:
            add(i, "absorption", (vr - p.spike_ratio) / 5 + 0.4,
                f"거래량 {vr:.1f}배인데 등락 {chg * 100:+.1f}%")

        # 3) 아래꼬리 매집: 장중 투매를 받아내 긴 아래꼬리 형성
        lt, body = r["LowerTail"], r["Body"]
        if vr >= p.tail_ratio and rng > 0 and lt / rng >= 0.5 and lt >= 2 * max(body, rng * 0.05) and r["UpperTail"] / rng <= 0.25:
            add(i, "lower_tail", (lt / rng - 0.5) + vr / 10,
                f"아래꼬리 {lt / c * 100:.1f}%, 거래량 {vr:.1f}배")

        # 4) OBV 상승 다이버전스: 주가는 횡보/하락인데 OBV는 상승
        w = p.divergence_window
        if i >= w and i - last_obv_div >= w // 2:
            win = ind.iloc[i - w + 1:i + 1]
            price_trend = win["Close"].iloc[-1] / win["Close"].iloc[0] - 1
            obv = win["OBV"]
            obv_scale = win["Volume"].sum() or 1.0
            obv_trend = (obv.iloc[-1] - obv.iloc[0]) / obv_scale
            if price_trend <= 0.03 and obv_trend >= 0.25:
                add(i, "obv_divergence", obv_trend,
                    f"{w}일간 주가 {price_trend * 100:+.1f}%, OBV 순유입 {obv_trend * 100:.0f}%")
                last_obv_div = i

    # 5) 거래량 급감(물량 잠김): 급증 이후 거래가 말라붙었는데 가격은 급증일 저가 위 유지
    spikes = [s for s in signals if s.type in ("entry", "absorption", "lower_tail")]
    if spikes and n >= 10:
        last_spike = max(spikes, key=lambda s: s.date)
        idx = ind.index.get_loc(pd.Timestamp(last_spike.date))
        after = ind.iloc[idx + 1:]
        if len(after) >= 5:
            recent = after.iloc[-5:]
            base_vol = ind["Volume"].iloc[max(0, idx - 60):idx].mean()
            spike_low = ind["Low"].iloc[idx]
            if base_vol > 0:
                dry = recent["Volume"].mean() / base_vol
                if dry <= 0.6 and recent["Close"].min() >= spike_low:
                    add(n - 1, "dry_up", 1 - dry,
                        f"최근 5일 거래량이 평소의 {dry * 100:.0f}% 수준, 주가는 {last_spike.date} 매집봉 저가 위 유지")

    signals.sort(key=lambda s: s.date)
    return signals


def _anchored_vwap(ind: pd.DataFrame, anchor: int) -> pd.Series:
    seg = ind.iloc[anchor:]
    tp = (seg["High"] + seg["Low"] + seg["Close"]) / 3
    return (tp * seg["Volume"]).cumsum() / seg["Volume"].cumsum()


def score_accumulation(ind: pd.DataFrame, signals: list[Signal], p: Params) -> tuple[float, list[ScoreItem], dict]:
    win = ind.iloc[-p.lookback:]
    start_date = win.index[0].strftime("%Y-%m-%d")
    recent = [s for s in signals if s.date >= start_date]
    items: list[ScoreItem] = []

    # 1. 매집 이벤트 빈도 (25)
    ev = [s for s in recent if s.type in ("entry", "absorption", "lower_tail")]
    ev_score = min(25.0, sum(6 + 6 * s.strength for s in ev))
    items.append(ScoreItem("events", "매집성 거래 이벤트", ev_score, 25,
                           f"최근 {p.lookback}일 매집봉/진입봉/아래꼬리 {len(ev)}회"))

    # 2. OBV 다이버전스 + OBV 추세 (20)
    # 구간 OBV 순증가분 / 구간 총거래량 (-1 ~ +1)
    obv_trend = float((win["OBV"].iloc[-1] - win["OBV"].iloc[0]) / (win["Volume"].sum() or 1.0))
    price_trend = win["Close"].iloc[-1] / win["Close"].iloc[0] - 1
    div_cnt = sum(1 for s in recent if s.type == "obv_divergence")
    obv_score = min(20.0, div_cnt * 8 + float(np.clip(obv_trend / 0.3, 0, 1)) * 8 + (4 if obv_trend > 0 and price_trend < 0.05 else 0))
    items.append(ScoreItem("obv", "OBV 다이버전스", obv_score, 20,
                           f"OBV 추세 {obv_trend:+.2f}, 주가 {price_trend * 100:+.1f}%, 다이버전스 {div_cnt}회"))

    # 3. CMF 자금 유입 (15)
    cmf = float(ind["CMF"].iloc[-1]) if np.isfinite(ind["CMF"].iloc[-1]) else 0.0
    cmf_avg = float(win["CMF"].dropna().mean()) if win["CMF"].notna().any() else 0.0
    cmf_score = float(np.clip((cmf_avg + 0.05) / 0.25, 0, 1) * 15)
    items.append(ScoreItem("cmf", "CMF 자금 유입", cmf_score, 15,
                           f"현재 CMF {cmf:+.3f}, 구간 평균 {cmf_avg:+.3f}"))

    # 4. 상승일/하락일 거래량 비 (15)
    udr = float(win["UpDownRatio"].dropna().iloc[-1]) if win["UpDownRatio"].notna().any() else 1.0
    udr_score = float(np.clip((udr - 0.9) / 1.1, 0, 1) * 15)
    items.append(ScoreItem("updown", "상승일 거래량 우위", udr_score, 15,
                           f"최근 20일 상승일/하락일 거래량 비 {udr:.2f}"))

    # 5. 거래량 급감(물량 잠김) (10)
    dry = [s for s in recent if s.type == "dry_up"]
    dry_score = 10.0 * max((s.strength for s in dry), default=0) / 0.6
    dry_score = min(10.0, dry_score)
    items.append(ScoreItem("dry_up", "급증 후 거래량 급감", dry_score, 10,
                           dry[-1].detail if dry else "해당 없음"))

    # 6. 박스권 수렴 (10)
    base = ind.iloc[-p.base_window:]
    width = float((base["High"].max() - base["Low"].min()) / base["Close"].iloc[-1])
    base_score = float(np.clip((p.base_width * 2 - width) / p.base_width, 0, 1) * 10)
    items.append(ScoreItem("base", "박스권 수렴", base_score, 10,
                           f"최근 {p.base_window}일 변동폭 {width * 100:.1f}%"))

    # 7. 세력 평단(대량거래일 앵커 VWAP) 위 유지 (5)
    lb = ind.iloc[-max(p.lookback * 2, 60):]
    anchor_label = lb["Volume"].idxmax()
    anchor = ind.index.get_loc(anchor_label)
    avwap = _anchored_vwap(ind, anchor)
    last_close = float(ind["Close"].iloc[-1])
    avwap_last = float(avwap.iloc[-1])
    gap = last_close / avwap_last - 1
    vwap_score = 5.0 if gap >= 0 else float(np.clip(1 + gap / 0.1, 0, 1) * 2.5)
    items.append(ScoreItem("avwap", "세력 평단 위 유지", vwap_score, 5,
                           f"{anchor_label:%Y-%m-%d} 최대거래일 기준 VWAP {avwap_last:,.0f} 대비 {gap * 100:+.1f}%"))

    total = round(sum(i.score for i in items), 1)
    for it in items:
        it.score = round(it.score, 1)

    # 매집 신호일들의 거래량가중 평균가 = 추정 세력 평단 (최근 lookback*2 구간)
    cost_start = lb.index[0].strftime("%Y-%m-%d")
    acc = [s for s in signals if s.type in ("entry", "absorption", "lower_tail") and s.date >= cost_start]
    est_cost = None
    if acc:
        vol = sum(s.volume for s in acc)
        est_cost = sum(s.price * s.volume for s in acc) / vol if vol else None

    summary = {
        "last_date": ind.index[-1].strftime("%Y-%m-%d"),
        "last_close": last_close,
        "change": float(ind["Change"].iloc[-1]) if np.isfinite(ind["Change"].iloc[-1]) else 0.0,
        "volume": float(ind["Volume"].iloc[-1]),
        "vol_ratio": float(ind["VolRatio"].iloc[-1]) if np.isfinite(ind["VolRatio"].iloc[-1]) else None,
        "cmf": cmf,
        "updown_ratio": udr,
        "anchor_date": anchor_label.strftime("%Y-%m-%d"),
        "anchor_vwap": avwap_last,
        "estimated_cost": est_cost,
        "cost_gap": (last_close / est_cost - 1) if est_cost else None,
        "recent_signal_count": len(recent),
        "lookback": p.lookback,
    }
    return total, items, summary


def grade_of(score: float) -> str:
    if score >= 70:
        return "강한 매집 의심"
    if score >= 50:
        return "매집 가능성"
    if score >= 30:
        return "관찰 필요"
    return "특이사항 없음"


def analyze(df: pd.DataFrame, params: Params | None = None) -> AnalysisResult:
    p = params or Params()
    df = normalize_ohlcv(df)
    if len(df) < MIN_BARS:
        raise ValueError(f"분석에는 최소 {MIN_BARS}거래일 데이터가 필요합니다 (현재 {len(df)}일)")
    ind = compute_indicators(df, p)
    signals = detect_signals(ind, p)
    score, breakdown, summary = score_accumulation(ind, signals, p)
    ind["AVWAP"] = np.nan
    anchor = ind.index.get_loc(pd.Timestamp(summary["anchor_date"]))
    ind.iloc[anchor:, ind.columns.get_loc("AVWAP")] = _anchored_vwap(ind, anchor).to_numpy()
    return AnalysisResult(ind, signals, score, grade_of(score), breakdown, summary)


def result_to_json(res: AnalysisResult) -> dict:
    ind = res.indicators

    def series(col: str, digits: int = 4) -> list:
        vals = ind[col].to_numpy(dtype=float)
        return [None if not np.isfinite(x) else round(float(x), digits) for x in vals]

    return {
        "score": res.score,
        "grade": res.grade,
        "breakdown": [b.to_dict() for b in res.breakdown],
        "summary": res.summary,
        "signals": [s.to_dict() for s in res.signals],
        "series": {
            "dates": [d.strftime("%Y-%m-%d") for d in ind.index],
            "open": series("Open", 2),
            "high": series("High", 2),
            "low": series("Low", 2),
            "close": series("Close", 2),
            "volume": series("Volume", 0),
            "vol_ma": series("VolMA", 0),
            "vol_ratio": series("VolRatio", 2),
            "obv": series("OBV", 0),
            "ad": series("AD", 0),
            "cmf": series("CMF", 4),
            "avwap": series("AVWAP", 2),
        },
    }
