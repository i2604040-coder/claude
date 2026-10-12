// Cloudflare Pages Functions 공용: 종목 검색(네이버+야후)과 월봉 시세(원화 환산)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const YAHOO_SEARCH = 'https://query1.finance.yahoo.com/v1/finance/search';
const NAVER_AC = 'https://ac.stock.naver.com/ac';

export const SYMBOL_RE = /^[A-Za-z0-9.\-=^]{1,24}$/;

export function json(data, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
    },
  });
}

async function getJSON(url, ttl) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 네이버 자동완성 항목 → 야후 심볼 */
export function naverToItem(it) {
  if (it.category === 'coin') {
    return { symbol: `${it.code}-KRW`, name: it.name, type: 'CRYPTOCURRENCY', market: '가상자산' };
  }
  if (it.category !== 'stock') return null;
  if (it.nationCode === 'KOR') {
    const sfx = { KOSPI: '.KS', KOSDAQ: '.KQ' }[it.typeCode];
    return sfx ? { symbol: it.code + sfx, name: it.name, type: 'KR', market: it.typeName } : null;
  }
  if (it.nationCode === 'USA') {
    return { symbol: it.code.replace('.', '-'), name: it.name, type: 'US', market: it.typeName };
  }
  return null;
}

export async function search(q) {
  const out = [];
  const seen = new Set();
  const add = (x) => { if (x && !seen.has(x.symbol)) { seen.add(x.symbol); out.push(x); } };
  try {
    const nv = await getJSON(`${NAVER_AC}?q=${encodeURIComponent(q)}&target=stock,coin`, 3600);
    (nv.items || []).forEach((it) => add(naverToItem(it)));
  } catch (_) { /* 야후로 계속 */ }
  if (/^[\x20-\x7e]+$/.test(q)) {
    try {
      const yh = await getJSON(`${YAHOO_SEARCH}?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`, 3600);
      (yh.quotes || [])
        .filter((x) => ['EQUITY', 'ETF', 'CRYPTOCURRENCY', 'MUTUALFUND'].includes(x.quoteType))
        .forEach((x) => add({ symbol: x.symbol, name: x.shortname || x.longname || x.symbol, type: x.quoteType, market: x.exchDisp || x.exchange }));
    } catch (_) { /* 무시 */ }
  }
  return out.slice(0, 8);
}

/** 앞뒤 값과 비교해 한 달만 튀었다가 돌아오는 오류값 제거 (야후 데이터 결함 대응) */
export function dropSpikes(entries, k) {
  return entries.filter(([, v], i) => {
    const prev = entries[i - 1], next = entries[i + 1];
    if (!prev || !next) return true;
    const a = v / prev[1], b = v / next[1];
    return !((a > k && b > k) || (a < 1 / k && b < 1 / k));
  });
}

async function yahooMonthly(symbol, spike = 4, range = '10y') {
  const data = await getJSON(`${YAHOO_CHART}${encodeURIComponent(symbol)}?range=${range}&interval=1mo&events=div`, 3600);
  const res = data && data.chart && data.chart.result && data.chart.result[0];
  if (!res || !res.timestamp) throw new Error('not found');
  const adj = res.indicators.adjclose && res.indicators.adjclose[0] && res.indicators.adjclose[0].adjclose;
  const closes = adj || res.indicators.quote[0].close;
  const months = new Map();
  res.timestamp.forEach((t, i) => {
    const c = closes[i];
    if (c == null || !(c > 0)) return;
    const d = new Date((t + 9 * 3600) * 1000); // KST 기준 월
    months.set(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, c);
  });
  const sorted = dropSpikes([...months.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)), spike);
  return { meta: res.meta || {}, months: new Map(sorted) };
}

/** 월봉 수정주가를 원화로 환산해 반환 */
export async function monthlyKRW(symbol, range = '10y') {
  let tried = [symbol];
  if (/^[0-9A-Z]{6}$/.test(symbol) && /^\d/.test(symbol)) tried = [`${symbol}.KS`, `${symbol}.KQ`];
  let got = null, used = null;
  for (const s of tried) {
    try { got = await yahooMonthly(s, 4, range); used = s; break; } catch (_) { /* 다음 후보 */ }
  }
  if (!got) throw new Error('종목을 찾을 수 없어요');
  const { meta, months } = got;
  const currency = (meta.currency || 'KRW').toUpperCase();
  let fx = null;
  if (currency !== 'KRW') {
    fx = (await yahooMonthly(`${currency}KRW=X`, 1.5, range)).months;
  }
  const dates = [], close = [];
  for (const [m, c] of months) {
    const rate = fx ? fx.get(m) : 1;
    if (!rate) continue;
    dates.push(m);
    close.push(Math.round(c * rate * 10000) / 10000);
  }
  if (dates.length < 3) throw new Error('시세 데이터가 부족해요');
  return {
    symbol: meta.symbol || used,
    name: meta.longName || meta.shortName || used,
    type: meta.instrumentType || '',
    currency,
    converted: currency !== 'KRW',
    dates, close,
  };
}
