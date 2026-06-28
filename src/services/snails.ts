/**
 * 스냅(스네일) 조회 API.
 * 사장님 웹에서는 "내 샵을 태그한 스냅" 집계(대시보드 지표)에 사용한다.
 */
import { apiClient } from '@/lib/api-client';

export interface SnapListQuery {
  feed_type?: 'latest' | 'ranking' | 'following';
  cursor?: string;
  limit?: number;
  tagged_design_id?: string;
  tagged_shop_id?: string;
  tagged_designer_id?: string;
}

/** 스냅 목록. tagged_shop_id로 내 샵을 태그한 스냅만 필터할 수 있다. */
export async function listSnails(query?: SnapListQuery) {
  return apiClient.get('/api/v1/snails', { query });
}
