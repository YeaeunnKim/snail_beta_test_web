'use client';

/**
 * 내 샵 공개 상태 변경 mutation.
 * 성공 응답으로 받은 ShopMe를 캐시에 즉시 반영하고, 이후 내 샵 쿼리를 재검증한다.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { shopApi } from '@/services';
import type { Shop, ShopVisibilityUpdate } from '@/services';
import { MY_SHOP_KEY } from './use-my-shop';

export type SetShopVisibility = Extract<ShopVisibilityUpdate['visibility'], 'active' | 'hidden'>;

export function useSetShopVisibility() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (visibility: SetShopVisibility) => shopApi.setVisibility({ visibility }),
    onSuccess: (shop: Shop) => {
      qc.setQueryData<Shop | null>(MY_SHOP_KEY, shop);
      qc.invalidateQueries({ queryKey: MY_SHOP_KEY });
    },
  });
}
