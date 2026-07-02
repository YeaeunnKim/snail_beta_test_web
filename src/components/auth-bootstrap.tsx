'use client';

/**
 * 앱 부팅 시 한 번 저장된 토큰으로 세션을 복원한다.
 * (Server Component 트리 최상단에서 client 경계를 형성)
 */
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { config } from '@/lib/config';

const AUTH_PAGES = ['/login', '/register', '/password-reset'];

export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const status = useAuthStore((s) => s.status);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // dev 자동 로그인으로 인증되면, 미들웨어가 떨궈둔 로그인 화면에서 대시보드로 보낸다.
  useEffect(() => {
    if (!config.devAutoLogin.enabled) return;
    if (status !== 'authenticated') return;
    if (AUTH_PAGES.some((p) => pathname.startsWith(p))) {
      router.replace('/dashboard');
    }
  }, [status, pathname, router]);

  return <>{children}</>;
}
