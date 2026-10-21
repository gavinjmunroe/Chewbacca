import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * WHICH COMMIT IS ACTUALLY SERVING THIS SITE.
 *
 * This exists because of a specific, expensive hour: code was written, tested,
 * committed, pushed, and the platform said "deployed" — and the screen did not
 * change. There was no way to tell, from outside, whether the build had
 * actually picked up the last two commits, whether a layer cache had served a
 * stale source copy, or whether a browser was holding old chunks. Every one of
 * those looks identical from a refreshed page, and the only honest answer
 * anybody could give was "try a hard reload".
 *
 * One endpoint ends that. Open it and you know the exact commit the running
 * container was built from. If it does not match what you pushed, the problem
 * is the deploy; if it does, the problem is in front of you and worth
 * debugging.
 *
 * NOTHING SENSITIVE. A commit SHA of a private repo is not a secret, and the
 * build timestamp is visible in any deploy log. No variables are echoed.
 *
 * RAILWAY_GIT_COMMIT_SHA is injected by the platform at build time, so unlike
 * a NEXT_PUBLIC_* value it is genuinely present when this runs — and unlike a
 * value read at request time, it is frozen into the image, which is exactly
 * the property wanted: it describes the BUILD, not the current configuration.
 */
export async function GET() {
  const sha =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    null;

  return NextResponse.json(
    {
      service: "amber-website",
      commit: sha,
      shortCommit: sha ? sha.slice(0, 7) : null,
      branch: process.env.RAILWAY_GIT_BRANCH || null,
      message: process.env.RAILWAY_GIT_COMMIT_MESSAGE || null,
      // Baked at build time by next.config, so it moves only when the image is
      // rebuilt. A timestamp read at request time would just say "now" and
      // tell you nothing about whether the build is current.
      builtAt: process.env.NEXT_PUBLIC_BUILD_TIME || null,
      deployedAt: process.env.RAILWAY_DEPLOYMENT_ID || null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
