'use client';

/**
 * 인증 상태 접근용 편의 훅.
 * verification_status 기반 온보딩 분기 헬퍼도 함께 제공한다.
 */
import { useAuthStore } from '@/stores/auth-store';

export function useAuth() {
  const owner = useAuthStore((s) => s.owner);
  const status = useAuthStore((s) => s.status);
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const refreshOwner = useAuthStore((s) => s.refreshOwner);

  const verification = owner?.verification_status ?? null;

  return {
    owner,
    status,
    isAuthenticated: status === 'authenticated',
    isLoading: status === 'loading' || status === 'idle',
    /** 사업자 인증 완료 여부 (대시보드 운영 액션 허용 조건) */
    isApproved: verification === 'approved',
    /** 인증 화면으로 유도해야 하는 상태 */
    needsVerification: verification === 'pending' || verification === 'rejected',
    verificationStatus: verification,
    login,
    logout,
    bootstrap,
    refreshOwner,
  };
}
