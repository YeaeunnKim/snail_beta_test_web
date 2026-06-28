'use client';

/**
 * 내 샵 조회 훅 (TanStack Query).
 * 샵 미등록(404)은 에러가 아니라 null로 정규화한다 — 온보딩 필요 여부 판단에 사용.
 */
import { useQuery } from '@tanstack/react-query';
import { shopApi } from '@/services';
import type { Shop } from '@/services';
import { isApiError } from '@/lib/api-error';

export const MY_SHOP_KEY = ['shop', 'me'] as const;

export function useMyShop() {
  return useQuery<Shop | null>({
    queryKey: MY_SHOP_KEY,
    queryFn: async () => {
      try {
        return await shopApi.getMyShop();
      } catch (e) {
        if (isApiError(e) && e.status === 404) return null;
        throw e;
      }
    },
  });
}
