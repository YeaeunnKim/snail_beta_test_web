/**
 * TanStack Query 기본 설정.
 *
 * 재시도 정책은 ApiError를 인지한다:
 *  - 4xx(429 제외)는 재시도하지 않는다. (권한/검증/충돌 등은 재시도해도 동일)
 *  - 네트워크 오류(status 0)·429·5xx는 최대 2회 지수 백오프 재시도.
 * 변이(mutation)는 기본적으로 재시도하지 않는다. (Idempotency-Key는 클라이언트가 관리)
 */
import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './api-error';

/** 재시도 가능 여부: 일시적(네트워크/429/5xx) 에러만 true. */
function isRetryable(error: unknown): boolean {
  if (!isApiError(error)) return true; // 알 수 없는 오류는 일시적일 수 있어 재시도 허용
  if (error.status === 0) return true; // 네트워크 오류
  if (error.status === 429) return true; // 레이트 리밋
  if (error.status >= 500) return true; // 서버 오류
  return false; // 그 외 4xx는 재시도 무의미
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000, // 30초간 fresh — 화면 전환 시 불필요한 재요청 억제
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false, // 운영 대시보드 — 포커스마다 재요청하지 않음
        retry: (failureCount, error) => isRetryable(error) && failureCount < 2,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8_000),
      },
      mutations: {
        retry: false,
      },
    },
  });
}
