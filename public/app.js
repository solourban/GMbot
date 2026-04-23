// ───────────────────────────────────────────────
// 경매판독 · Editorial Frontend
// ───────────────────────────────────────────────

let currentRaw = null;

// ───── Utilities ─────
function formatMoney(n) {
  if (!n && n !== 0) return '—';
  n = Number(n);
  if (!n) return '0원';
  const 억 = Math.floor(n / 100_000_000);
  const 만 = Math.floor((n % 100_000_000) / 10_000);
  const parts = [];
  if (억) parts.push(`${억}억`);
  if (만) parts.push(`${만.toLocaleString('ko-KR')}만`);
  return (parts.join(' ') || '0') + '원';
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function pr(html) {
  return html;  // passthrough for readability
}

// ───── Step 1: Fetch basics ─────
document.getElementById('btnFetch').onclick = async () => {
  const saYear = document.getElementById('saYear').value.trim();
  const saSer = document.getElementById('saSer').value.trim();
  const jiwonNm = document.getElementById('jiwonNm').value;
  const rs = document.getElementById('resultsSection');
  if (!saSer) { alert('사건번호를 입력하세요'); return; }

  rs.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>대법원 법원경매정보에서 자료를 수집하는 중입니다...</p>
    </div>`;

  try {
    const res = await fetch('/api/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saYear, saSer, jiwonNm })
    });
    const data = await res.json();
    if (!res.ok) {
      rs.innerHTML = `<div class="error-card"><h3>수집 실패</h3><p>${escapeHtml(data.error)}</p></div>`;
      return;
    }
    currentRaw = data.raw;
    renderStep1(data.raw, data.elapsed);
  } catch (e) {
    rs.innerHTML = `<div class="error-card"><h3>요청 실패</h3><p>${escapeHtml(e.message)}</p></div>`;
  }
};

document.getElementById('saSer').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btnFetch').click();
});

// ───── Step 1 Render ─────
function renderStep1(raw, elapsed) {
  const rs = document.getElementById('resultsSection');
  const basic = raw.basic || {};
  const interested = raw.interested || [];
  const tenants = raw.tenants || [];

  rs.innerHTML = `
    <article class="article">
      <p class="article-kicker">Case · ${escapeHtml(raw.caseNo || '')}</p>
      <h2 class="article-title">${escapeHtml(basic['소재지'] || raw.caseNo)}</h2>
      <p class="search-hint" style="text-align:left; margin-bottom:24px">
        ${escapeHtml(raw.court || '')} · 수집 소요 ${elapsed}
      </p>

      <div class="verdict ok">
        <div class="verdict-kicker">기본정보 수집 완료</div>
        <div class="verdict-grid">
          <div>
            <div class="verdict-stat-k">감정가</div>
            <div class="verdict-stat-v">${escapeHtml(basic['감정평가액'] || '-')}</div>
          </div>
          <div>
            <div class="verdict-stat-k">최저매각가</div>
            <div class="verdict-stat-v">${escapeHtml(basic['최저매각가격'] || '-')}</div>
          </div>
          <div>
            <div class="verdict-stat-k">유찰횟수</div>
            <div class="verdict-stat-v">${escapeHtml(basic['유찰횟수'] || '-')}</div>
          </div>
          <div>
            <div class="verdict-stat-k">이해관계인</div>
            <div class="verdict-stat-v">${interested.length}명</div>
          </div>
        </div>
      </div>

      <details class="detail" open>
        <summary>사건 기본정보</summary>
        <div>
          <table class="cost-table"><tbody>
            ${Object.entries(basic).filter(([k,v]) => v).map(([k, v]) => `
              <tr><td style="color:var(--ink-3);width:35%">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>
            `).join('')}
          </tbody></table>
        </div>
      </details>

      ${interested.length > 0 ? `
        <details class="detail">
          <summary>이해관계인 (${interested.length}명)</summary>
          <div>
            <table class="cost-table"><tbody>
              ${interested.map(p => `
                <tr>
                  <td style="width:30%; color:var(--ink-3); font-family:var(--serif); font-size:12px; letter-spacing:1px; text-transform:uppercase">${escapeHtml(p.type)}</td>
                  <td>${escapeHtml(p.name)}</td>
                </tr>
              `).join('')}
            </tbody></table>
          </div>
        </details>
      ` : ''}

      ${raw.schedule && raw.schedule.length > 0 ? renderSchedulePreview(raw.schedule) : ''}

      ${raw.curstDetail || raw.curstNote ? `
        <details class="detail">
          <summary>현황조사 요약</summary>
          <div>
            ${raw.curstDetail ? `<div class="prose" style="font-size:14px; white-space:pre-wrap">${escapeHtml(raw.curstDetail)}</div>` : ''}
            ${raw.curstNote ? `<div class="note">${escapeHtml(raw.curstNote)}</div>` : ''}
          </div>
        </details>
      ` : ''}
    </article>

    <div class="step2">
      <div class="step2-kicker">Step 02</div>
      <h3 class="step2-headline">매각물건명세서를 <em>읽을 차례</em></h3>
      <p class="step2-sub">PDF를 드래그하면 자동으로 폼이 채워집니다.</p>
    </div>

    <article class="article">

      <!-- PDF Drop -->
      <div class="input-group">
        <h4 class="input-group-head">매각물건명세서 PDF</h4>
        <p class="input-group-sub">대법원 경매정보에서 다운로드 후 업로드하세요</p>
        <div class="pdf-drop" id="pdfDropZone">
          <input type="file" id="pdfInput" accept="application/pdf,.pdf" style="display:none">
          <div class="pdf-drop-icon">PDF</div>
          <div class="pdf-drop-text">파일을 끌어다 놓거나 클릭하여 선택</div>
          <div class="pdf-drop-sub">매각물건명세서 PDF · 감정평가서 아님</div>
        </div>
        <div id="pdfStatus" style="margin-top:12px"></div>
      </div>

      <!-- 최선순위 -->
      <div class="input-group">
        <h4 class="input-group-head">최선순위 설정 · 말소기준권리</h4>
        <p class="input-group-sub">매각물건명세서 상단 "최선순위 설정" 그대로 입력</p>
        <div class="input-row">
          <label class="field-label">
            <span class="field-label-text">접수일</span>
            <input type="date" id="malsoDate" class="field" required>
          </label>
          <label class="field-label">
            <span class="field-label-text">권리종류</span>
            <select id="malsoType" class="field">
              <option>근저당</option>
              <option>저당</option>
              <option>가압류</option>
              <option>압류</option>
              <option>담보가등기</option>
              <option>경매개시결정</option>
              <option>강제경매</option>
            </select>
          </label>
          <label class="field-label">
            <span class="field-label-text">권리자</span>
            <input type="text" id="malsoHolder" class="field" placeholder="예: OO은행">
          </label>
          <label class="field-label">
            <span class="field-label-text">채권최고액</span>
            <input type="number" id="malsoAmount" class="field num" placeholder="숫자만">
          </label>
        </div>
      </div>

      <!-- 기타 권리 -->
      <div class="input-group">
        <h4 class="input-group-head">등기부 기타 권리 <span style="color:var(--ink-3); font-size:12px; letter-spacing:1px; text-transform:uppercase; margin-left:8px">선택</span></h4>
        <p class="input-group-sub">근저당·가압류·압류 등 추가 권리</p>
        <div id="rightsList"></div>
        <button type="button" class="btn-add" onclick="addRight()">+ 권리 추가</button>
      </div>

      <!-- 임차인 -->
      <div class="input-group">
        <h4 class="input-group-head">임차인 정보</h4>
        <p class="input-group-sub">매각물건명세서 "조사된 임차내역" 참조</p>
        <div id="tenantsList"></div>
        <button type="button" class="btn-add" onclick="addTenant()">+ 임차인 추가</button>
      </div>

      <!-- 특수권리 -->
      <div class="input-group">
        <h4 class="input-group-head">특수권리 <span style="color:var(--ink-3); font-size:12px; letter-spacing:1px; text-transform:uppercase; margin-left:8px">선택</span></h4>
        <p class="input-group-sub">비고란의 유치권·법정지상권·분묘기지권</p>
        <div id="specialsList"></div>
        <button type="button" class="btn-add" onclick="addSpecial()">+ 특수권리 추가</button>
      </div>

      <!-- 지역 -->
      <div class="input-group">
        <h4 class="input-group-head">소액임차인 기준 지역</h4>
        <div class="input-row" style="grid-template-columns:1fr">
          <select id="region" class="field">
            <option value="seoul">서울특별시 (1억6,500만원 / 5,500만원)</option>
            <option value="overcrowded">과밀억제권역·세종·용인·화성·김포 (1억4,500만원 / 4,800만원)</option>
            <option value="metro">광역시·안산·광주·파주·이천·평택 (8,500만원 / 2,800만원)</option>
            <option value="other" selected>그 외 지역 (7,500만원 / 2,500만원)</option>
          </select>
        </div>
      </div>

      <!-- 비용 상세 -->
      <div class="input-group">
        <h4 class="input-group-head">실질 투자비 계산</h4>
        <p class="input-group-sub">낙찰가 외 추가 비용 · 비우면 자동 추정</p>
        <div class="input-row">
          <label class="field-label">
            <span class="field-label-text">내 입찰가 (원) <span style="color:var(--ink-3); font-weight:400">· 선택</span></span>
            <input type="number" id="bidPrice" class="field num" placeholder="비우면 AI 예상가 사용">
          </label>
          <label class="field-label">
            <span class="field-label-text">전용면적 ㎡</span>
            <input type="number" id="areaM2" class="field num" step="0.01" placeholder="예: 84.97">
          </label>
          <label class="field-label">
            <span class="field-label-text">취득세 유형</span>
            <select id="acqType" class="field">
              <option value="주택_1주택" selected>주택 (1주택자)</option>
              <option value="주택_다주택">주택 (다주택자)</option>
              <option value="상가">상가·오피스텔</option>
              <option value="토지">토지</option>
              <option value="농지">농지</option>
            </select>
          </label>
          <label class="field-label">
            <span class="field-label-text">미납관리비</span>
            <input type="number" id="unpaidFee" class="field num" placeholder="예: 650000">
          </label>
        </div>
        <details class="detail" style="margin-top:12px">
          <summary>명도비용 상세 조정</summary>
          <div>
            <p class="input-group-sub" style="margin-top:0">각 항목 비우면 면적 기준 자동 계산 (84㎡ 기준 421만원)</p>
            <div class="input-row">
              <label class="field-label">
                <span class="field-label-text">접수비</span>
                <input type="number" class="field num" data-k="receipt" placeholder="100000">
              </label>
              <label class="field-label">
                <span class="field-label-text">운반·보관료</span>
                <input type="number" class="field num" data-k="storage" placeholder="자동">
              </label>
              <label class="field-label">
                <span class="field-label-text">노무비</span>
                <input type="number" class="field num" data-k="labor" placeholder="자동">
              </label>
              <label class="field-label">
                <span class="field-label-text">사다리차</span>
                <input type="number" class="field num" data-k="ladder" placeholder="350000">
              </label>
            </div>
          </div>
        </details>
      </div>

      <!-- 시세 -->
      <div class="input-group">
        <h4 class="input-group-head">주변 시세 · 매도 시나리오</h4>
        <p class="input-group-sub">네이버부동산·KB시세 등 같은 단지·평형 최근 매매가</p>
        <div class="input-row" style="grid-template-columns:1fr">
          <label class="field-label">
            <span class="field-label-text">매매 시세 (원)</span>
            <input type="number" id="marketPrice" class="field num" placeholder="예: 155000000">
          </label>
        </div>
        <p style="margin-top:8px">
          <a href="https://land.naver.com/" target="_blank" class="ext-link">네이버부동산 →</a>
          <a href="https://kbland.kr/" target="_blank" class="ext-link">KB부동산 →</a>
          <a href="https://rt.molit.go.kr/" target="_blank" class="ext-link">국토부 실거래가 →</a>
        </p>
      </div>

      <!-- 전세 시나리오 -->
      <div class="input-group">
        <h4 class="input-group-head">전세 임대 시나리오 <span style="color:var(--ink-3); font-size:11px; letter-spacing:1.5px; text-transform:uppercase; margin-left:6px">선택</span></h4>
        <p class="input-group-sub">임대 투자 시 · 전세 보증금으로 자본 회수율 계산</p>
        <div class="input-row" style="grid-template-columns:1fr">
          <label class="field-label">
            <span class="field-label-text">예상 전세가 (원)</span>
            <input type="number" id="jeonsePrice" class="field num" placeholder="예: 130000000">
          </label>
        </div>
      </div>

      <!-- 월세 시나리오 -->
      <div class="input-group">
        <h4 class="input-group-head">월세 임대 시나리오 <span style="color:var(--ink-3); font-size:11px; letter-spacing:1.5px; text-transform:uppercase; margin-left:6px">선택</span></h4>
        <p class="input-group-sub">임대 투자 시 · 연 임대수익률 계산</p>
        <div class="input-row">
          <label class="field-label">
            <span class="field-label-text">월세 보증금 (원)</span>
            <input type="number" id="wolseDeposit" class="field num" placeholder="예: 20000000">
          </label>
          <label class="field-label">
            <span class="field-label-text">월세 (원/월)</span>
            <input type="number" id="wolseMonthly" class="field num" placeholder="예: 500000">
          </label>
        </div>
      </div>

      <button class="btn-analyze" onclick="runAnalysis()">권리분석 실행</button>
    </article>
  `;

  // 임차인 있으면 미리 추가
  if (tenants.length > 0) {
    tenants.forEach(t => addTenant(t['임차인'] || t.name));
  }

  setupPdfDrop();
}

// ───── Schedule Preview (기일내역) ─────
function renderSchedulePreview(schedule) {
  if (!Array.isArray(schedule) || schedule.length === 0) return '';

  // schedule row 형태: [date, time, place, kind, result, price]
  return `
    <details class="detail">
      <summary>기일 내역 · ${schedule.length}건</summary>
      <div>
        <div class="schedule">
          ${schedule.map(row => {
            const result = row[4] || '';
            let resultClass = '';
            if (result === '유찰') resultClass = 'yuchal';
            else if (result === '매각') resultClass = 'sold';
            else if (/진행|예정/.test(result)) resultClass = 'progress';
            const priceClass = result === '유찰' ? 'strike' : '';
            return `
              <div class="sched-row">
                <span class="sched-date">${escapeHtml(row[0] || '')} ${escapeHtml(row[1] || '')}</span>
                <span class="sched-result ${resultClass}">${escapeHtml(result || '—')}</span>
                <span class="sched-place">${escapeHtml(row[2] || '-')}</span>
                <span class="sched-price num ${priceClass}">${escapeHtml(row[5] || '-')}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </details>
  `;
}

// ───── PDF drop/upload ─────
function setupPdfDrop() {
  const zone = document.getElementById('pdfDropZone');
  const input = document.getElementById('pdfInput');
  if (!zone || !input) return;

  zone.onclick = () => input.click();
  input.onchange = (e) => { if (e.target.files[0]) handlePdfFile(e.target.files[0]); };
  zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('dragover'); };
  zone.ondragleave = () => zone.classList.remove('dragover');
  zone.ondrop = (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handlePdfFile(file);
  };
}

async function handlePdfFile(file) {
  const status = document.getElementById('pdfStatus');
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    status.innerHTML = `<div class="note danger">PDF 파일만 업로드 가능합니다.</div>`;
    return;
  }

  status.innerHTML = `<div class="note"><span class="spinner" style="width:14px; height:14px; border-width:1.5px; display:inline-block; vertical-align:-2px; margin-right:8px"></span>PDF 파싱 중...</div>`;

  const fd = new FormData();
  fd.append('pdf', file);

  try {
    const res = await fetch('/api/parse-pdf', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) {
      status.innerHTML = `<div class="note danger">${escapeHtml(data.error)}</div>`;
      return;
    }

    applyParsed(data.parsed);

    const p = data.parsed;
    let summary = `<div class="note ok">
      <strong>PDF 파싱 완료</strong> — 아래 폼이 자동으로 채워졌습니다. 확인 후 "권리분석 실행"을 누르세요.
      <ul style="margin:8px 0 0">
        ${p.caseNo ? `<li>사건번호: <strong>${escapeHtml(p.caseNo)}</strong></li>` : ''}
        ${p.malso ? `<li>최선순위: <strong>${escapeHtml(p.malso.date)} ${escapeHtml(p.malso.type)}</strong></li>` : '<li>⚠ 최선순위 설정 찾지 못함 — 직접 입력 필요</li>'}
        ${p.baedangDeadline ? `<li>배당요구종기: ${escapeHtml(p.baedangDeadline)}</li>` : ''}
        ${p.areaM2 ? `<li>전용면적: <strong>${p.areaM2}㎡</strong></li>` : ''}
        <li>임차인 ${p.tenants.length}명 자동 추출</li>
        ${p.specials.length ? `<li>특수권리: ${p.specials.map(s => s.type).join(', ')}</li>` : ''}
      </ul>
    </div>`;

    if (p.warnings && p.warnings.length) {
      summary += `<div class="note warn">
        <strong>PDF에서 감지된 주의사항</strong>
        <ul>${p.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
      </div>`;
    }

    if (p.bigotContent) {
      summary += `<details class="detail"><summary>비고란 원문</summary><div><pre style="white-space:pre-wrap; font-family:var(--serif); font-size:13.5px; line-height:1.7; margin:0">${escapeHtml(p.bigotContent)}</pre></div></details>`;
    }

    status.innerHTML = summary;
  } catch (e) {
    status.innerHTML = `<div class="note danger">${escapeHtml(e.message)}</div>`;
  }
}

function applyParsed(parsed) {
  if (parsed.malso) {
    document.getElementById('malsoDate').value = parsed.malso.date;
    const typeSel = document.getElementById('malsoType');
    for (const opt of typeSel.options) {
      if (parsed.malso.type.includes(opt.value) || opt.value.includes(parsed.malso.type)) {
        typeSel.value = opt.value;
        break;
      }
    }
    if (parsed.malso.type === '경매개시결정') typeSel.value = '경매개시결정';
  }

  if (parsed.areaM2) {
    const areaInput = document.getElementById('areaM2');
    if (areaInput && !areaInput.value) areaInput.value = parsed.areaM2;
  }

  const tenantList = document.getElementById('tenantsList');
  tenantList.innerHTML = '';
  parsed.tenants.forEach(t => {
    addTenant(t.name);
    const rows = tenantList.children;
    const last = rows[rows.length - 1];
    last.querySelector('[data-k="moveIn"]').value = t.moveIn || '';
    last.querySelector('[data-k="fixed"]').value = t.fixed || '';
    last.querySelector('[data-k="deposit"]').value = t.deposit || '';
  });

  const specialList = document.getElementById('specialsList');
  specialList.innerHTML = '';
  parsed.specials.forEach(s => {
    addSpecial();
    const rows = specialList.children;
    const last = rows[rows.length - 1];
    last.querySelector('[data-k="type"]').value = s.type;
  });
}

// ───── Dynamic rows ─────
window.addRight = function() {
  const list = document.getElementById('rightsList');
  const div = document.createElement('div');
  div.className = 'input-row';
  div.innerHTML = `
    <label class="field-label"><span class="field-label-text">접수일</span><input type="date" class="field" data-k="date"></label>
    <label class="field-label"><span class="field-label-text">종류</span>
      <select class="field" data-k="type">
        <option>근저당</option><option>저당</option><option>가압류</option>
        <option>압류</option><option>가등기</option><option>전세권</option>
      </select>
    </label>
    <label class="field-label"><span class="field-label-text">권리자</span><input type="text" class="field" data-k="holder"></label>
    <label class="field-label"><span class="field-label-text">금액</span><input type="number" class="field num" data-k="amount"></label>
    <button type="button" class="btn-remove" onclick="this.parentElement.remove()">×</button>
  `;
  list.appendChild(div);
};

window.addTenant = function(prefillName = '') {
  const list = document.getElementById('tenantsList');
  const div = document.createElement('div');
  div.className = 'input-row';
  div.innerHTML = `
    <label class="field-label"><span class="field-label-text">이름</span><input type="text" class="field" data-k="name" value="${escapeHtml(prefillName)}"></label>
    <label class="field-label"><span class="field-label-text">전입신고일</span><input type="date" class="field" data-k="moveIn"></label>
    <label class="field-label"><span class="field-label-text">확정일자</span><input type="date" class="field" data-k="fixed"></label>
    <label class="field-label"><span class="field-label-text">보증금</span><input type="number" class="field num" data-k="deposit"></label>
    <button type="button" class="btn-remove" onclick="this.parentElement.remove()">×</button>
  `;
  list.appendChild(div);
};

window.addSpecial = function() {
  const list = document.getElementById('specialsList');
  const div = document.createElement('div');
  div.className = 'input-row';
  div.innerHTML = `
    <label class="field-label"><span class="field-label-text">종류</span>
      <select class="field" data-k="type">
        <option>유치권</option><option>법정지상권</option><option>분묘기지권</option>
      </select>
    </label>
    <label class="field-label"><span class="field-label-text">접수일</span><input type="date" class="field" data-k="date"></label>
    <label class="field-label"><span class="field-label-text">권리자</span><input type="text" class="field" data-k="holder"></label>
    <label class="field-label"><span class="field-label-text">금액</span><input type="number" class="field num" data-k="amount"></label>
    <button type="button" class="btn-remove" onclick="this.parentElement.remove()">×</button>
  `;
  list.appendChild(div);
};

function readRows(listId) {
  const rows = document.getElementById(listId).children;
  const result = [];
  for (const r of rows) {
    const obj = {};
    r.querySelectorAll('[data-k]').forEach(el => { obj[el.dataset.k] = el.value.trim(); });
    if (Object.values(obj).some(v => v)) result.push(obj);
  }
  return result;
}

// ───── Run analysis ─────
window.runAnalysis = async function() {
  const malsoDate = document.getElementById('malsoDate').value;
  const malsoType = document.getElementById('malsoType').value;
  const malsoHolder = document.getElementById('malsoHolder').value.trim();
  const malsoAmount = document.getElementById('malsoAmount').value;
  const region = document.getElementById('region').value;

  if (!malsoDate) {
    alert('말소기준권리의 접수일을 입력하세요.\nPDF를 올리면 자동으로 채워집니다.');
    return;
  }

  const evictionOverrides = {};
  document.querySelectorAll('.detail [data-k]').forEach(el => {
    if (el.value && ['receipt','storage','labor','ladder'].includes(el.dataset.k)) {
      evictionOverrides[el.dataset.k] = parseInt(el.value, 10);
    }
  });

  const userInputs = {
    bidPrice: document.getElementById('bidPrice')?.value || '',
    areaM2: document.getElementById('areaM2')?.value || '',
    acqType: document.getElementById('acqType')?.value || '주택_1주택',
    unpaidFee: document.getElementById('unpaidFee')?.value || '',
    marketPrice: document.getElementById('marketPrice')?.value || '',
    jeonsePrice: document.getElementById('jeonsePrice')?.value || '',
    wolseDeposit: document.getElementById('wolseDeposit')?.value || '',
    wolseMonthly: document.getElementById('wolseMonthly')?.value || '',
    evictionOverrides,
  };

  const manual = {
    malso: { date: malsoDate, type: malsoType, holder: malsoHolder || '-', amount: malsoAmount || '0' },
    rights: readRows('rightsList'),
    tenants: readRows('tenantsList'),
    specials: readRows('specialsList'),
  };

  const rs = document.getElementById('resultsSection');
  rs.innerHTML = `<div class="loading"><div class="spinner"></div><p>권리분석을 실행하는 중...</p></div>`;

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: currentRaw, manual, region, userInputs })
    });
    const data = await res.json();
    if (!res.ok) {
      rs.innerHTML = `<div class="error-card"><h3>분석 실패</h3><p>${escapeHtml(data.error)}</p></div>`;
      return;
    }
    renderReport(data.report);
  } catch (e) {
    rs.innerHTML = `<div class="error-card"><h3>요청 실패</h3><p>${escapeHtml(e.message)}</p></div>`;
  }
};

