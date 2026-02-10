import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes — no auth required
  if (
    pathname.startsWith('/shared/') ||
    PUBLIC_PATHS.some((p) => pathname.startsWith(p))
  ) {
    return NextResponse.next();
  }

  // Check for access token cookie
  const token = request.cookies.get('access_token')?.value;
  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // TODO: Verify JWT and check role for /admin routes
  // For now, pass through — full auth implementation in Phase 3

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
