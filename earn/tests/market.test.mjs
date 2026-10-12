import test from 'node:test';
import assert from 'node:assert';
import { dropSpikes, naverToItem } from '../functions/lib/market.js';

test('dropSpikes: 한 달만 튄 오류값 제거, 추세 변화는 유지', () => {
  const e = (vals) => vals.map((v, i) => [String(i), v]);
  assert.deepStrictEqual(dropSpikes(e([1100, 0.11, 1120, 1130]), 1.5).map((x) => x[1]), [1100, 1120, 1130]);
  assert.deepStrictEqual(dropSpikes(e([100, 50, 25, 30]), 4).map((x) => x[1]), [100, 50, 25, 30]);
  assert.deepStrictEqual(dropSpikes(e([100, 5000, 110]), 4).map((x) => x[1]), [100, 110]);
});

test('naverToItem: 국내·미국·코인 심볼 변환', () => {
  assert.deepStrictEqual(naverToItem({ category: 'stock', nationCode: 'KOR', typeCode: 'KOSDAQ', code: '086520', name: '에코프로', typeName: '코스닥' }).symbol, '086520.KQ');
  assert.strictEqual(naverToItem({ category: 'stock', nationCode: 'USA', code: 'BRK.B', name: '버크셔', typeName: 'NYSE' }).symbol, 'BRK-B');
  assert.strictEqual(naverToItem({ category: 'coin', code: 'BTC', name: '비트코인' }).symbol, 'BTC-KRW');
  assert.strictEqual(naverToItem({ category: 'index', code: 'KOSPI' }), null);
});
