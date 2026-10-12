import { json, search } from '../lib/market.js';

export async function onRequestGet({ request }) {
  const q = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 40);
  if (!q) return json({ items: [] });
  try {
    return json({ items: await search(q) }, 200, 3600);
  } catch (e) {
    return json({ items: [], error: '검색 실패' }, 502);
  }
}
