import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware - Currently bypassed for development
 *
 * FUTURE: This will integrate with Amber ID for authentication
 * Amber will be the single auth layer for both consumer and B2B apps
 */
export function middleware(request: NextRequest) {
  // TODO: Add Amber ID authentication here
  // For now, allow all requests to pass through
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
