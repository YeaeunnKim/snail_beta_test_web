/** 내 샵 관리 API. 샵 정보·영업시간·이미지. */
import { apiClient } from '@/lib/api-client';
import type { BusinessHoursSet, ShopCreate, ShopImageCreate, ShopUpdate } from './types';

/** 내 샵 조회 (없으면 404 SHOP_NOT_FOUND) */
export async function getMyShop() {
  return apiClient.get('/api/v1/shops/me');
}

/** 내 샵 생성 (사업자 인증 approved 필요) */
export async function createMyShop(body: ShopCreate) {
  return apiClient.post('/api/v1/shops/me', { body });
}

/** 내 샵 수정 */
export async function updateMyShop(body: ShopUpdate) {
  return apiClient.patch('/api/v1/shops/me', { body });
}

/** 영업시간 일괄 설정 (요일별 7건) */
export async function setBusinessHours(body: BusinessHoursSet) {
  return apiClient.put('/api/v1/shops/me/business-hours', { body });
}

/** 샵 이미지 추가 (업로드된 object key 기반) */
export async function addImage(body: ShopImageCreate) {
  return apiClient.post('/api/v1/shops/me/images', { body });
}

/** 샵 이미지 삭제 */
export async function deleteImage(imageId: string) {
  return apiClient.delete('/api/v1/shops/me/images/{image_id}', {
    params: { image_id: imageId },
  });
}
