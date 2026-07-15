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

/**
 * 운영(프로덕션) 빌드 여부.
 * Next.js는 빌드 시 `process.env.NODE_ENV`를 리터럴 문자열로 인라인한다
 * (components/query-provider.tsx의 `NODE_ENV === 'development'` 가드와 동일한 판별 방식 —
 * NEXT_PUBLIC_* 값과 달리 클라이언트 번들에서도 항상 안전하게 평가된다).
 * 아래 devAutoLogin 가드는 이 상수로 분기하므로, 운영 빌드에서는 이 조건이
 * 빌드 타임에 상수로 확정되어 시드 자격증명 리터럴이 번들에 포함되지 않는다.
 */
const IS_PRODUCTION_BUILD = process.env.NODE_ENV === 'production';

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
   *
   * 운영 빌드(IS_PRODUCTION_BUILD)에서는 env 설정 실수와 무관하게 무조건 비활성화하고
   * 시드 이메일/비밀번호도 빈 문자열로 대체한다(운영 번들에 리터럴이 인라인되지 않도록).
   */
  devAutoLogin: IS_PRODUCTION_BUILD
    ? { enabled: false, email: '', password: '' }
    : {
        enabled: process.env.NEXT_PUBLIC_DEV_AUTOLOGIN === '1',
        email: process.env.NEXT_PUBLIC_DEV_OWNER_EMAIL ?? 'owner1@seed.snail.app',
        password: process.env.NEXT_PUBLIC_DEV_OWNER_PASSWORD ?? 'devpass1234',
      },
} as const;
