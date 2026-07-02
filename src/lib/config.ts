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
  /**
   * 개발용 자동 로그인. NEXT_PUBLIC_DEV_AUTOLOGIN=1 일 때만 동작하며,
   * 토큰이 없으면 시드 사장님 계정으로 자동 로그인해 로그인 화면을 건너뛴다.
   * 운영 빌드에서는 이 플래그를 켜지 않는다.
   */
  devAutoLogin: {
    enabled: process.env.NEXT_PUBLIC_DEV_AUTOLOGIN === '1',
    email: process.env.NEXT_PUBLIC_DEV_OWNER_EMAIL ?? 'owner1@seed.snail.app',
    password: process.env.NEXT_PUBLIC_DEV_OWNER_PASSWORD ?? 'devpass1234',
  },
} as const;
