import { json, monthlyKRW, SYMBOL_RE } from '../lib/market.js';

export async function onRequestGet({ request }) {
  const symbol = (new URL(request.url).searchParams.get('symbol') || '').trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return json({ error: '종목 코드를 확인해 주세요' }, 400);
  try {
    return json(await monthlyKRW(symbol), 200, 3600);
  } catch (e) {
    return json({ error: e.message || '시세 조회 실패' }, 404);
  }
}
