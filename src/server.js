const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

const { analyzeCase } = require('./analyzer');
const { fetchCase } = require('./crawler');
const { parseMyeongseseoPdf } = require('./pdf_parser');

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: '경매AI v3.1 서버 정상 (PDF 파싱 탑재)' });
});

// 1단계: 사건번호로 기본정보 자동 수집
app.post('/api/fetch', async (req, res) => {
  const startTime = Date.now();
  try {
    const { saYear, saSer, jiwonNm } = req.body;
    if (!saYear || !saSer || !jiwonNm) {
      return res.status(400).json({ error: '필수 파라미터 누락' });
    }
    console.log(`[fetch] ${jiwonNm} ${saYear}타경${saSer}`);
    const raw = await fetchCase(String(saYear), String(saSer), String(jiwonNm));
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    if (raw.status !== 'ok') {
      return res.status(500).json({
        error: raw.error || '크롤링 실패',
        debug: raw.debug,
        elapsed: `${elapsed}s`,
      });
    }
    res.json({ ok: true, raw, elapsed: `${elapsed}s` });
  } catch (e) {
    console.error('[fetch] exception:', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// 1.5단계: 매각물건명세서 PDF 업로드 → 자동 추출
app.post('/api/parse-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'PDF 파일이 없습니다' });
    if (!/pdf$/i.test(req.file.mimetype) && !/\.pdf$/i.test(req.file.originalname)) {
      return res.status(400).json({ error: 'PDF 파일만 허용됩니다' });
    }

    console.log(`[parse-pdf] ${req.file.originalname} (${(req.file.size/1024).toFixed(1)}KB)`);
    const { parsed, raw } = await parseMyeongseseoPdf(req.file.buffer);
    res.json({
      ok: true,
      parsed,
      rawLength: raw.length,
    });
  } catch (e) {
    console.error('[parse-pdf] exception:', e);
    res.status(500).json({ error: `PDF 파싱 실패: ${e.message}` });
  }
});

// 2단계: 사용자 입력 + 자동수집 데이터로 권리분석
app.post('/api/analyze', async (req, res) => {
  try {
    const { raw, manual, region = 'other', userInputs = {} } = req.body;
    if (!raw || !manual) {
      return res.status(400).json({ error: '필수 파라미터 누락 (raw, manual)' });
    }

    const merged = { ...raw };
    merged.rights = manual.rights || [];
    merged.tenants = (manual.tenants || []).map((t) => ({
      '임차인': t.name || '',
      '전입신고일자': t.moveIn || '',
      '확정일자': t.fixed || '',
      '보증금': t.deposit || '',
    }));

    if (Array.isArray(manual.specials)) {
      manual.specials.forEach((s) => {
        merged.rights.push({
          '접수일자': s.date || '2000-01-01',
          '권리종류': s.type || '유치권',
          '권리자': s.holder || '-',
          '채권금액': s.amount || '0',
        });
      });
    }

    if (manual.malso && manual.malso.date) {
      merged.rights.unshift({
        '접수일자': manual.malso.date,
        '권리종류': manual.malso.type || '근저당권',
        '권리자': manual.malso.holder || '-',
        '채권금액': manual.malso.amount || '0',
      });
    }

    const report = analyzeCase(merged, region, userInputs);
    res.json({ ok: true, report });
  } catch (e) {
    console.error('[analyze] exception:', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`경매AI v3.1 서버 시작: port ${PORT}`);
});
