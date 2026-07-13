/** 디자인 및 옵션 관리 API. 등록·AI 분석·옵션·공개 전환·폴더. */
import { apiClient } from '@/lib/api-client';
import type {
  DesignCreate,
  DesignFolderCreate,
  DesignFolderUpdate,
  DesignOptionCreate,
  DesignOptionUpdate,
  DesignSortRequest,
  DesignUpdate,
  DesignVisibilityUpdate,
} from './types';

/** 내 샵 디자인 목록. folder_id/unfiled로 폴더별 조회. */
export async function listDesigns(query?: {
  cursor?: string;
  limit?: number;
  folder_id?: string;
  unfiled?: boolean;
}) {
  return apiClient.get('/api/v1/shops/me/designs', { query });
}

/** 디자인 상세 조회. ai_analysis_status 폴링에 사용. */
export async function getDesign(designId: string) {
  return apiClient.get('/api/v1/shops/me/designs/{design_id}', {
    params: { design_id: designId },
  });
}

/** 디자인 생성 (image_upload_keys는 업로드된 object key) */
export async function createDesign(body: DesignCreate) {
  return apiClient.post('/api/v1/shops/me/designs', { body });
}

/**
 * 디자인 정렬: 업로드한 원본(object key들)을 백엔드로 보내면, 백엔드가 VM /process로
 * 정렬 처리 후 폴더에 디자인을 백그라운드로 생성한다. 응답은 큐잉 결과(count)뿐이라,
 * 실제 디자인은 폴더를 폴링해 확인한다.
 */
export async function sortDesigns(body: DesignSortRequest) {
  return apiClient.post('/api/v1/shops/me/designs/sort', { body });
}

/** 디자인 수정 */
export async function updateDesign(designId: string, body: DesignUpdate) {
  return apiClient.patch('/api/v1/shops/me/designs/{design_id}', {
    params: { design_id: designId },
    body,
  });
}

/** 디자인 삭제 */
export async function deleteDesign(designId: string) {
  return apiClient.delete('/api/v1/shops/me/designs/{design_id}', {
    params: { design_id: designId },
  });
}

/** 디자인 재분석 요청 (AI 분석 실패 시) */
export async function reanalyze(designId: string) {
  return apiClient.post('/api/v1/shops/me/designs/{design_id}/reanalyze', {
    params: { design_id: designId },
  });
}

/**
 * 디자인 공개 상태 변경.
 * 앱 노출(피드) 조건: owner.verification_status=approved, shop.visibility=active,
 *   design.visibility=active. (ai_analysis_status와 무관 — 백엔드가 노출을 AI에서 분리했다.
 *   AI는 백그라운드로 돌며 완료 시 검색 랭킹만 보강.)
 */
export async function changeVisibility(designId: string, body: DesignVisibilityUpdate) {
  return apiClient.post('/api/v1/shops/me/designs/{design_id}/visibility', {
    params: { design_id: designId },
    body,
  });
}

// --- 폴더 ---

/** 디자인 폴더 목록 (디자인 개수 포함) */
export async function listFolders() {
  return apiClient.get('/api/v1/shops/me/design-folders');
}

/** 디자인 폴더 생성 */
export async function createFolder(body: DesignFolderCreate) {
  return apiClient.post('/api/v1/shops/me/design-folders', { body });
}

/** 디자인 폴더 이름 변경 */
export async function updateFolder(folderId: string, body: DesignFolderUpdate) {
  return apiClient.patch('/api/v1/shops/me/design-folders/{folder_id}', {
    params: { folder_id: folderId },
    body,
  });
}

/** 디자인 폴더 삭제 (디자인은 유지) */
export async function deleteFolder(folderId: string) {
  return apiClient.delete('/api/v1/shops/me/design-folders/{folder_id}', {
    params: { folder_id: folderId },
  });
}

// --- 옵션 ---

/** 디자인 옵션 목록 */
export async function listOptions(designId: string) {
  return apiClient.get('/api/v1/shops/me/designs/{design_id}/options', {
    params: { design_id: designId },
  });
}

/** 디자인 옵션 생성 */
export async function createOption(designId: string, body: DesignOptionCreate) {
  return apiClient.post('/api/v1/shops/me/designs/{design_id}/options', {
    params: { design_id: designId },
    body,
  });
}

/** 디자인 옵션 수정 */
export async function updateOption(designId: string, optionId: string, body: DesignOptionUpdate) {
  return apiClient.patch('/api/v1/shops/me/designs/{design_id}/options/{option_id}', {
    params: { design_id: designId, option_id: optionId },
    body,
  });
}

/** 디자인 옵션 삭제 */
export async function deleteOption(designId: string, optionId: string) {
  return apiClient.delete('/api/v1/shops/me/designs/{design_id}/options/{option_id}', {
    params: { design_id: designId, option_id: optionId },
  });
}
