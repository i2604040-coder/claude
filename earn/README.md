# 💰 돈계산기 — 소소한 수익용 생활 금융 계산기

2026년 기준 **연봉 실수령액 · 대출 이자 · 예·적금 이자 · 퇴직금** 계산기를 한 페이지에 모은 정적 웹사이트입니다.
서버·DB가 필요 없어 **GitHub Pages로 0원에 운영**되고, `config.js` 한 파일만 채우면 수익 장치가 켜집니다.

## 📈 투자 비교 (적금·예금·대출 vs 주식·ETF·펀드)

- 같은 돈을 같은 방식(적금=매월 적립, 예금=일시 투자)으로 KODEX 200, 미국 S&P500·나스닥100, 미국배당, 삼성전자, SK하이닉스, 국고채10년, 금, CD금리(MMF 대용)에 넣었을 때의 **세후 결과**
- 최근 N개월 결과 + 과거 10년 안 모든 N개월 구간 중 **예·적금보다 많았던 확률, 원금 손실 확률, 최악·최고 결과**
- 대출 모드: 1년 세후 수익률이 **대출 금리를 넘은 확률**과 1·3·5년 연평균 수익률
- 시세는 `earn/tools/build_market.py`가 Yahoo Finance 월말 수정주가(배당 재투자 반영)로 `earn/market.json` 생성. 배포 워크플로가 평일 장 마감 후 자동 갱신
- 비교 상품은 `build_market.py`의 `PRODUCTS` 목록만 고치면 추가·변경 가능
- **직접 골라 비교**: 한글·영문 이름이나 코드(예: 테슬라, 비트코인, 에코프로, SCHD, 005930, BTC-KRW)로 아무 주식·ETF·코인을 검색해서 같은 기준으로 비교
  - `earn/functions/` = Cloudflare Pages Functions API (`/api/search`: 네이버 자동완성 + 야후 검색, `/api/chart`: 10년 월봉 수정주가, 외화 종목은 그 달 환율로 원화 환산, 야후 데이터 오류값 자동 제거)
  - GitHub Pages 사이트도 `config.js`의 `apiBase`(https://doncalc.pages.dev) API를 사용
  - 세금 자동 판정: 국내주식·국내주식형 ETF·가상자산 비과세, 그 외 국내 ETF 15.4%, 해외 상장 22%(250만원 공제). 화면에서 직접 바꿀 수 있음

## ⚔️ 종목 대결

- 주식·ETF·코인을 최대 4개 골라 **같은 기간, 같은 돈**(매월 적립 또는 한 번에 투자)으로 붙여 봄
- 결과: 순위, 세후 최종 금액·수익률, 가격 상승률, 연평균 수익률, 최대 낙폭, 변동성, 최고·최악의 달, 세금
- 평가금액 추이 차트(크로스헤어 툴팁), 적금 비교선, 넣은 돈 선
- 기간: 1·3·5·10년/최대 프리셋 또는 시작·끝 월 직접 지정. 늦게 상장한 종목이 있으면 모두가 시세를 가진 기간으로 자동으로 맞춤
- 투자 비교 탭에도 분석 기간 설정 추가 (확률·최근 결과를 그 기간 기준으로 계산)

## 왜 이 아이템인가

- "연봉 실수령액", "대출 이자 계산기", "퇴직금 계산기"는 매달 검색량이 꾸준한 키워드 → 광고·제휴 수익과 궁합이 좋음
- 결과 화면 바로 아래(사용자가 가장 오래 보는 위치)에 후원 버튼·쿠팡 링크 배치
- 가입·로그인·개인정보 수집 없음 → 운영 부담과 법적 리스크 최소

## 수익 구조 (빠른 순)

| 수단 | 수익 발생 시점 | 설정 방법 |
|---|---|---|
| **토스 QR 후원** | 스캔·송금 즉시 내 토스 계좌로 입금 | 토스 앱의 '송금 QR' 이미지를 `earn/toss-qr.png`로 저장 (파일이 있으면 자동 표시) |
| **카카오페이 후원** | 즉시 | `kakaoPayUrl` (설정 완료) |
| **쿠팡 파트너스** | 링크 클릭 후 24시간 내 구매 시 약 3% 적립 (월 정산) | partners.coupang.com 가입 → 링크 생성 → `coupangLinks.*.url` (가입 직후 바로 사용 가능, 대가성 문구 자동 표시) |
| **구글 애드센스** | 승인 후 노출·클릭당 (월 정산) | 사이트 공개 후 신청 → 승인되면 `adsenseClient`, `adsenseSlot` 입력 + `earn/ads.txt` 추가 |

> 솔직한 기대치: 방문자가 없으면 수익도 0원입니다. 처음엔 하루 수십 명 수준이고, 아래 '홍보' 단계를 해야 수백 원~수천 원 단위가 생기기 시작합니다.

## 배포 (5분)

1. `earn/toss-qr.png` 업로드, 필요하면 `earn/config.js`에 쿠팡 링크 입력 후 커밋
2. 기본 브랜치에 머지 (워크플로는 `main`과 현재 기본 브랜치 push 시 실행)
3. GitHub 저장소 → **Settings → Pages → Source: GitHub Actions** 선택
4. Actions 탭에서 "돈계산기 GitHub Pages 배포"가 돌면 `https://<깃허브아이디>.github.io/<저장소명>/` 에 공개됨
   (`workflow_dispatch`로 수동 실행도 가능)

> 저장소가 private이면 무료 플랜에서는 Pages를 쓸 수 없습니다. 그럴 땐 `earn/` 폴더를 Netlify Drop(app.netlify.com/drop)에 드래그하면 바로 공개됩니다.

## Cloudflare Pages 배포 (`doncalc.pages.dev`)

같은 워크플로가 GitHub Pages와 함께 Cloudflare Pages 프로젝트 `doncalc`에도 배포합니다. 저장소 Secrets 두 개만 있으면 됩니다.

1. Cloudflare 대시보드 → **Manage Account → Account API Tokens → Create Token → Custom token**, 권한 `Account / Cloudflare Pages / Edit`
2. Cloudflare 대시보드 오른쪽(또는 Workers & Pages 화면)의 **Account ID** 복사
3. GitHub 저장소 → **Settings → Secrets and variables → Actions → New repository secret**
   - `CLOUDFLARE_API_TOKEN` = 1번 토큰
   - `CLOUDFLARE_ACCOUNT_ID` = 2번 ID
4. Actions → "돈계산기 GitHub Pages 배포" → **Run workflow**

`doncalc`라는 이름을 다른 사람이 이미 쓰고 있으면 Cloudflare가 `doncalc-xxx.pages.dev`처럼 뒤에 글자를 붙입니다. 실제 주소는 Actions 로그나 Cloudflare 대시보드에서 확인하세요.

## 홍보 (방문자 = 수익)

- 네이버 서치어드바이저, 구글 서치콘솔에 사이트 등록 (검색 노출 시작)
- 결과 화면을 캡처해 블로그·카페·커뮤니티에 "2026 연봉별 실수령액 표" 형태로 공유하고 링크 첨부
- 각 탭은 `#salary`, `#loan`, `#savings`, `#severance`, `#compare` 주소로 바로 열려서 상황별로 공유하기 좋음

## 로컬 실행 / 테스트

```bash
cd earn
python3 -m http.server 8000   # http://localhost:8000
node --test tests/calc.test.js tests/market.test.mjs
npx wrangler pages dev .   # API(functions/)까지 함께 실행하려면
```

## 계산 기준 (2026)

- 국민연금 4.75% (기준소득월액 40만~637만원), 건강보험 3.595%, 장기요양 = 건강보험료 × 13.14%, 고용보험 0.9%
- 소득세: 근로소득공제 → 인적공제(1인 150만) → 4대보험 공제 → 기본세율 → 근로소득세액공제·표준세액공제(13만)·자녀세액공제, 월 환산. 간이세액표 원천징수액과는 소폭 차이 가능
- 이자소득세 15.4% / 세금우대 9.5% / 비과세
- 퇴직금 = 1일 평균임금 × 30 × 재직일수/365 (평균임금에 상여·연차수당 3/12 반영), 1년 미만 0원

요율이 바뀌면 `calc.js` 상단 `RATES`만 수정하면 됩니다.
