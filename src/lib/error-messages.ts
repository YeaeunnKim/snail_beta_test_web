/**
 * 중앙 에러 메시지 매핑.
 *
 * ApiError(코드/상태)를 사용자에게 보여줄 한국어 메시지로 변환한다.
 * 화면에서는 try/catch 후 `toUserMessage(e)`로 일관된 문구를 얻는다.
 * (폼 필드 단위 에러는 ApiError.fieldErrors로 별도 매핑한다.)
 *
 * 우선순위: 에러 코드 매핑 > 상태(HTTP) 매핑 > 서버 메시지 > 일반 폴백.
 * 단, 422(검증)는 서버가 준 구체 메시지를 우선한다.
 */
import { isApiError, NETWORK_ERROR_CODE } from './api-error';

/** 사업자 인증이 완료되어야 접근 가능한 리소스에 접근했을 때의 백엔드 에러 코드. */
export const VERIFICATION_REQUIRED_CODE = 'VERIFICATION_REQUIRED';

/** 에러 코드별 사용자 메시지 (상태 코드보다 우선). */
const CODE_MESSAGES: Record<string, string> = {
  [VERIFICATION_REQUIRED_CODE]: '사업자 인증이 완료되어야 이용할 수 있습니다.',
  OWNER_NOT_APPROVED: '사업자 인증 승인 후 이용할 수 있습니다.',
  NO_SHOW_TOO_EARLY: '예약 시간 30분 경과 후에 노쇼 처리할 수 있어요.',
  [NETWORK_ERROR_CODE]: '서버에 연결할 수 없습니다. 네트워크 상태를 확인해주세요.',
};

/** HTTP 상태별 기본 사용자 메시지 (서버가 친절한 메시지를 주지 않을 때의 폴백). */
const STATUS_MESSAGES: Record<number, string> = {
  401: '로그인이 만료되었습니다. 다시 로그인해주세요.',
  403: '이 작업을 수행할 권한이 없습니다.',
  409: '이미 처리되었거나 다른 변경과 충돌했습니다. 새로고침 후 다시 시도해주세요.',
  422: '입력값을 다시 확인해주세요.',
  429: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
  500: '일시적인 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
  502: '일시적인 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
  503: '서비스가 일시적으로 불안정합니다. 잠시 후 다시 시도해주세요.',
};

const FALLBACK_MESSAGE = '오류가 발생했습니다. 잠시 후 다시 시도해주세요.';

/** 어떤 에러든 사용자에게 보여줄 한국어 문구로 변환한다. */
export function toUserMessage(error: unknown): string {
  if (!isApiError(error)) return FALLBACK_MESSAGE;

  // 1) 코드 매핑 우선 (가장 구체적인 비즈니스 의미)
  const byCode = CODE_MESSAGES[error.code];
  if (byCode) return byCode;

  // 2) 검증 에러는 서버가 준 구체 메시지를 우선 (필드 에러는 별도 매핑)
  if (error.status === 422 && error.message) return error.message;

  // 3) 상태 매핑 (403/409/429/5xx 등 시스템성 에러는 일관된 문구로)
  const byStatus = STATUS_MESSAGES[error.status];
  if (byStatus) return byStatus;

  // 4) 서버 메시지 → 일반 폴백
  return error.message || FALLBACK_MESSAGE;
}

/** 사업자 인증이 필요해 차단된 에러인지 (인증 화면으로 유도할 때 사용). */
export function isVerificationRequired(error: unknown): boolean {
  return isApiError(error) && error.code === VERIFICATION_REQUIRED_CODE;
}

/** 인증 만료/실패(401)인지 — 재로그인 유도용. */
export function isUnauthorized(error: unknown): boolean {
  return isApiError(error) && error.status === 401;
}
