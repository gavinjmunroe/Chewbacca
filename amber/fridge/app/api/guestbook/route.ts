import { appendFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { isCompletePhone, phoneDigits } from "@/lib/fridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * THE GUEST JOURNAL'S DRAFT STORE. Never the production waitlist.
 *
 * A signature (pen strokes in page coordinates) and a cell number come in,
 * are validated here, and go to one of two places: GUESTBOOK_WEBHOOK_URL if
 * it is set, or a JSON-lines file (GUESTBOOK_FILE, default /tmp/amber-guestbook.jsonl)
 * if not. This route never calls Karthik's backend and never logs the number.
 *
 * Nothing here proves the visitor owns the number, so every entry is stored
 * with `verified: false`. Whoever imports these must get a reply from the
 * number (an opt-in text) before Amber messages it again.
 */

const point = z.object({
  x: z.number().min(-0.5).max(1.5),
  y: z.number().min(-0.5).max(1.5),
  t: z.number().min(0).max(600_000),
  p: z.number().min(0).max(1),
});

// A signature is a few strokes of a few hundred points. The caps stop a
// scripted client from storing megabytes per request; they are guessed, and
// sit above anything a hand produces. Journal.tsx thins to the same limits.
const MAX_POINTS_TOTAL = 1200;
const schema = z.object({
  strokes: z
    .array(z.array(point).min(1).max(1000))
    .max(40)
    .refine(
      (all) => all.reduce((n, s) => n + s.length, 0) <= MAX_POINTS_TOTAL,
      "Signature too long",
    ),
  phone: z
    .string()
    .trim()
    .max(20)
    .refine(isCompletePhone, "A US cell number with all ten digits"),
});

const WEBHOOK_TIMEOUT_MS = 8_000;

// 1200 points serialise to about 55KB. Guessed from the point format,
// never measured against a real hand.
const MAX_BODY_BYTES = 64 * 1024;

// The draft store stops taking entries past this size rather than filling
// the disk: about 900 entries at the body cap, far more at real sizes.
// Someone determined can still fill it from many addresses and lock real
// signers out; that needs a bot check (Turnstile) and SMS opt-in before
// launch, both listed in docs/FRIDGE-SPEC.md. A draft store accepts that.
const MAX_FILE_BYTES = 50 * 1024 * 1024;

// How many proxies sit in front of the app and append to X-Forwarded-For.
// The client can write anything to the left of what they add, so the
// address is read that many hops from the right. Railway runs one edge
// proxy; unconfirmed until the draft is deployed and a request is logged.
const TRUSTED_PROXY_HOPS = Math.max(
  1,
  Number(process.env.TRUSTED_PROXY_HOPS ?? "1") || 1,
);

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const hops = fwd.split(",").map((h) => h.trim()).filter(Boolean);
    const ip = hops[hops.length - TRUSTED_PROXY_HOPS];
    if (ip) return ip;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

async function readCappedBody(req: NextRequest): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

type Entry = {
  at: string;
  verified: false;
  phone: string;
  strokes: z.infer<typeof schema>["strokes"];
};

// One JSON object per line, appended. Appends of a line this size don't
// interleave, and nothing ever rewrites the old entries.
async function appendToFile(file: string, entry: Entry): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  try {
    const { size } = await stat(file);
    if (size > MAX_FILE_BYTES) throw new Error("guestbook file is full");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await appendFile(file, `${JSON.stringify(entry)}\n`);
}

export async function POST(req: NextRequest) {
  const limit = checkRateLimit(`guestbook:${clientIp(req)}`);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many entries from this connection" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const raw = await readCappedBody(req);
  if (raw === null) {
    return NextResponse.json({ error: "Entry too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid entry" }, { status: 400 });
  }

  const entry: Entry = {
    at: new Date().toISOString(),
    verified: false,
    phone: `+1${phoneDigits(parsed.data.phone)}`,
    strokes: parsed.data.strokes,
  };

  const webhook = process.env.GUESTBOOK_WEBHOOK_URL?.trim();
  try {
    if (webhook) {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(entry),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`webhook answered ${res.status}`);
    } else {
      await appendToFile(
        process.env.GUESTBOOK_FILE ?? "/tmp/amber-guestbook.jsonl",
        entry,
      );
    }
  } catch (err) {
    // The reason only; the entry (and its number) stays out of the log.
    console.error(
      "[guestbook] could not store an entry:",
      err instanceof Error ? err.message : "unknown error",
    );
    return NextResponse.json({ error: "Could not save" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
