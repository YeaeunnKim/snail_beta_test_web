/**
 * 타입-세이프 API 클라이언트.
 *
 * OpenAPI의 `paths` 타입을 그대로 사용하므로 경로/메서드/요청 본문/쿼리/응답이
 * 모두 컴파일 타임에 검증된다. 스펙이 바뀌면 `pnpm generate:types` 후 타입 에러로 드러난다.
 *
 * 공통 처리:
 *  - Authorization: Bearer <access_token> 자동 첨부
 *  - 변이 요청(POST/PUT/PATCH/DELETE)에 Idempotency-Key 자동 생성/첨부
 *  - 401 응답 시 /auth/refresh 로 토큰 1회 자동 갱신 후 재시도
 *  - 에러 응답을 ApiError로 정규화
 *  - 커서 기반 페이지네이션 헬퍼(collectAll) 제공
 *
 * 사용 예 (서비스 레이어에서):
 *   const shop = await apiClient.get('/api/v1/shops/me');
 *   await apiClient.post('/api/v1/shops/me/designers', { body: { name: '민지' } });
 */
import type {
  HasPathParams,
  HasQuery,
  HasRequiredBody,
  Operation,
  PathParams,
  PathsWithMethod,
  QueryParams,
  RequestBody,
  Schemas,
  SuccessResponse,
} from '@/types/api-helpers';
import { ApiError, NETWORK_ERROR_CODE } from './api-error';
import { config } from './config';
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './token';

const REQUEST_ID_HEADER = 'X-Request-Id';
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** 호출 시 넘기는 옵션. path 파라미터/쿼리/본문 필요 여부에 따라 조건부로 요구된다. */
type RequestOptions<O> = {
  /** AbortController 시그널 */
  signal?: AbortSignal;
  /** 멱등키 직접 지정(미지정 시 crypto.randomUUID로 생성). 재시도 시 동일 키를 넘기면 안전. */
  idempotencyKey?: string;
  /** 추가 헤더 */
  headers?: Record<string, string>;
} & (HasPathParams<O> extends true ? { params: PathParams<O> } : { params?: never }) &
  (HasQuery<O> extends true ? { query?: QueryParams<O> } : { query?: never }) &
  (HasRequiredBody<O> extends true ? { body: RequestBody<O> } : { body?: RequestBody<O> });

/** 옵션이 전부 선택적이면 인자 자체를 생략할 수 있게 한다. */
type MaybeOptions<O> = RequestOptions<O> extends { params: unknown } | { body: unknown }
  ? [options: RequestOptions<O>]
  : [options?: RequestOptions<O>];

function buildUrl(path: string, params?: Record<string, unknown>, query?: Record<string, unknown>): string {
  let resolved = path;
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      resolved = resolved.replace(`{${key}}`, encodeURIComponent(String(value)));
    }
  }
  const url = new URL(config.apiOrigin + resolved);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, String(v));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

/** 진행 중인 refresh 요청을 공유해 동시 401 폭주 시 한 번만 갱신하도록 한다. */
let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    try {
      const res = await fetch(config.apiOrigin + '/api/v1/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': generateIdempotencyKey(),
        },
        body: JSON.stringify({ refresh_token: refreshToken } satisfies Schemas['RefreshTokenRequest']),
      });
      if (!res.ok) {
        clearTokens();
        return false;
      }
      const tokens = (await res.json()) as Schemas['TokenPair'];
      setTokens(tokens);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // 폴백 (구형 환경)
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

interface RawRequest {
  method: string;
  path: string;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  idempotencyKey?: string;
}

async function request<T>(req: RawRequest, allowRefresh = true): Promise<T> {
  const url = buildUrl(req.path, req.params, req.query);
  const method = req.method.toUpperCase();
  const headers: Record<string, string> = { ...req.headers };

  const accessToken = getAccessToken();
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const hasBody = req.body !== undefined;
  if (hasBody) headers['Content-Type'] = 'application/json';

  if (MUTATION_METHODS.has(method)) {
    headers['Idempotency-Key'] = req.idempotencyKey ?? generateIdempotencyKey();
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: hasBody ? JSON.stringify(req.body) : undefined,
      signal: req.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError({
      status: 0,
      code: NETWORK_ERROR_CODE,
      message: '서버에 연결할 수 없습니다. 네트워크를 확인해주세요.',
    });
  }

  const requestId = res.headers.get(REQUEST_ID_HEADER);

  // 401 → 토큰 갱신 후 1회 재시도 (refresh 엔드포인트 자체는 제외)
  if (res.status === 401 && allowRefresh && !req.path.endsWith('/auth/refresh')) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      // 동일 멱등키로 재시도(서버가 중복 처리하지 않도록)
      return request<T>({ ...req, idempotencyKey: headers['Idempotency-Key'] }, false);
    }
  }

  const body = await parseBody(res);
  if (!res.ok) {
    throw ApiError.fromResponse(res.status, body, requestId);
  }
  return body as T;
}

/** 메서드별 호출 시그니처를 만들어 주는 팩토리 */
function makeMethod<M extends 'get' | 'post' | 'put' | 'patch' | 'delete'>(method: M) {
  return <P extends PathsWithMethod<M>>(
    path: P,
    ...args: MaybeOptions<Operation<P, M>>
  ): Promise<SuccessResponse<Operation<P, M>>> => {
    const options = (args[0] ?? {}) as {
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
      body?: unknown;
      headers?: Record<string, string>;
      signal?: AbortSignal;
      idempotencyKey?: string;
    };
    return request<SuccessResponse<Operation<P, M>>>({
      method,
      path: path as string,
      params: options.params,
      query: options.query,
      body: options.body,
      headers: options.headers,
      signal: options.signal,
      idempotencyKey: options.idempotencyKey,
    });
  };
}

export const apiClient = {
  get: makeMethod('get'),
  post: makeMethod('post'),
  put: makeMethod('put'),
  patch: makeMethod('patch'),
  delete: makeMethod('delete'),
};

/** 커서 기반 목록 응답의 공통 형태 */
export interface CursorPage {
  next_cursor?: string | null;
  has_next?: boolean;
}

/**
 * 커서 페이지네이션을 끝까지 따라가며 모든 항목을 모은다.
 * fetchPage는 cursor를 받아 { data, page } 형태를 반환해야 한다.
 */
export async function collectAll<T>(
  fetchPage: (cursor?: string) => Promise<{ data: T[]; page?: CursorPage }>,
  maxPages = 50,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i += 1) {
    const { data, page } = await fetchPage(cursor);
    all.push(...data);
    const next = page?.next_cursor;
    if (!next || page?.has_next === false) break;
    cursor = next;
  }
  return all;
}
