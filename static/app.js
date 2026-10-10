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
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SIGNAL_COLORS = {
  entry: "#e03131", absorption: "#f08c00", lower_tail: "#7048e8", obv_divergence: "#1098ad", dry_up: "#2f9e44",
};
const SIGNAL_SHORT = { entry: "진입", absorption: "흡수", lower_tail: "꼬리", obv_divergence: "OBV", dry_up: "잠김" };

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
    position: sig.type === "obv_divergence" || sig.type === "dry_up" ? "aboveBar" : "belowBar",
    color: SIGNAL_COLORS[sig.type],
    shape: sig.type === "obv_divergence" || sig.type === "dry_up" ? "circle" : "arrowUp",
    text: SIGNAL_SHORT[sig.type],
  })));
  charts.push({ chart: price, el: priceEl });

  // volume
  const volEl = $("#volume-chart");
  const vol = LightweightCharts.createChart(volEl, { ...themeOpts(), height: volEl.clientHeight });
  const sigDates = new Set(data.signals.filter((x) => x.type !== "obv_divergence" && x.type !== "dry_up").map((x) => x.date));
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
  const { info, summary, score } = data;
  $("#result").hidden = false;
  $("#stock-name").innerHTML = `${esc(info.name)}<small>${esc(info.symbol)} · ${esc(info.exchange)} · ${esc(summary.last_date)} 기준</small>`;
  $("#score").textContent = score.toFixed(1);
  $("#score").className = gradeClass(score);
  $("#grade").textContent = data.grade;
  $("#grade").className = `grade ${gradeClass(score)}`;
  $("#gauge-fill").style.width = `${score}%`;
  $("#gauge-fill").style.background = gradeColor(score);

  const kpi = (k, v, sub = "", cls = "") => `<div class="kpi"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="s">${sub}</div></div>`;
  $("#kpis").innerHTML = [
    kpi("현재가", fmt(summary.last_close, PD), pct(summary.change), summary.change >= 0 ? "up" : "down"),
    kpi("거래량", fmtVol(summary.volume), summary.vol_ratio ? `20일 평균의 ${summary.vol_ratio.toFixed(2)}배` : ""),
    kpi("추정 매집단가", fmt(summary.estimated_cost, PD), summary.cost_gap != null ? `현재가 ${pct(summary.cost_gap)}` : "매집봉 없음",
      summary.cost_gap >= 0 ? "up" : summary.cost_gap < 0 ? "down" : ""),
    kpi("세력평단(앵커 VWAP)", fmt(summary.anchor_vwap, PD), `${summary.anchor_date} 최대거래일 기준`),
    kpi("CMF(20)", summary.cmf.toFixed(3), summary.cmf > 0 ? "자금 유입 우위" : "자금 유출 우위", summary.cmf > 0 ? "up" : "down"),
    kpi("상승/하락 거래량비", summary.updown_ratio.toFixed(2), "최근 20일"),
  ].join("");

  $("#breakdown").innerHTML = data.breakdown.map((b) => `
    <div class="bar-row">
      <span class="lbl">${esc(b.label)}</span>
      <div class="bar"><div style="width:${(b.score / b.max_score) * 100}%"></div></div>
      <span class="val">${b.score}/${b.max_score}</span>
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
    </tr>`).join("");
  $("#signals tbody").innerHTML = rows || `<tr><td colspan="6">탐지된 신호가 없습니다</td></tr>`;
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
    const q = new URLSearchParams({ ticker, range: $("#range").value, lookback: $("#lookback").value, spike: $("#spike").value });
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
      body: JSON.stringify({ tickers, range: $("#range").value, lookback: +$("#lookback").value, spike: +$("#spike").value }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const { results } = await res.json();
    let rank = 0;
    $("#scan-table tbody").innerHTML = results.map((r) => r.error
      ? `<tr><td></td><td>${esc(r.ticker)}</td><td colspan="8" class="down">${esc(r.error)}</td></tr>`
      : `<tr data-ticker="${esc(r.ticker)}">
          <td>${++rank}</td>
          <td><b>${esc(r.name)}</b><br><span class="hint">${esc(r.symbol)}</span></td>
          <td class="num"><b class="${gradeClass(r.score)}">${r.score.toFixed(1)}</b></td>
          <td class="${gradeClass(r.score)}">${esc(r.grade)}</td>
          <td class="num">${fmt(r.last_close, pdOf(r.currency))}</td>
          <td class="num ${r.change >= 0 ? "up" : "down"}">${pct(r.change)}</td>
          <td class="num ${r.cmf >= 0 ? "up" : "down"}">${r.cmf.toFixed(3)}</td>
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

/* ---------- init ---------- */
const initial = new URLSearchParams(location.search).get("ticker");
if (initial) $("#ticker").value = initial;
analyzeTicker($("#ticker").value.trim());
