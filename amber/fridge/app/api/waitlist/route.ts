import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * THE WAITLIST ENDPOINT. Validate, drop bots, POST to Clay. That is the whole
 * job, and Clay is the only place a signup goes.
 *
 * The URL comes from CLAY_WEBHOOK_URL and there is no fallback constant. A
 * Clay webhook is an unauthenticated write endpoint -- anyone holding the URL
 * can push arbitrary rows into the table -- so it does not belong in a file
 * that gets committed. If the variable is missing the route says so loudly
 * instead of quietly posting somewhere a previous version hardcoded.
 */

const CLAY_TIMEOUT_MS = 8_000;

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  source: z.string().trim().max(120).optional(),
  // Honeypot: hidden field only a bot fills in
  website: z.string().max(200).optional(),
});

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export async function POST(req: NextRequest) {
  const webhook = process.env.CLAY_WEBHOOK_URL?.trim();
  if (!webhook) {
    console.error("[waitlist] CLAY_WEBHOOK_URL is not set — cannot save signups");
    return NextResponse.json({ error: "Could not save email" }, { status: 500 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  // Honeypot filled means a bot. Report success so it does not retry, but
  // never forward the lead.
  if (parsed.data.website?.trim()) {
    console.warn("[waitlist] honeypot tripped, dropping submission");
    return NextResponse.json({ ok: true });
  }

  const ip = getClientIp(req);
  const rate = checkRateLimit(ip);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  const source =
    parsed.data.source || req.headers.get("referer") || "amberintelligence.ai";

  try {
    const clayRes = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: parsed.data.email,
        name: parsed.data.name ?? null,
        phone: parsed.data.phone ?? null,
        source,
        ip: ip === "unknown" ? null : ip,
        user_agent: req.headers.get("user-agent"),
        submitted_at: new Date().toISOString(),
      }),
      // Clay does not get to hold a visitor's request open indefinitely.
      signal: AbortSignal.timeout(CLAY_TIMEOUT_MS),
    });

    if (!clayRes.ok) {
      /**
       * LOUD, because Clay is the only copy. If the source is deleted, the URL
       * rotated, or a limit hit, this line is the only sign that signups have
       * stopped landing anywhere.
       */
      console.error(`[waitlist] CLAY REFUSED HTTP ${clayRes.status} — signup lost: ${parsed.data.email}`);
      return NextResponse.json({ error: "Could not save email" }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[waitlist] CLAY UNREACHABLE — signup lost: ${parsed.data.email}`, err);
    return NextResponse.json({ error: "Could not save email" }, { status: 502 });
  }
}
