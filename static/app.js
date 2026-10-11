"use strict";

const $ = (sel) => document.querySelector(sel);
const fmt = (n, d = 0) => (n == null || !isFinite(n) ? "-" : Number(n).toLocaleString("ko-KR", { maximumFractionDigits: d, minimumFractionDigits: d }));
const pct = (x, d = 1) => (x == null || !isFinite(x) ? "-" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);
const fmtVol = (v) => {
  if (v == null) return "-";
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}만`;
  return fmt(v);
};
let PD = 2; // 가격 소수 자릿수 (원화는 0)
const pdOf = (cur) => (cur === "KRW" ? 0 : 2);
const signedVol = (v) => (v == null ? "-" : `${v >= 0 ? "+" : "-"}${fmtVol(Math.abs(v))}`);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SIGNAL_COLORS = {
  entry: "#e03131", absorption: "#f08c00", lower_tail: "#7048e8", obv_divergence: "#1098ad", dry_up: "#2f9e44", smart_money: "#c2255c",
};
const SIGNAL_SHORT = { entry: "진입", absorption: "흡수", lower_tail: "꼬리", obv_divergence: "OBV", dry_up: "잠김", smart_money: "수급" };
const SIGNAL_NAMES = { entry: "세력 진입봉", absorption: "흡수형 매집봉", lower_tail: "아래꼬리 매집", obv_divergence: "OBV 상승 다이버전스", smart_money: "기관·외국인 매집", dry_up: "거래량 급감" };
const ABOVE_TYPES = new Set(["obv_divergence", "dry_up", "smart_money"]);

function gradeClass(score) {
  if (score >= 70) return "g-strong";
  if (score >= 50) return "g-mid";
  if (score >= 30) return "g-watch";
  return "g-none";
}
function gradeColor(score) {
  return getComputedStyle(document.documentElement).getPropertyValue(
    score >= 70 ? "--s-strong" : score >= 50 ? "--s-mid" : score >= 30 ? "--s-watch" : "--s-none").trim();
}

/* ---------- tabs ---------- */
document.querySelectorAll(".tab").forEach((btn) =>
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${btn.dataset.tab}`));
    if (btn.dataset.tab === "single") charts.forEach((c) => c.chart.timeScale().fitContent());
  }));

/* ---------- charts ---------- */
let charts = [];
function themeOpts() {
  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue("--muted").trim();
  const grid = css.getPropertyValue("--border").trim();
  return {
    layout: { background: { color: "transparent" }, textColor: text, fontFamily: "inherit" },
    grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    rightPriceScale: { borderColor: grid, minimumWidth: 80 },
    timeScale: { borderColor: grid, timeVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    localization: { locale: "ko-KR" },
  };
}

function destroyCharts() {
  charts.forEach((c) => c.chart.remove());
  charts = [];
}

function syncCharts() {
  let syncing = false;
  charts.forEach((src) => {
    src.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncing || !range) return;
      syncing = true;
      charts.forEach((dst) => dst !== src && dst.chart.timeScale().setVisibleLogicalRange(range));
      syncing = false;
    });
  });
}

