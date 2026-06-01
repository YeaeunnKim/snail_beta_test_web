'use client';

/**
 * 앱 부팅 시 한 번 저장된 토큰으로 세션을 복원한다.
 * (Server Component 트리 최상단에서 client 경계를 형성)
 */
import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth-store';

export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return <>{children}</>;
}
