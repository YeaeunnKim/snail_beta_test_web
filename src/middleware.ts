/**
 * 라우트 가드 미들웨어.
 *
 * presence 쿠키(snail_owner_authed)로 빠르게 분기한다:
 *  - 미인증인데 (dashboard) 접근 → /login
 *  - 인증 상태인데 (auth) 접근   → /dashboard
 *
 * 실제 권한 검증은 API의 401/403으로 강제되며, 이 미들웨어는 UX 리다이렉트용이다.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const AUTHED_COOKIE = 'snail_owner_authed';
const AUTH_PAGES = ['/login', '/register', '/password-reset'];
// 로그인이 필요한(미인증 시 /login 으로) 경로들. 승인 여부 분기는 클라이언트(useAuth)가 담당.
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/business-verification',
  '/pending',
  '/onboarding',
  // 로그인한 사장님만 쓴다(현재 비밀번호를 확인하므로). AUTH_PAGES 에는 넣지 않는다 —
  // 넣으면 임시 비밀번호로 들어온 사람이 이 화면을 열자마자 대시보드로 튕긴다.
  '/password-change',
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isAuthed = req.cookies.get(AUTHED_COOKIE)?.value === '1';
  const isAuthPage = AUTH_PAGES.some((p) => pathname.startsWith(p));
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  if (isProtected && !isAuthed) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthPage && isAuthed) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // 정적 파일/이미지/_next는 제외
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