function renderCharts(data) {
  destroyCharts();
  const s = data.series;
  const css = getComputedStyle(document.documentElement);
  const up = css.getPropertyValue("--up").trim();
  const down = css.getPropertyValue("--down").trim();
  const accent = css.getPropertyValue("--accent").trim();
  const pt = (arr) => s.dates.map((t, i) => (arr[i] == null ? null : { time: t, value: arr[i] })).filter(Boolean);

  // price
  const priceEl = $("#price-chart");
  const price = LightweightCharts.createChart(priceEl, { ...themeOpts(), height: priceEl.clientHeight });
  const candles = price.addCandlestickSeries({
    upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down,
    priceFormat: { type: "price", precision: PD, minMove: PD ? 0.01 : 1 },
  });
  candles.setData(s.dates.map((t, i) => ({ time: t, open: s.open[i], high: s.high[i], low: s.low[i], close: s.close[i] })));
  const avwap = price.addLineSeries({ color: accent, lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: true, title: "세력평단(VWAP)", priceFormat: { type: "price", precision: PD, minMove: PD ? 0.01 : 1 } });
  avwap.setData(pt(s.avwap));
  if (data.summary.estimated_cost) {
    candles.createPriceLine({ price: data.summary.estimated_cost, color: "#f08c00", lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: true, title: "추정 매집단가" });
  }
  candles.setMarkers(data.signals.map((sig) => ({
    time: sig.date,
    position: ABOVE_TYPES.has(sig.type) ? "aboveBar" : "belowBar",
    color: SIGNAL_COLORS[sig.type],
    shape: ABOVE_TYPES.has(sig.type) ? "circle" : "arrowUp",
    text: SIGNAL_SHORT[sig.type],
  })));
  charts.push({ chart: price, el: priceEl });

  // volume
  const volEl = $("#volume-chart");
  const vol = LightweightCharts.createChart(volEl, { ...themeOpts(), height: volEl.clientHeight });
  const sigDates = new Set(data.signals.filter((x) => !ABOVE_TYPES.has(x.type)).map((x) => x.date));
  const volSeries = vol.addHistogramSeries({ priceFormat: { type: "volume" }, priceLineVisible: false });
  volSeries.setData(s.dates.map((t, i) => ({
    time: t, value: s.volume[i],
    color: sigDates.has(t) ? "#f08c00" : (s.close[i] >= s.open[i] ? up : down) + "88",
  })));
  const vma = vol.addLineSeries({ color: accent, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  vma.setData(pt(s.vol_ma));
  charts.push({ chart: vol, el: volEl });

  // OBV + A/D
  const obvEl = $("#obv-chart");
  const obv = LightweightCharts.createChart(obvEl, { ...themeOpts(), height: obvEl.clientHeight, leftPriceScale: { visible: true, borderColor: css.getPropertyValue("--border").trim() } });
  obv.addLineSeries({ color: "#1098ad", lineWidth: 2, priceFormat: { type: "volume" }, title: "OBV", priceLineVisible: false }).setData(pt(s.obv));
  obv.addLineSeries({ color: "#7048e8", lineWidth: 1, priceScaleId: "left", priceFormat: { type: "volume" }, title: "A/D", priceLineVisible: false }).setData(pt(s.ad));
  charts.push({ chart: obv, el: obvEl });

  // CMF
  const cmfEl = $("#cmf-chart");
  const cmf = LightweightCharts.createChart(cmfEl, { ...themeOpts(), height: cmfEl.clientHeight });
  cmf.addHistogramSeries({ priceLineVisible: false, priceFormat: { type: "price", precision: 3, minMove: 0.001 } })
    .setData(pt(s.cmf).map((p) => ({ ...p, color: p.value >= 0 ? up : down })));
  charts.push({ chart: cmf, el: cmfEl });

  // 투자자별 누적 순매수 (국내 종목)
  $("#flow-wrap").hidden = !data.has_flow;
  if (data.has_flow) {
    const flowEl = $("#flow-chart");
    const flow = LightweightCharts.createChart(flowEl, { ...themeOpts(), height: flowEl.clientHeight });
    const add = (key, color, title, width = 2) =>
      flow.addLineSeries({ color, lineWidth: width, title, priceFormat: { type: "volume" }, priceLineVisible: false }).setData(pt(s[key]));
    add("foreign_cum", "#e8590c", "외국인");
    add("organ_cum", "#1971c2", "기관");
    add("individual_cum", "#868e96", "개인", 1);
    charts.push({ chart: flow, el: flowEl });
  }

  syncCharts();
  charts.forEach((c) => c.chart.timeScale().fitContent());

  // legend on crosshair
  const idxOf = new Map(s.dates.map((d, i) => [d, i]));
  const showLegend = (i) => {
    if (i == null) i = s.dates.length - 1;
    const chg = i > 0 ? s.close[i] / s.close[i - 1] - 1 : 0;
    $("#legend").innerHTML = `${s.dates[i]} &nbsp; 시 ${fmt(s.open[i], PD)} 고 ${fmt(s.high[i], PD)} 저 ${fmt(s.low[i], PD)} 종 <b class="${chg >= 0 ? "up" : "down"}">${fmt(s.close[i], PD)} (${pct(chg)})</b> &nbsp; 거래량 ${fmtVol(s.volume[i])} (${s.vol_ratio[i] == null ? "-" : s.vol_ratio[i].toFixed(1) + "배"})`;
  };
  price.subscribeCrosshairMove((p) => showLegend(p.time ? idxOf.get(p.time) : null));
  showLegend();
}

function focusDate(date) {
  const idx = window.__lastData?.series.dates.indexOf(date);
  if (idx == null || idx < 0) return;
  charts[0].chart.timeScale().setVisibleLogicalRange({ from: idx - 40, to: idx + 20 });
  $("#price-chart").scrollIntoView({ behavior: "smooth", block: "center" });
}

window.addEventListener("resize", () => charts.forEach((c) => c.chart.applyOptions({ width: c.el.clientWidth })));

/* ---------- render result ---------- */
function renderResult(data) {
  window.__lastData = data;
  PD = pdOf(data.info.currency);
  EVIDENCE = EVIDENCE_BY[marketOf(data.info.symbol)] || null;
  const { info, summary, score } = data;
  $("#result").hidden = false;
  $("#stock-name").innerHTML = `${esc(info.name)}<small>${esc(info.symbol)} · ${esc(info.exchange)} · ${esc(summary.last_date)} 기준</small>`;
  $("#score").textContent = score.toFixed(1);
  $("#score").className = gradeClass(score);
  $("#grade").textContent = data.grade;
  $("#grade").className = `grade ${gradeClass(score)}`;
  $("#gauge-fill").style.width = `${score}%`;
  $("#gauge-fill").style.background = gradeColor(score);
  const entryV = EVIDENCE ? verdictOf("entry") : null;
  $("#score-note").textContent = EVIDENCE
    ? `최근 세력 진입봉 중심 점수(${EVIDENCE.adopted?.version || ""})입니다. ${EVIDENCE.market === "nasdaq" ? "나스닥 " : ""}${EVIDENCE.universe}종목·5년 검증에서 수익 예측력은 확인되지 않았습니다. ` +
      (entryV?.kind === "vol" ? "진입봉은 이후 급등·급락이 모두 잦아지는 '변동성 확대' 신호에 가깝습니다." : "진입봉도 변동성이 비슷한 종목과 비교하면 뚜렷한 효과가 없었습니다.") + " (백테스트 탭 참고)"
    : "";

  const kpi = (k, v, sub = "", cls = "") => `<div class="kpi"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="s">${sub}</div></div>`;
  $("#kpis").innerHTML = [
    kpi("현재가", fmt(summary.last_close, PD), pct(summary.change), summary.change >= 0 ? "up" : "down"),
    kpi("거래량", fmtVol(summary.volume), summary.vol_ratio ? `20일 평균의 ${summary.vol_ratio.toFixed(2)}배` : ""),
    kpi("추정 매집단가", fmt(summary.estimated_cost, PD), summary.cost_gap != null ? `현재가 ${pct(summary.cost_gap)}` : "매집봉 없음",
      summary.cost_gap >= 0 ? "up" : summary.cost_gap < 0 ? "down" : ""),
    kpi("세력평단(앵커 VWAP)", fmt(summary.anchor_vwap, PD), `${summary.anchor_date} 최대거래일 기준`),
    kpi("CMF(20)", summary.cmf.toFixed(3), summary.cmf > 0 ? "자금 유입 우위" : "자금 유출 우위", summary.cmf > 0 ? "up" : "down"),
    kpi("상승/하락 거래량비", summary.updown_ratio.toFixed(2), "최근 20일"),
    ...(summary.flow ? [
      kpi("외국인 20일 순매수", `${signedVol(summary.flow.foreign_20)}주`,
        summary.flow.foreign_hold != null ? `지분율 ${summary.flow.foreign_hold.toFixed(2)}% (${summary.flow.foreign_hold_change >= 0 ? "+" : ""}${summary.flow.foreign_hold_change.toFixed(2)}%p)` : "",
        summary.flow.foreign_20 >= 0 ? "up" : "down"),
      kpi("기관 20일 순매수", `${signedVol(summary.flow.organ_20)}주`, `기관+외인 = 거래량의 ${pct(summary.flow.smart_ratio_20)}`,
        summary.flow.organ_20 >= 0 ? "up" : "down"),
    ] : []),
  ].join("");

  $("#breakdown").innerHTML = data.breakdown.map((b) => `
    <div class="bar-row${b.max_score < 0 ? " penalty" : ""}">
      <span class="lbl">${esc(b.label)}</span>
      <div class="bar"><div style="width:${(b.score / b.max_score) * 100}%"></div></div>
      <span class="val">${b.max_score < 0 ? `감점 ${b.score}` : `${b.score}/${b.max_score}`}</span>
      <span class="det">${esc(b.detail)}</span>
    </div>`).join("");

  const rows = [...data.signals].reverse().map((sig) => `
    <tr data-date="${sig.date}">
      <td>${sig.date}</td>
      <td><span class="badge b-${sig.type}">${esc(sig.label)}</span></td>
      <td class="num">${Math.round(sig.strength * 100)}</td>
      <td class="num">${fmt(sig.price, PD)}</td>
      <td class="num">${fmtVol(sig.volume)}</td>
      <td class="wrap">${esc(sig.detail)}</td>
      <td>${verdictHtml(sig.type)}</td>
    </tr>`).join("");
  $("#signals tbody").innerHTML = rows || `<tr><td colspan="7">탐지된 신호가 없습니다</td></tr>`;
  $("#signals tbody").querySelectorAll("tr[data-date]").forEach((tr) => tr.addEventListener("click", () => focusDate(tr.dataset.date)));

  renderCharts(data);
}

function setStatus(el, msg, isError = false) {
  el.textContent = msg;
  el.classList.toggle("error", isError);
}

async function readError(res) {
  try { const j = await res.json(); return typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); }
  catch { return `HTTP ${res.status}`; }
}

/* ---------- single analysis ---------- */
async function analyzeTicker(ticker) {
  const status = $("#status");
  const btn = $("#analyze-form button[type=submit]");
  btn.disabled = true;
  setStatus(status, `${ticker} 분석 중…`);
  try {
    const q = new URLSearchParams({ ticker, range: $("#range").value, lookback: $("#lookback").value, spike: $("#spike").value, flow: $("#use-flow").checked });
    const res = await fetch(`/api/analyze?${q}`);
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    renderResult(data);
    setStatus(status, `${data.series.dates.length}거래일 분석 완료 · 신호 ${data.signals.length}건 · 출처 ${data.info.source}`);
    history.replaceState(null, "", `?ticker=${encodeURIComponent(ticker)}`);
  } catch (e) {
    setStatus(status, e.message, true);
  } finally {
    btn.disabled = false;
  }
}

$("#analyze-form").addEventListener("submit", (e) => {
  e.preventDefault();
  analyzeTicker($("#ticker").value.trim());
});

$("#csv").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const status = $("#status");
  setStatus(status, `${file.name} 업로드 분석 중…`);
  const fd = new FormData();
  fd.append("file", file);
  try {
    const q = new URLSearchParams({ lookback: $("#lookback").value, spike: $("#spike").value });
    const res = await fetch(`/api/upload?${q}`, { method: "POST", body: fd });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    renderResult(data);
    setStatus(status, `${file.name}: ${data.series.dates.length}거래일 분석 완료 · 신호 ${data.signals.length}건`);
  } catch (err) {
    setStatus(status, err.message, true);
  } finally {
    e.target.value = "";
  }
});

