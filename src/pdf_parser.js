/**
 * 매각물건명세서 PDF 파서 v2
 * ────────────────────────────
 * 대법원 매각물건명세서 PDF의 텍스트는 세로로 쪼개져서 추출되기 때문에,
 * 줄 단위가 아닌 "임차인 블록 단위"로 파싱해야 함.
 *
 * 구조 예시:
 *   이기백
 *   203호
 *   전부
 *   등기사항전
 *   부증명서
 *   주택
 *   임차권자
 *   2022.03.02.~200,000,0002022.03.02.2022.02.04.
 *
 *   주택도
 *   시보증
 *   공사(임
 *   차인
 *   이기백)
 *   ...
 *   200,000,0002022.03.02.2022.02.04.2025.5.9.
 */

const pdfParse = require('pdf-parse');

async function parseMyeongseseoPdf(buffer) {
  const data = await pdfParse(buffer);
  const text = data.text;
  return { raw: text, parsed: parseText(text) };
}

function parseText(text) {
  const result = {
    caseNo: null,
    malso: null,
    baedangDeadline: null,
    areaM2: null,            // 전용면적
    tenants: [],
    specials: [],
    warnings: [],
    bigotContent: null,
  };

  // 1. 사건번호
  const mCase = text.match(/(\d{4}타경\d+)/);
  if (mCase) result.caseNo = mCase[1];

  // 2. 최선순위 설정 — "2023.03.10. 경매개시결정배당요구종기2025. 5. 28."에서
  //    "경매개시결정" 다음에 "배당요구종기"가 붙으므로 그 전까지만 추출
  const mMalso = text.match(/최선순위\s*설정\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*([가-힣]+?)(?=배당요구종기|\s|$)/);
  if (mMalso) {
    let type = mMalso[4];
    // "경매개시결정배당요구종기" 같은 케이스 방어
    type = type.replace(/배당요구종기.*$/, '');
    result.malso = {
      date: `${mMalso[1]}-${mMalso[2].padStart(2, '0')}-${mMalso[3].padStart(2, '0')}`,
      type,
    };
  }

  // 3. 배당요구종기
  const mBaedang = text.match(/배당요구종기\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (mBaedang) {
    result.baedangDeadline = `${mBaedang[1]}-${mBaedang[2].padStart(2, '0')}-${mBaedang[3].padStart(2, '0')}`;
  }

  // 3-1. 전용면적 추출 — "전유부분의 건물의 표시" 뒤 첫 번째 ㎡ 값
  // 패턴: "2층 203호\n          철근콘크리트벽식조\n          84.972㎡"
  const mArea1 = text.match(/전유부분의\s*건물의\s*표시[\s\S]{0,200}?(\d+\.?\d*)\s*㎡/);
  if (mArea1) {
    result.areaM2 = parseFloat(mArea1[1]);
  } else {
    // fallback: "건물면적 84.97㎡" 같은 직접 표기
    const mArea2 = text.match(/(?:건물면적|전용면적)\s*(\d+\.?\d*)\s*㎡/);
    if (mArea2) result.areaM2 = parseFloat(mArea2[1]);
  }

  // 4. 임차인 — 블록 단위 추출
  // 전략: 텍스트 전체에서 "보증금+전입일+확정일" 패턴이 붙어있는 줄을 찾고,
  //       그 줄 위쪽 몇 줄에서 이름을 복원
  result.tenants = extractTenants(text);

  // 5. 특수권리
  // "비고" 이후 "비고란" 이전의 주의사항 영역 전체에서 키워드 검색
  ['유치권', '법정지상권', '분묘기지권'].forEach(kw => {
    if (text.includes(kw)) result.specials.push({ type: kw });
  });

  // 6. 경고
  if (/매수인에게\s*대항할\s*수\s*있는/.test(text)) {
    result.warnings.push('대항력 있는 임차인/권리 존재 → 배당 부족시 낙찰자 인수');
  }
  if (/매수인이\s*인수함|인수되는\s*경우가\s*발생/.test(text)) {
    result.warnings.push('인수 대상 권리 명시됨 (원문 확인 필수)');
  }
  if (/유치권/.test(text)) {
    result.warnings.push('유치권 관련 기재 있음');
  }

  // 7. 비고란 원문 (인수조건 등 중요 정보)
  // "<비고>" 이후의 상세 내용 추출
  const bigotStart = text.indexOf('<비고>');
  if (bigotStart >= 0) {
    // "비고란" 앞까지 또는 "사건" 시작 전까지
    let endIdx = text.indexOf('비고란', bigotStart);
    if (endIdx < 0) endIdx = text.indexOf('사건', bigotStart + 10);
    if (endIdx < 0) endIdx = Math.min(bigotStart + 1200, text.length);
    result.bigotContent = text.slice(bigotStart, endIdx).replace(/\n{2,}/g, '\n').trim();
  }

  return result;
}

/**
 * 임차인 추출 — "정보출처" 키워드 기준 블록 분할
 *
 * PDF 텍스트에서 각 임차인 블록은 "현황조사", "등기사항전"(+"부증명서"), "권리신고"로 시작.
 * 이 키워드들을 앵커로 잡아서 그 직전까지 역방향으로 이름 복원.
 *
 * 또한 "보증금+날짜" 덩어리에서 보증금·전입일·확정일 추출.
 */
function extractTenants(text) {
  const tenants = [];
  const seen = new Set();
  const allLines = text.split(/\n/).map(l => l.trim());

  // 0단계: 점유자 표 본문 영역만 추려내기
  // 시작점: "(배당요구일자)" 다음 줄부터 (표 헤더 끝)
  //         또는 "확정일자" + "배당" + "요구여부" 블록 다음
  // 끝점: "<비고>", "비고란", "부동산의 표시" 중 먼저 나오는 것
  let tableStart = -1;
  let tableEnd = allLines.length;

  for (let i = 0; i < allLines.length; i++) {
    const L = allLines[i];
    if (/^\(배당요구일자\)$/.test(L) || /배당요구일자\)$/.test(L)) {
      tableStart = i + 1;
      break;
    }
  }
  // 실패 시 "확정일자" 줄 기반 fallback
  if (tableStart < 0) {
    for (let i = 0; i < allLines.length; i++) {
      if (allLines[i] === '확정일자' && i + 3 < allLines.length) {
        // 확정일자 다음에 배당/요구여부 나옴
        tableStart = i + 4;
        break;
      }
    }
  }
  if (tableStart < 0) tableStart = 0;

  for (let i = tableStart; i < allLines.length; i++) {
    const L = allLines[i];
    if (L === '<비고>' || L === '비고란' || L.startsWith('부동산의 표시') || L.startsWith('[물건')) {
      tableEnd = i;
      break;
    }
  }

  const lines = allLines.slice(tableStart, tableEnd);

  // 1단계: 정보출처 앵커 위치 찾기
  const ANCHOR_TYPES = ['현황조사', '등기사항전', '권리신고'];
  const anchors = [];
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    // "권리신고임차인" 같이 합쳐진 경우도 포함
    if (L === '현황조사' || L.startsWith('현황조사') ||
        L === '등기사항전' || L === '권리신고' || L.startsWith('권리신고')) {
      anchors.push({ idx: i, label: L });
    }
    // "신연지203호현황조사" 처럼 이름+호수+앵커가 한 줄에 합쳐진 케이스
    else {
      const inlineMatch = L.match(/^([가-힣()]+)(\d+호)(현황조사|등기사항전|권리신고)(.*)$/);
      if (inlineMatch) {
        anchors.push({
          idx: i,
          label: inlineMatch[3],
          inlineName: inlineMatch[1],
        });
      }
    }
  }

  // 2단계: 각 앵커 블록 처리
  for (let a = 0; a < anchors.length; a++) {
    const anchor = anchors[a];
    const endIdx = anchor.idx;
    const startIdx = a === 0 ? 0 : anchors[a - 1].idx + 1;

    let name = '';

    // inline 이름이 있으면 그대로 사용
    if (anchor.inlineName) {
      name = anchor.inlineName;
    } else {
      // 앵커 이전 줄들에서 이름 조각 모으기
      const nameFragments = [];
      for (let i = startIdx; i < endIdx; i++) {
        const L = lines[i];
        if (!L) continue;
        if (/^\d+호$/.test(L)) continue;
        if (/^\d+호\s+(전부|일부)$/.test(L)) continue;
        if (/^(전부|일부)$/.test(L)) continue;
        if (/^부증명서$/.test(L)) continue;
        if (/^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}/.test(L)) continue;
        if (/^\d+[,\d]*$/.test(L)) continue;
        if (/^[가-힣()\s]+$/.test(L) && L.length <= 8) {
          nameFragments.push(L);
        }
      }
      const STOP_WORDS = new Set([
        '주거', '주택', '상가', '임차인', '임차권자', '점유자', '성명', '성 명',
        '점유', '부분', '정보출처', '구분', '구 분', '점유의', '권원', '권 원',
      ]);
      const cleaned = nameFragments
        .map(s => s.replace(/\s+/g, ''))
        .filter(s => s && !STOP_WORDS.has(s));
      name = cleaned.join('').replace(/\s+/g, '');
    }

    // 후처리
    if (name.includes('주택도시보증') || (name.includes('주택도') && name.includes('보증'))) {
      name = '주택도시보증공사';
    }
    name = name.replace(/주거임차인?/g, '').replace(/주택임차권자/g, '').replace(/주택임차인/g, '');
    name = name.replace(/^\(|\)$/g, '');

    if (!name) continue;

    // 3단계: 이 앵커 이후에서 보증금+날짜 찾기
    const nextAnchorIdx = a + 1 < anchors.length ? anchors[a + 1].idx : lines.length;
    let deposit = null, moveIn = null, fixed = null;

    for (let i = endIdx; i < nextAnchorIdx; i++) {
      const L = lines[i];
      if (!L) continue;
      const m = L.match(/(\d{1,3}(?:,\d{3}){2,})(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?)(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?)/);
      if (m) {
        deposit = m[1].replace(/,/g, '');
        moveIn = normalizeDate(m[2]);
        fixed = normalizeDate(m[3]);
        break;
      }
      // 현황조사: 보증금 없고 전입일만 단독
      const dateOnly = L.match(/^(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})\.?$/);
      if (dateOnly && !moveIn) {
        moveIn = normalizeDate(dateOnly[1]);
      }
    }

    const key = `${name}|${moveIn || ''}|${deposit || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    tenants.push({
      name,
      moveIn: moveIn || '',
      fixed: fixed || '',
      deposit: deposit || '',
    });
  }

  return tenants;
}

function normalizeDate(s) {
  const m = String(s).match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return s;
}

module.exports = { parseMyeongseseoPdf };
