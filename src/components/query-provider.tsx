'use client';

/**
 * TanStack Query Provider.
 *
 * QueryClient를 컴포넌트 상태로 한 번만 생성해(브라우저 탭당 1개) 유지한다.
 * 개발 환경에서는 devtools를 함께 마운트한다.
 */
import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { makeQueryClient } from '@/lib/query-client';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
