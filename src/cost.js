/**
 * 실질 투자비 계산 모듈
 * ────────────────────────
 * 낙찰가 외에 추가로 드는 모든 비용을 계산.
 *
 * 1) 취득세 (주택 1.1% ~ 4.6%)
 * 2) 법무사비 (등기이전 + 근저당설정)
 * 3) 명도비용 (마이옥션 스타일 - 면적별 세분)
 * 4) 미납관리비 (사용자 입력)
 * 5) 인수 보증금/권리 (분석엔진에서 이미 계산)
 *
 * 모든 금액 단위는 원.
 */

/**
 * 취득세 계산
 * @param {number} bidPrice - 낙찰가
 * @param {string} acqType - '주택_1주택' | '주택_다주택' | '상가' | '토지' | '농지'
 * @param {number} areaM2 - 전용면적 (85㎡ 이하 여부로 세율 다름)
 */
function calcAcquisitionTax(bidPrice, acqType = '주택_1주택', areaM2 = 85) {
  if (!bidPrice) return 0;

  // 주택 (1주택자) — 6억 이하 1%, 6억~9억 2%, 9억 초과 3%
  // + 지방교육세 0.1%, 농특세 0.2% (85㎡ 초과시)
  if (acqType === '주택_1주택') {
    let rate;
    if (bidPrice <= 600_000_000) rate = 0.01;
    else if (bidPrice <= 900_000_000) rate = 0.02;
    else rate = 0.03;
    rate += 0.001; // 지방교육세
    if (areaM2 > 85) rate += 0.002; // 농특세
    return Math.round(bidPrice * rate);
  }

  // 주택 (다주택자) — 조정대상지역 8% / 비조정 4% + 부가세
  if (acqType === '주택_다주택') {
    let rate = 0.04 + 0.004; // 4% + 지방교육세 0.4%
    if (areaM2 > 85) rate += 0.002;
    return Math.round(bidPrice * rate);
  }

  // 상가·오피스텔·토지 — 4% + 부가세 0.6% = 4.6%
  if (acqType === '상가' || acqType === '토지') {
    return Math.round(bidPrice * 0.046);
  }

  // 농지 — 3% + 부가세 0.2% = 3.2%
  if (acqType === '농지') {
    return Math.round(bidPrice * 0.032);
  }

  // 기본 4.6%
  return Math.round(bidPrice * 0.046);
}

/**
 * 법무사비 (등기이전 수수료)
 * 실제 보수는 법정 요율표 기준이지만 단순화: 낙찰가의 0.25% + 등록면허세 (소유권이전 0.15%)
 * 마이옥션·부동산태인 관례상 "낙찰가의 약 0.4~0.5%"로 잡음
 */
function calcLegalFee(bidPrice) {
  if (!bidPrice) return 0;
  return Math.round(bidPrice * 0.004);
}

/**
 * 명도비용 — 마이옥션 스타일 (항목별 세분)
 *
 * @param {number} areaM2 - 전용면적
 * @param {Object} overrides - 사용자가 직접 입력한 값 (없으면 자동 추정)
 * @returns {Object} { total, items: [{label, amount, note}] }
 *
 * 기준 (84㎡ 아파트 기준 421만원):
 * - 접수비: 10만원 (고정, 면적 무관)
 * - 운반 및 보관료: 5톤 컨테이너 2대, 보관 3개월 → 220만원 (84㎡ 기준)
 * - 노무비: 노무자 12인 × 13만원 = 156만원 (84㎡ 기준 = 면적의 1.86배)
 * - 사다리차: 35만원 (기본차량 1대)
 *
 * 면적별 스케일링: 84㎡ 대비 비율로 선형 증가
 */
