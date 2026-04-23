/**
 * 권리분석 엔진
 */

const { calcTotalCost, compareMarket, analyzeScenario, estimateBidPrice } = require('./cost');

const MALSO_KEYWORDS = ['근저당', '저당', '가압류', '압류', '담보가등기', '경매개시결정'];
const ALWAYS_INHERIT = ['유치권', '법정지상권', '분묘기지권'];

const CHOI_U_SEON = {
  seoul: [165_000_000, 55_000_000],
  overcrowded: [145_000_000, 48_000_000],
  metro: [85_000_000, 28_000_000],
  other: [75_000_000, 25_000_000],
};

function parseMoney(s) {
  if (!s) return 0;
  const digits = String(s).replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function normalizeDate(s) {
  if (!s) return '';
  const m = String(s).match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return String(s);
}

function formatMoney(n) {
  if (!n) return '-';
  const 억 = Math.floor(n / 100_000_000);
  const 만 = Math.floor((n % 100_000_000) / 10_000);
  const parts = [];
  if (억) parts.push(`${억}억`);
  if (만) parts.push(`${만.toLocaleString('ko-KR')}만`);
  return (parts.join(' ') || '0') + '원';
}

function normalizeRights(raw) {
  return raw
    .map((r) => ({
      date: normalizeDate(r['접수일자'] || r['접수일'] || r['접수'] || ''),
      type: (r['권리종류'] || r['등기'] || '').trim(),
      holder: (r['권리자'] || r['등기명의인'] || '').trim(),
      amount: parseMoney(r['채권금액'] || r['채권최고액'] || r['금액'] || ''),
    }))
    .filter((r) => r.date || r.type);
}

function normalizeTenants(raw) {
  return raw
    .map((t) => ({
      name: (t['임차인'] || t['성명'] || '').trim(),
      moveIn: normalizeDate(t['전입신고일자'] || t['전입일'] || t['전입'] || ''),
      fixed: normalizeDate(t['확정일자'] || ''),
      deposit: parseMoney(t['보증금'] || t['임차보증금'] || ''),
    }))
    .filter((t) => t.moveIn);
}

function findMalso(rights) {
  const candidates = rights.filter((r) => MALSO_KEYWORDS.some((k) => r.type.includes(k)));
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.date.localeCompare(b.date));
  return candidates[0];
}

function analyzeRights(rights, malso) {
  const sorted = [...rights].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((r) => {
    const out = { ...r };
    if (ALWAYS_INHERIT.some((k) => r.type.includes(k))) {
      out.status = '인수';
      out.reason = `${r.type}은(는) 경매로 소멸되지 않는 특수권리`;
    } else if (!malso) {
      out.status = '?';
      out.reason = '말소기준권리 없음';
    } else if (r === malso) {
      out.status = '소멸';
      out.reason = '말소기준 본인 — 매각으로 소멸';
      out.isMalso = true;
    } else if (r.date < malso.date) {
      out.status = '인수';
      out.reason = '말소기준보다 선순위 → 인수';
    } else {
      out.status = '소멸';
      out.reason = '말소기준 이후 → 소멸';
    }
    return out;
  });
}

function analyzeTenants(tenants, malso) {
  return tenants.map((t) => {
    const out = { ...t };
    if (!malso) {
      out.daehang = '?';
      out.reason = '말소기준 없음';
    } else if (!t.moveIn) {
      out.daehang = '?';
      out.reason = '전입일 미확인';
    } else {
      // 주택임대차보호법 3조: 전입신고 다음날 0시부터 대항력 발생
      // 즉 전입일이 말소기준일보다 "엄격히 이전"이어야 대항력 있음
      // 같은 날 전입 → 다음날 0시인데 말소기준이 같은 날이니 대항력 없음
      if (t.moveIn < malso.date) {
        out.daehang = '있음';
        out.reason = `전입(${t.moveIn}) < 말소기준(${malso.date}) → 대항력 있음`;
      } else if (t.moveIn === malso.date) {
        out.daehang = '없음';
        out.reason = `전입(${t.moveIn}) = 말소기준(${malso.date}) 같은 날 → 다음날 0시 대항력 발생 규정으로 대항력 없음`;
      } else {
        out.daehang = '없음';
        out.reason = `전입(${t.moveIn}) > 말소기준(${malso.date}) → 대항력 없음`;
      }
    }
    return out;
  });
}