/* ---------- scanner ---------- */
$("#scan-btn").addEventListener("click", async () => {
  const tickers = $("#scan-list").value.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
  const status = $("#scan-status");
  if (!tickers.length) return setStatus(status, "종목코드를 입력하세요", true);
  const btn = $("#scan-btn");
  btn.disabled = true;
  setStatus(status, `${tickers.length}개 종목 스캔 중…`);
  try {
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers, range: $("#range").value, lookback: +$("#lookback").value, spike: +$("#spike").value, flow: $("#use-flow").checked }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const { results } = await res.json();
    let rank = 0;
    $("#scan-table tbody").innerHTML = results.map((r) => r.error
      ? `<tr><td></td><td>${esc(r.ticker)}</td><td colspan="9" class="down">${esc(r.error)}</td></tr>`
      : `<tr data-ticker="${esc(r.ticker)}">
          <td>${++rank}</td>
          <td><b>${esc(r.name)}</b><br><span class="hint">${esc(r.symbol)}</span></td>
          <td class="num"><b class="${gradeClass(r.score)}">${r.score.toFixed(1)}</b></td>
          <td class="${gradeClass(r.score)}">${esc(r.grade)}</td>
          <td class="num">${fmt(r.last_close, pdOf(r.currency))}</td>
          <td class="num ${r.change >= 0 ? "up" : "down"}">${pct(r.change)}</td>
          <td class="num ${r.cmf >= 0 ? "up" : "down"}">${r.cmf.toFixed(3)}</td>
          <td class="num ${r.smart_ratio_20 == null ? "" : r.smart_ratio_20 >= 0 ? "up" : "down"}">${r.smart_ratio_20 == null ? "-" : pct(r.smart_ratio_20)}</td>
          <td class="num">${pct(r.cost_gap)}</td>
          <td class="num">${r.signal_count}</td>
          <td>${r.last_signal ? `<span class="badge b-${r.last_signal.type}">${esc(r.last_signal.label)}</span> ${r.last_signal.date}` : "-"}</td>
        </tr>`).join("");
    $("#scan-table tbody").querySelectorAll("tr[data-ticker]").forEach((tr) => tr.addEventListener("click", () => {
      $("#ticker").value = tr.dataset.ticker;
      document.querySelector('.tab[data-tab="single"]').click();
      analyzeTicker(tr.dataset.ticker);
    }));
    const ok = results.filter((r) => !r.error).length;
    setStatus(status, `완료: ${ok}/${results.length}개 종목 · 매집 점수 높은 순`);
  } catch (e) {
    setStatus(status, e.message, true);
  } finally {
    btn.disabled = false;
  }
});

