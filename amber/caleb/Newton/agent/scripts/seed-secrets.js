#!/usr/bin/env node
/**
 * One-time migration: seed per-user secrets into amber-id's /v1/secrets store
 * from current Railway env vars.
 *
 * Run this ONCE after SECRETS_MASTER_KEY is set on amber-id and deployed.
 *
 *   AMBER_ID_API_URL=https://amber-id-production.up.railway.app \
 *   AMBER_ID_API_KEY=... \
 *   CALEB_DID=did:privy:... \
 *   SAGAR_DID=did:privy:cmobxrpvr00ml0cjp5gq5mdyd \
 *   COMPOSIO_API_KEY=... \
 *   TODOIST_API_KEY=... \
 *   [OTHER_KEYS...] \
 *   node scripts/seed-secrets.js
 *
 * Sagar's DID is scaffolded with null placeholders — he fills in his own
 * values later by POSTing to /v1/secrets/:did.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const {
  AMBER_ID_API_URL,
  AMBER_ID_API_KEY,
  CALEB_DID,
  SAGAR_DID,
} = process.env;

// Default to dry-run because this script writes API keys (Composio,
// Todoist, GitHub PATs, Google OAuth tokens) into amber-id's secrets
// store. A misconfigured run could clobber a working production tenant
// or stuff scaffolding placeholders over real secrets. Operators must
// pass APPLY=1 to actually write.
const APPLY = process.env.APPLY === "1";
const DRY_RUN = !APPLY;

if (!AMBER_ID_API_URL || !AMBER_ID_API_KEY) {
  console.error("AMBER_ID_API_URL and AMBER_ID_API_KEY required");
  process.exit(1);
}

if (DRY_RUN) {
  console.log(
    "DRY-RUN (default). Re-run with APPLY=1 to write secrets to amber-id.",
  );
} else {
  console.log("APPLY=1 set — writing secrets to amber-id for real.");
}

// Keys to migrate per user. null-valued keys become scaffold placeholders.
const PER_USER_KEYS = [
  "COMPOSIO_API_KEY",
  "COMPOSIO_ENTITY_ID",
  "TODOIST_API_KEY",
  "GITHUB_PAT",
  "LINKEDIN_ACCESS_TOKEN",
  "VERCEL_API_TOKEN",
  "YOUTUBE_API_KEY",
  "PERPLEXITY_API_KEY",
  "GOOGLE_OAUTH_ACCESS_TOKEN",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
];

function readEnvRecord() {
  const record = {};
  for (const k of PER_USER_KEYS) {
    if (process.env[k]) record[k] = process.env[k];
  }
  return record;
}

async function upsert(did, record, label) {
  if (DRY_RUN) {
    console.log(
      `[${label}] DRY-RUN: would upsert ${Object.keys(record).length} keys → ${did}`,
    );
    console.log(`   keys:`, Object.keys(record).join(", "));
    return;
  }
  const res = await fetch(`${AMBER_ID_API_URL}/v1/secrets/${encodeURIComponent(did)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": AMBER_ID_API_KEY,
      "x-caller": "seed-secrets-script",
    },
    body: JSON.stringify(record),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[${label}] upsert failed:`, res.status, body);
    process.exit(1);
  }
  console.log(`[${label}] upserted ${Object.keys(record).length} keys → ${did}`);
  console.log(`   keys:`, Object.keys(record).join(", "));
}

async function scaffold(did, keys, label) {
  if (DRY_RUN) {
    console.log(`[${label}] DRY-RUN: would scaffold ${keys.length} empty slots → ${did}`);
    return;
  }
  const res = await fetch(
    `${AMBER_ID_API_URL}/v1/secrets/${encodeURIComponent(did)}/scaffold`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": AMBER_ID_API_KEY,
        "x-caller": "seed-secrets-script",
      },
      body: JSON.stringify({ keys }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[${label}] scaffold failed:`, res.status, body);
    process.exit(1);
  }
  console.log(`[${label}] scaffolded ${keys.length} empty slots → ${did}`);
}

async function main() {
  if (CALEB_DID) {
    const record = readEnvRecord();
    if (Object.keys(record).length === 0) {
      console.warn("[caleb] no env vars found; scaffolding empty instead");
      await scaffold(CALEB_DID, PER_USER_KEYS, "caleb");
    } else {
      await upsert(CALEB_DID, record, "caleb");
      // Scaffold any missing keys so the schema is consistent
      const missing = PER_USER_KEYS.filter((k) => !record[k]);
      if (missing.length) await scaffold(CALEB_DID, missing, "caleb-missing");
    }
  } else {
    console.warn("CALEB_DID not set, skipping Caleb seed");
  }

  if (SAGAR_DID) {
    await scaffold(SAGAR_DID, PER_USER_KEYS, "sagar");
  } else {
    console.warn("SAGAR_DID not set, skipping Sagar scaffold");
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