function simulateBaedang(bidPrice, rights, tenants, region) {
  let remain = bidPrice;
  const allocations = [];

  const cost = Math.round(bidPrice * 0.03);
  allocations.push({ order: 1, label: '경매집행비용(추정 3%)', amount: cost });
  remain -= cost;
  if (remain < 0) remain = 0;

  const [limit, maxAmt] = CHOI_U_SEON[region] || CHOI_U_SEON.other;
  const half = Math.floor(bidPrice / 2);
  let choiTotal = 0;
  tenants.forEach((t) => {
    if (t.deposit <= limit) {
      const allow = Math.max(0, Math.min(t.deposit, maxAmt, half - choiTotal));
      if (allow > 0) {
        allocations.push({ order: 2, label: `소액임차인 최우선변제 (${t.name || '임차인'})`, amount: allow });
        t._choi = allow;
        choiTotal += allow;
      } else {
        t._choi = 0;
      }
    } else {
      t._choi = 0;
    }
  });
  remain -= choiTotal;
  if (remain < 0) remain = 0;

  const priority = [];
  rights.forEach((r) => {
    if (/근저당|저당|전세권|담보가등기/.test(r.type) && r.status === '소멸') {
      priority.push({ kind: 'right', date: r.date, label: `${r.type} (${r.holder})`, amount: r.amount, ref: r });
    }
  });
  tenants.forEach((t) => {
    if (t.fixed) {
      const remainDep = Math.max(0, t.deposit - (t._choi || 0));
      if (remainDep > 0) {
        const wuseon = t.fixed > t.moveIn ? t.fixed : t.moveIn;
        priority.push({ kind: 'tenant', date: wuseon, label: `임차인 우선변제 (${t.name})`, amount: remainDep, ref: t });
      }
    }
  });
  priority.sort((a, b) => a.date.localeCompare(b.date));

  priority.forEach((p) => {
    if (remain <= 0) return;
    const pay = Math.min(p.amount, remain);
    allocations.push({ order: 3, label: `${p.label} — ${p.date}`, amount: pay });
    p.ref._baedang = (p.ref._baedang || 0) + pay;
    remain -= pay;
  });

  return { bidPrice, allocations, surplus: remain };
}

function calculateInherited(rights, tenants) {
  const items = [];
  let total = 0;
  rights.forEach((r) => {
    if (r.status === '인수') {
      const note = ALWAYS_INHERIT.some((k) => r.type.includes(k)) ? '특수권리' : '선순위 권리 인수';
      items.push({ label: `${r.type} (${r.holder})`, amount: r.amount, note });
      total += r.amount;
    }
  });
  tenants.forEach((t) => {
    if (t.daehang === '있음') {
      const received = (t._choi || 0) + (t._baedang || 0);
      const unpaid = Math.max(0, t.deposit - received);
      if (unpaid > 0) {
        items.push({ label: `대항력 임차인 미배당 (${t.name})`, amount: unpaid, note: '낙찰자 인수' });
        total += unpaid;
      }
    }
  });
  return { total, items };
}