/* ---------- 대규모 검증 근거 ---------- */
let EVIDENCE = null;            // 현재 보고 있는 종목 시장의 검증 결과
const EVIDENCE_BY = {};          // kr / nasdaq
let evidenceView = "kr";         // 백테스트 탭 표에서 고른 시장
const marketOf = (symbol) => (/\.(KS|KQ)$/i.test(symbol || "") || /^\d{6}$/.test(symbol || "") ? "kr" : "nasdaq");

function verdictOf(type, ev = EVIDENCE) {
  const tr = ev?.train.by_type[type], te = ev?.test.by_type[type];
  if (!tr || !te) return null;
  // 같은 변동성의 아무 종목 대비: 평균 차이 방향이 두 구간에서 같고 원 t값이 둘 다 |t|≥2일 때만 방향성 인정
  const ex = (x) => x.mean_excess - x.vm_mean;
  // t값도 '같은 변동성 기대값 대비'로 계산한 vm_t 사용 (없으면 원 t값)
  const tv = (x) => (x.vm_t ?? x.t);
  const directional = Math.sign(ex(tr)) === Math.sign(ex(te)) && Math.abs(tv(tr)) >= 2 && Math.abs(tv(te)) >= 2;
  const volUp = [tr, te].every((x) => x.p_big > x.vm_p_big * 1.15 && x.p_crash > x.vm_p_crash * 1.15);
  let kind = "none", label = "효과 불분명";
  if (directional && ex(te) > 0) [kind, label] = volUp ? ["vol", "변동성 확대 · 평균↑"] : ["pos", "평균 우위 ▲"];
  else if (directional) [kind, label] = ["neg", "평균 약세 ▼"];
  else if (volUp) [kind, label] = ["vol", "변동성 확대 (방향 불분명)"];
  return { kind, label, tr, te };
}

