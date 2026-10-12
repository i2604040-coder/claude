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
      국내주식·국내주식형 ETF는 매매차익 비과세, 그 외 ETF는 이익에 15.4% 과세로 계산했어요.
      개별 종목은 지금 시가총액 상위 종목이라 과거 성과가 실제보다 좋아 보일 수 있어요(생존 편향). 과거 결과가 미래 수익을 보장하지 않으며, 투자 상품은 원금 손실이 날 수 있어요.
      예·적금은 예금자보호(1인당 1억원) 대상입니다. 투자 권유가 아닌 참고용 정보입니다.</p>`;
  }

  async function renderCompare(f) {
    const data = await loadMarket();
    const mode = f.mode.value;
    const rate = num(f.rate.value);

    if (mode === 'loan') {
      const items = data.products.map((p) => ({ p, c: Calc.compareLoan(p, rate) }))
        .sort((a, b) => b.c.beatRate - a.c.beatRate);
      const cards = items.map(({ p, c }) => {
        if (!c.enough) return `<div class="cmp">${head(p)}<p class="cmp-sub">데이터 부족</p></div>`;
        const cagr = [['1년', c.r1], ['3년', c.r3], ['5년', c.r5]]
          .map(([l, v]) => `${l} ${v === null ? '–' : `<span class="${v * 100 > rate ? 'plus' : 'minus'}">${pct(v, true)}</span>`}`).join(' · ');
        return `<div class="cmp">${head(p)}
          <p class="cmp-main">대출 금리를 넘은 확률 <b class="${c.beatRate >= 0.5 ? 'plus' : 'minus'}">${pct(c.beatRate)}</b></p>
          <p class="cmp-sub">연평균 수익률(세전) ${cagr}<br>
          과거 ${c.windows}번의 1년 구간 기준(세후) · 최악의 1년 ${pct(c.worst.ret, true)} (${ym(c.worst.from)}~${ym(c.worst.to)})</p></div>`;
      }).join('');
      return `<p class="headline">대출을 갚으면 확실하게 아끼는 이자</p>
        <p class="big">연 ${rate}%</p>
        <p class="note" style="margin:0 0 12px">대출을 갚는 대신 그 돈을 투자했을 때, 1년 뒤 세후 수익률이 대출 금리보다 높았던 비율이에요. 50% 미만이면 대출 상환이 유리했던 경우가 더 많았다는 뜻입니다.</p>
        ${cards}${compareFooter(data)}`;
    }

    const amount = num(f.amount.value);
    const months = Math.max(1, Math.min(120, num(f.months.value)));
    const sv = Calc.savings(mode, amount, rate, months, f.tax.value, false);
    const label = mode === 'saving' ? '적금' : '예금';
    const items = data.products.map((p) => ({ p, c: Calc.compareSavings(p, mode, amount, months, sv.afterTax) }))
      .sort((a, b) => (b.c.enough - a.c.enough) || (b.c.enough ? b.c.winRate - a.c.winRate : 0));
    const cards = items.map(({ p, c }) => {
      if (!c.enough) return `<div class="cmp">${head(p)}<p class="cmp-sub">상장 후 ${c.months}개월뿐이라 ${months}개월 비교는 아직 못 해요.</p></div>`;
      const diff = c.latest.afterTax - sv.afterTax;
      return `<div class="cmp">${head(p)}
        <p class="cmp-main">최근 ${months}개월 넣었다면 <b>${won(c.latest.afterTax)}</b>
          <span class="${diff >= 0 ? 'plus' : 'minus'}">(${label}보다 ${signedWon(diff)})</span></p>
        <p class="cmp-sub">과거 ${c.windows}번의 ${months}개월 구간 중 <b>${pct(c.winRate)}</b>는 ${label}보다 많았고, ${pct(c.lossRate)}는 원금 손실<br>
        최악 ${won(c.worst.afterTax)} (${ym(c.worst.from)}~${ym(c.worst.to)}) · 최고 ${won(c.best.afterTax)}</p></div>`;
    }).join('');
    return `<p class="headline">내 ${label} ${months}개월 세후 만기액 (원금 ${won(sv.principal)})</p>
      <p class="big">${won(sv.afterTax)}</p>
      <p class="note" style="margin:0 0 12px">같은 돈을 같은 방식(${mode === 'saving' ? '매월 적립' : '한 번에 투자'})으로 넣었을 때의 세후 금액이에요. '최근'은 지금 끝난 ${months}개월, 확률은 과거 10년 안의 모든 ${months}개월 구간 기준입니다.</p>
      ${cards}${compareFooter(data)}`;
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
      if (form.dataset.calc === 'compare') {
        show('<p class="headline">최신 시세 불러오는 중…</p>');
        renderCompare(form.elements).then(show,
          () => show('<p class="headline">시세 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>'));
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