function assessRisk(rights, tenants, inherited, minBid) {
  const flags = [];
  let level = 'ok';

  const special = rights.filter((r) => ALWAYS_INHERIT.some((k) => r.type.includes(k)));
  if (special.length) {
    flags.push({ sev: 'danger', msg: `특수권리 ${special.length}건 (${special.map((r) => r.type).join(', ')})` });
    level = 'danger';
  }

  const daehang = tenants.filter((t) => t.daehang === '있음');
  if (daehang.length) {
    flags.push({ sev: inherited.total > 0 ? 'danger' : 'warn', msg: `대항력 임차인 ${daehang.length}명` });
    if (level === 'ok') level = 'warn';
  }

  if (inherited.total > 0 && minBid) {
    const ratio = inherited.total / minBid;
    if (ratio >= 0.3) {
      flags.push({ sev: 'danger', msg: `인수금액이 최저가의 ${(ratio * 100).toFixed(0)}%` });
      level = 'danger';
    } else if (ratio >= 0.05) {
      flags.push({ sev: 'warn', msg: `인수금액이 최저가의 ${(ratio * 100).toFixed(0)}%` });
      if (level === 'ok') level = 'warn';
    }
  }

  if (!flags.length) flags.push({ sev: 'ok', msg: '권리관계가 깨끗한 물건입니다' });
  return { level, flags };
}

function recommendBid(appraisal, minBid, inheritedTotal) {
  if (!appraisal || !minBid) return null;
  const taxAndOther = appraisal * 0.056;
  const upper = Math.max(minBid, Math.floor(Math.min(appraisal * 0.85, appraisal - inheritedTotal - taxAndOther)));
  return { lower: minBid, upper, base: appraisal };
}

