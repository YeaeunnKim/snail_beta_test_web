/**
 * 약관/개인정보 처리방침 버전.
 *
 * 회원가입 시 accepted_terms_version / accepted_privacy_version 으로 그대로 전송된다.
 *
 * 백엔드 확정: 버전 출처를 백엔드가 제공하지 않으며, auth 요청에 위 두 값을 그대로 보내는
 * 구조다. 따라서 현행 버전을 env(NEXT_PUBLIC_TERMS_VERSION/NEXT_PUBLIC_PRIVACY_VERSION)로
 * 주입한다. (배포 환경에서 실제 버전 문자열을 설정할 것. 미설정 시 아래 기본값 사용.)
 */
export const TERMS_VERSION = process.env.NEXT_PUBLIC_TERMS_VERSION ?? '1.0';
export const PRIVACY_VERSION = process.env.NEXT_PUBLIC_PRIVACY_VERSION ?? '1.0';
