/** 사장님 계정/사업자 인증 API. */
import { apiClient } from '@/lib/api-client';
import type { BusinessVerificationSubmit, OwnerUpdate } from './types';

/** 내 사장님 정보 조회. 로그인 후 verification_status 분기에 사용. */
export async function getMe() {
  return apiClient.get('/api/v1/owners/me');
}

/** 내 사장님 정보 수정 */
export async function updateMe(body: OwnerUpdate) {
  return apiClient.patch('/api/v1/owners/me', { body });
}

/** 최근 사업자 인증 제출 내역 조회 */
export async function getBusinessVerification() {
  return apiClient.get('/api/v1/owners/me/business-verification');
}

/** 사업자 인증 제출 (document_object_key는 이미 업로드된 object key) */
export async function submitBusinessVerification(body: BusinessVerificationSubmit) {
  return apiClient.post('/api/v1/owners/me/business-verification', { body });
}
