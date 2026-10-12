const test = require('node:test');
const assert = require('node:assert');
const C = require('../calc.js');

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b} (±${tol})`);

test('세율표: 과세표준 구간 경계', () => {
  assert.strictEqual(C.progressiveTax(14000000), 840000);
  assert.strictEqual(Math.round(C.progressiveTax(50000000)), 6240000);
  assert.strictEqual(Math.round(C.progressiveTax(88000000)), 15360000);
});

test('근로소득공제: 구간 및 2천만원 한도', () => {
  assert.strictEqual(C.earnedIncomeDeduction(5000000), 3500000);
  assert.strictEqual(C.earnedIncomeDeduction(45000000), 12000000);
  assert.strictEqual(C.earnedIncomeDeduction(1e9), 20000000);
});

test('연봉 4천만원 실수령액은 월 300만원 중반대', () => {
  const r = C.netSalary(40000000, { nonTaxMonthly: 200000, dependents: 1 });
  assert.strictEqual(r.pension, 148830); // 3,133,333 × 4.75%
  near(r.netMonthly, 2980000, 60000);
  assert.strictEqual(r.netMonthly, r.monthly - r.deductions);
});

test('국민연금은 기준소득월액 상한 적용', () => {
  const r = C.netSalary(200000000, { nonTaxMonthly: 0 });
  assert.strictEqual(r.pension, Math.floor(6370000 * 0.0475 / 10) * 10);
});

test('부양가족·자녀가 많을수록 세금이 줄어든다', () => {
  const a = C.netSalary(60000000, { dependents: 1 });
  const b = C.netSalary(60000000, { dependents: 4, children: 2 });
  assert.ok(b.incomeTax < a.incomeTax);
});

test('저소득은 소득세 0', () => {
  assert.strictEqual(C.netSalary(15000000).incomeTax, 0);
});

test('원리금균등: 1억, 연 4.5%, 30년 → 월 506,685원', () => {
  const r = C.loan(100000000, 4.5, 360, 'equal');
  near(r.firstPayment, 506685, 1);
  near(r.rows.at(-1).balance, 0, 1e-6);
});

test('원금균등: 이자 합계 = P·r·(n+1)/2', () => {
  const r = C.loan(12000000, 6, 12, 'principal');
  near(r.totalInterest, 12000000 * 0.005 * 13 / 2, 1e-6);
});

test('만기일시: 이자만 내다 마지막에 원금', () => {
  const r = C.loan(10000000, 12, 12, 'bullet');
  near(r.firstPayment, 100000, 1e-6);
  near(r.rows.at(-1).payment, 10100000, 1e-6);
});

test('이자 0%도 동작', () => {
  const r = C.loan(1200000, 0, 12, 'equal');
  near(r.firstPayment, 100000, 1e-9);
});

test('적금 단리: 월 50만, 3.5%, 12개월 → 세전 113,750원', () => {
  const r = C.savings('saving', 500000, 3.5, 12, 'normal');
  assert.strictEqual(r.interest, 113750);
  assert.strictEqual(r.tax, 17510);
  assert.strictEqual(r.afterTax, 6000000 + 113750 - 17510);
});

test('예금 비과세/월복리', () => {
  assert.strictEqual(C.savings('deposit', 10000000, 3, 12, 'free').interest, 300000);
  const c = C.savings('deposit', 10000000, 3, 12, 'free', true);
  near(c.interest, 304160, 1);
});

test('퇴직금: 1년 미만은 0, 정확히 계산', () => {
  assert.strictEqual(C.severance('2026-01-01', '2026-10-01', 9000000).amount, 0);
  const r = C.severance('2021-10-12', '2026-10-12', 9200000);
  assert.strictEqual(r.days, 1826);
  assert.strictEqual(r.periodDays, 92);
  assert.strictEqual(r.dailyAvg, 100000);
  assert.strictEqual(r.amount, Math.round(100000 * 30 * 1826 / 365));
});

const flat = { dates: ['a', 'b', 'c', 'd'], close: [100, 100, 100, 100], tax: 'free' };
const dbl = { dates: ['a', 'b', 'c'], close: [100, 150, 200], tax: 'dividend' };

test('적립식: 가격이 그대로면 원금 그대로', () => {
  const r = C.investWindow(flat.close, 0, 3, 'saving', 1000, 'free');
  assert.strictEqual(r.principal, 3000);
  near(r.afterTax, 3000, 1e-9);
});

test('거치식 2배 + 배당소득세 15.4%는 이익에만', () => {
  const r = C.investWindow(dbl.close, 0, 2, 'deposit', 1000, 'dividend');
  near(r.value, 2000, 1e-9);
  near(r.afterTax, 2000 - 1000 * 0.154, 1e-9);
});

test('적립식 평균단가: 100·150 매수 후 200 평가', () => {
  const r = C.investWindow(dbl.close, 0, 2, 'saving', 300, 'free');
  near(r.value, (3 + 2) * 200, 1e-9);
});

test('compareSavings: 구간 수, 승률, 데이터 부족', () => {
  const r = C.compareSavings(flat, 'saving', 1000, 2, 1999);
  assert.strictEqual(r.windows, 2);
  assert.strictEqual(r.winRate, 1);
  assert.strictEqual(r.lossRate, 0);
  assert.strictEqual(C.compareSavings(flat, 'saving', 1000, 12, 0).enough, false);
});

test('compareLoan: 1년 수익률이 금리를 넘는 비율', () => {
  const close = Array.from({ length: 25 }, (_, i) => 100 * Math.pow(1.1, i / 12));
  const r = C.compareLoan({ dates: close.map((_, i) => String(i)), close, tax: 'free' }, 5);
  assert.strictEqual(r.windows, 13);
  assert.strictEqual(r.beatRate, 1);
  near(r.r1, 0.1, 1e-9);
  assert.strictEqual(r.r3, null);
  assert.strictEqual(C.compareLoan({ dates: close.map(String), close, tax: 'free' }, 12).beatRate, 0);
});
