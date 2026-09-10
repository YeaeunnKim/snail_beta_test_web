/** 사장님이 만드는 커스텀 옵션 카테고리 API. 고정 3종(제거/연장/케어)과 나란히 존재한다. */
import { apiClient } from '@/lib/api-client';
import type { ShopOptionCategoryCreate, ShopOptionCategoryUpdate } from './types';

/** 내 샵 커스텀 옵션 카테고리 목록 */
export async function listCategories() {
  return apiClient.get('/api/v1/shops/me/option-categories');
}

/** 커스텀 옵션 카테고리 생성 */
export async function createCategory(body: ShopOptionCategoryCreate) {
  return apiClient.post('/api/v1/shops/me/option-categories', { body });
}

/** 커스텀 옵션 카테고리 수정 */
export async function updateCategory(categoryId: string, body: ShopOptionCategoryUpdate) {
  return apiClient.patch('/api/v1/shops/me/option-categories/{category_id}', {
    params: { category_id: categoryId },
    body,
  });
}

/** 커스텀 옵션 카테고리 삭제 — 안의 옵션도 함께 삭제된다. */
export async function deleteCategory(categoryId: string) {
  return apiClient.delete('/api/v1/shops/me/option-categories/{category_id}', {
    params: { category_id: categoryId },
  });
}