// ───── Final Report Rendering ─────
function renderReport(report) {
  const rs = document.getElementById('resultsSection');

  const verdictLabel = { ok: '양호', warn: '주의', danger: '위험' }[report.risk.level];
  const daehang = report.tenants.filter(t => t.daehang === '있음').length;
  const inheritFromRights = report.rights.filter(r => r.status === '인수').length;
  const inheritFromTenants = (report.inherited.items || []).filter(i => /임차인/.test(i.label)).length;
  const inheritCount = inheritFromRights + inheritFromTenants;
  const extinctCount = report.rights.filter(r => r.status === '소멸').length;

  rs.innerHTML = `
    <div style="text-align:right; margin-bottom:16px">
      <button class="btn btn-secondary" onclick="location.reload()" style="font-size:13px; padding:8px 16px">← 새 사건 분석</button>
    </div>

    ${renderVerdictBanner(report, verdictLabel, inheritCount, extinctCount, daehang)}
    ${renderAIVerdict(report)}
    ${renderScenarios(report)}
    ${renderProcessTimeline(report)}
    ${renderMalso(report)}
    ${renderRightsCards(report)}
    ${renderTenantCards(report)}
    ${renderDistributionTable(report)}
    ${renderChecklist(report)}
    ${renderScheduleDetail(report)}
    ${renderDeliveries(report)}

    <article class="article">
      <p class="article-kicker">Disclaimer</p>
      <div class="note">
        이 분석은 입력된 정보를 기반으로 한 참고용 분석입니다. 실제 권리관계는 등기부등본 열람시점 이후에도 변동될 수 있으며, 중요한 투자 결정 전에 반드시 법무사·변호사 등 전문가 검토를 받으시기 바랍니다.
      </div>
    </article>
  `;

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ───── Investment Scenarios ─────
function renderScenarios(r) {
  const s = r.scenarios || {};
  const hasAny = s.sell || s.jeonse || s.wolse;
  if (!hasAny || !r.finalCost) return '';

  let tabsHtml = '<div class="scenario-picker">';
  const available = [];
  if (s.sell) available.push({ key: 'sell', label: '매도' });
  if (s.jeonse) available.push({ key: 'jeonse', label: '전세' });
  if (s.wolse) available.push({ key: 'wolse', label: '월세' });
  available.forEach((a, i) => {
    tabsHtml += `<button class="scenario-btn ${i===0?'active':''}" data-scenario="${a.key}" onclick="switchScenario('${a.key}')">${a.label}</button>`;
  });
  tabsHtml += '</div>';

  let panelsHtml = '';
  Object.entries(s).forEach(([key, sc], i) => {
    panelsHtml += `<div class="scenario-panel ${i===0?'active':''}" data-panel="${key}">`;

    // 입력값 요약
    panelsHtml += `<div class="market ${sc.verdict}">`;
    sc.inputs.forEach(inp => {
      panelsHtml += `<div class="market-line"><span class="k">${escapeHtml(inp.k)}</span><span class="v">${formatMoney(inp.v)}</span></div>`;
    });
    panelsHtml += '</div>';

    // 결과 카드 2개
    panelsHtml += '<div class="scenario-result">';
    if (key === 'sell') {
      const profitClass = sc.profit >= 0 ? 'profit' : 'loss';
      panelsHtml += `<div class="scenario-card ${profitClass}">
        <div class="scenario-card-k">예상 손익</div>
        <div class="scenario-card-v">${sc.profit >= 0 ? '+' : '-'}${formatMoney(Math.abs(sc.profit))}</div>
        <div class="scenario-card-note">시세 대비 ${(sc.profitRatio*100).toFixed(1)}%</div>
      </div>`;
      panelsHtml += `<div class="scenario-card">
        <div class="scenario-card-k">판단</div>
        <div class="scenario-card-v" style="font-size:15px">${sc.summary}</div>
      </div>`;
    } else if (key === 'jeonse') {
      panelsHtml += `<div class="scenario-card">
        <div class="scenario-card-k">실투자금 (자본금)</div>
        <div class="scenario-card-v">${formatMoney(sc.tiedUp)}</div>
        <div class="scenario-card-note">전세 보증금 제외</div>
      </div>`;
      panelsHtml += `<div class="scenario-card">
        <div class="scenario-card-k">회수율</div>
        <div class="scenario-card-v">${(sc.ratio*100).toFixed(1)}%</div>
        <div class="scenario-card-note">${sc.note || ''}</div>
      </div>`;
    } else if (key === 'wolse') {
      const profitClass = sc.yieldRate >= 0.03 ? 'profit' : (sc.yieldRate >= 0.02 ? '' : 'loss');
      panelsHtml += `<div class="scenario-card ${profitClass}">
        <div class="scenario-card-k">연 임대수익</div>
        <div class="scenario-card-v">${formatMoney(sc.annualIncome)}</div>
        <div class="scenario-card-note">월 ${formatMoney(sc.annualIncome/12)} × 12</div>
      </div>`;
      panelsHtml += `<div class="scenario-card ${profitClass}">
        <div class="scenario-card-k">수익률</div>
        <div class="scenario-card-v">${(sc.yieldRate*100).toFixed(2)}%</div>
        <div class="scenario-card-note">실투자금 ${formatMoney(sc.tiedUp)} 기준</div>
      </div>`;
    }
    panelsHtml += '</div>';
    panelsHtml += '</div>';
  });

  return `
    <article class="article">
      <p class="article-kicker">Investment Scenario · 수익 시나리오</p>
      <h3 class="article-title">어떻게 활용할 건가</h3>
      <p class="input-group-sub" style="margin-bottom:16px">매도 · 전세 · 월세 시나리오별 수익 분석. 입력한 것만 표시됩니다.</p>
      ${tabsHtml}
      ${panelsHtml}
    </article>
  `;
}

window.switchScenario = function(key) {
  document.querySelectorAll('.scenario-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.scenario === key);
  });
  document.querySelectorAll('.scenario-panel').forEach(p => {
    p.classList.toggle('active', p.dataset.panel === key);
  });
};

