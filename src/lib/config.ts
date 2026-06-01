/**
 * 앱 전역 환경 설정.
 *
 * 모든 환경 변수는 한 곳에서 읽어 검증한다. 다른 모듈은 process.env를
 * 직접 참조하지 말고 이 모듈을 import 한다.
 */

/** 백엔드 API base URL. 예: http://localhost:8000/api/v1 */
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, '') ?? 'http://localhost:8000/api/v1';

/**
 * OpenAPI의 path 키는 `/api/v1/...` 프리픽스를 포함한다.
 * 반면 base URL(env)도 보통 `/api/v1`로 끝난다.
 * 둘을 그대로 합치면 `/api/v1/api/v1/...`로 중복되므로,
 * 요청 시에는 origin(프리픽스를 제거한 부분)만 사용하고 path 키 전체를 붙인다.
 */
const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1$/, '');

export const config = {
  /** `.../api/v1` 까지 포함한 base URL (사람이 읽는 용도/표시용) */
  apiBaseUrl: API_BASE_URL,
  /** path 키(`/api/v1/...`)와 결합할 origin */
  apiOrigin: API_ORIGIN,
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? '스네일 사장님',
  apiDocsUrl: process.env.NEXT_PUBLIC_API_DOCS_URL ?? '',
  /** 브라우저 런타임 여부 */
  isBrowser: typeof window !== 'undefined',
} as const;
