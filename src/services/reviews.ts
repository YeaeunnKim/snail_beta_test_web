/** 리뷰 관리 API. 샵 리뷰 조회 + 답글 작성. */
import { apiClient } from '@/lib/api-client';
import type { ReviewReplyCreate } from './types';

/** 특정 샵의 리뷰 목록 (shop_id 필요 — 내 샵 조회로 얻은 id 사용) */
export async function listReviewsForShop(
  shopId: string,
  query?: { cursor?: string; limit?: number },
) {
  return apiClient.get('/api/v1/shops/{shop_id}/reviews', {
    params: { shop_id: shopId },
    query,
  });
}

/** 리뷰 답글 작성 */
export async function createReply(reviewId: string, body: ReviewReplyCreate) {
  return apiClient.post('/api/v1/reviews/{review_id}/replies', {
    params: { review_id: reviewId },
    body,
  });
}