// ───── Verdict Hero · 판독서 + 헤이딜러 ─────
function renderVerdictBanner(r, verdictLabel, inheritCount, extinctCount, daehang) {
  const addr = r.basic?.['소재지'] || r.case || '';
  const caseNo = r.case || '';
  const mc = r.marketComparison;

  // 판정 라벨 (한글)
  const stampLabels = { ok: '양호', warn: '주의', danger: '위험' };

  // 큰 숫자 히어로 결정
  let bigNumber = null;
  let bigNumberUnit = '만원';
  let bigNumberSub = '';
  let headline = '';
  let conclusion = '';
  let bigNumberClass = '';

  if (mc && (mc.verdict === 'terrible' || mc.verdict === 'overpay')) {
    const loss = Math.abs(mc.diff);
    const man = Math.round(loss / 10000);
    bigNumber = '-' + man.toLocaleString('ko-KR');
    bigNumberClass = 'loss';
    bigNumberSub = `실질 투자비 ${formatMoney(r.finalCost.total)} − 주변 시세 ${formatMoney(mc.market)}`;
    headline = `이 물건을 낙찰받으면<br><strong>약 ${formatMoney(loss)} 손실</strong>이 예상됩니다.`;
    conclusion = mc.verdict === 'terrible'
      ? `실질 투자비가 시세를 ${(mc.diffRatio * 100).toFixed(1)}% 초과합니다. 경매로 낙찰받을 이유가 없는 물건이에요.`
      : `실질 투자비가 시세를 ${(mc.diffRatio * 100).toFixed(1)}% 초과합니다. 경매의 가격 이점이 없거나 적습니다.`;
  } else if (mc && (mc.verdict === 'great' || mc.verdict === 'good')) {
    const gain = Math.abs(mc.diff);
    const man = Math.round(gain / 10000);
    bigNumber = '+' + man.toLocaleString('ko-KR');
    bigNumberClass = 'gain';
    bigNumberSub = `주변 시세 ${formatMoney(mc.market)} − 실질 투자비 ${formatMoney(r.finalCost.total)}`;
    headline = `이 물건을 낙찰받으면<br><strong>약 ${formatMoney(gain)} 절약</strong>할 수 있습니다.`;
    conclusion = mc.verdict === 'great'
      ? `실질 투자비가 시세보다 ${(Math.abs(mc.diffRatio) * 100).toFixed(1)}% 저렴. 권리관계만 괜찮다면 적극 검토할 만해요.`
      : `실질 투자비가 시세보다 ${(Math.abs(mc.diffRatio) * 100).toFixed(1)}% 저렴. 현장답사 권장.`;
  } else if (r.inherited.total > 0) {
    const man = Math.round(r.inherited.total / 10000);
    bigNumber = man.toLocaleString('ko-KR');
    bigNumberClass = 'loss';
    bigNumberSub = '대항력 임차인 미배당 보증금 등';
    headline = `낙찰가 외에 <strong>${formatMoney(r.inherited.total)}을 추가</strong>로 인수해야 합니다.`;
    conclusion = `시세를 입력하면 실질 손익 판정이 가능합니다. 네이버부동산 등에서 주변 시세를 확인해보세요.`;
  } else {
    headline = `권리관계가 <strong>깨끗한 물건</strong>입니다.`;
    conclusion = `시세 대비 입찰가만 검증하면 되는 단순 구조. 주변 시세를 확인해보세요.`;
  }

  // 낙찰가 기준 표시
  const bidSourceLabel = {
    user: '사용자 입력 입찰가',
    ai: 'AI 예상 낙찰가',
    min: '최저매각가',
  }[r.bidSource] || '최저매각가';

  // 계산식 (실질 투자비 구성)
  let formula = '';
  if (r.finalCost) {
    const items = r.finalCost.breakdown;
    const bid = items.find(i => i.key === 'bid')?.amount || 0;
    const inherited = items.find(i => i.key === 'inherited')?.amount || 0;
    const others = r.finalCost.total - bid - inherited;

    formula = `
      <div class="verdict-formula">
        <div class="verdict-formula-title">실질 투자비 구성 <span class="verdict-formula-basis">· ${escapeHtml(bidSourceLabel)} 기준</span></div>
        <div class="verdict-formula-row">
          <span class="k">낙찰가</span>
          <span class="v">${formatMoney(bid)}</span>
        </div>
        ${inherited > 0 ? `
          <div class="verdict-formula-row">
            <span class="k">임차인 인수 · 선순위 권리</span>
            <span class="v">${formatMoney(inherited)}</span>
          </div>
        ` : ''}
        <div class="verdict-formula-row">
          <span class="k">취득세 · 법무사비 · 명도비 · 관리비</span>
          <span class="v">${formatMoney(others)}</span>
        </div>
        <div class="verdict-formula-row total">
          <span class="k">총 실질 투자비</span>
          <span class="v">${formatMoney(r.finalCost.total)}</span>
        </div>
      </div>
    `;
  }

  // AI 예상 낙찰가 박스
  let bidEstimateBox = '';
  if (r.bidEstimate) {
    const be = r.bidEstimate;
    bidEstimateBox = `
      <div class="bid-estimate">
        <div class="bid-estimate-head">
          <span class="bid-estimate-kicker">AI 예상 낙찰가</span>
          <span class="bid-estimate-value">${formatMoney(be.estimated)}</span>
        </div>
        <div class="bid-estimate-range">예상 구간 ${formatMoney(be.low)} ~ ${formatMoney(be.high)}</div>
        <div class="bid-estimate-reason">${escapeHtml(be.reasoning)}</div>
      </div>
    `;
  }

  // 메인 히어로 카드
  return `
    <div class="verdict-hero ${r.risk.level}">
      <div class="verdict-head">
        <h2 class="verdict-head-title">판독서</h2>
        <div class="verdict-head-meta">${escapeHtml(caseNo)}<br>${new Date().toLocaleDateString('ko-KR')}</div>
      </div>
      <div class="verdict-body">
        <div class="verdict-stamp ${r.risk.level}">
          <span class="verdict-stamp-text">판정</span>
          <span class="verdict-stamp-label">${stampLabels[r.risk.level]}</span>
        </div>

        <p class="verdict-hero-headline">${headline}</p>

        ${bigNumber ? `
          <div class="verdict-hero-bignumber ${bigNumberClass}">
            <span>${bigNumber}</span>
            <span class="unit">${bigNumberUnit}</span>
          </div>
          <p class="verdict-hero-bignumber-sub">${escapeHtml(bigNumberSub)}</p>
        ` : ''}

        ${bidEstimateBox}
        ${formula}

        <div class="verdict-conclusion">${conclusion}</div>
      </div>
      <div class="verdict-foot">
        <div class="verdict-foot-addr">${escapeHtml(addr)}</div>
        <div class="verdict-foot-case">${escapeHtml(r.court || '')}</div>
      </div>
    </div>

    <div class="stats-hero">
      <div class="primary">
        <div class="stat-hero-k">낙찰자 인수금액</div>
        <div class="stat-hero-v ${r.inherited.total > 0 ? 'danger' : 'ok'}">${formatMoney(r.inherited.total)}</div>
        <div class="stat-hero-sub">대항력 임차인 · 선순위 권리 총합</div>
      </div>
      <div>
        <div class="stat-hero-k">인수 항목</div>
        <div class="stat-hero-v ${inheritCount > 0 ? 'danger' : 'ok'}">${inheritCount}건</div>
      </div>
      <div>
        <div class="stat-hero-k">대항력</div>
        <div class="stat-hero-v ${daehang > 0 ? 'danger' : 'ok'}">${daehang}명</div>
      </div>
      <div>
        <div class="stat-hero-k">소멸 권리</div>
        <div class="stat-hero-v">${extinctCount}건</div>
      </div>
    </div>
  `;
}

