"""거래량 기반 세력 매집 흔적 분석 엔진.

입력: 일봉 OHLCV DataFrame (index=DatetimeIndex, columns=Open/High/Low/Close/Volume)
출력: 보조지표 시계열, 날짜별 매집 신호, 종합 매집 점수(0~100)
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

REQUIRED_COLUMNS = ["Open", "High", "Low", "Close", "Volume"]
MIN_BARS = 30
WEIGHTS_FILE = Path(__file__).resolve().parent / "weights.json"
# 최초 설계 배점 (백테스트 보정 전)
LEGACY_WEIGHTS = {"events": 25, "obv": 20, "cmf": 15, "updown": 15, "dry_up": 10, "base": 10, "avwap": 5, "flow": 20}


@lru_cache(maxsize=1)
def load_weights() -> dict:
    """백테스트로 보정한 배점(app/weights.json)을 읽음. 파일이 없으면 최초 설계 배점."""
    try:
        return dict(json.loads(WEIGHTS_FILE.read_text(encoding="utf-8"))["weights"])
    except (OSError, KeyError, ValueError):
        return dict(LEGACY_WEIGHTS)


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
    flow_ratio: float = 0.08         # 기관·외국인 매집: 20일 순매수 / 거래량 비율 하한
    weights: dict | None = None      # 점수 항목별 배점. None이면 app/weights.json (없으면 LEGACY_WEIGHTS)


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
    "smart_money": "기관·외국인 매집",
}
SPIKE_TYPES = ("entry", "absorption", "lower_tail")


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
    """날짜별 매집 신호 탐지. 'dry_up'을 제외한 모든 신호는 해당 날짜까지의 데이터만 사용(백테스트 가능)."""
    signals: list[Signal] = []
    dates = ind.index.strftime("%Y-%m-%d")
    o, h, l, c, v = (ind[k].to_numpy(dtype=float) for k in REQUIRED_COLUMNS)
    vr = ind["VolRatio"].to_numpy(dtype=float)
    chg = ind["Change"].to_numpy(dtype=float)
    lt = ind["LowerTail"].to_numpy(dtype=float)
    ut = ind["UpperTail"].to_numpy(dtype=float)
    body = ind["Body"].to_numpy(dtype=float)
    obv = ind["OBV"].to_numpy(dtype=float)
    smart = ind["SmartNet"].to_numpy(dtype=float) if "SmartNet" in ind else None

    def add(i: int, typ: str, strength: float, detail: str) -> None:
        if smart is not None and np.isfinite(smart[i]) and typ in SPIKE_TYPES:
            detail += f" · 기관+외국인 {smart[i]:+,.0f}주"
        signals.append(Signal(
            date=dates[i], type=typ, label=SIGNAL_LABELS[typ],
            strength=round(float(min(max(strength, 0), 1)), 3),
            price=float(c[i]), volume=float(v[i]), detail=detail,
        ))

    n = len(ind)
    rng = h - l
    with np.errstate(divide="ignore", invalid="ignore"):
        ok = np.isfinite(vr) & (rng > 0)
        # 1) 세력 진입봉: 대량 거래 + 장대양봉 + 고가 근처 마감
        entry = ok & (vr >= p.entry_ratio) & (c > o) & ((c - o) / o >= p.entry_body) & ((h - c) / rng <= 0.3)
        # 2) 흡수형 매집봉: 거래량은 터졌는데 가격은 거의 안 움직임 → 매도 물량을 누군가 받아냄
        absorb = ok & ~entry & (vr >= p.spike_ratio) & (np.abs(chg) <= p.absorb_max_move)
        # 3) 아래꼬리 매집: 장중 투매를 받아내 긴 아래꼬리 형성
        tail = (ok & (vr >= p.tail_ratio) & (lt / rng >= 0.5)
                & (lt >= 2 * np.maximum(body, rng * 0.05)) & (ut / rng <= 0.25))

    for i in np.flatnonzero(entry):
        add(i, "entry", (vr[i] - p.entry_ratio) / 7 + 0.4,
            f"거래량 {vr[i]:.1f}배, 양봉 몸통 {(c[i] - o[i]) / o[i] * 100:.1f}%")
    for i in np.flatnonzero(absorb):
        add(i, "absorption", (vr[i] - p.spike_ratio) / 5 + 0.4,
            f"거래량 {vr[i]:.1f}배인데 등락 {chg[i] * 100:+.1f}%")
    for i in np.flatnonzero(tail):
        add(i, "lower_tail", (lt[i] / rng[i] - 0.5) + vr[i] / 10,
            f"아래꼬리 {lt[i] / c[i] * 100:.1f}%, 거래량 {vr[i]:.1f}배")

    # 4) OBV 상승 다이버전스 / 5) 기관·외국인 매집: 주가는 횡보·하락인데 순매수 누적
    w = p.divergence_window
    if n > w:
        vol_sum = np.convolve(v, np.ones(w), "valid")              # i = w-1 .. n-1
        price_tr = c[w - 1:] / c[:n - w + 1] - 1
        obv_tr = (obv[w - 1:] - obv[:n - w + 1]) / np.where(vol_sum > 0, vol_sum, 1)
        flat = price_tr <= 0.03
        last = -999
        for k in np.flatnonzero(flat & (obv_tr >= 0.25)):
            i = k + w - 1
            if i - last >= w // 2:
                add(i, "obv_divergence", obv_tr[k],
                    f"{w}일간 주가 {price_tr[k] * 100:+.1f}%, OBV 순유입 {obv_tr[k] * 100:.0f}%")
                last = i
        if smart is not None:
            sm = np.nan_to_num(smart)
            known = np.convolve(np.isfinite(smart).astype(float), np.ones(w), "valid")
            sm_tr = np.convolve(sm, np.ones(w), "valid") / np.where(vol_sum > 0, vol_sum, 1)
            last = -999
            for k in np.flatnonzero(flat & (sm_tr >= p.flow_ratio) & (known >= w * 0.8)):
                i = k + w - 1
                if i - last >= w // 2:
                    add(i, "smart_money", sm_tr[k] / (p.flow_ratio * 3),
                        f"{w}일간 주가 {price_tr[k] * 100:+.1f}%, 기관+외국인 순매수 = 거래량의 {sm_tr[k] * 100:.1f}%")
                    last = i

    # 6) 거래량 급감(물량 잠김): 급증 이후 거래가 말라붙었는데 가격은 급증일 저가 위 유지
    spike_idx = np.flatnonzero(entry | absorb | tail)
    if len(spike_idx) and n >= 10:
        idx = int(spike_idx[-1])
        if n - idx - 1 >= 5:
            base_vol = v[max(0, idx - 60):idx].mean() if idx > 0 else 0
            if base_vol > 0:
                dry = v[-5:].mean() / base_vol
                if dry <= 0.6 and c[-5:].min() >= l[idx]:
                    add(n - 1, "dry_up", 1 - dry,
                        f"최근 5일 거래량이 평소의 {dry * 100:.0f}% 수준, 주가는 {dates[idx]} 매집봉 저가 위 유지")

    signals.sort(key=lambda s: (s.date, s.type))
    return signals


def _anchored_vwap(ind: pd.DataFrame, anchor: int) -> pd.Series:
    seg = ind.iloc[anchor:]
    tp = (seg["High"] + seg["Low"] + seg["Close"]) / 3
    return (tp * seg["Volume"]).cumsum() / seg["Volume"].cumsum()


def compute_components(ind: pd.DataFrame, signals: list[Signal], p: Params) -> tuple[dict, dict]:
    """점수 구성 요소를 0~1로 정규화해서 계산. 반환: ({key: (값, 라벨, 근거)}, 요약용 중간값)."""
    win = ind.iloc[-p.lookback:]
    start_date = win.index[0].strftime("%Y-%m-%d")
    recent = [s for s in signals if s.date >= start_date]
    comp: dict[str, tuple[float, str, str]] = {}

    # 매집 이벤트 빈도: 이벤트 1건당 6~12점, 25점에서 포화 (전체 / 유형별)
    def ev_norm(types: tuple) -> tuple[float, int]:
        ev = [s for s in recent if s.type in types]
        return min(1.0, sum(6 + 6 * s.strength for s in ev) / 25), len(ev)

    v, n = ev_norm(SPIKE_TYPES)
    comp["events"] = (v, "매집성 거래 이벤트", f"최근 {p.lookback}일 매집봉/진입봉/아래꼬리 {n}회")
    for typ in SPIKE_TYPES:
        v, n = ev_norm((typ,))
        comp[f"ev_{typ}"] = (v, f"{SIGNAL_LABELS[typ]} 빈도", f"최근 {p.lookback}일 {n}회")

    # OBV 다이버전스: 구간 OBV 순증가분 / 구간 총거래량 (-1 ~ +1)
    obv_trend = float((win["OBV"].iloc[-1] - win["OBV"].iloc[0]) / (win["Volume"].sum() or 1.0))
    price_trend = win["Close"].iloc[-1] / win["Close"].iloc[0] - 1
    div_cnt = sum(1 for s in recent if s.type == "obv_divergence")
    obv_v = min(1.0, (div_cnt * 8 + float(np.clip(obv_trend / 0.3, 0, 1)) * 8
                      + (4 if obv_trend > 0 and price_trend < 0.05 else 0)) / 20)
    comp["obv"] = (obv_v, "OBV 다이버전스", f"OBV 추세 {obv_trend:+.2f}, 주가 {price_trend * 100:+.1f}%, 다이버전스 {div_cnt}회")

    cmf = float(ind["CMF"].iloc[-1]) if np.isfinite(ind["CMF"].iloc[-1]) else 0.0
    cmf_avg = float(win["CMF"].dropna().mean()) if win["CMF"].notna().any() else 0.0
    comp["cmf"] = (float(np.clip((cmf_avg + 0.05) / 0.25, 0, 1)), "CMF 자금 유입",
                   f"현재 CMF {cmf:+.3f}, 구간 평균 {cmf_avg:+.3f}")

    udr = float(win["UpDownRatio"].dropna().iloc[-1]) if win["UpDownRatio"].notna().any() else 1.0
    comp["updown"] = (float(np.clip((udr - 0.9) / 1.1, 0, 1)), "상승일 거래량 우위",
                      f"최근 20일 상승일/하락일 거래량 비 {udr:.2f}")

    dry = [s for s in recent if s.type == "dry_up"]
    comp["dry_up"] = (min(1.0, max((s.strength for s in dry), default=0) / 0.6), "급증 후 거래량 급감",
                      dry[-1].detail if dry else "해당 없음")

    base = ind.iloc[-p.base_window:]
    width = float((base["High"].max() - base["Low"].min()) / base["Close"].iloc[-1])
    comp["base"] = (float(np.clip((p.base_width * 2 - width) / p.base_width, 0, 1)), "박스권 수렴",
                    f"최근 {p.base_window}일 변동폭 {width * 100:.1f}%")

    lb = ind.iloc[-max(p.lookback * 2, 60):]
    anchor_label = lb["Volume"].idxmax()
    anchor = ind.index.get_loc(anchor_label)
    avwap_last = float(_anchored_vwap(ind, anchor).iloc[-1])
    last_close = float(ind["Close"].iloc[-1])
    gap = last_close / avwap_last - 1
    comp["avwap"] = (1.0 if gap >= 0 else float(np.clip(1 + gap / 0.1, 0, 1)) * 0.5, "세력 평단 위 유지",
                     f"{anchor_label:%Y-%m-%d} 최대거래일 기준 VWAP {avwap_last:,.0f} 대비 {gap * 100:+.1f}%")

    # 기관·외국인 수급 (국내 종목 수급 데이터가 있을 때만)
    flow_summary = {}
    if "SmartNet" in ind and win["SmartNet"].notna().sum() >= min(20, len(win)) * 0.8:
        w20 = ind.iloc[-20:]
        r20 = float(w20["SmartNet"].sum() / (w20["Volume"].sum() or 1.0))
        r_lb = float(win["SmartNet"].sum() / (win["Volume"].sum() or 1.0))
        hold = win["ForeignHold"].dropna()
        hold_chg = float(hold.iloc[-1] - hold.iloc[0]) if len(hold) >= 2 else 0.0
        comp["flow"] = ((float(np.clip(r20 / 0.08, 0, 1)) * 10 + float(np.clip(r_lb / 0.05, 0, 1)) * 6
                         + (4.0 if hold_chg > 0 else 0.0)) / 20, "기관·외국인 순매수",
                        f"20일 순매수 = 거래량의 {r20 * 100:+.1f}%, {p.lookback}일 {r_lb * 100:+.1f}%, "
                        f"외국인 지분율 {hold_chg:+.2f}%p")
        flow_summary = {
            "foreign_20": float(w20["Foreign"].sum()),
            "organ_20": float(w20["Organ"].sum()),
            "individual_20": float(w20["Individual"].sum()),
            "smart_ratio_20": r20,
            "foreign_hold": float(hold.iloc[-1]) if len(hold) else None,
            "foreign_hold_change": hold_chg,
        }

    extra = {"recent": recent, "lb": lb, "cmf": cmf, "udr": udr, "anchor_label": anchor_label,
             "avwap_last": avwap_last, "last_close": last_close, "flow_summary": flow_summary}
    return comp, extra


def score_accumulation(ind: pd.DataFrame, signals: list[Signal], p: Params) -> tuple[float, list[ScoreItem], dict]:
    comp, x = compute_components(ind, signals, p)
    weights = p.weights if p.weights is not None else load_weights()
    items = [ScoreItem(k, comp[k][1], comp[k][0] * w, w, comp[k][2])
             for k, w in weights.items() if w > 0 and k in comp]
    max_total = sum(i.max_score for i in items)
    total = round(sum(i.score for i in items) / max_total * 100, 1) if max_total else 0.0
    for it in items:
        it.score = round(it.score, 1)
        it.max_score = round(it.max_score, 1)
    recent, lb, last_close = x["recent"], x["lb"], x["last_close"]
    anchor_label, avwap_last, cmf, udr = x["anchor_label"], x["avwap_last"], x["cmf"], x["udr"]
    flow_summary = x["flow_summary"]

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
        "flow": flow_summary or None,
        "components": {k: round(v[0], 4) for k, v in comp.items()},
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


FLOW_COLUMNS = ["Foreign", "Organ", "Individual", "ForeignHold"]


def attach_flow(ind: pd.DataFrame, flow: pd.DataFrame | None) -> pd.DataFrame:
    """투자자별 순매수(주)를 일봉에 붙임. SmartNet = 기관 + 외국인."""
    if flow is None or flow.empty:
        return ind
    f = flow.reindex(ind.index)[FLOW_COLUMNS]
    if f["Foreign"].notna().sum() < 5:
        return ind
    ind = ind.join(f)
    ind["SmartNet"] = ind["Foreign"] + ind["Organ"]
    return ind


def analyze(df: pd.DataFrame, params: Params | None = None, flow: pd.DataFrame | None = None) -> AnalysisResult:
    p = params or Params()
    df = normalize_ohlcv(df)
    if len(df) < MIN_BARS:
        raise ValueError(f"분석에는 최소 {MIN_BARS}거래일 데이터가 필요합니다 (현재 {len(df)}일)")
    ind = attach_flow(compute_indicators(df, p), flow)
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

    has_flow = "SmartNet" in ind
    flow_series = {}
    if has_flow:
        for col, key in (("Foreign", "foreign_cum"), ("Organ", "organ_cum"), ("Individual", "individual_cum")):
            known = ind[col].notna()
            cum = ind[col].fillna(0).cumsum().where(known.cummax())
            flow_series[key] = [None if not np.isfinite(x) else float(x) for x in cum.to_numpy(dtype=float)]

    return {
        "score": res.score,
        "has_flow": has_flow,
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
            **flow_series,
        },
    }