function calcEvictionCost(areaM2 = 85, overrides = {}) {
  const scale = Math.max(0.5, Math.min(3.0, areaM2 / 84)); // 최소 0.5배, 최대 3배 제한

  const items = [
    {
      key: 'receipt',
      label: '접수비',
      amount: overrides.receipt ?? 100_000,
      note: '면적 무관 고정비',
    },
    {
      key: 'storage',
      label: '운반 및 보관료',
      amount: overrides.storage ?? Math.round(2_200_000 * scale),
      note: `5톤 컨테이너 2대, 보관 3개월 (면적 ${areaM2}㎡ 기준)`,
    },
    {
      key: 'labor',
      label: '노무비',
      amount: overrides.labor ?? Math.round(1_560_000 * scale),
      note: `노무자 ${Math.round(12 * scale)}인 × 13만원`,
    },
    {
      key: 'ladder',
      label: '사다리차',
      amount: overrides.ladder ?? 350_000,
      note: '기본차량 1대',
    },
  ];

  const total = items.reduce((s, it) => s + it.amount, 0);
  return { total, items };
}

/**
 * 전체 실질 투자비 계산
 *
 * @param {Object} params
 * @param {number} params.bidPrice - 낙찰 예정가 (보통 최저가)
 * @param {number} params.inheritedTotal - 인수 금액 (대항력 임차인 등)
 * @param {number} params.unpaidFee - 미납관리비 (사용자 입력, 없으면 0)
 * @param {number} params.areaM2 - 전용면적
 * @param {string} params.acqType - 취득세 유형
 * @param {Object} params.evictionOverrides - 명도비 직접 입력값
 */
function calcTotalCost({ bidPrice, inheritedTotal = 0, unpaidFee = 0, areaM2 = 85, acqType = '주택_1주택', evictionOverrides = {} }) {
  const acquisitionTax = calcAcquisitionTax(bidPrice, acqType, areaM2);
  const legalFee = calcLegalFee(bidPrice);
  const eviction = calcEvictionCost(areaM2, evictionOverrides);

  const breakdown = [
    { key: 'bid', label: '낙찰가', amount: bidPrice },
    { key: 'inherited', label: '인수 보증금/권리', amount: inheritedTotal, note: inheritedTotal > 0 ? '대항력 임차인 미배당분 등' : undefined },
    { key: 'acquisitionTax', label: '취득세', amount: acquisitionTax, note: `${acqType} 기준` },
    { key: 'legalFee', label: '법무사비', amount: legalFee, note: '등기이전 수수료' },
    { key: 'eviction', label: '명도비용', amount: eviction.total, note: '접수비+운반+노무비+사다리차', sub: eviction.items },
    { key: 'unpaidFee', label: '미납관리비', amount: unpaidFee, note: unpaidFee ? '사용자 입력' : '없음' },
  ];

  const total = breakdown.reduce((s, item) => s + (item.amount || 0), 0);

  return { total, breakdown };
}

/**
 * 시세 비교
 *
 * @param {number} totalCost - 실질 투자비
 * @param {number} marketPrice - 주변 시세 (사용자 입력)
 * @returns {Object|null} { market, diff, diffRatio, verdict }
 */
function compareMarket(totalCost, marketPrice) {
  if (!marketPrice || marketPrice <= 0) return null;

  const diff = totalCost - marketPrice;
  const diffRatio = diff / marketPrice;

  let verdict;
  if (diffRatio <= -0.15) verdict = 'great';       // 시세보다 15%+ 싸게
  else if (diffRatio <= -0.05) verdict = 'good';    // 5~15% 싸게
  else if (diffRatio <= 0.05) verdict = 'fair';     // ±5% 적정
  else if (diffRatio <= 0.15) verdict = 'overpay';  // 5~15% 비싸게
  else verdict = 'terrible';                        // 15% 이상 비싸게

  return { market: marketPrice, diff, diffRatio, verdict };
}