// ───── AI Verdict (Editorial Style) ─────
function renderAIVerdict(r) {
  return `
    <article class="article">
      <p class="article-kicker">AI Judgment</p>
      <h3 class="article-title">종합 판단</h3>
      ${r.explanation}
    </article>
  `;
}

// ───── Process Timeline ─────
function renderProcessTimeline(r) {
  if (!r.processGuide || r.processGuide.length === 0) return '';
  return `
    <article class="article">
      <p class="article-kicker">Process</p>
      <h3 class="article-title">이 사건은 지금 어디까지 왔는가</h3>
      <div class="timeline">
        ${r.processGuide.map((s, i) => `
          <div class="timeline-step ${s.done ? 'done' : ''}">
            <div class="timeline-dot">${i + 1}</div>
            <div class="timeline-label">${escapeHtml(s.label)}</div>
            <div class="timeline-desc">${escapeHtml(s.detail)}</div>
          </div>
        `).join('')}
      </div>
    </article>
  `;
}

// ───── Malso (말소기준권리) ─────
function renderMalso(r) {
  if (!r.malso) return '';
  return `
    <article class="article">
      <p class="article-kicker">Malso · 말소기준권리</p>
      <h3 class="article-title">${escapeHtml(r.malso.type)}</h3>
      <div class="prose" style="font-size:15px; margin-bottom:16px">
        ${escapeHtml(r.malso.holder)}가 ${escapeHtml(r.malso.date)}에 설정한 권리가 <strong>말소기준</strong>입니다. 이 날짜 이후에 설정된 모든 권리는 경매로 소멸되고, 이전 권리는 낙찰자가 인수합니다.
      </div>
      <div class="note">
        <strong>채권최고액</strong> ${formatMoney(r.malso.amount)}
      </div>
    </article>
  `;
}

