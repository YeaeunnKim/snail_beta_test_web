/**
 * openapi-typescript가 생성한 `paths` / `components`에서
 * 요청·응답·파라미터 타입을 추출하는 유틸리티 타입 모음.
 *
 * 이 파일 덕분에 API 클라이언트와 서비스 레이어가 OpenAPI 스펙과
 * 100% 동기화된 타입으로 동작한다. (스펙이 바뀌면 `pnpm generate:types` 후
 * 타입 에러로 드러난다.)
 */
import type { paths, components } from './api';

/** 컴포넌트 스키마 단축 접근: Schemas['ShopMe'] 형태로 사용 */
export type Schemas = components['schemas'];

export type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'patch';

/** 특정 HTTP 메서드를 실제로 가진 path 키만 추출 */
export type PathsWithMethod<M extends HttpMethod> = {
  [P in keyof paths]: paths[P] extends { [K in M]: infer Op }
    ? Op extends undefined | never
      ? never
      : P
    : never;
}[keyof paths];

/** path + method → operation 객체 */
export type Operation<P extends keyof paths, M extends HttpMethod> = M extends keyof paths[P]
  ? paths[P][M]
  : never;

type JsonContent<T> = T extends { content: { 'application/json': infer C } } ? C : never;

/** 2xx 성공 응답의 JSON 본문 타입 (204 등 본문 없으면 never) */
export type SuccessResponse<O> = O extends { responses: infer R }
  ? JsonContent<R[Extract<keyof R, 200 | 201 | 202 | 203 | 204>]>
  : never;

/** 요청 본문(application/json) 타입 */
export type RequestBody<O> = O extends { requestBody?: { content: { 'application/json': infer B } } }
  ? B
  : never;

/** requestBody가 필수인지 여부 */
export type HasRequiredBody<O> = O extends { requestBody: { content: unknown } } ? true : false;

type Parameters<O> = O extends { parameters: infer P } ? P : never;

/** query 파라미터 타입 (없으면 never) */
export type QueryParams<O> = Parameters<O> extends { query?: infer Q }
  ? Q extends undefined | never
    ? never
    : Q
  : never;

/** path 파라미터 타입 (없으면 never) */
export type PathParams<O> = Parameters<O> extends { path?: infer P }
  ? P extends undefined | never
    ? never
    : P
  : never;

/** path에 path 파라미터가 필수로 존재하는지 */
export type HasPathParams<O> = [PathParams<O>] extends [never] ? false : true;

/** path에 query 파라미터가 존재하는지 */
export type HasQuery<O> = [QueryParams<O>] extends [never] ? false : true;
