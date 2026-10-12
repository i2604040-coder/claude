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
