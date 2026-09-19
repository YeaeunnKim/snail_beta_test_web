/** 인증/계정 관련 API. 로그인·회원가입·비밀번호 재설정. */
import { apiClient } from '@/lib/api-client';
import { setTokens } from '@/lib/token';
import type { Owner, OwnerLoginRequest, OwnerSignupRequest, TokenPair } from './types';

/** 사장님 로그인 → 토큰을 저장하고 반환 */
export async function login(body: OwnerLoginRequest): Promise<TokenPair> {
  const tokens = await apiClient.post('/api/v1/auth/owner/login', { body });
  setTokens(tokens);
  return tokens;
}

/** 사장님 회원가입 (가입 후 별도 로그인 필요) */
export async function signup(body: OwnerSignupRequest) {
  return apiClient.post('/api/v1/auth/owner/signup', { body });
}

/**
 * 비밀번호 재설정 토큰 발급 요청.
 *
 * ⚠️ 베타에서는 쓰지 않는다. 성공(204)해도 사장님에게 아무것도 도착하지 않는다 —
 * 백엔드에 메일 발송 연동이 없고, 있어도 베타 계정의 이메일은 인스타 핸들로 만든 합성
 * 주소(`lib/beta-account.ts`)라 받는 사람이 없다. 복구는 운영자의 임시 비밀번호 발급으로
 * 한다. 함수를 남겨 두는 이유는 발송이 연결되는 날 화면만 되돌리면 되게 하기 위함이다.
 */
export async function requestPasswordReset(email: string) {
  return apiClient.post('/api/v1/auth/password-reset', { body: { email } });
}

/**
 * 비밀번호 재설정 확정. 링크의 `?token=` 을 들고 온 경우에만 쓴다.
 *
 * 발송이 연결되기 전에도 경로는 살려 둔다 — 운영자가 개발 로그에서 토큰을 꺼내 전달하는
 * 예외 상황이 실제로 있고, 그때 화면이 없으면 손으로 API 를 부르게 된다.
 */
export async function confirmPasswordReset(body: { token: string; new_password: string }) {
  return apiClient.post('/api/v1/auth/password-reset/confirm', { body });
}

/**
 * 로그인 상태에서 내 비밀번호 변경. 현재 비밀번호를 함께 보낸다.
 *
 * 운영자가 발급한 임시 비밀번호로 들어온 계정은 이 호출을 성공시키기 전까지 다른 API 가
 * 403(`PASSWORD_CHANGE_REQUIRED`)으로 막힌다. 그때의 "현재 비밀번호" 는 운영자가 전화로
 * 불러 준 임시 값이다.
 */
export function changePassword(body: {
  current_password: string;
  new_password: string;
}): Promise<Owner> {
  return apiClient.patch('/api/v1/owners/me/password', { body });
}
