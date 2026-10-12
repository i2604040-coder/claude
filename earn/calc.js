// 계산 로직 (브라우저와 Node 테스트에서 함께 사용)
(function (root) {
  'use strict';

  // 2026년 기준 요율 (근로자 부담분)
  const RATES = {
    pension: 0.0475,          // 국민연금 9.5%의 절반
    pensionMaxBase: 6370000,  // 기준소득월액 상한
    pensionMinBase: 400000,   // 기준소득월액 하한
    health: 0.03595,          // 건강보험 7.19%의 절반
    ltcOfHealth: 0.9448 / 7.19, // 장기요양 = 건강보험료 × 13.14%
    employment: 0.009,        // 고용보험
  };

  const TAX_BRACKETS = [
    [14000000, 0.06, 0],
    [50000000, 0.15, 1260000],
    [88000000, 0.24, 5760000],
    [150000000, 0.35, 15440000],
    [300000000, 0.38, 19940000],
    [500000000, 0.40, 25940000],
    [1000000000, 0.42, 35940000],
    [Infinity, 0.45, 65940000],
  ];

  const floor10 = (x) => Math.floor(x / 10) * 10;

  function earnedIncomeDeduction(gross) {
    let d;
    if (gross <= 5000000) d = gross * 0.7;
    else if (gross <= 15000000) d = 3500000 + (gross - 5000000) * 0.4;
    else if (gross <= 45000000) d = 7500000 + (gross - 15000000) * 0.15;
    else if (gross <= 100000000) d = 12000000 + (gross - 45000000) * 0.05;
    else d = 14750000 + (gross - 100000000) * 0.02;
    return Math.min(d, 20000000);
  }

  function progressiveTax(base) {
    if (base <= 0) return 0;
    for (const [limit, rate, minus] of TAX_BRACKETS) {
      if (base <= limit) return base * rate - minus;
    }
    return 0;
  }

  function earnedIncomeTaxCredit(calcTax, gross) {
    let credit = calcTax <= 1300000 ? calcTax * 0.55 : 715000 + (calcTax - 1300000) * 0.3;
    let cap;
    if (gross <= 33000000) cap = 740000;
    else if (gross <= 70000000) cap = Math.max(740000 - (gross - 33000000) * 0.008, 660000);
    else if (gross <= 120000000) cap = Math.max(660000 - (gross - 70000000) * 0.5, 500000);
    else cap = Math.max(500000 - (gross - 120000000) * 0.5, 200000);
    return Math.min(credit, cap);
  }

  /**
   * 연봉 실수령액 (연말정산 기준 추정)
   * @param {number} salary 연봉(원)
   * @param {object} opt { nonTaxMonthly: 월 비과세액, dependents: 본인 포함 공제 인원, children: 8~20세 자녀 수 }
   */
  function netSalary(salary, opt = {}) {
    const nonTaxMonthly = opt.nonTaxMonthly ?? 200000;
    const dependents = Math.max(1, opt.dependents ?? 1);
    const children = Math.max(0, opt.children ?? 0);

    const monthly = salary / 12;
    const taxableMonthly = Math.max(0, monthly - nonTaxMonthly);
    const gross = taxableMonthly * 12; // 총급여

    const pensionBase = Math.min(Math.max(taxableMonthly, RATES.pensionMinBase), RATES.pensionMaxBase);
    const pension = taxableMonthly > 0 ? floor10(pensionBase * RATES.pension) : 0;
    const health = floor10(taxableMonthly * RATES.health);
    const ltc = floor10(health * RATES.ltcOfHealth);
    const employment = floor10(taxableMonthly * RATES.employment);

    const annualInsurance = (pension + health + ltc + employment) * 12;
    const earnedIncome = gross - earnedIncomeDeduction(gross);
    const base = Math.max(0, earnedIncome - 1500000 * dependents - annualInsurance);
    const calcTax = progressiveTax(base);

    let childCredit = 0;
    if (children === 1) childCredit = 250000;
    else if (children === 2) childCredit = 550000;
    else if (children >= 3) childCredit = 550000 + (children - 2) * 400000;

    const credits = earnedIncomeTaxCredit(calcTax, gross) + 130000 + childCredit;
    const annualIncomeTax = Math.max(0, calcTax - credits);
    const incomeTax = floor10(annualIncomeTax / 12);
    const localTax = floor10(incomeTax * 0.1);

    const deductions = pension + health + ltc + employment + incomeTax + localTax;
    return {
      monthly: Math.round(monthly),
      pension, health, ltc, employment, incomeTax, localTax,
      deductions,
      netMonthly: Math.round(monthly - deductions),
      netAnnual: Math.round((monthly - deductions) * 12),
    };
  }

  /**
   * 대출 상환 스케줄
   * @param {number} principal 원금
   * @param {number} annualRate 연이율(%)
   * @param {number} months 기간(개월)
   * @param {'equal'|'principal'|'bullet'} method 원리금균등 | 원금균등 | 만기일시
   */
  function loan(principal, annualRate, months, method = 'equal') {
    const r = annualRate / 100 / 12;
    const rows = [];
    let balance = principal;
    for (let i = 1; i <= months; i++) {
      const interest = balance * r;
      let principalPaid;
      if (method === 'equal') {
        const pmt = r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months));
        principalPaid = pmt - interest;
      } else if (method === 'principal') {
        principalPaid = principal / months;
      } else {
        principalPaid = i === months ? balance : 0;
      }
      if (i === months) principalPaid = balance;
      balance -= principalPaid;
      rows.push({ month: i, payment: principalPaid + interest, principal: principalPaid, interest, balance: Math.max(0, balance) });
    }
    const totalInterest = rows.reduce((s, x) => s + x.interest, 0);
    return { rows, totalInterest, totalPayment: principal + totalInterest, firstPayment: rows[0] ? rows[0].payment : 0 };
  }

  const TAX_TYPES = { normal: 0.154, preferential: 0.095, free: 0 };

  /**
   * 예·적금 이자 (단리/월복리)
   * @param {'saving'|'deposit'} kind 적금(매월 납입) | 예금(목돈 거치)
   */
  function savings(kind, amount, annualRate, months, taxType = 'normal', compound = false) {
    const r = annualRate / 100 / 12;
    let principal, interest;
    if (kind === 'saving') {
      principal = amount * months;
      if (compound) {
        // 매월 초 납입, 월복리
        interest = 0;
        for (let k = 1; k <= months; k++) interest += amount * (Math.pow(1 + r, k) - 1);
      } else {
        interest = amount * r * (months * (months + 1)) / 2;
      }
    } else {
      principal = amount;
      interest = compound ? amount * (Math.pow(1 + r, months) - 1) : amount * r * months;
    }
    const tax = floor10(interest * (TAX_TYPES[taxType] ?? 0.154));
    return { principal, interest: Math.round(interest), tax, afterTax: Math.round(principal + interest - tax) };
  }

  const DAY = 86400000;
  const toUTC = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };

  /**
   * 퇴직금 (근로기준법 평균임금 기준)
   * @param {string} start 입사일 YYYY-MM-DD
   * @param {string} end 퇴사일(마지막 근무일 다음 날) YYYY-MM-DD
   * @param {number} wage3m 퇴사 전 3개월 임금 총액(세전)
   * @param {number} annualBonus 연간 상여금
   * @param {number} annualLeavePay 연차수당(1년분)
   */
  function severance(start, end, wage3m, annualBonus = 0, annualLeavePay = 0) {
    const s = toUTC(start), e = toUTC(end);
    const days = Math.round((e - s) / DAY);
    const endDate = new Date(e);
    const threeMonthsAgo = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - 3, endDate.getUTCDate());
    const periodDays = Math.round((e - threeMonthsAgo) / DAY);
    const totalWage = wage3m + annualBonus * 3 / 12 + annualLeavePay * 3 / 12;
    const dailyAvg = totalWage / periodDays;
    const eligible = days >= 365;
    const amount = eligible ? Math.round(dailyAvg * 30 * days / 365) : 0;
    return { days, periodDays, dailyAvg: Math.round(dailyAvg), eligible, amount };
  }

  const api = { RATES, netSalary, loan, savings, severance, progressiveTax, earnedIncomeDeduction };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