function generateExplanation(rep) {
  const summary = makeHeadlineSummary(rep);
  const risks = collectTopRisks(rep);
  const casual = makeCasualExplanation(rep);
  const conclusion = makeConclusion(rep);

  let html = '';

  // Headline
  html += `<div class="judgment"><h3 class="judgment-headline">${summary}</h3></div>`;

  // Top risks
  if (risks.length > 0) {
    html += `<h5 class="drop-cap"><span class="num">01</span> 핵심 리스크</h5>`;
    html += `<ul class="risks">`;
    risks.slice(0, 3).forEach(r => {
      html += `<li class="${r.sev}">${r.text}</li>`;
    });
    html += `</ul>`;
  }

  // Cost breakdown
  if (rep.finalCost) {
    html += `<h5 class="drop-cap"><span class="num">02</span> 실질 투자비</h5>`;
    html += `<table class="cost-table"><thead><tr><th>항목</th><th class="r">금액</th></tr></thead><tbody>`;
    rep.finalCost.breakdown.forEach(item => {
      if (item.amount > 0 || item.key === 'bid') {
        html += `<tr><td>${escapeHtml(item.label)}${item.note ? ` <span class="meta">${escapeHtml(item.note)}</span>` : ''}</td><td class="r">${formatMoney(item.amount)}</td></tr>`;
      }
    });
    html += `<tr class="total"><td>총 실질 투자비</td><td class="r">${formatMoney(rep.finalCost.total)}</td></tr>`;
    html += `</tbody></table>`;
  }

  // Market comparison
  if (rep.marketComparison) {
    const mc = rep.marketComparison;
    html += `<h5 class="drop-cap"><span class="num">03</span> 주변 시세 대비</h5>`;
    html += `<div class="market ${mc.verdict}">`;
    html += `<div class="market-line"><span class="k">실질 투자비</span><span class="v">${formatMoney(rep.finalCost.total)}</span></div>`;
    html += `<div class="market-line"><span class="k">주변 시세</span><span class="v">${formatMoney(mc.market)}</span></div>`;
    html += `<div class="market-diff">${mc.diff >= 0 ? '+' : '-'}${formatMoney(Math.abs(mc.diff))} (${(mc.diffRatio * 100).toFixed(1)}%)</div>`;
    const verdictText = {
      great: '시세보다 상당히 싸게 낙찰',
      good: '시세보다 적정히 싸게',
      fair: '시세와 비슷한 수준',
      overpay: '시세보다 비싸게 낙찰하는 셈',
      terrible: '시세를 크게 초과 · 경매의 의미 없음',
    }[mc.verdict];
    html += `<div class="market-verdict-line">${verdictText}</div>`;
    html += `</div>`;
  }

  // Casual explanation (양쪽 큰따옴표)
  html += `<h5 class="drop-cap"><span class="num">04</span> 쉬운 말 해설</h5>`;
  html += `<div class="pull-quote"><span class="pull-quote-text">${casual}</span></div>`;

  // Conclusion
  html += `<div class="conclusion ${rep.risk.level}">${conclusion}</div>`;

  return html;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── 헤드라인 요약 ──
function makeHeadlineSummary(rep) {
  const mc = rep.marketComparison;
  const daehang = rep.tenants.filter(t => t.daehang === '있음').length;

  if (mc && mc.verdict === 'terrible') {
    return `시세보다 <em>${formatMoney(Math.abs(mc.diff))}</em> 비싸게 낙찰받게 되는 위험 물건입니다.`;
  }
  if (mc && mc.verdict === 'overpay') {
    return `실질 투자비가 시세를 초과합니다.`;
  }
  if (rep.risk.level === 'danger') {
    return `위험 요소가 여러 개. <em>입찰 전 전문가 검토</em>가 필수입니다.`;
  }
  if (daehang > 0 && rep.inherited.total > 0) {
    return `대항력 있는 임차인 인수금액 <em>${formatMoney(rep.inherited.total)}</em>이 발생합니다.`;
  }
  if (rep.risk.level === 'warn') {
    return `주의 요소가 있지만 실질 투자비 기준 판단 가능한 물건입니다.`;
  }
  if (mc && (mc.verdict === 'great' || mc.verdict === 'good')) {
    return `권리관계 깨끗하고 시세보다 <em>${formatMoney(Math.abs(mc.diff))}</em> 저렴. 검토할 만합니다.`;
  }
  return `권리관계가 깨끗한 물건입니다.`;
}

// ── TOP 3 리스크 ──
function collectTopRisks(rep) {
  const risks = [];

  const daehang = rep.tenants.filter(t => t.daehang === '있음');
  if (daehang.length > 0 && rep.inherited.total > 0) {
    risks.push({
      sev: 'danger',
      severity: 3,
      text: `대항력 있는 임차인 ${daehang.map(t => t.name).join(', ')} 보증금 중 <strong>${formatMoney(rep.inherited.total)}</strong>이 낙찰자 인수 대상`,
    });
  }

  const mc = rep.marketComparison;
  if (mc) {
    if (mc.verdict === 'terrible') {
      risks.push({
        sev: 'danger',
        severity: 3,
        text: `실질 투자비 <strong>${formatMoney(rep.finalCost.total)}</strong>이 시세 <strong>${formatMoney(mc.market)}</strong>를 <strong>${formatMoney(Math.abs(mc.diff))}</strong> 초과`,
      });
    } else if (mc.verdict === 'overpay') {
      risks.push({
        sev: 'warn',
        severity: 2,
        text: `시세 대비 ${(mc.diffRatio * 100).toFixed(1)}% 비싸게 낙찰하는 셈`,
      });
    }
  }

  const inheritRights = rep.rights.filter(r => r.status === '인수');
  if (inheritRights.length > 0) {
    inheritRights.forEach(r => {
      risks.push({
        sev: 'warn',
        severity: 2,
        text: `${r.type} (${r.holder}) <strong>인수</strong> · ${r.reason || ''}`,
      });
    });
  }

  const yuchal = parseInt(String(rep.basic?.['유찰횟수'] || '').replace(/[^0-9]/g, ''), 10) || 0;
  if (yuchal >= 3) {
    risks.push({
      sev: 'warn',
      severity: 1,
      text: `${yuchal}회 유찰 · 시장이 이 물건의 위험을 이미 인지하고 있음`,
    });
  }

  if (rep.finalCost?.breakdown.find(b => b.key === 'unpaidFee')?.amount > 0) {
    const fee = rep.finalCost.breakdown.find(b => b.key === 'unpaidFee').amount;
    if (fee >= 3_000_000) {
      risks.push({
        sev: 'warn',
        severity: 1,
        text: `미납관리비 <strong>${formatMoney(fee)}</strong> · 낙찰자 일부 부담`,
      });
    }
  }

  risks.sort((a, b) => b.severity - a.severity);
  return risks;
}

// ── 쉬운 말 해설 ──
function makeCasualExplanation(rep) {
  const mc = rep.marketComparison;
  const daehang = rep.tenants.filter(t => t.daehang === '있음').length;

  if (mc && mc.verdict === 'terrible') {
    return `싸 보이는 거 함정입니다. 최저가만 보고 입찰하면 안 돼요. 세입자 보증금까지 떠안게 되니 실제로는 시세보다 훨씬 비싸게 사는 꼴입니다. 차라리 일반 매매로 근처 집을 사는 게 나아요.`;
  }
  if (mc && mc.verdict === 'overpay') {
    return `겉보기엔 싸 보이지만 세금·명도비·인수금액까지 다 더하면 시세랑 별 차이 없어요. 경매의 이점이 별로 없는 상황입니다.`;
  }
  if (daehang > 0 && rep.inherited.total > 0) {
    return `대항력 있는 임차인이 있어요. 낙찰 후에 세입자 보증금(또는 일부)을 당신이 대신 갚아야 합니다. 이 금액을 반드시 총 비용에 포함시켜서 판단하세요.`;
  }
  if (rep.risk.level === 'ok') {
    return `권리관계는 깨끗한 편이에요. 남은 건 시세 대비 얼마나 싸게 낙찰받느냐의 문제입니다. 주변 실거래가를 꼭 확인하세요.`;
  }
  return `단순해 보이지 않는 물건이에요. 실질 투자비 계산과 현장 확인을 하시고, 필요시 경매 전문 법무사와 상담하시는 걸 권합니다.`;
}

// ── 결론 ──
function makeConclusion(rep) {
  const mc = rep.marketComparison;

  if (mc) {
    if (mc.verdict === 'terrible') return `입찰 비추천 · 실질 투자비가 시세를 크게 초과합니다.`;
    if (mc.verdict === 'overpay') return `입찰 신중 · 경매의 가격 이점이 없거나 적습니다.`;
    if (mc.verdict === 'fair') return `가치 중립 · 권리관계·입지 등 가격 외 요소로 판단하세요.`;
    if (mc.verdict === 'good') return `검토 가치 있음 · 시세 대비 적정히 저렴. 현장답사 권장.`;
    if (mc.verdict === 'great') return `적극 검토 · 권리관계만 괜찮다면 시세 대비 매력적인 가격.`;
  }

  if (rep.risk.level === 'danger') return `입찰 비추천 · 위험 요소가 많습니다. 전문가 검토 필수.`;
  if (rep.risk.level === 'warn') return `입찰 신중 · 주의 요소가 있으니 실질 투자비 꼼꼼히 계산.`;
  return `시세 정보 추가하면 더 정확한 판단 가능 · 네이버부동산 등에서 확인 후 입력하세요.`;
}

// ── 초보자 체크리스트 생성 ──
function makeChecklist(rep) {
  const items = [];

  // 말소기준권리
  if (rep.malso) {
    items.push({
      status: 'ok',
      label: `말소기준권리 (${rep.malso.type} ${rep.malso.date}) 확인 완료`,
    });
  } else {
    items.push({
      status: 'warn',
      label: '말소기준권리 미확인 — 매각물건명세서 확인 필요',
    });
  }

  // 인수 권리 개수 (권리 + 대항력 임차인 인수액)
  const inheritRights = rep.rights.filter(r => r.status === '인수');
  const daehangInherited = rep.inherited.items.filter(i => /임차인/.test(i.label));
  const totalInheritCount = inheritRights.length + daehangInherited.length;
  if (totalInheritCount > 0) {
    items.push({
      status: 'danger',
      label: `인수 항목 ${totalInheritCount}건 · 추가 ${formatMoney(rep.inherited.total)} 부담`,
    });
  } else {
    items.push({
      status: 'ok',
      label: '인수 권리 없음',
    });
  }

  // 임차인별
  rep.tenants.forEach(t => {
    if (t.daehang === '있음') {
      items.push({
        status: 'warn',
        label: `임차인 ${t.name} 보증금 ${t.deposit ? formatMoney(t.deposit) : '미확인'} 배당 여부 확인 필요`,
      });
    }
  });

  // 유치권 등 특수권리
  const specials = rep.rights.filter(r => /유치권|법정지상권|분묘기지권/.test(r.type));
  if (specials.length > 0) {
    specials.forEach(s => {
      items.push({
        status: 'danger',
        label: `${s.type} 주장 있음 — 전문가 검토 필수`,
      });
    });
  } else {
    items.push({
      status: 'ok',
      label: '유치권·법정지상권 등 특수권리 없음',
    });
  }

  // 유찰 패턴
  const yuchal = parseInt(String(rep.basic?.['유찰횟수'] || '').replace(/[^0-9]/g, ''), 10) || 0;
  if (yuchal >= 3) {
    items.push({
      status: 'ok',
      label: `${yuchal}회 유찰 — 최저가 하락으로 가격 메리트`,
    });
  }

  // 시세 vs 실질투자비
  if (rep.marketComparison && rep.finalCost) {
    if (rep.marketComparison.verdict === 'terrible' || rep.marketComparison.verdict === 'overpay') {
      items.push({
        status: 'danger',
        label: `실질 투자비가 시세를 초과 — 경매의 가격 이점 없음`,
      });
    } else if (rep.marketComparison.verdict === 'great' || rep.marketComparison.verdict === 'good') {
      items.push({
        status: 'ok',
        label: `시세 대비 저렴 — 권리관계만 검증하면 유리`,
      });
    }
  }

  return items;
}

// ── 경매 진행 단계 해설 ──
function makeProcessGuide(rep) {
  const schedule = rep.schedule || [];
  const stages = [
    { key: 'start', label: '경매 개시', done: true, detail: '법원이 경매를 결정했습니다' },
    { key: 'survey', label: '현황 조사', done: true, detail: '집행관이 현장을 방문하여 임차인·점유 관계를 조사했습니다' },
    { key: 'appraisal', label: '감정 평가', done: !!rep.basic?.['감정평가액'], detail: '감정평가사가 시세를 조사하여 감정가를 산정했습니다' },
    { key: 'sale', label: '매각기일', done: false, detail: '정해진 기일에 입찰이 진행됩니다' },
  ];

  // 스케줄에서 실제 진행 상황 확인
  if (schedule.length > 0) {
    const hasSold = schedule.some(s => s[4] === '매각');
    const hasProgress = schedule.some(s => /진행|예정/.test(s[4]));
    stages[3].done = hasSold || hasProgress;
  }

  return stages;
}

function analyzeCase(raw, region = 'other', userInputs = {}) {
  const rights = normalizeRights(raw.rights);
  const tenantsRaw = normalizeTenants(raw.tenants);
  const malso = findMalso(rights);
  const analyzedRights = analyzeRights(rights, malso);
  const tenants = analyzeTenants(tenantsRaw, malso);

  const minBid = parseMoney(raw.basic['최저매각가격'] || raw.basic['최저가']);
  const appraisal = parseMoney(raw.basic['감정평가액'] || raw.basic['감정가']);

  const baedang = simulateBaedang(minBid || appraisal || 100_000_000, analyzedRights, tenants, region);
  const inherited = calculateInherited(analyzedRights, tenants);
  const risk = assessRisk(analyzedRights, tenants, inherited, minBid);
  const bidRec = recommendBid(appraisal, minBid, inherited.total);

  // ── 실질 투자비 계산 ──
  let finalCost = null;
  let marketComparison = null;
  let scenarios = {};
  let bidEstimate = null;
  let bidPriceUsed = null;
  let bidSource = null; // 'user' | 'ai' | 'min'

  if (minBid) {
    // 유찰 횟수 파싱
    const yuchalCount = parseInt(String(raw.basic['유찰횟수'] || '').replace(/[^0-9]/g, ''), 10) || 0;

    // AI 예상 낙찰가 계산
    bidEstimate = estimateBidPrice({
      minBid,
      appraisal,
      yuchalCount,
      inheritedTotal: inherited.total,
      propertyType: '주거용',
    });

    // 사용할 입찰가 결정: 사용자 입력 > AI 추정 > 최저가
    if (userInputs.bidPrice) {
      bidPriceUsed = parseMoney(userInputs.bidPrice);
      bidSource = 'user';
    } else if (bidEstimate && bidEstimate.estimated) {
      bidPriceUsed = bidEstimate.estimated;
      bidSource = 'ai';
    } else {
      bidPriceUsed = minBid;
      bidSource = 'min';
    }

    const areaM2 = userInputs.areaM2 ? parseFloat(userInputs.areaM2) : 85;
    const acqType = userInputs.acqType || '주택_1주택';
    const unpaidFee = userInputs.unpaidFee ? parseMoney(userInputs.unpaidFee) : 0;
    const evictionOverrides = userInputs.evictionOverrides || {};

    finalCost = calcTotalCost({
      bidPrice: bidPriceUsed,
      inheritedTotal: inherited.total,
      unpaidFee,
      areaM2,
      acqType,
      evictionOverrides,
    });

    // 시세 비교 (사용자가 입력한 경우)
    if (userInputs.marketPrice) {
      const marketPrice = parseMoney(userInputs.marketPrice);
      if (marketPrice > 0) {
        marketComparison = compareMarket(finalCost.total, marketPrice);
      }
    }

    // 수익 시나리오 — 입력된 값만 계산
    if (userInputs.marketPrice) {
      const s = analyzeScenario(finalCost.total, {
        type: 'sell',
        marketPrice: parseMoney(userInputs.marketPrice),
      });
      if (s) scenarios.sell = s;
    }
    if (userInputs.jeonsePrice) {
      const s = analyzeScenario(finalCost.total, {
        type: 'jeonse',
        jeonsePrice: parseMoney(userInputs.jeonsePrice),
      });
      if (s) scenarios.jeonse = s;
    }
    if (userInputs.wolseMonthly) {
      const s = analyzeScenario(finalCost.total, {
        type: 'wolse',
        wolseDeposit: parseMoney(userInputs.wolseDeposit || '0'),
        wolseMonthly: parseMoney(userInputs.wolseMonthly),
      });
      if (s) scenarios.wolse = s;
    }

    // 리스크 재평가 — 시세 대비 위험 반영
    if (marketComparison) {
      if (marketComparison.verdict === 'terrible' && risk.level !== 'danger') {
        risk.level = 'danger';
      } else if (marketComparison.verdict === 'overpay' && risk.level === 'ok') {
        risk.level = 'warn';
      }
    }
  }

  const pre = {
    case: raw.caseNo,
    court: raw.court,
    basic: raw.basic,
    malso,
    rights: analyzedRights,
    tenants,
    baedang,
    inherited,
    risk,
    bidRec,
    finalCost,
    marketComparison,
    scenarios,
    bidEstimate,
    bidPriceUsed,
    bidSource,
    url: raw.url,
    schedule: raw.schedule || [],
    interested: raw.interested || [],
    curstNote: raw.curstNote,
    curstDetail: raw.curstDetail,
    deliveries: raw.deliveries || [],
  };
  const report = { ...pre, explanation: generateExplanation(pre) };
  report.checklist = makeChecklist(report);
  report.processGuide = makeProcessGuide(report);
  return report;
}

module.exports = { analyzeCase, formatMoney };
