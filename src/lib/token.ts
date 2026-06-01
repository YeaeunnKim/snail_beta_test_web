/**
 * 토큰 저장소 (클라이언트 전용).
 *
 * - access_token / refresh_token 을 localStorage에 보관한다.
 * - 미들웨어(서버)에서 로그인 여부만 빠르게 판별할 수 있도록
 *   httpOnly가 아닌 presence 쿠키(`snail_owner_authed`)도 함께 둔다.
 *   (실제 권한 검증은 항상 백엔드 401 응답으로 강제된다.)
 *
 * NOTE: 보안을 더 강화하려면 추후 refresh_token을 httpOnly 쿠키로 옮기고
 * BFF(route handler)에서 갱신하도록 바꾸는 것을 권장한다. 지금은 팀이
 * 빠르게 붙일 수 있는 클라이언트 토큰 방식을 기본으로 한다.
 */
import type { Schemas } from '@/types/api-helpers';
import { config } from './config';

type TokenPair = Schemas['TokenPair'];

const ACCESS_KEY = 'snail.owner.access_token';
const REFRESH_KEY = 'snail.owner.refresh_token';
const AUTHED_COOKIE = 'snail_owner_authed';

/** localStorage 접근 불가(SSR/프라이빗 모드) 시에도 안전하게 동작하도록 in-memory 폴백 */
let memoryAccess: string | null = null;
let memoryRefresh: string | null = null;

function safeGet(key: string): string | null {
  if (!config.isBrowser) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (!config.isBrowser) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 무시: in-memory 폴백 사용 */
  }
}

function safeRemove(key: string): void {
  if (!config.isBrowser) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* 무시 */
  }
}

function setAuthedCookie(authed: boolean): void {
  if (!config.isBrowser) return;
  if (authed) {
    // 30일. 미들웨어 redirect 용도이며 토큰 값 자체는 담지 않는다.
    document.cookie = `${AUTHED_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
  } else {
    document.cookie = `${AUTHED_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  }
}

export function getAccessToken(): string | null {
  return safeGet(ACCESS_KEY) ?? memoryAccess;
}

export function getRefreshToken(): string | null {
  return safeGet(REFRESH_KEY) ?? memoryRefresh;
}

export function setTokens(tokens: TokenPair): void {
  memoryAccess = tokens.access_token;
  memoryRefresh = tokens.refresh_token;
  safeSet(ACCESS_KEY, tokens.access_token);
  safeSet(REFRESH_KEY, tokens.refresh_token);
  setAuthedCookie(true);
}

export function clearTokens(): void {
  memoryAccess = null;
  memoryRefresh = null;
  safeRemove(ACCESS_KEY);
  safeRemove(REFRESH_KEY);
  setAuthedCookie(false);
}

export function hasTokens(): boolean {
  return getAccessToken() !== null;
}

export const AUTHED_COOKIE_NAME = AUTHED_COOKIE;