const ratio = (a, b) => `${(a * 100).toFixed(1)}% <span class="hint">(평소 ${(b * 100).toFixed(1)}%)</span>`;

function verdictHtml(type) {
  const v = verdictOf(type);
  if (!v) return type === "dry_up" ? `<span class="hint">검증 대상 아님</span>` : "-";
  return `<span class="verdict v-${v.kind}">${v.label}</span><span class="sub">급등 ${(v.te.p_big * 100).toFixed(0)}% · 급락 ${(v.te.p_crash * 100).toFixed(0)}% (평소 ${(v.te.vm_p_big * 100).toFixed(0)}% · ${(v.te.vm_p_crash * 100).toFixed(0)}%)</span>`;
}

function renderEvidence() {
  const EVIDENCE = EVIDENCE_BY[evidenceView];
  if (!EVIDENCE) return;
  document.querySelectorAll("#evidence-market button").forEach((b) => b.classList.toggle("active", b.dataset.m === evidenceView));
  $("#evidence-card").hidden = false;
  $("#evidence-meta").textContent = `${EVIDENCE.universe}종목 · 학습 ${EVIDENCE.train.period.join("~")} · 검증 ${EVIDENCE.test.period.join("~")} · ${EVIDENCE.horizon}거래일 보유`;
  const cell = (x) => `<td class="num"><b class="${x.mean_excess - x.vm_mean >= 0 ? "up" : "down"}">${pct(x.mean_excess - x.vm_mean, 2)}</b>
    <span class="sub">중앙값 ${pct(x.median_excess)} · t=${(x.vm_t ?? x.t).toFixed(1)} · n=${x.n.toLocaleString()}</span>
    <span class="sub">급등 ${ratio(x.p_big, x.vm_p_big)} · 급락 ${ratio(x.p_crash, x.vm_p_crash)}</span></td>`;
  const types = Object.keys(EVIDENCE.test.by_type);
  $("#evidence-table").innerHTML = `<thead><tr><th>신호</th><th class="num">학습 구간</th><th class="num">검증 구간</th><th>판정</th></tr></thead><tbody>` +
    types.map((t) => {
      const v = verdictOf(t, EVIDENCE);
      return `<tr><td><span class="badge b-${t}">${esc(SIGNAL_NAMES[t] || t)}</span></td>${cell(v.tr)}${cell(v.te)}<td><span class="verdict v-${v.kind}">${v.label}</span></td></tr>`;
    }).join("") + "</tbody>";
  const sc = EVIDENCE.score, ad = EVIDENCE.adopted;
  const mname = { kr: "한국", nasdaq: "나스닥" }[evidenceView];
  const line = (name, x) => x ? `${name}: IC 학습 ${x.ic_train.toFixed(3)} / 검증 ${x.ic_test.toFixed(3)}, 점수 상위 20% 초과수익 학습 ${pct(x.top20_train)} / 검증 ${pct(x.top20_test)}` : "";
  $("#evidence-score").innerHTML = [
    line(`현재 배점(${ad?.version || "-"}, ${ad?.adopted || ""} 적용)`, sc.adopted_c),
    line("최초 배점", sc.legacy_c),
    `${mname}: 두 배점 모두 0과 구별되는 예측력은 확인되지 않았습니다.` + (evidenceView === "nasdaq" ? " 나스닥은 배점을 정할 때 쓰지 않은 독립 시장입니다(수급 데이터 없음)." : " 현재 배점의 실제 검증은 적용일 이후 데이터로 진행합니다."),
  ].filter(Boolean).join("<br>");
}

