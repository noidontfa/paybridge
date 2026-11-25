/**
 * The request check for pages (Next 16 calls what used to be `middleware.ts` a
 * `proxy`). A page needs a session: with a live access cookie it passes; when
 * only the refresh cookie is left (the access token lasts 5 minutes) it goes
 * through `/api/auth/refresh` and back; with neither it goes to sign-in.
 *
 * The `/api/...` routes check for themselves (the BFF answers 401
 * `SESSION_EXPIRED`). Mock mode has no sign-in and lets everything through.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { isMockModeEnabled } from '@/mocks/mode';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/server/session-cookies';

const SIGN_IN_PATH = '/sign-in';

export function proxy(request: NextRequest) {
  if (isMockModeEnabled()) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith('/api/')) return NextResponse.next();

  const hasAccess = request.cookies.has(ACCESS_COOKIE);
  const hasRefresh = request.cookies.has(REFRESH_COOKIE);

  if (pathname === SIGN_IN_PATH) {
    return hasAccess ? NextResponse.redirect(new URL('/', request.url)) : NextResponse.next();
  }
  if (hasAccess) return NextResponse.next();
  if (hasRefresh) {
    const refresh = new URL('/api/auth/refresh', request.url);
    refresh.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(refresh);
  }
  return NextResponse.redirect(new URL(SIGN_IN_PATH, request.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
