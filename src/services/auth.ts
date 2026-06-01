/** 인증/계정 관련 API. 로그인·회원가입·비밀번호 재설정. */
import { apiClient } from '@/lib/api-client';
import { setTokens } from '@/lib/token';
import type { OwnerLoginRequest, OwnerSignupRequest, TokenPair } from './types';

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

/** 비밀번호 재설정 요청 (이메일 발송) */
export async function requestPasswordReset(email: string) {
  return apiClient.post('/api/v1/auth/password-reset', { body: { email } });
}

/** 비밀번호 재설정 확정 */
export async function confirmPasswordReset(body: { token: string; new_password: string }) {
  return apiClient.post('/api/v1/auth/password-reset/confirm', { body });
}
