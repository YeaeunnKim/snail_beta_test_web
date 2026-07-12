/** 디자인 및 옵션 관리 API. 등록·AI 분석·옵션·공개 전환·폴더. */
import { apiClient } from '@/lib/api-client';
import { ApiError, NETWORK_ERROR_CODE } from '@/lib/api-error';
import { config } from '@/lib/config';
import { getAccessToken } from '@/lib/token';
import type {
  DesignCreate,
  DesignFolderCreate,
  DesignFolderUpdate,
  DesignOptionCreate,
  DesignOptionUpdate,
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

// --- 이미지 자동 처리 트리거 ---

/** uploads.ts와 동일한 멱등키 생성 방식(직접 fetch 경로 전용). */
function idempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * 디자인 이미지 자동 처리(크롭 원본 → 배경 제거/보정 등) 트리거.
 *
 * `POST /shops/me/designs/{id}/process`는 아직 생성된 OpenAPI 타입(src/types/api.d.ts)에 없다
 * (Seam C에서 백엔드 계약 동기화 후 openapi 재생성 예정). 타입드 apiClient로 이 경로를 부르면
 * PathsWithMethod에 없어 컴파일이 실패하므로, uploads.ts 스타일의 직접 fetch로 우회한다.
 * // TODO(types): Seam C(openapi 재생성) 후 apiClient.post('/api/v1/shops/me/designs/{design_id}/process', ...)로 이관
 */
export async function processDesign(designId: string, signal?: AbortSignal): Promise<void> {
  const token = getAccessToken();
  const path = `/api/v1/shops/me/designs/${encodeURIComponent(designId)}/process`;

  let res: Response;
  try {
    res = await fetch(config.apiOrigin + path, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Idempotency-Key': idempotencyKey(),
      },
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError({
      status: 0,
      code: NETWORK_ERROR_CODE,
      message: '서버에 연결할 수 없습니다. 네트워크를 확인해주세요.',
    });
  }

  const body = await parseBody(res);
  if (!res.ok) throw ApiError.fromResponse(res.status, body, res.headers.get('X-Request-Id'));
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