Promise.all(["kr", "nasdaq"].map((m) => fetch(`/api/evidence?market=${m}`).then((r) => r.json()).catch(() => null)))
  .then(([kr, nq]) => {
    if (kr?.train) EVIDENCE_BY.kr = kr;
    if (nq?.train) EVIDENCE_BY.nasdaq = nq;
    renderEvidence();
    if (window.__lastData) renderResult(window.__lastData);
  });
document.querySelectorAll("#evidence-market button").forEach((b) => b.addEventListener("click", () => {
  evidenceView = b.dataset.m;
  renderEvidence();
}));

/* ---------- backtest ---------- */
let btChart = null;
const H = [5, 10, 20];

function retCell(st) {
  if (!st || !st.n) return `<td class="num">-</td>`;
  const ex = st.excess == null ? "" : `<span class="sub ${st.excess >= 0 ? "up" : "down"}">기준 대비 ${pct(st.excess)}</span>`;
  return `<td class="num"><b class="${st.mean >= 0 ? "up" : "down"}">${pct(st.mean)}</b>${ex}<span class="sub">승률 ${(st.win_rate * 100).toFixed(0)}% · n=${st.n}</span></td>`;
}

function renderBacktest(r) {
  $("#bt-result").hidden = false;
  const head = (first) => `<thead><tr><th>${first}</th><th class="num">표본</th>${H.map((h) => `<th class="num">${h}일 후</th>`).join("")}</tr></thead>`;
  const baseRow = `<tr class="baseline"><td>기준 (아무 날이나 매수)</td><td class="num">${r.baseline.r5.n}</td>${H.map((h) => retCell(r.baseline[`r${h}`])).join("")}</tr>`;

  $("#bt-signal").innerHTML = head("신호").replace("</tr></thead>", `<th class="num">MAE(20일)</th></tr></thead>`) + "<tbody>" + baseRow.replace("</tr>", "<td></td></tr>") +
    (r.by_signal.length ? r.by_signal.map((row) => `<tr>
      <td><span class="badge b-${row.type}">${esc(row.label)}</span></td>
      <td class="num">${row.count}</td>
      ${H.map((h) => retCell(row[`r${h}`])).join("")}
      <td class="num down">${pct(row.mae20)}</td></tr>`).join("") : `<tr><td colspan="6">발생한 신호가 없습니다</td></tr>`) + "</tbody>";

  $("#bt-score").innerHTML = head("매집 점수") + "<tbody>" + baseRow +
    r.by_score.map((row) => `<tr><td>${esc(row.bucket)}</td><td class="num">${row.count}</td>${H.map((h) => retCell(row[`r${h}`])).join("")}</tr>`).join("") + "</tbody>";

  const EV_LIMIT = 30;
  const evCell = (v) => `<td class="num ${v == null ? "" : v >= 0 ? "up" : "down"}">${v == null ? "진행 중" : pct(v)}</td>`;
  $("#bt-events").innerHTML = `<thead><tr><th>날짜</th><th>종목</th><th>신호</th><th class="num">진입가</th>${H.map((h) => `<th class="num">${h}일 후</th>`).join("")}<th class="num">MAE(20일)</th></tr></thead><tbody>` +
    (r.events.map((e, i) => `<tr data-ticker="${esc(e.ticker)}"${i >= EV_LIMIT ? ' class="more" hidden' : ""}>
      <td>${e.date}</td><td>${esc(e.ticker)}</td><td><span class="badge b-${e.type}">${esc(e.label)}</span></td>
      <td class="num">${fmt(e.price, e.price >= 1000 ? 0 : 2)}</td>${H.map((h) => evCell(e[`r${h}`])).join("")}${evCell(e.mae20)}</tr>`).join("") ||
      `<tr><td colspan="8">신호가 없습니다</td></tr>`) + "</tbody>" +
    (r.events.length > EV_LIMIT ? `<tfoot><tr><td colspan="8"><button type="button" class="secondary" id="ev-more">전체 ${r.events.length}건 보기</button></td></tr></tfoot>` : "");
  $("#ev-more")?.addEventListener("click", (ev) => {
    $("#bt-events").querySelectorAll("tr.more").forEach((tr) => { tr.hidden = false; });
    ev.target.closest("tfoot").remove();
  });
  $("#bt-events").querySelectorAll("tr[data-ticker]").forEach((tr) => tr.addEventListener("click", () => {
    $("#ticker").value = tr.dataset.ticker;
    document.querySelector('.tab[data-tab="single"]').click();
    analyzeTicker(tr.dataset.ticker);
  }));

  $("#bt-tickers").innerHTML = "대상: " + r.tickers.map((t) => t.error
    ? `<span class="down">${esc(t.ticker)} (실패: ${esc(t.error)})</span>`
    : `${esc(t.name || t.ticker)} ${t.days}일·신호 ${t.signals}건${t.has_flow ? "·수급" : ""}`).join(", ");

  // 단일 종목이면 과거 매집 점수 추이
  if (btChart) { btChart.remove(); btChart = null; }
  $("#bt-history-card").hidden = !r.score_history;
  if (r.score_history) {
    const el = $("#bt-history");
    btChart = LightweightCharts.createChart(el, { ...themeOpts(), height: el.clientHeight, leftPriceScale: { visible: true } });
    const sc = btChart.addHistogramSeries({ priceScaleId: "left", priceLineVisible: false, title: "매집 점수" });
    sc.setData(r.score_history.map((x) => ({ time: x.date, value: x.score, color: gradeColor(x.score) + "aa" })));
    btChart.priceScale("left").applyOptions({ scaleMargins: { top: 0.6, bottom: 0 } });
    btChart.addLineSeries({ color: getComputedStyle(document.documentElement).getPropertyValue("--text").trim(), lineWidth: 2, priceLineVisible: false, title: "종가" })
      .setData(r.score_history.map((x) => ({ time: x.date, value: x.close })));
    btChart.timeScale().fitContent();
  }
}

