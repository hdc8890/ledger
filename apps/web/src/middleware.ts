import { NextResponse } from 'next/server';
import { auth } from '@/auth';

// Routes that do not require authentication. A path matches when it equals a
// prefix exactly or sits beneath it (prefix + '/').
const PUBLIC_PREFIXES = [
  '/sign-in',
  '/~offline',
  '/api/auth',
  '/api/plaid/webhook',
  '/api/inngest',
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default auth((request) => {
  if (isPublicRoute(request.nextUrl.pathname)) return;
  if (request.auth) return;

  const signInUrl = new URL('/sign-in', request.nextUrl.origin);
  return NextResponse.redirect(signInUrl);
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
