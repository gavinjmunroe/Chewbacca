import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * WHERE THE API LIVES, ANSWERED AT RUNTIME.
 *
 * This exists because NEXT_PUBLIC_AMBER_API could not do the job. Next inlines
 * NEXT_PUBLIC_* into the client bundle during `npm run build`, so on any
 * platform that builds a container and then injects variables into it -- which
 * is most of them, Railway included -- the value is already frozen as the empty
 * string by the time the variable exists. Every API call then goes to this
 * site's own origin, gets this site's own HTML 404, and surfaces as a generic
 * failure while the API logs stay empty.
 *
 * The first attempt at a fix was a build ARG plus a guard that failed the build
 * when it was missing. That made the failure loud, which was right, but it also
 * made every deploy depend on the platform forwarding build arguments, and the
 * deploy that followed failed on exactly that. A correct build cannot be
 * contingent on a build-time channel that may not exist.
 *
 * So the origin is read HERE, per request, from an ordinary server variable.
 * Changing it is a variable edit and a restart -- no rebuild, no build args, no
 * platform-specific behavior to get right.
 *
 * AMBER_API is the variable that matters. NEXT_PUBLIC_AMBER_API is still read
 * as a fallback so an existing build that already has it baked in keeps
 * working; new deployments need only the first.
 *
 * NOTHING SECRET GOES THROUGH HERE. It is one public origin, the same one that
 * would have been visible in the client bundle anyway.
 */
export async function GET() {
  const apiBase =
    process.env.AMBER_API?.trim() ||
    process.env.NEXT_PUBLIC_AMBER_API?.trim() ||
    "";

  return NextResponse.json(
    { apiBase, configured: Boolean(apiBase) },
    // Never cached. The point of reading it at runtime is that it can change.
    { headers: { "cache-control": "no-store" } },
  );
}
