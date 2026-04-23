# 경매AI 권리분석 — Railway 배포

Vercel 서버리스와 다르게 Railway는 **일반 리눅스 서버**라 Chromium이 문제없이 돌아갑니다.
Dockerfile에 필요한 라이브러리 전부 포함돼있어서 `libnss3.so` 같은 에러 안 납니다.

## 📁 파일 구조

```
auction-railway/
├── Dockerfile          ← Chromium + Node.js 환경
├── package.json
├── railway.json
├── src/
│   ├── server.js       ← Express 서버
│   ├── crawler.js      ← 대법원 크롤러
│   └── analyzer.js     ← 권리분석 엔진
└── public/
    ├── index.html      ← UI
    ├── app.js          ← 프론트엔드
    └── style.css       ← 스타일
```

## 🚀 Railway 배포 (3단계)

### 1단계: GitHub에 푸시

GitHub Desktop 또는 명령어로:
```bash
cd auction-railway
git init
git add .
git commit -m "initial"
git branch -M main
git remote add origin https://github.com/YOUR/gyeongmae-railway.git
git push -u origin main
```

### 2단계: Railway에서 Deploy

1. https://railway.app 접속 → GitHub 로그인
2. **New Project** → **Deploy from GitHub repo** → 방금 올린 레포 선택
3. Railway가 자동으로 `Dockerfile` 인식 → 빌드 시작
4. 5~8분 기다리면 배포 완료

### 3단계: 도메인 생성

1. 프로젝트 → **Settings** → **Networking**
2. **Generate Domain** 클릭
3. `your-app.up.railway.app` 주소 생성됨

## 💰 비용

- Railway 무료 크레딧: $5/월
- Chromium 서버 24시간 돌리면 월 $5~7 정도 (조금 넘길 수 있음)
- 개인/소규모 사용은 무료~월 5천원 이내
- 결제 카드 등록 필수 (무료 크레딧 소진 후부터 과금)

## 🔧 로컬 테스트

Docker 설치돼있으면:
```bash
docker build -t auction .
docker run -p 3000:3000 auction
```
http://localhost:3000 접속

Docker 없으면 일반 Node로는 Chromium 따로 설치해야 함. Railway에서 바로 테스트하는 게 편함.

## 문제 해결

**빌드 실패시**: Railway 대시보드 → Deployments → Build Logs 확인
**크롤링 실패시**: Deployments → Logs (런타임 로그)
**에러 메시지 스샷 주시면 바로 고쳐드림**
