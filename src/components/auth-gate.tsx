'use client';

/**
 * 인증 게이트 (미승인 사장님 전용 화면 보호).
 *
 * /business-verification, /pending 처럼 "로그인은 했지만 아직 승인 전" 사용자를 위한
 * 화면을 감싼다.
 *  - 미인증            → /login
 *  - 임시 비밀번호      → /password-change (심사 화면도 API 가 403 이라 열어 봐야 빈 화면)
 *  - 인증 + 승인 완료   → /dashboard (더 이상 게이트에 머물 필요 없음)
 *  - 인증 + 미승인      → children 렌더
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { status, isApproved, owner } = useAuth();
  const mustChangePassword = owner?.must_change_password === true;

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    } else if (status === 'authenticated' && mustChangePassword) {
      router.replace('/password-change');
    } else if (status === 'authenticated' && isApproved) {
      router.replace('/dashboard');
    }
  }, [status, isApproved, mustChangePassword, router]);

  if (status === 'idle' || status === 'loading') {
    return <p className="text-body-sm text-primary-50 text-center">불러오는 중…</p>;
  }

  // 리다이렉트 대상(미인증/임시 비밀번호/승인완료)은 화면을 그리지 않는다.
  if (status !== 'authenticated' || mustChangePassword || isApproved) return null;

  return <>{children}</>;
}
