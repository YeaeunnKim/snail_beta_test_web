'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import {
  capturePageView,
  identifyAnalyticsOwner,
  initAnalytics,
  resetAnalytics,
} from '@/lib/analytics';
import { useAuthStore } from '@/stores/auth-store';

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const ownerId = useAuthStore((state) => state.owner?.id ?? null);
  const authStatus = useAuthStore((state) => state.status);
  const lastPathname = useRef<string | null>(null);

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    if (authStatus === 'idle' || authStatus === 'loading') return;
    if (ownerId) {
      identifyAnalyticsOwner(ownerId);
    } else {
      resetAnalytics();
    }
  }, [authStatus, ownerId]);

  useEffect(() => {
    if (authStatus === 'idle' || authStatus === 'loading') return;
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    capturePageView(pathname);
  }, [authStatus, pathname]);

  return <>{children}</>;
}
