import { config } from '@/lib/config';

/**
 * 약관/개인정보 처리방침 버전.
 *
 * 회원가입 시 accepted_terms_version / accepted_privacy_version 으로 그대로 전송된다.
 *
 * 백엔드 확정: 버전 출처를 백엔드가 제공하지 않으며, auth 요청에 위 두 값을 그대로 보내는
 * 구조다. 따라서 현행 버전을 env(NEXT_PUBLIC_TERMS_VERSION/NEXT_PUBLIC_PRIVACY_VERSION)로
 * 주입한다. (배포 환경에서 실제 버전 문자열을 설정할 것. 미설정 시 아래 기본값 사용.)
 *
 * 기본값은 백엔드 `LEGAL_TERMS_VERSION` / `LEGAL_PRIVACY_VERSION` 과 일치시킨다.
 * 1.1 = 사업자 정보 조항 + 예약금·취소·환불 조항 신설분(2026-08-23 시행).
 * 약관 1.2 / 처리방침 1.3 = 예약금 수취 주체를 매장 → 회사로 변경(PG 선결제),
 *   부분환불 폐지, 처리방침에 PG 위탁사 추가. 시행 2026-09-30.
 * 약관 1.3 = 확정 후 취소를 "시술 전날 23:59 까지 전액 환불 / 당일 취소는 환불 불가" 로
 *   고정(2026-09-03). 카드사 환불정책 요건 대응. 시행일은 2026-09-30 그대로.
 */
export const TERMS_VERSION = process.env.NEXT_PUBLIC_TERMS_VERSION ?? '1.3';
export const PRIVACY_VERSION = process.env.NEXT_PUBLIC_PRIVACY_VERSION ?? '1.3';

/**
 * 동의 화면에서 실제 본문을 열 수 있어야 하므로 백엔드 공개 페이지로 링크한다.
 * (본문 정본은 backend `app/legal_content.py`, 서빙은 `GET /legal/{terms,privacy}`.)
 */
export const TERMS_URL = `${config.apiOrigin}/legal/terms`;
export const PRIVACY_URL = `${config.apiOrigin}/legal/privacy`;
/** PG·카드사 심사에 제출하는 환불정책 URL. 본문은 약관 제9~10조와 같은 규칙이다. */
export const REFUND_URL = `${config.apiOrigin}/legal/refund`;
