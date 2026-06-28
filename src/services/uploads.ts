/**
 * 파일 업로드 API.
 *
 * 사장님 업로드 단일 엔드포인트: POST /api/v1/shops/me/uploads
 * 응답: { object_key, url, content_type, byte_size }
 * 사업자등록증·샵 이미지·디자인 사진 모두 이 엔드포인트로 업로드한 뒤,
 * 각 생성/제출 API에 object_key(들)를 넘긴다.
 *
 * multipart/form-data 전송이라 JSON 전용 타입드 클라이언트(api-client)와 별개로 둔다.
 * 백엔드 시그니처: file: UploadFile(File), target_type: UploadTargetType(Form).
 */
import { ApiError, NETWORK_ERROR_CODE } from '@/lib/api-error';
import { config } from '@/lib/config';
import { getAccessToken } from '@/lib/token';

/** 업로드 용도. 사장님 웹에서는 주로 business_license(등록증)·design(디자인 사진)·shop(샵 이미지)·profile(디자이너). */
export type UploadTargetType = 'profile' | 'shop' | 'design' | 'snap' | 'review' | 'business_license';

export interface UploadResult {
  object_key: string;
  url: string;
  content_type: string;
  byte_size: number;
}

const UPLOAD_PATH = '/api/v1/shops/me/uploads';

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

/** 파일 1개를 업로드하고 object_key 등을 받는다. target_type으로 용도를 지정한다. */
export async function uploadFile(
  file: File,
  targetType: UploadTargetType,
  signal?: AbortSignal,
): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('target_type', targetType);

  const token = getAccessToken();
  let res: Response;
  try {
    res = await fetch(config.apiOrigin + UPLOAD_PATH, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Idempotency-Key': idempotencyKey(),
        // Content-Type은 지정하지 않는다 — FormData가 boundary 포함해 자동 설정.
      },
      body: form,
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
  return body as UploadResult;
}
