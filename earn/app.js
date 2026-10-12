(function () {
  'use strict';
  const CFG = window.SITE_CONFIG || {};
  const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
  const manwon = (n) => {
    const v = Math.round(n);
    if (Math.abs(v) < 10000) return won(v);
    const eok = Math.floor(v / 1e8), man = Math.floor((v % 1e8) / 1e4);
    return [eok ? eok.toLocaleString('ko-KR') + '억' : '', man ? man.toLocaleString('ko-KR') + '만' : ''].join(' ').trim() + '원';
  };
  const num = (s) => Number(String(s).replace(/[^\d.]/g, '')) || 0;
  const isHttps = (u) => typeof u === 'string' && /^https:\/\//.test(u);

  function row(label, value, cls = '') {
    return `<dt>${label}</dt><dd class="${cls}">${value}</dd>`;
  }

  function affiliate(key) {
    const link = CFG.coupangLinks && CFG.coupangLinks[key];
    if (!link || !isHttps(link.url)) return '';
    const a = document.createElement('a');
    a.className = 'affiliate';
    a.href = link.url;
    a.target = '_blank';
    a.rel = 'sponsored noopener';
    a.textContent = '🛒 ' + (link.text || '추천 상품 보기');
    return a.outerHTML;
  }

  // ---------- 계산기별 렌더 ----------
  const renderers = {
    salary(f) {
      const r = Calc.netSalary(num(f.salary.value), {
        nonTaxMonthly: num(f.nonTax.value),
        dependents: num(f.dependents.value) || 1,
        children: num(f.children.value),
      });
      return `
        <p class="headline">월 예상 실수령액</p>
        <p class="big">${won(r.netMonthly)}</p>
        <dl>
          ${row('월 급여(세전)', won(r.monthly))}
          ${row('국민연금 4.75%', '-' + won(r.pension), 'minus')}
          ${row('건강보험 3.595%', '-' + won(r.health), 'minus')}
          ${row('장기요양보험', '-' + won(r.ltc), 'minus')}
          ${row('고용보험 0.9%', '-' + won(r.employment), 'minus')}
          ${row('소득세', '-' + won(r.incomeTax), 'minus')}
          ${row('지방소득세', '-' + won(r.localTax), 'minus')}
          ${row('<strong>공제 합계</strong>', '<strong>-' + won(r.deductions) + '</strong>', 'minus')}
          ${row('연 실수령액', manwon(r.netAnnual))}
        </dl>
        <p class="note">소득세는 연말정산 기본공제·근로소득세액공제·표준세액공제를 반영한 추정치입니다. 회사 간이세액표 원천징수액과 조금 다를 수 있어요.</p>
        ${affiliate('salary')}`;
    },

    loan(f) {
      const months = Math.max(1, Math.min(600, num(f.months.value)));
      const r = Calc.loan(num(f.principal.value), num(f.rate.value), months, f.method.value);
      const label = { equal: '매월 상환액', principal: '첫 달 상환액', bullet: '매월 이자' }[f.method.value];
      const rows = r.rows.map((x) =>
        `<tr><td>${x.month}</td><td>${won(x.payment)}</td><td>${won(x.principal)}</td><td>${won(x.interest)}</td><td>${won(x.balance)}</td></tr>`
      ).join('');
      const last = r.rows[r.rows.length - 1];
      return `
        <p class="headline">${label}</p>
        <p class="big">${won(r.firstPayment)}</p>
        <dl>
          ${row('대출 원금', manwon(num(f.principal.value)))}
          ${row('총 이자', manwon(r.totalInterest), 'minus')}
          ${row('총 상환액', manwon(r.totalPayment))}
          ${f.method.value === 'principal' ? row('마지막 달 상환액', won(last.payment)) : ''}
          ${f.method.value === 'bullet' ? row('만기 상환액', won(last.payment)) : ''}
        </dl>
        <details><summary>월별 상환 스케줄 보기</summary>
          <div class="schedule"><table>
            <thead><tr><th>회차</th><th>상환액</th><th>원금</th><th>이자</th><th>잔액</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
        </details>
        <button type="button" class="ghost to-compare" data-from="loan">📈 갚을 돈을 투자했다면? (금리 vs 수익률)</button>
        ${affiliate('loan')}`;
    },

    savings(f) {
      const r = Calc.savings(f.kind.value, num(f.amount.value), num(f.rate.value),
        Math.max(1, num(f.months.value)), f.tax.value, f.compound.value === '1');
      return `
        <p class="headline">만기 수령액 (세후)</p>
        <p class="big">${won(r.afterTax)}</p>
        <dl>
          ${row('원금 합계', won(r.principal))}
          ${row('세전 이자', '+' + won(r.interest), 'plus')}
          ${row('이자 과세', '-' + won(r.tax), 'minus')}
          ${row('세후 이자', '+' + won(r.interest - r.tax), 'plus')}
        </dl>
        <button type="button" class="ghost to-compare" data-from="savings">📈 같은 돈을 주식·ETF에 넣었다면?</button>
        ${affiliate('savings')}`;
    },

    severance(f) {
      if (!f.start.value || !f.end.value || f.end.value <= f.start.value) {
        return '<p class="headline">입사일과 퇴사일을 확인해 주세요.</p>';
      }
      const r = Calc.severance(f.start.value, f.end.value, num(f.wage3m.value), num(f.bonus.value), num(f.leave.value));
      return `
        <p class="headline">예상 퇴직금 (세전)</p>
        <p class="big">${r.eligible ? won(r.amount) : '0원'}</p>
        <dl>
          ${row('재직 일수', r.days.toLocaleString('ko-KR') + '일')}
          ${row('1일 평균임금', won(r.dailyAvg))}
          ${row('평균임금 산정 기간', r.periodDays + '일')}
        </dl>
        <p class="note">${r.eligible
          ? '퇴직금 = 1일 평균임금 × 30일 × (재직일수 ÷ 365). 퇴직소득세는 별도이며, 근속이 짧을수록 세율이 낮습니다.'
          : '계속근로기간 1년 미만은 퇴직금 지급 대상이 아닙니다.'}</p>
        ${affiliate('severance')}`;
    },
  };

  // ---------- 투자 비교 ----------
  let marketPromise = null;
  const loadMarket = () => (marketPromise ||= fetch('market.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .catch((e) => { marketPromise = null; throw e; }));
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (x, signed = false) => (signed && x > 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
  const signedWon = (x) => (x >= 0 ? '+' : '-') + won(Math.abs(x));
  const ym = (s) => s.replace('-', '.');
  const head = (p) => `<div class="cmp-head"><b>${esc(p.name)}</b><span class="tag">${esc(p.kind)}</span></div>`;

  function compareFooter(data) {
    return `<p class="note">시세: Yahoo Finance 월말 수정주가(배당 재투자 반영), ${esc(data.updated)} 갱신.
      국내주식·국내주식형 ETF·가상자산(2027년 과세 예정)은 비과세, 그 외 국내 ETF는 이익의 15.4%, 해외 상장 종목은 250만원 공제 후 22%로 계산했어요. 해외 종목은 그 달의 환율로 원화 환산했습니다.
      개별 종목은 지금 시가총액 상위 종목이라 과거 성과가 실제보다 좋아 보일 수 있어요(생존 편향). 과거 결과가 미래 수익을 보장하지 않으며, 투자 상품은 원금 손실이 날 수 있어요.
      예·적금은 예금자보호(1인당 1억원) 대상입니다. 투자 권유가 아닌 참고용 정보입니다.</p>`;
  }

  // 직접 고른 종목 시세 (Cloudflare Functions API)
  const apiBase = (CFG.apiBase || '').replace(/\/$/, '');
  const api = (path) => fetch(apiBase + path).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || '시세를 불러오지 못했어요');
    return d;
  });
  const kindLabel = (d) => {
    const isKR = /\.(KS|KQ)$/.test(d.symbol), isCoin = d.type === 'CRYPTOCURRENCY' || /-KRW$/.test(d.symbol);
    return (isCoin ? '가상자산' : isKR ? '국내' : '해외') + (d.type === 'ETF' ? ' ETF' : '') + (d.converted ? ' · 원화 환산' : '');
  };
  /** 종목 시세를 받아 비교용 상품 객체로 */
  async function loadProduct(item, taxChoice = 'auto', range = '10y') {
    const d = await api(`/api/chart?symbol=${encodeURIComponent(item.symbol)}&range=${range}`);
    const name = item.name || d.name;
    const tax = taxChoice === 'auto' ? Calc.guessTax(d.symbol, name, d.type) : taxChoice;
    return { ...d, name, kind: kindLabel(d), tax, picked: true };
  }

  async function loadPicked(f) {
    const item = comparePicker.items[0];
    return item ? loadProduct(item, f.picktax.value) : null;
  }

  function savingCard(p, c, months, label, benchmark) {
    const taxNote = p.picked ? ` · 세금 ${esc(Calc.TAX_LABELS[p.tax])}` : '';
    if (!c.enough) return `<div class="cmp${p.picked ? ' mine' : ''}">${head(p)}<p class="cmp-sub">시세가 ${c.months}개월치뿐이라 ${months}개월 비교는 아직 못 해요. 기간을 줄여 보세요.</p></div>`;
    const diff = c.latest.afterTax - benchmark;
    return `<div class="cmp${p.picked ? ' mine' : ''}">${head(p)}
      <p class="cmp-main">최근 ${months}개월 넣었다면 <b>${won(c.latest.afterTax)}</b>
        <span class="${diff >= 0 ? 'plus' : 'minus'}">(${label}보다 ${signedWon(diff)})</span></p>
      <p class="cmp-sub">과거 ${c.windows}번의 ${months}개월 구간 중 <b>${pct(c.winRate)}</b>는 ${label}보다 많았고, ${pct(c.lossRate)}는 원금 손실<br>
      최악 ${won(c.worst.afterTax)} (${ym(c.worst.from)}~${ym(c.worst.to)}) · 최고 ${won(c.best.afterTax)}${taxNote}</p></div>`;
  }

  function loanCard(p, c, rate) {
    if (!c.enough) return `<div class="cmp${p.picked ? ' mine' : ''}">${head(p)}<p class="cmp-sub">데이터 부족</p></div>`;
    const cagr = [['1년', c.r1], ['3년', c.r3], ['5년', c.r5]]
      .map(([l, v]) => `${l} ${v === null ? '–' : `<span class="${v * 100 > rate ? 'plus' : 'minus'}">${pct(v, true)}</span>`}`).join(' · ');
    return `<div class="cmp${p.picked ? ' mine' : ''}">${head(p)}
      <p class="cmp-main">대출 금리를 넘은 확률 <b class="${c.beatRate >= 0.5 ? 'plus' : 'minus'}">${pct(c.beatRate)}</b></p>
      <p class="cmp-sub">연평균 수익률(세전) ${cagr}<br>
      과거 ${c.windows}번의 1년 구간 기준(세후) · 최악의 1년 ${pct(c.worst.ret, true)} (${ym(c.worst.from)}~${ym(c.worst.to)})</p></div>`;
  }

  async function renderCompare(f) {
    let [data, mine] = await Promise.all([
      loadMarket(),
      loadPicked(f).catch((e) => ({ error: e.message })),
    ]);
    // 분석 기간 적용
    const { from, to } = comparePeriod.value();
    const periodText = from || to ? `${from ? ym(from) : '처음'}~${to ? ym(to) : '현재'} 기간` : '과거 10년';
    if (from || to) {
      data = { ...data, products: data.products.map((p) => Calc.sliceProduct(p, from, to)) };
      if (mine && !mine.error) mine = Calc.sliceProduct(mine, from, to);
    }
    const mode = f.mode.value;
    const rate = num(f.rate.value);
    const mineHtml = (render) => {
      if (!mine) return '';
      if (mine.error) {
        const it = comparePicker.items[0];
        return `<div class="cmp mine"><div class="cmp-head"><b>${esc(it.name || it.symbol)}</b></div><p class="cmp-sub">${esc(mine.error)}</p></div>`;
      }
      return render(mine) + (data.products.length ? '<p class="others">대표 상품과 비교</p>' : '');
    };

    if (mode === 'loan') {
      const items = data.products.map((p) => ({ p, c: Calc.compareLoan(p, rate) }))
        .sort((a, b) => b.c.beatRate - a.c.beatRate);
      return `<p class="headline">대출을 갚으면 확실하게 아끼는 이자</p>
        <p class="big">연 ${rate}%</p>
        <p class="note" style="margin:0 0 12px">대출을 갚는 대신 그 돈을 투자했을 때, ${periodText} 동안 1년 뒤 세후 수익률이 대출 금리보다 높았던 비율이에요. 50% 미만이면 대출 상환이 유리했던 경우가 더 많았다는 뜻입니다.</p>
        ${mineHtml((p) => loanCard(p, Calc.compareLoan(p, rate), rate))}
        ${items.map(({ p, c }) => loanCard(p, c, rate)).join('')}${compareFooter(data)}`;
    }

    const amount = num(f.amount.value);
    const months = Math.max(1, Math.min(120, num(f.months.value)));
    const sv = Calc.savings(mode, amount, rate, months, f.tax.value, false);
    const label = mode === 'saving' ? '적금' : '예금';
    const items = data.products.map((p) => ({ p, c: Calc.compareSavings(p, mode, amount, months, sv.afterTax) }))
      .sort((a, b) => (b.c.enough - a.c.enough) || (b.c.enough ? b.c.winRate - a.c.winRate : 0));
    return `<p class="headline">내 ${label} ${months}개월 세후 만기액 (원금 ${won(sv.principal)})</p>
      <p class="big">${won(sv.afterTax)}</p>
      <p class="note" style="margin:0 0 12px">같은 돈을 같은 방식(${mode === 'saving' ? '매월 적립' : '한 번에 투자'})으로 넣었을 때의 세후 금액이에요. ${to ? '' : `'최근'은 지금 끝난 ${months}개월, `}확률은 ${periodText} 안의 모든 ${months}개월 구간 기준입니다.${to ? ` '최근'은 ${ym(to)}에 끝나는 구간이에요.` : ''}</p>
      ${mineHtml((p) => savingCard(p, Calc.compareSavings(p, mode, amount, months, sv.afterTax), months, label, sv.afterTax))}
      ${items.map(({ p, c }) => savingCard(p, c, months, label, sv.afterTax)).join('')}${compareFooter(data)}`;
  }

  // ---------- 종목 대결 ----------
  const shortWon = (v) => {
    const a = Math.abs(v);
    if (a >= 1e8) return (v / 1e8).toFixed(a >= 1e9 ? 0 : 1).replace(/\.0$/, '') + '억';
    if (a >= 1e4) return Math.round(v / 1e4).toLocaleString('ko-KR') + '만';
    return Math.round(v).toLocaleString('ko-KR');
  };

  /** 평가금액 추이 선 차트 (SVG, 크로스헤어 툴팁) */
  function lineChart(host, lines) {
    const W = Math.max(300, host.clientWidth || 340), H = 240;
    const pad = { l: 44, r: 10, t: 12, b: 26 };
    const n = lines[0].points.length;
    const all = lines.flatMap((l) => l.points.map((p) => p.v));
    let lo = Math.min(0, ...all), hi = Math.max(...all);
    if (hi === lo) hi = lo + 1;
    const step = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4)));
    const tick = [1, 2, 2.5, 5, 10].map((m) => m * step).find((t) => (hi - lo) / t <= 5);
    hi = Math.ceil(hi / tick) * tick; lo = Math.floor(lo / tick) * tick;
    const x = (i) => pad.l + (W - pad.l - pad.r) * (n === 1 ? 0 : i / (n - 1));
    const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent && parent.appendChild(e); return e; };
    host.innerHTML = '';
    host.style.position = 'relative';
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart', role: 'img', 'aria-label': '평가금액 추이 차트' }, host);
    for (let v = lo; v <= hi + tick / 2; v += tick) {
      el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid' }, svg);
      el('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }, svg).textContent = shortWon(v);
    }
    const dates = lines[0].points.map((p) => p.d);
    [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).forEach((i, k, arr) => {
      el('text', { x: x(i), y: H - 8, 'text-anchor': k === 0 ? 'start' : k === arr.length - 1 ? 'end' : 'middle', class: 'axis' }, svg).textContent = ym(dates[i]);
    });
    lines.forEach((l) => {
      el('path', {
        d: l.points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(''),
        class: 'line' + (l.dash ? ' dash' : ''), style: `stroke:${l.color}`,
      }, svg);
    });
    // 선 끝 점
    lines.filter((l) => !l.dash).forEach((l) => {
      el('circle', { cx: x(n - 1), cy: y(l.points[n - 1].v), r: 3.5, style: `fill:${l.color}`, class: 'end-dot' }, svg);
    });
    // 크로스헤어 + 툴팁
    const cross = el('line', { y1: pad.t, y2: H - pad.b, class: 'cross', visibility: 'hidden' }, svg);
    const tip = document.createElement('div');
    tip.className = 'chart-tip'; tip.hidden = true; host.appendChild(tip);
    const hit = el('rect', { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b, fill: 'transparent' }, svg);
    const show = (evt) => {
      const r = svg.getBoundingClientRect();
      const px = (evt.clientX - r.left) * (W / r.width);
      const i = Math.max(0, Math.min(n - 1, Math.round((px - pad.l) / ((W - pad.l - pad.r) / Math.max(1, n - 1)))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      tip.replaceChildren();
      const h = document.createElement('b'); h.textContent = ym(dates[i]); tip.appendChild(h);
      [...lines].sort((a, b) => b.points[i].v - a.points[i].v).forEach((l) => {
        const row = document.createElement('div');
        const sw = document.createElement('i'); sw.className = 'swatch' + (l.dash ? ' dash' : ''); sw.style.background = l.color;
        const nm = document.createElement('span'); nm.textContent = l.name;
        const v = document.createElement('em'); v.textContent = won(l.points[i].v);
        row.append(sw, nm, v); tip.appendChild(row);
      });
      tip.hidden = false;
      const left = (x(i) / W) * r.width;
      tip.style.left = Math.min(Math.max(0, left - tip.offsetWidth / 2), r.width - tip.offsetWidth) + 'px';
    };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
  }

  let battleChart = null; // 렌더 후 차트 그리기용
  async function renderBattle(f) {
    battlePicker.takeRaw();
    const picks = battlePicker.items.slice();
    if (picks.length < 1) return '<p class="headline">비교할 종목을 1개 이상 골라 주세요. (2개 이상이면 대결!)</p>';
    const kind = f.kind.value, amount = num(f.amount.value), rate = num(f.rate.value);
    const afterTax = f.taxmode.value === 'after';
    const loaded = await Promise.all(picks.map((it, i) =>
      loadProduct(it, 'auto', 'max').then((p) => ({ ...p, color: `var(--s${i + 1})` }), (e) => ({ error: e.message, item: it }))));
    const ok = loaded.filter((p) => !p.error);
    const errors = loaded.filter((p) => p.error)
      .map((p) => `<p class="cmp-sub">⚠️ ${esc(p.item.name || p.item.symbol)}: ${esc(p.error)}</p>`).join('');
    if (!ok.length) return `<p class="headline">시세를 불러오지 못했어요.</p>${errors}`;

    const want = battlePeriod.value();
    const cr = Calc.commonRange(ok, want.from, want.to);
    if (!cr.ok) return `<p class="headline">고른 종목들이 함께 거래된 기간이 선택한 기간과 겹치지 않아요.</p>${errors}`;
    const aligned = Calc.alignProducts(ok, cr.from, cr.to);
    const results = aligned.map((p) => ({ p, r: Calc.battle(p, kind, amount, cr.from, cr.to, afterTax) }));
    if (results.some((x) => !x.r.enough)) return `<p class="headline">기간이 너무 짧아요. 2개월 이상으로 늘려 주세요.</p>${errors}`;
    const span = (a, b) => { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + m2 - m1; };
    const months = span(results[0].r.from, results[0].r.to);
    // 늦게 상장한 종목 때문에 시작이 당겨졌는지
    const late = ok.length > 1 ? ok.reduce((a, b) => (a.dates[0] > b.dates[0] ? a : b)) : null;
    const adjusted = late && cr.from === late.dates[0] && (!want.from || want.from < cr.from);

    // 적금 비교선
    let sv = null;
    if (rate > 0) {
      const pts = results[0].r.series.map((pt, k) => ({ d: pt.date, v: k === 0 ? amount : Calc.savings(kind, amount, rate, k, 'normal').afterTax }));
      sv = { name: `적금 연 ${rate}%`, color: 'var(--s-muted)', dash: true, points: pts, final: pts[pts.length - 1].v };
    }
    const ranked = [...results].sort((a, b) => b.r.afterTax - a.r.afterTax);
    const win = ranked[0];
    const principal = win.r.principal;
    const head = `<p class="headline">${ym(cr.from)}~${ym(cr.to)} · ${months}개월 · ${kind === 'saving' ? '매월' : '한 번에'} ${won(amount)} (원금 ${won(principal)})</p>
      <p class="big">${ranked.length > 1 ? `🏆 ${esc(win.p.name)} 승` : won(win.r.afterTax)}</p>`;

    // ① 한눈에 보는 순위표 (최종 금액 막대)
    const entries = ranked.map(({ p, r }) => ({ name: p.name, color: p.color, final: r.afterTax, rate: r.profitRate }));
    if (sv) entries.push({ name: sv.name, color: 'var(--s-muted)', final: sv.final, rate: sv.final / principal - 1, base: true });
    entries.sort((a, b) => b.final - a.final);
    const maxV = Math.max(...entries.map((e) => e.final), principal);
    let rank = 0;
    const board = `<ol class="board">${entries.map((e) => `
      <li class="${e.base ? 'base' : ''}">
        <div class="b-top"><span class="b-rank">${e.base ? '–' : ++rank}</span><i class="swatch${e.base ? ' dash' : ''}" style="background:${e.color}"></i>
          <b class="b-name">${esc(e.name)}</b><span class="b-val">${won(e.final)}</span></div>
        <div class="b-bar"><div class="track" style="--p:${(principal / maxV * 100).toFixed(1)}%"><span style="width:${Math.max(1, e.final / maxV * 100).toFixed(1)}%;background:${e.color}"></span></div>
          <em class="${e.rate >= 0 ? 'plus' : 'minus'}">${pct(e.rate, true)}</em></div>
      </li>`).join('')}</ol>
      <p class="b-note">막대 속 세로선 = 넣은 돈 ${won(principal)}${afterTax ? ' · 세후 금액' : ' · 세전 금액'}</p>`;

    // ② 핵심 지표 표
    const metrics = `<table class="metrics">
      <thead><tr><th>종목</th><th>연평균</th><th>최대 낙폭</th><th>변동성</th></tr></thead>
      <tbody>${ranked.map(({ p, r }) => `<tr>
        <td><i class="swatch" style="background:${p.color}"></i><span>${esc(p.name)}</span></td>
        <td class="${r.cagr >= 0 ? 'plus' : 'minus'}">${pct(r.cagr, true)}</td>
        <td class="minus">${pct(r.mdd)}</td>
        <td>${pct(r.vol)}</td></tr>`).join('')}</tbody></table>
      <p class="b-note">연평균 = 가격 기준 연 수익률 · 최대 낙폭 = 고점 대비 가장 크게 떨어진 비율 · 변동성 = 연간 출렁임(클수록 위험)</p>`;

    // ③ 자세히 (접기)
    const more = `<details class="more"><summary>종목별 자세히 보기</summary>${ranked.map(({ p, r }) => `
      <div class="more-item"><div class="cmp-head"><i class="swatch" style="background:${p.color}"></i><b>${esc(p.name)}</b><span class="tag">${esc(p.kind)}</span></div>
        <dl>
          <dt>평가 금액</dt><dd>${won(r.value)}</dd>
          ${afterTax ? `<dt>세금</dt><dd>${won(r.tax)}</dd><dt>세금 기준</dt><dd>${esc(Calc.TAX_LABELS[p.tax])}</dd>` : ''}
          <dt>가격 상승률</dt><dd>${pct(r.priceReturn, true)}</dd>
          <dt>최고의 달</dt><dd class="plus">${pct(r.bestMonth.ret, true)} (${ym(r.bestMonth.date)})</dd>
          <dt>최악의 달</dt><dd class="minus">${pct(r.worstMonth.ret, true)} (${ym(r.worstMonth.date)})</dd>
        </dl></div>`).join('')}</details>`;

    const legend = [...results.map(({ p }) => `<span><i class="swatch" style="background:${p.color}"></i>${esc(p.name)}</span>`),
      sv ? `<span><i class="swatch dash" style="background:var(--s-muted)"></i>적금</span>` : '',
      '<span><i class="swatch dot"></i>넣은 돈</span>'].join('');

    battleChart = () => {
      const host = document.querySelector('#battle .chart-host');
      if (!host) return;
      const lines = results.map(({ p, r }) => ({ name: p.name, label: p.name, color: p.color, points: r.series.map((x) => ({ d: x.date, v: x.value })) }));
      if (sv) lines.push({ ...sv, label: '' });
      lines.push({ name: '넣은 돈', color: 'var(--text-muted)', dash: true, points: results[0].r.series.map((x) => ({ d: x.date, v: x.principal })) });
      lineChart(host, lines);
    };
    return `${head}
      ${adjusted && late ? `<p class="note" style="margin:0 0 10px">ℹ️ ${esc(late.name)} 시세가 ${ym(late.dates[0])}부터 있어 모든 종목을 같은 기간으로 맞췄어요.</p>` : ''}
      ${board}
      <h3 class="sub-h">평가금액 추이 <small>(차트를 누르면 그 달 금액)</small></h3>
      <div class="legend">${legend}</div>
      <div class="chart-host"></div>
      <h3 class="sub-h">위험·수익 지표</h3>
      ${metrics}
      ${more}${errors}
      <p class="note">${kind === 'saving' ? '매월 초 같은 금액을 사서' : '시작 달에 한 번에 사서'} 끝 달 가격으로 평가했어요. 수정주가(배당 재투자) 기준이며, 해외 종목은 그 달 환율로 원화 환산했어요.
      ${afterTax ? '세금은 종목별 자동 판정(국내주식·국내주식형 ETF·가상자산 비과세, 기타 국내 ETF 15.4%, 해외 22%·250만원 공제)했어요.' : '세금을 빼기 전 금액이에요.'}
      과거 결과가 미래 수익을 보장하지 않아요.</p>`;
  }

  // ---------- 폼 동작 ----------
  document.querySelectorAll('input[data-money]').forEach((el) => {
    el.addEventListener('input', () => {
      const v = num(el.value);
      el.value = v ? v.toLocaleString('ko-KR') : '';
    });
  });

  document.querySelectorAll('form[data-calc]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const box = form.parentElement.querySelector('.result');
      const show = (html) => {
        box.innerHTML = html;
        box.hidden = false;
        resultShown = true;
        refreshSupport();
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      };
      const asyncRender = { compare: renderCompare, battle: renderBattle }[form.dataset.calc];
      if (asyncRender) {
        show('<p class="headline">최신 시세 불러오는 중…</p>');
        asyncRender(form.elements).then((html) => {
          show(html);
          if (form.dataset.calc === 'battle' && battleChart) { battleChart(); }
        }, () => show('<p class="headline">시세 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>'));
      } else {
        show(renderers[form.dataset.calc](form.elements));
      }
    });
  });

  const kindSel = document.querySelector('form[data-calc="savings"] select[name="kind"]');
  kindSel.addEventListener('change', () => {
    document.querySelector('[data-kind-label]').textContent =
      kindSel.value === 'saving' ? '월 납입액 (원)' : '예치 금액 (원)';
  });

  // ---------- 탭 ----------
  const tabs = document.querySelectorAll('.tabs button');
  function showTab(id) {
    if (!document.getElementById(id)) id = 'salary';
    tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
    document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== id; });
    if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
  }
  tabs.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  showTab(location.hash.slice(1));
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));

  // ---------- 비교 탭 연동 ----------
  const cmpForm = document.querySelector('form[data-calc="compare"]');
  function syncCompareMode() {
    const m = cmpForm.mode.value;
    cmpForm.querySelectorAll('[data-hide-loan]').forEach((el) => { el.hidden = m === 'loan'; });
    cmpForm.querySelector('[data-amount-label]').textContent = m === 'saving' ? '월 납입액 (원)' : '예치 금액 (원)';
    cmpForm.querySelector('[data-rate-label]').textContent =
      { saving: '적금 연 이자율 (%)', deposit: '예금 연 이자율 (%)', loan: '대출 연 금리 (%)' }[m];
  }
  cmpForm.mode.addEventListener('change', syncCompareMode);
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.to-compare');
    if (!btn) return;
    const src = document.querySelector(`form[data-calc="${btn.dataset.from}"]`).elements;
    if (btn.dataset.from === 'loan') {
      cmpForm.mode.value = 'loan';
      cmpForm.rate.value = src.rate.value;
    } else {
      cmpForm.mode.value = src.kind.value;
      cmpForm.amount.value = src.amount.value;
      cmpForm.rate.value = src.rate.value;
      cmpForm.months.value = src.months.value;
      cmpForm.tax.value = src.tax.value;
    }
    syncCompareMode();
    showTab('compare');
    cmpForm.requestSubmit();
  });

  // ---------- 종목 선택기 (비교·대결 공용) ----------
  function createPicker(root, max, onChange = () => {}) {
    const input = root.querySelector('input[type=search]');
    const box = root.querySelector('.suggest');
    const list = root.querySelector('.picked-list');
    const items = [];
    const render = () => {
      list.innerHTML = items.map((x, i) => `<div class="picked">${max > 1 ? `<i class="swatch" style="background:var(--s${i + 1})"></i>` : '✅'}
        <span class="pk"><b></b><small></small></span><button type="button" class="ghost" data-rm="${i}" aria-label="빼기">✕</button></div>`).join('');
      list.querySelectorAll('.picked .pk').forEach((el, i) => {
        el.querySelector('b').textContent = items[i].name || items[i].symbol;
        el.querySelector('small').textContent = items[i].symbol;
      });
      onChange(items);
    };
    const add = (it) => {
      if (!it || items.some((x) => x.symbol === it.symbol)) { box.hidden = true; return; }
      if (max === 1) items.length = 0;
      else if (items.length >= max) { toast(`최대 ${max}개까지 비교할 수 있어요`); return; }
      items.push(it);
      input.value = '';
      box.hidden = true;
      render();
    };
    list.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-rm]');
      if (b) { items.splice(Number(b.dataset.rm), 1); render(); }
    });
    let timer = null, seq = 0, found = [];
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) { box.hidden = true; return; }
      timer = setTimeout(async () => {
        const my = ++seq;
        let res = [];
        try { res = (await api('/api/search?q=' + encodeURIComponent(q))).items || []; } catch (_) { /* 아래 안내 */ }
        if (my !== seq) return;
        found = res;
        box.innerHTML = res.length
          ? res.map((x, i) => `<li><button type="button" data-i="${i}"><b>${esc(x.name)}</b> <small>${esc(x.symbol)} · ${esc(x.market || '')}</small></button></li>`).join('')
          : '<li class="empty">검색 결과가 없어요. 종목코드(예: 005930, TSLA, BTC-KRW)를 그대로 입력해도 돼요.</li>';
        box.hidden = false;
      }, 250);
    });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (b) add(found[Number(b.dataset.i)]);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const first = box.querySelector('button[data-i]');
      if (first) { e.preventDefault(); first.click(); }
    });
    root.querySelector('.chips').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-symbol]');
      if (b) add({ symbol: b.dataset.symbol, name: b.textContent });
    });
    return {
      items,
      // 고르지 않고 코드만 입력한 경우 그대로 추가
      takeRaw() {
        const raw = input.value.trim();
        if (/^[A-Za-z0-9.\-=^]{1,24}$/.test(raw)) add({ symbol: raw.toUpperCase(), name: '' });
      },
    };
  }

  // ---------- 기간 설정 (프리셋 + 시작·끝 월) ----------
  const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
  function createPeriod(root) {
    const f = (n) => root.querySelector(`select[name=${n}]`);
    const fromY = f('fromY'), fromM = f('fromM'), toY = f('toY'), toM = f('toM');
    const nowY = new Date().getFullYear();
    const years = Array.from({ length: nowY - 1999 }, (_, i) => nowY - i);
    const yearOpts = (first) => `<option value="">${first}</option>` + years.map((y) => `<option value="${y}">${y}년</option>`).join('');
    const monthOpts = Array.from({ length: 12 }, (_, i) => `<option value="${String(i + 1).padStart(2, '0')}">${i + 1}월</option>`).join('');
    fromY.innerHTML = yearOpts('처음부터'); toY.innerHTML = yearOpts('현재까지');
    fromM.innerHTML = monthOpts; toM.innerHTML = monthOpts;
    const sync = () => { fromM.hidden = !fromY.value; toM.hidden = !toY.value; };
    const set = (ySel, mSel, v) => { ySel.value = v ? v.slice(0, 4) : ''; if (v) mSel.value = v.slice(5, 7); };
    const btns = root.querySelectorAll('.seg button');
    const mark = (y) => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.years === y)));
    const preset = (y) => {
      if (y === '0' || y === 'max') { set(fromY, fromM, ''); set(toY, toM, ''); } else {
        const to = thisMonth();
        set(toY, toM, to); set(fromY, fromM, addMonths(to, -12 * Number(y)));
      }
      sync(); mark(y);
    };
    btns.forEach((b) => b.addEventListener('click', () => preset(b.dataset.years)));
    [fromY, fromM, toY, toM].forEach((el) => el.addEventListener('change', () => {
      if (el === fromY && fromY.value && !fromM.value) fromM.value = '01';
      sync(); mark('');
    }));
    preset(root.dataset.default);
    return {
      value: () => ({ from: fromY.value ? `${fromY.value}-${fromM.value}` : '', to: toY.value ? `${toY.value}-${toM.value}` : '' }),
    };
  }

  const comparePickRoot = cmpForm.querySelector('.pick');
  const comparePicker = createPicker(comparePickRoot, 1, (items) => { cmpForm.querySelector('.pick-tax').hidden = !items.length; });
  const comparePeriod = createPeriod(cmpForm.querySelector('.period'));
  cmpForm.addEventListener('submit', () => comparePicker.takeRaw(), true);

  const battleForm = document.querySelector('form[data-calc="battle"]');
  const battlePicker = createPicker(battleForm.querySelector('.pick'), 4);
  const battlePeriod = createPeriod(battleForm.querySelector('.period'));
  battleForm.kind.addEventListener('change', () => {
    battleForm.querySelector('[data-battle-amount]').textContent = battleForm.kind.value === 'saving' ? '월 투자액 (원)' : '투자 금액 (원)';
  });

  // ---------- 공유 ----------
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }
  document.getElementById('share-btn').addEventListener('click', async () => {
    const data = { title: document.title, url: location.href };
    try {
      if (navigator.share) { await navigator.share(data); return; }
      await navigator.clipboard.writeText(location.href);
      toast('링크를 복사했어요');
    } catch (_) { /* 사용자가 공유 취소 */ }
  });

  // ---------- 수익화 ----------
  const supportBtns = document.querySelector('.support-btns');
  const supportBox = document.getElementById('support');
  let hasSupport = false;
  let resultShown = false;
  const refreshSupport = () => { supportBox.hidden = !(hasSupport && resultShown); };

  if (isHttps(CFG.kakaoPayUrl)) {
    supportBtns.insertAdjacentHTML('beforeend', '<a class="kakao" target="_blank" rel="noopener">카카오페이로 후원</a>');
    supportBtns.lastElementChild.href = CFG.kakaoPayUrl;
    hasSupport = true;
  }
  if (CFG.tossQrImage) {
    // 이미지가 실제로 있을 때만 토스 QR 버튼을 노출
    const img = new Image();
    img.alt = '토스 송금 QR 코드';
    img.onload = () => {
      const btn = document.createElement('a');
      btn.className = 'toss';
      btn.href = '#';
      btn.textContent = '토스로 후원 (QR)';
      supportBtns.prepend(btn);
      const qr = document.createElement('div');
      qr.className = 'qr';
      qr.hidden = true;
      const frame = document.createElement('div');
      frame.className = 'frame';
      frame.appendChild(img);
      qr.appendChild(frame);
      qr.insertAdjacentHTML('beforeend', '<p>토스 앱 → 홈 상단 스캔 버튼으로 QR을 찍어주세요.<br>휴대폰이라면 길게 눌러 이미지를 저장한 뒤 토스에서 불러오세요.</p>');
      supportBox.appendChild(qr);
      btn.addEventListener('click', (e) => { e.preventDefault(); qr.hidden = !qr.hidden; });
      hasSupport = true;
      refreshSupport();
    };
    img.src = CFG.tossQrImage;
  }

  const hasCoupang = CFG.coupangLinks && Object.values(CFG.coupangLinks).some((l) => l && isHttps(l.url));
  document.querySelector('.disclosure').hidden = !hasCoupang;

  if (/^ca-pub-\d+$/.test(CFG.adsenseClient || '')) {
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + CFG.adsenseClient;
    s.crossOrigin = 'anonymous';
    document.head.appendChild(s);
    if (CFG.adsenseSlot) {
      const slot = document.getElementById('ad-slot');
      const ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'block';
      ins.dataset.adClient = CFG.adsenseClient;
      ins.dataset.adSlot = CFG.adsenseSlot;
      ins.dataset.adFormat = 'auto';
      ins.dataset.fullWidthResponsive = 'true';
      slot.appendChild(ins);
      slot.hidden = false;
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    }
  }
})();
