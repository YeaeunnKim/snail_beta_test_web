'use client';

/**
 * 샵 지역 선택지 훅.
 * 운영자웹 태그 관리(taxonomy_chips)가 SSOT라 목록을 API에서 받는다.
 * 하드코딩하면 운영자가 지역을 바꿔도 이 화면만 안 따라온다.
 */
import { useQuery } from '@tanstack/react-query';
import { taxonomyApi } from '@/services';

export const TAXONOMY_KEY = ['taxonomy'] as const;

export function useRegions() {
  return useQuery({
    queryKey: TAXONOMY_KEY,
    queryFn: () => taxonomyApi.getTaxonomy(),
    select: (t) => t.regions,
  });
}