/**
 * AI 예상 낙찰가 추정
 *
 * 대한민국 경매 통계상 낙찰가율:
 * - 주거용 아파트 평균: 최저가 대비 105~115%
 * - 유찰이 많을수록 낙찰가율 상승 (시장이 가격이 떨어져서 들어옴)
 * - 대항력 임차인 인수 등 리스크 있으면 낙찰가율 하락 (90~100%)
 * - 6회 이상 유찰은 '문제 있는 물건' 인식, 낙찰가율 95~105% 유지
 *
 * @param {Object} params
 * @param {number} params.minBid - 최저매각가
 * @param {number} params.appraisal - 감정가
 * @param {number} params.yuchalCount - 유찰 횟수
 * @param {number} params.inheritedTotal - 인수금액 (0이면 깨끗, 크면 위험)
 * @param {string} params.propertyType - '주거용'|'상가'|'토지'
 * @returns {Object} { estimated, low, high, ratio, reasoning }
 */
function estimateBidPrice({ minBid, appraisal, yuchalCount = 0, inheritedTotal = 0, propertyType = '주거용' }) {
  if (!minBid) return null;

  // 기본 낙찰가율: 주거용 110%
  let baseRatio = 1.10;

  // 상가·토지는 더 보수적
  if (propertyType === '상가') baseRatio = 1.05;
  if (propertyType === '토지') baseRatio = 1.08;

  // 유찰 보정
  // 0~2회: 일반적 (기본)
  // 3~4회: 유의미한 위험 신호, 낙찰가율 하락 0.03
  // 5회 이상: 심각한 문제, 낙찰가율 하락 0.05
  let yuchalAdj = 0;
  if (yuchalCount >= 5) yuchalAdj = -0.05;
  else if (yuchalCount >= 3) yuchalAdj = -0.03;

  // 인수금액 보정 (최저가 대비 인수비율)
  // 인수가 최저가의 30%+: 낙찰가율 하락 0.05
  // 50%+: 하락 0.08
  // 100%+: 하락 0.12 (사실상 최저가 근처에서 낙찰)
  let inheritAdj = 0;
  if (minBid > 0 && inheritedTotal > 0) {
    const burdenRatio = inheritedTotal / minBid;
    if (burdenRatio >= 1.0) inheritAdj = -0.12;
    else if (burdenRatio >= 0.5) inheritAdj = -0.08;
    else if (burdenRatio >= 0.3) inheritAdj = -0.05;
    else if (burdenRatio >= 0.1) inheritAdj = -0.02;
  }

  const finalRatio = baseRatio + yuchalAdj + inheritAdj;
  // 최저가 이하로는 내려가지 않음 (유찰 후 재매각이니까)
  const estimated = Math.max(minBid, Math.round(minBid * finalRatio));
  const low = Math.max(minBid, Math.round(minBid * Math.max(1.0, finalRatio - 0.05)));
  const high = Math.max(minBid, Math.round(minBid * Math.max(finalRatio, finalRatio + 0.08)));

  // 추정 근거 설명
  const reasoning = [];
  reasoning.push(`${propertyType} 기본 낙찰가율 ${(baseRatio * 100).toFixed(0)}%`);
  if (yuchalAdj !== 0) {
    reasoning.push(`${yuchalCount}회 유찰로 ${(yuchalAdj * 100).toFixed(0)}%p 조정`);
  }
  if (inheritAdj !== 0) {
    reasoning.push(`인수금액 부담으로 ${(inheritAdj * 100).toFixed(0)}%p 조정`);
  }
  reasoning.push(`최종 예상 낙찰가율 ${(finalRatio * 100).toFixed(0)}%`);

  return {
    estimated,
    low,
    high,
    ratio: finalRatio,
    reasoning: reasoning.join(' · '),
  };
}

/**
 * 수익 시나리오 분석
 *
 * @param {number} totalCost - 총 실질 투자비
 * @param {Object} scenario - { type: 'sell'|'jeonse'|'wolse', marketPrice, jeonsePrice, wolseDeposit, wolseMonthly }
 */
