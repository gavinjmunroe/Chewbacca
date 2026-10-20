/**
 * scripts/preflight-network-check.ts
 *
 * Day-0 contract probe for the connection_network/ Python service.
 *
 * The 48N enrichment orchestrator (Tab B + Karthik's Day-2 work) needs to call
 * /network/check before queueing a contact into TOF channels (Smartlead /
 * HeyReach / Retell). The expected response shape is:
 *
 *   {
 *     in_network:        boolean,        // does BMA already have a relationship?
 *     is_dnc:            boolean,        // do-not-contact flag
 *     last_contacted_at: string | null,  // ISO timestamp
 *     relationship_type: 'cold' | 'warm' | 'existing_customer' | null,
 *   }
 *
 * This script POSTs a sample contact, asserts every field is present and
 * correctly typed, and reports any drift. Run BEFORE Karthik wires the
 * orchestrator into the resolver/dialer flow on Day 2.
 *
 * USAGE:
 *   NETWORK_CHECK_URL=https://connection-network-staging.run.app \
 *   AUTH0_TOKEN=eyJhbGc... \
 *     npx tsx scripts/preflight-network-check.ts
 *
 * Optional:
 *   NETWORK_CHECK_TIMEOUT_MS=5000  (default)
 *   FIXTURE=email|linkedin|phone   (default: runs all three)
 */

interface NetworkCheckResponse {
  in_network: boolean;
  is_dnc: boolean;
  last_contacted_at: string | null;
  relationship_type: "cold" | "warm" | "existing_customer" | null;
}

interface NetworkCheckRequest {
  email?: string;
  linkedin_url?: string;
  phone?: string;
}

const FIXTURES: Record<string, NetworkCheckRequest> = {
  email: { email: "kevin@bluemodernadvisory.com" },
  linkedin: { linkedin_url: "https://www.linkedin.com/in/kevin-newton-bma" },
  phone: { phone: "+1-310-555-0100" },
};

const RELATIONSHIP_TYPES = ["cold", "warm", "existing_customer"] as const;

interface FieldCheckResult {
  field: keyof NetworkCheckResponse;
  ok: boolean;
  message: string;
}

function validateResponse(payload: unknown): FieldCheckResult[] {
  const results: FieldCheckResult[] = [];
  const obj = (payload ?? {}) as Record<string, unknown>;

  results.push({
    field: "in_network",
    ok: typeof obj.in_network === "boolean",
    message:
      typeof obj.in_network === "boolean"
        ? "boolean"
        : `expected boolean, got ${typeof obj.in_network}`,
  });

  results.push({
    field: "is_dnc",
    ok: typeof obj.is_dnc === "boolean",
    message:
      typeof obj.is_dnc === "boolean"
        ? "boolean"
        : `expected boolean, got ${typeof obj.is_dnc}`,
  });

  const lc = obj.last_contacted_at;
  const lcOk =
    lc === null || (typeof lc === "string" && !Number.isNaN(Date.parse(lc)));
  results.push({
    field: "last_contacted_at",
    ok: lcOk,
    message: lcOk
      ? `null or ISO string (${lc ?? "null"})`
      : `expected null or ISO string, got ${typeof lc}: ${String(lc).slice(0, 60)}`,
  });

  const rt = obj.relationship_type;
  const rtOk =
    rt === null ||
    (typeof rt === "string" &&
      (RELATIONSHIP_TYPES as readonly string[]).includes(rt));
  results.push({
    field: "relationship_type",
    ok: rtOk,
    message: rtOk
      ? `null or one of ${RELATIONSHIP_TYPES.join("|")} (${rt ?? "null"})`
      : `expected null or ${RELATIONSHIP_TYPES.join("|")}, got ${String(rt).slice(0, 60)}`,
  });

  return results;
}

async function probe(
  baseUrl: string,
  token: string,
  body: NetworkCheckRequest,
  timeoutMs: number,
): Promise<{ status: number; body: unknown; latencyMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/network/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - start;
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = await res.text();
    }
    return { status: res.status, body: parsed, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const baseUrl = process.env.NETWORK_CHECK_URL;
  const token = process.env.AUTH0_TOKEN;
  const timeoutMs = Number.parseInt(
    process.env.NETWORK_CHECK_TIMEOUT_MS ?? "5000",
    10,
  );
  const fixtureFilter = process.env.FIXTURE;

  if (!baseUrl) {
    console.error("FAIL: NETWORK_CHECK_URL env var is required");
    console.error(
      "  Example: NETWORK_CHECK_URL=https://connection-network-staging.run.app",
    );
    process.exit(1);
  }
  if (!token) {
    console.error(
      "FAIL: AUTH0_TOKEN env var is required (Bearer token for the connection_network audience)",
    );
    process.exit(1);
  }

  const fixturesToRun = fixtureFilter
    ? { [fixtureFilter]: FIXTURES[fixtureFilter] }
    : FIXTURES;
  if (fixtureFilter && !FIXTURES[fixtureFilter]) {
    console.error(
      `FAIL: unknown FIXTURE "${fixtureFilter}". Choose: ${Object.keys(FIXTURES).join(", ")}`,
    );
    process.exit(1);
  }

  console.log(`preflight: ${baseUrl}/network/check`);
  console.log(`timeout:   ${timeoutMs}ms`);
  console.log("");

  let driftCount = 0;
  let probeFailures = 0;

  for (const [name, body] of Object.entries(fixturesToRun)) {
    console.log(`── fixture: ${name} ──`);
    console.log(`  request: ${JSON.stringify(body)}`);
    try {
      const {
        status,
        body: payload,
        latencyMs,
      } = await probe(baseUrl, token, body, timeoutMs);
      console.log(`  status:  ${status} (${latencyMs}ms)`);

      if (status >= 400) {
        console.log(`  body:    ${JSON.stringify(payload).slice(0, 200)}`);
        console.log("  result:  PROBE FAILED — non-2xx response");
        probeFailures++;
        console.log("");
        continue;
      }

      const checks = validateResponse(payload);
      let fixtureDrift = 0;
      for (const check of checks) {
        const marker = check.ok ? "OK " : "XX ";
        console.log(`  ${marker} ${check.field}: ${check.message}`);
        if (!check.ok) fixtureDrift++;
      }
      driftCount += fixtureDrift;
      console.log(
        `  result:  ${fixtureDrift === 0 ? "CONTRACT OK" : `CONTRACT DRIFT (${fixtureDrift} field${fixtureDrift === 1 ? "" : "s"})`}`,
      );
    } catch (err) {
      console.log(`  result:  PROBE FAILED — ${(err as Error).message}`);
      probeFailures++;
    }
    console.log("");
  }

  console.log("─────────────────────────────");
  console.log(`fixtures probed: ${Object.keys(fixturesToRun).length}`);
  console.log(`probe failures:  ${probeFailures}`);
  console.log(`field drift:     ${driftCount}`);

  if (probeFailures > 0 || driftCount > 0) {
    console.log("");
    console.log(
      "NEXT: file an issue against connection_network. The orchestrator",
    );
    console.log("cannot ship until /network/check returns the four documented");
    console.log("fields with the documented types.");
    process.exit(probeFailures > 0 ? 2 : 3);
  }

  console.log("");
  console.log(
    "all fixtures pass. orchestrator can call /network/check safely.",
  );
}

main().catch((err) => {
  console.error("unexpected error:", err);
  process.exit(99);
});
