/**
 * 인증 상태(verification_status)에 따른 진입 경로 결정.
 *
 * 로그인/부팅 직후 어디로 보낼지 한 곳에서 결정한다:
 *  - must_change_password → /password-change (심사 상태보다 먼저 본다 — 임시 비밀번호로는
 *    서버가 `/owners/me` 와 비밀번호 변경 외 모든 경로를 403 으로 막아, 심사 상태에 맞는
 *    화면으로 보내 봐야 그 화면이 부르는 API 가 전부 막혀 빈 화면이 된다)
 *  - approved → /dashboard
 *  - rejected → /business-verification (반려 사유 + 재제출)
 *  - pending  → /pending (심사 대기 안내; 미제출이면 그 화면이 폼으로 유도)
 */
import type { Owner } from '@/services';

export function resolveAuthedHome(owner: Owner | null): string {
  if (!owner) return '/login';
  if (owner.must_change_password) return '/password-change';
  switch (owner.verification_status) {
    case 'approved':
      return '/dashboard';
    case 'rejected':
      return '/business-verification';
    case 'pending':
    default:
      return '/pending';
  }
}
