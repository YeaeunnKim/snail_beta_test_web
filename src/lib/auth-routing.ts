/**
 * 인증 상태(verification_status)에 따른 진입 경로 결정.
 *
 * 로그인/부팅 직후 어디로 보낼지 한 곳에서 결정한다:
 *  - approved → /dashboard
 *  - rejected → /business-verification (반려 사유 + 재제출)
 *  - pending  → /pending (심사 대기 안내; 미제출이면 그 화면이 폼으로 유도)
 */
import type { Owner } from '@/services';

export function resolveAuthedHome(owner: Owner | null): string {
  if (!owner) return '/login';
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
