/**
 * scripts/smoke.ts
 *
 * End-to-end smoke test of the Clay-callable dedupe API. Hits every public
 * endpoint with realistic payloads and prints PASS/FAIL per step. Run this
 * after every deploy as a sanity check.
 *
 * Usage:
 *   npx tsx scripts/smoke.ts <base_url> <tgi_live_key>
 *
 * Example:
 *   npx tsx scripts/smoke.ts http://localhost:4100 tgi_live_K3F8H2P9X7Q1M4N6Y2T5W8B0J3D7L9R2
 *   npx tsx scripts/smoke.ts https://togari.bluemodernadvisory.com tgi_live_...
 *
 * Steps:
 *   1. GET  /api/v1/health
 *   2. POST /api/v1/people/match (expect no match for a unique synthetic person)
 *   3. POST /api/v1/people       (create that person)
 *   4. POST /api/v1/people/match (expect match for the same person now)
 *   5. PATCH /api/v1/people/:id  (update title)
 *
 * Exits 0 if all steps pass, 1 otherwise.
 */

interface Step {
  name: string;
  ok: boolean;
  detail: string;
}

async function jsonFetch(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: Record<string, unknown>; raw: string }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { _raw: text };
  }
  return { status: res.status, body, raw: text };
}

async function run(baseUrl: string, key: string): Promise<Step[]> {
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const synthetic = {
    full_name: `Smoke Test ${Date.now()}`,
    first_name: "Smoke",
    last_name: "Test",
    email: `smoke-${Date.now()}@togari-smoke.test`,
  };
  const steps: Step[] = [];

  // 1. Health
  try {
    const r = await jsonFetch(`${baseUrl}/api/v1/health`, { method: "GET" });
    steps.push({
      name: "GET /api/v1/health",
      ok: r.status === 200 && (r.body.ok as boolean) === true,
      detail: `status=${r.status} ok=${r.body.ok} bq=${(r.body.checks as { bigquery: { ok: boolean } } | undefined)?.bigquery?.ok}`,
    });
  } catch (err) {
    steps.push({
      name: "GET /api/v1/health",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
    return steps;
  }

  // 2. Match — expect no hit
  const matchPayload = { name: synthetic.full_name, email: synthetic.email };
  let firstMatch: { status: number; body: Record<string, unknown> };
  try {
    firstMatch = await jsonFetch(`${baseUrl}/api/v1/people/match`, {
      method: "POST",
      headers,
      body: JSON.stringify(matchPayload),
    });
    steps.push({
      name: "POST /api/v1/people/match (expect no match)",
      ok: firstMatch.status === 200 && firstMatch.body.matched === false,
      detail: `status=${firstMatch.status} matched=${firstMatch.body.matched}`,
    });
  } catch (err) {
    steps.push({
      name: "POST /api/v1/people/match",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
    return steps;
  }

  // 3. Create
  let created: { status: number; body: Record<string, unknown> };
  try {
    created = await jsonFetch(`${baseUrl}/api/v1/people`, {
      method: "POST",
      headers,
      body: JSON.stringify(synthetic),
    });
    const c = created.body.contact as Record<string, unknown> | undefined;
    steps.push({
      name: "POST /api/v1/people (create)",
      ok:
        created.status === 201 &&
        typeof c?.contact_id === "string" &&
        typeof c?.is_real_person === "boolean",
      detail: `status=${created.status} contact_id=${c?.contact_id ?? "?"} realness=${c?.realness_score ?? "?"}`,
    });
    if (!c?.contact_id) return steps;
  } catch (err) {
    steps.push({
      name: "POST /api/v1/people",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
    return steps;
  }

  const contactId = (created.body.contact as { contact_id: string }).contact_id;

  // 4. Match again — expect hit
  try {
    const r = await jsonFetch(`${baseUrl}/api/v1/people/match`, {
      method: "POST",
      headers,
      body: JSON.stringify(matchPayload),
    });
    steps.push({
      name: "POST /api/v1/people/match (expect hit after create)",
      ok:
        r.status === 200 &&
        r.body.matched === true &&
        (r.body.contact as { contact_id: string }).contact_id === contactId,
      detail: `status=${r.status} matched=${r.body.matched} matched_on=${r.body.matched_on}`,
    });
  } catch (err) {
    steps.push({
      name: "POST /api/v1/people/match (re-match)",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 5. Patch
  try {
    const r = await jsonFetch(`${baseUrl}/api/v1/people/${contactId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ current_title: "Smoke Test Subject" }),
    });
    const c = r.body.contact as Record<string, unknown> | undefined;
    steps.push({
      name: "PATCH /api/v1/people/:contact_id",
      ok: r.status === 200 && c?.current_title === "Smoke Test Subject",
      detail: `status=${r.status} title=${c?.current_title ?? "?"}`,
    });
  } catch (err) {
    steps.push({
      name: "PATCH /api/v1/people/:contact_id",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  return steps;
}

async function main(): Promise<void> {
  const baseUrl = process.argv[2];
  const key = process.argv[3];
  if (!baseUrl || !key) {
    process.stderr.write(
      "Usage: npx tsx scripts/smoke.ts <base_url> <tgi_live_key>\n",
    );
    process.exit(2);
  }

  process.stdout.write(
    `\nTogari smoke test\n  base: ${baseUrl}\n  key:  ${key.slice(0, 12)}...\n\n`,
  );
  const steps = await run(baseUrl, key);

  let failed = 0;
  for (const s of steps) {
    const marker = s.ok ? "PASS" : "FAIL";
    process.stdout.write(`  [${marker}] ${s.name}\n         ${s.detail}\n`);
    if (!s.ok) failed++;
  }

  process.stdout.write(
    `\n${steps.length - failed}/${steps.length} steps passed\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(
    `Error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
