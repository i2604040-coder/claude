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
      box.innerHTML = renderers[form.dataset.calc](form.elements);
      box.hidden = false;
      resultShown = true;
      refreshSupport();
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
