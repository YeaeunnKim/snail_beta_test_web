/**
 * 약관/개인정보 처리방침 버전.
 *
 * 회원가입 시 accepted_terms_version / accepted_privacy_version 으로 그대로 전송된다.
 *
 * TODO(backend): 현재 "유효한" 버전 문자열의 출처가 백엔드 스펙에 없다.
 * 백엔드와 합의된 현행 버전을 env(NEXT_PUBLIC_TERMS_VERSION/NEXT_PUBLIC_PRIVACY_VERSION)로
 * 주입하거나, 약관 조회 엔드포인트가 생기면 그 값으로 대체할 것. 아래 기본값은 임시.
 */
export const TERMS_VERSION = process.env.NEXT_PUBLIC_TERMS_VERSION ?? '1.0';
export const PRIVACY_VERSION = process.env.NEXT_PUBLIC_PRIVACY_VERSION ?? '1.0';
