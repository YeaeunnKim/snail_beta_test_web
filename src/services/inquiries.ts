/**
 * 샵 문의 API.
 *
 * 앱 사용자가 특정 디자인(또는 샵)에 대해 남긴 문의를 조회하고 답변한다.
 *  - design_id가 있으면 해당 디자인에 대한 문의, 없으면 샵 일반 문의.
 *  - status: pending(답변 대기) → answered(답변 완료).
 */
import { apiClient } from '@/lib/api-client';
import type { ShopInquiryReply } from './types';

/** 내 샵에 들어온 문의 목록 (커서 페이지네이션) */
export async function listMyShopInquiries(query?: { cursor?: string; limit?: number }) {
  return apiClient.get('/api/v1/shops/me/inquiries', { query });
}

/** 문의 답변 (pending → answered) */
export async function reply(inquiryId: string, body: ShopInquiryReply) {
  return apiClient.post('/api/v1/shops/me/inquiries/{inquiry_id}/reply', {
    params: { inquiry_id: inquiryId },
    body,
  });
}
