/** 통제어휘(색상/무드/시즌/지역). 운영자웹 태그 관리가 SSOT다. */
import { apiClient } from '@/lib/api-client';

/** 필터/드롭다운 공용 목록. 활성 칩만 sort_order 순으로 온다. */
export async function getTaxonomy() {
  return apiClient.get('/api/v1/taxonomy');
}