async function runBacktest(tickers) {
  const status = $("#bt-status");
  if (!tickers.length) return setStatus(status, "종목코드를 입력하세요", true);
  const btn = $("#bt-btn");
  btn.disabled = true;
  const t0 = Date.now();
  const tick = () => setStatus(status, `${tickers.length}개 종목 백테스트 중… ${Math.round((Date.now() - t0) / 1000)}초 (수급 데이터 수집 때문에 종목당 수 초 걸립니다)`);
  tick();
  const timer = setInterval(tick, 500);
  try {
    const res = await fetch("/api/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers, range: $("#bt-range").value, lookback: +$("#lookback").value, spike: +$("#spike").value, flow: $("#use-flow").checked }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const r = await res.json();
    renderBacktest(r);
    clearInterval(timer);
    setStatus(status, `완료 (${Math.round((Date.now() - t0) / 1000)}초) · 신호 ${r.events.length}건 · 과거 수익률이 미래를 보장하지 않으며, 표본이 수십 건 이하면 우연일 가능성이 큽니다`);
  } catch (e) {
    clearInterval(timer);
    setStatus(status, e.message, true);
  } finally {
    btn.disabled = false;
  }
}

$("#bt-btn").addEventListener("click", () => runBacktest($("#bt-list").value.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean)));
$("#bt-this").addEventListener("click", () => {
  const t = $("#ticker").value.trim();
  if (!t) return;
  $("#bt-list").value = t;
  document.querySelector('.tab[data-tab="backtest"]').click();
  runBacktest([t]);
});

/* ---------- init ---------- */
const initial = new URLSearchParams(location.search).get("ticker");
if (initial) $("#ticker").value = initial;
analyzeTicker($("#ticker").value.trim());
