/**
 * The auth seam's request check (spec, "Auth seam"; Next 16 calls what used to
 * be `middleware.ts` a `proxy`). A no-op in v1: the Console is reached on the
 * internal network only. Real authentication adds its session check here and
 * replaces `src/server/current-operator.ts`.
 */
import { NextResponse, type NextRequest } from 'next/server';

export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
