/**
 * 백엔드 에러 envelope를 정규화한 에러 객체.
 *
 * 백엔드 에러 응답 형태:
 * {
 *   "error": { "code": "VALIDATION_ERROR", "message": "...", "field_errors": { ... } },
 *   "request_id": "req_..."
 * }
 *
 * UI는 `error.code`로 분기하고, 폼 에러는 `field_errors`로 필드별 메시지를 표시한다.
 * 에러 코드 전체 목록은 backend-context/owner_web.ai.txt 참고.
 */
import type { Schemas } from '@/types/api-helpers';

type ErrorBody = Schemas['ErrorBody'];

export class ApiError extends Error {
  /** HTTP 상태 코드 */
  readonly status: number;
  /** 백엔드 에러 코드 (예: INVALID_CREDENTIALS). 네트워크 오류 등은 아래 합성 코드를 사용. */
  readonly code: string;
  /** 필드별 검증 에러 (폼에 매핑) */
  readonly fieldErrors: Record<string, string> | null;
  /** 요청 상관관계 ID (서버 로그 추적용) */
  readonly requestId: string | null;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    fieldErrors?: Record<string, string> | null;
    requestId?: string | null;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.status = params.status;
    this.code = params.code;
    this.fieldErrors = params.fieldErrors ?? null;
    this.requestId = params.requestId ?? null;
  }

  /** 백엔드 에러 envelope에서 ApiError 생성 */
  static fromResponse(status: number, body: unknown, requestId: string | null): ApiError {
    const envelope = body as { error?: ErrorBody; request_id?: string } | undefined;
    const error = envelope?.error;
    return new ApiError({
      status,
      code: error?.code ?? 'UNKNOWN_ERROR',
      message: error?.message ?? '알 수 없는 오류가 발생했습니다.',
      fieldErrors: error?.field_errors ?? null,
      requestId: envelope?.request_id ?? requestId,
    });
  }

  /** 인증 만료/실패 계열인지 (401) */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/** 네트워크 자체가 실패했을 때 (서버 미응답) 사용하는 합성 코드 */
export const NETWORK_ERROR_CODE = 'NETWORK_ERROR';

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
