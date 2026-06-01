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
const AUTH_PAGES = ['/login', '/signup', '/password-reset'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isAuthed = req.cookies.get(AUTHED_COOKIE)?.value === '1';
  const isAuthPage = AUTH_PAGES.some((p) => pathname.startsWith(p));
  const isDashboard = pathname.startsWith('/dashboard');

  if (isDashboard && !isAuthed) {
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