function analyzeScenario(totalCost, scenario) {
  if (!scenario || !scenario.type) return null;
  const s = scenario;

  // 매도 시나리오
  if (s.type === 'sell') {
    const marketPrice = Number(s.marketPrice) || 0;
    if (!marketPrice) return null;
    const profit = marketPrice - totalCost;
    const profitRatio = profit / totalCost;
    let verdict;
    if (profitRatio >= 0.3) verdict = 'great';
    else if (profitRatio >= 0.1) verdict = 'good';
    else if (profitRatio >= -0.05) verdict = 'fair';
    else if (profitRatio >= -0.2) verdict = 'loss';
    else verdict = 'bigloss';
    return {
      type: 'sell',
      label: '매도 시나리오',
      inputs: [
        { k: '매도 예상가 (시세)', v: marketPrice },
        { k: '총 실질 투자비', v: totalCost },
      ],
      profit,
      profitRatio,
      verdict,
      summary: profit >= 0
        ? `매도 시 ${Math.round(profitRatio * 1000) / 10}% 수익 예상`
        : `매도 시 ${Math.round(Math.abs(profitRatio) * 1000) / 10}% 손실 예상`,
    };
  }

  // 전세 시나리오
  if (s.type === 'jeonse') {
    const jeonsePrice = Number(s.jeonsePrice) || 0;
    if (!jeonsePrice) return null;
    const tiedUp = totalCost - jeonsePrice;
    const ratio = jeonsePrice / totalCost;
    let verdict;
    if (ratio >= 0.9) verdict = 'great';       // 전세로 거의 다 회수
    else if (ratio >= 0.75) verdict = 'good';   // 대부분 회수
    else if (ratio >= 0.5) verdict = 'fair';    // 절반 회수
    else verdict = 'loss';                        // 자본 많이 묶임
    return {
      type: 'jeonse',
      label: '전세 임대 시나리오',
      inputs: [
        { k: '총 실질 투자비', v: totalCost },
        { k: '전세 시세', v: jeonsePrice },
      ],
      tiedUp,
      ratio,
      verdict,
      summary: `전세 보증금으로 ${Math.round(ratio * 1000) / 10}% 회수, 실투자금 ${formatMoneyShort(tiedUp)}`,
      note: tiedUp > 0
        ? `자본금 ${formatMoneyShort(tiedUp)}이 전세 계약기간 동안 묶임. 시세차익 기대.`
        : `전세 보증금이 투자비를 초과 — 자본 없이 소유 가능 (갭투자)`,
    };
  }

  // 월세 시나리오
  if (s.type === 'wolse') {
    const deposit = Number(s.wolseDeposit) || 0;
    const monthly = Number(s.wolseMonthly) || 0;
    if (!monthly) return null;
    const tiedUp = totalCost - deposit;
    const annualIncome = monthly * 12;
    const yieldRate = tiedUp > 0 ? annualIncome / tiedUp : 0;
    let verdict;
    if (yieldRate >= 0.05) verdict = 'great';      // 5% 이상
    else if (yieldRate >= 0.03) verdict = 'good';   // 3~5%
    else if (yieldRate >= 0.02) verdict = 'fair';   // 2~3%
    else verdict = 'loss';                           // 2% 미만
    return {
      type: 'wolse',
      label: '월세 임대 시나리오',
      inputs: [
        { k: '총 실질 투자비', v: totalCost },
        { k: '월세 보증금', v: deposit },
        { k: '월세 (원/월)', v: monthly },
      ],
      tiedUp,
      annualIncome,
      yieldRate,
      verdict,
      summary: `연 임대수익 ${formatMoneyShort(annualIncome)} · 실투자금 대비 수익률 ${Math.round(yieldRate * 1000) / 10}%`,
    };
  }

  return null;
}

function formatMoneyShort(n) {
  if (!n && n !== 0) return '-';
  const 억 = Math.floor(n / 100_000_000);
  const 만 = Math.floor((n % 100_000_000) / 10_000);
  const parts = [];
  if (억) parts.push(`${억}억`);
  if (만) parts.push(`${만.toLocaleString('ko-KR')}만`);
  return (parts.join(' ') || '0') + '원';
}

module.exports = {
  calcAcquisitionTax,
  calcLegalFee,
  calcEvictionCost,
  calcTotalCost,
  compareMarket,
  analyzeScenario,
  estimateBidPrice,
};