// ───── Rights Cards ─────
function renderRightsCards(r) {
  if (!r.rights || r.rights.length === 0) return '';
  return `
    <article class="article">
      <p class="article-kicker">Rights Analysis</p>
      <h3 class="article-title">권리분석 · ${r.rights.length}건</h3>
      <div class="rights-cards">
        ${r.rights.map(right => {
          const cls = right.isMalso ? 'malso' : (right.status === '인수' ? 'inherit' : 'extinct');
          const statusLabel = right.isMalso ? '말소기준' : right.status;
          return `
            <div class="right-card ${cls}">
              <div class="right-card-head">
                <span class="right-card-type">${escapeHtml(right.type)}</span>
                <span class="right-card-status">${escapeHtml(statusLabel)}</span>
              </div>
              <div class="right-card-body">
                <strong>${escapeHtml(right.holder || '-')}</strong>
                · 접수 ${escapeHtml(right.date || '-')}
                · ${formatMoney(right.amount)}
              </div>
              ${right.reason ? `<div class="right-card-reason">${escapeHtml(right.reason)}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    </article>
  `;
}

// ───── Tenant Cards ─────
function renderTenantCards(r) {
  if (!r.tenants || r.tenants.length === 0) return '';
  return `
    <article class="article">
      <p class="article-kicker">Tenants · 임차인 분석</p>
      <h3 class="article-title">임차인 대항력</h3>

      <div class="note">
        <strong>대항력 판단 기준</strong>
        <ul>
          <li>전입신고 <em>다음날 0시</em>부터 대항력 발생 (주택임대차보호법 3조)</li>
          <li>말소기준권리 설정일과 <em>같은 날</em> 전입 → 대항력 없음</li>
          <li>말소기준보다 <em>먼저</em> 전입 + 확정일자 → 대항력 + 우선변제권</li>
        </ul>
      </div>

      ${r.tenants.map(t => {
        const cls = t.daehang === '있음' ? 'daehang' : '';
        const statusLabel = t.daehang === '있음' ? '대항력 있음' : (t.daehang === '없음' ? '대항력 없음' : '판단 불가');
        return `
          <div class="tenant-card ${cls}">
            <div class="tenant-card-head">
              <span class="tenant-card-name">${escapeHtml(t.name)}</span>
              <span class="right-card-status" style="color:${t.daehang === '있음' ? 'var(--burgundy)' : 'var(--sage)'}; border-color:currentColor">${escapeHtml(statusLabel)}</span>
            </div>
            <div class="tenant-card-grid">
              <div>
                <div class="tenant-card-field-k">전입일</div>
                <div class="tenant-card-field-v">${escapeHtml(t.moveIn || '—')}</div>
              </div>
              <div>
                <div class="tenant-card-field-k">확정일자</div>
                <div class="tenant-card-field-v">${escapeHtml(t.fixed || '—')}</div>
              </div>
              <div>
                <div class="tenant-card-field-k">보증금</div>
                <div class="tenant-card-field-v">${formatMoney(t.deposit)}</div>
              </div>
            </div>
            ${t.reason ? `<div class="tenant-card-note">${escapeHtml(t.reason)}</div>` : ''}
          </div>
        `;
      }).join('')}
    </article>
  `;
}

// ───── Distribution Table ─────
function renderDistributionTable(r) {
  if (!r.baedang || !r.baedang.allocations || r.baedang.allocations.length === 0) return '';
  return `
    <article class="article">
      <p class="article-kicker">Distribution · 예상 배당</p>
      <h3 class="article-title">예상 배당표</h3>
      <p class="prose" style="font-size:14px; color:var(--ink-2); margin-bottom:16px">
        최저매각가 ${formatMoney(r.baedang.bidPrice)} 기준으로 배당 순위를 시뮬레이션한 결과입니다.
      </p>
      <table class="dist-table">
        <thead>
          <tr>
            <th>순위</th>
            <th>항목</th>
            <th class="r">배당액</th>
          </tr>
        </thead>
        <tbody>
          ${r.baedang.allocations.map(a => `
            <tr>
              <td><span class="order">${a.order}순위</span></td>
              <td>${escapeHtml(a.label)}</td>
              <td class="r">${formatMoney(a.amount)}</td>
            </tr>
          `).join('')}
          ${r.baedang.surplus > 0 ? `
            <tr class="total">
              <td></td>
              <td>잉여</td>
              <td class="r">${formatMoney(r.baedang.surplus)}</td>
            </tr>
          ` : ''}
        </tbody>
      </table>
    </article>
  `;
}

// ───── Checklist ─────
function renderChecklist(r) {
  if (!r.checklist || r.checklist.length === 0) return '';
  return `
    <article class="article">
      <p class="article-kicker">Checklist</p>
      <h3 class="article-title">입찰 전 확인사항</h3>
      <div class="checklist">
        <div class="checklist-head">아래 항목을 모두 확인하세요</div>
        ${r.checklist.map(item => `
          <div class="checklist-item ${item.status}">
            <span class="checklist-mark"></span>
            <span>${escapeHtml(item.label)}</span>
          </div>
        `).join('')}
      </div>
    </article>
  `;
}

// ───── Schedule Detail (기일 내역 + 유찰 막대) ─────
function renderScheduleDetail(r) {
  if (!r.schedule || r.schedule.length === 0) return '';

  // 유찰 하락 막대 차트 — 오래된 순으로 정렬해서 높은 가격 → 낮은 가격
  const sortedAsc = [...r.schedule].reverse();
  const prices = sortedAsc.map(row => {
    const priceStr = String(row[5] || '').replace(/[^0-9]/g, '');
    return parseInt(priceStr, 10) || 0;
  }).filter(p => p > 0);
  const maxPrice = Math.max(...prices, 1);

  let chartHtml = '';
  if (prices.length > 1) {
    chartHtml = `
      <div style="margin-bottom:14px">
        <div style="font-size:10.5px; letter-spacing:2px; text-transform:uppercase; color:var(--ink-3); font-weight:600; margin-bottom:8px">유찰로 인한 최저가 하락 추이</div>
        <div class="yuchal-chart">
          ${sortedAsc.map((row, idx) => {
            const priceStr = String(row[5] || '').replace(/[^0-9]/g, '');
            const price = parseInt(priceStr, 10) || 0;
            const height = (price / maxPrice) * 100;
            const isCurrent = idx === sortedAsc.length - 1;
            return `<div class="yuchal-bar ${isCurrent ? 'current' : ''}" style="height:${height}%" title="${escapeHtml(row[0])} · ${escapeHtml(row[5])}"></div>`;
          }).join('')}
        </div>
        <div style="display:flex; justify-content:space-between; font-family:var(--mono); font-size:10.5px; color:var(--ink-3); margin-top:-4px">
          <span>${escapeHtml(sortedAsc[0][0] || '')}</span>
          <span>${escapeHtml(sortedAsc[sortedAsc.length-1][0] || '')}</span>
        </div>
      </div>
    `;
  }

  return `
    <article class="article">
      <p class="article-kicker">Schedule</p>
      <h3 class="article-title">기일 내역 · ${r.schedule.length}건</h3>
      ${chartHtml}
      <div class="schedule">
        ${r.schedule.map(row => {
          const result = row[4] || '';
          let resultClass = '';
          if (result === '유찰') resultClass = 'yuchal';
          else if (result === '매각') resultClass = 'sold';
          else if (/진행|예정/.test(result)) resultClass = 'progress';
          const priceClass = result === '유찰' ? 'strike' : '';
          return `
            <div class="sched-row">
              <span class="sched-date">${escapeHtml(row[0] || '')} ${escapeHtml(row[1] || '')}</span>
              <span class="sched-result ${resultClass}">${escapeHtml(result || '—')}</span>
              <span class="sched-place">${escapeHtml(row[2] || '-')}</span>
              <span class="sched-price num ${priceClass}">${escapeHtml(row[5] || '-')}</span>
            </div>
          `;
        }).join('')}
      </div>
    </article>
  `;
}

// ───── Deliveries (송달내역) ─────
function renderDeliveries(r) {
  if (!r.deliveries || r.deliveries.length === 0) return '';
  return `
    <article class="article">
      <p class="article-kicker">Deliveries · 송달내역</p>
      <h3 class="article-title">송달 내역 · ${r.deliveries.length}건</h3>

      <div class="glossary">
        <div class="glossary-title">송달 용어 가이드</div>
        <div class="glossary-grid">
          <div><span class="glossary-term">송달</span><span class="glossary-def">법원이 관계인에게 서류를 공식 전달</span></div>
          <div><span class="glossary-term">도달</span><span class="glossary-def">서류가 정상적으로 전달 완료</span></div>
          <div><span class="glossary-term">송달간주</span><span class="glossary-def">직접 전달 안 됐지만 법적으로 전달된 것으로 처리</span></div>
          <div><span class="glossary-term">불능/부도달</span><span class="glossary-def">서류 전달 실패 (주소 불명 등)</span></div>
          <div><span class="glossary-term">최고서</span><span class="glossary-def">관계기관에 경매 사실을 알리는 공식 통지</span></div>
          <div><span class="glossary-term">교부청구</span><span class="glossary-def">세금 등 채권자가 낙찰대금에서 배당 요청</span></div>
        </div>
      </div>

      <details class="detail">
        <summary>전체 송달내역 보기</summary>
        <div>
          <div class="delivery-list">
            ${r.deliveries.map(d => `
              <div class="delivery-row">
                <span class="delivery-date">${escapeHtml(d.date || '-')}</span>
                <span class="delivery-content">${escapeHtml(d.content || '-')}</span>
                <span class="delivery-result">${escapeHtml(d.result || '')}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </details>
    </article>
  `;
}
