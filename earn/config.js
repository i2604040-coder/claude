// ===== 수익화 설정 =====
// 여기 값만 채우면 사이트에 자동으로 반영됩니다. 비워두면 해당 영역은 숨겨집니다.
window.SITE_CONFIG = {
  siteName: '돈계산기',

  // 1) 후원 (즉시 수익)
  //    토스: 토스 앱 > 송금 > 'QR로 받기' 이미지를 earn/toss-qr.png 로 저장하면 자동 표시 (파일이 없으면 숨김)
  tossQrImage: 'toss-qr.png',
  kakaoPayUrl: 'https://qr.kakaopay.com/Ej8kSvBqe',

  // 2) 쿠팡 파트너스 — partners.coupang.com 가입 후 '링크 생성'으로 만든 단축 링크
  //    결과 화면 아래에 계산 종류별로 맞는 상품 링크가 노출됩니다.
  coupangLinks: {
    salary: { text: '직장인 필수템 최저가 보기', url: '' },   // 예: 'https://link.coupang.com/a/xxxxx'
    loan: { text: '가계부·재테크 베스트셀러 보기', url: '' },
    savings: { text: '재테크 입문서 최저가 보기', url: '' },
    severance: { text: '이직·퇴사 준비 추천템 보기', url: '' },
  },

  // 3) 구글 애드센스 — 승인 후 'ca-pub-xxxxxxxxxxxxxxxx' 형태의 게시자 ID
  adsenseClient: '',
  adsenseSlot: '',        // 디스플레이 광고 단위 slot ID (선택)
};
