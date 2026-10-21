#!/usr/bin/env node
/**
 * Register (or update) a tenant in amber-id.
 *
 * amber-id is the source of truth for "which Loop sender belongs to
 * which human". The agent looks tenants up by sender_id on every
 * inbound webhook, so once a tenant is registered here, the agent
 * picks them up automatically — no redeploy.
 *
 * Usage:
 *   AMBER_ID_API_URL=https://amber-id.up.railway.app \
 *   AMBER_ID_API_KEY=... \
 *   node scripts/register-tenant.js \
 *     --name "Sagar Tiwari" \
 *     --phone +15550100003 \
 *     --privyDid did:privy:xxxxxxxx \
 *     --loopSenderId c351f20c-dec0-44b3-8127-55b662e237a6 \
 *     --loopSenderPhone +15550100003
 *
 * You can also pass `--camber` or `--samber` as a preset for the two
 * known tenants; the uuids default to the current production values.
 *
 * Required flags: --privyDid, --phone, --loopSenderId.
 *
 * This writes via amber-id's admin endpoint `/tenants/upsert` (x-api-key auth).
 * If that endpoint is not yet live, the script prints the exact payload
 * so it can be POSTed manually.
 */

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function applyPreset(args) {
  // NOTE: presets were previously swapped. Authoritative values:
  //   Camber (Caleb):  loopSenderId c351f20c-dec0-44b3-8127-55b662e237a6,
  //                    loopSenderPhone +15550100003, owner +15550100002
  //   Samber (Sagar):  loopSenderId 00069c6f-7e7a-4059-a677-a1fdc77d8813,
  //                    loopSenderPhone +15550100005, owner +15550100004
  if (args.camber) {
    args.name ||= "Caleb Newton";
    args.agentName ||= "Camber";
    args.ownerName ||= "Caleb Newton";
    args.loopSenderId ||= "c351f20c-dec0-44b3-8127-55b662e237a6";
    args.loopSenderPhone ||= "+15550100003";
    args.phone ||= "+15550100002";
  }
  if (args.samber) {
    args.name ||= "Sagar Tiwari";
    args.agentName ||= "Samber";
    args.ownerName ||= "Sagar Tiwari";
    args.loopSenderId ||= "00069c6f-7e7a-4059-a677-a1fdc77d8813";
    args.loopSenderPhone ||= "+15550100005";
    args.phone ||= "+15550100004";
  }
  return args;
}

async function main() {
  const args = applyPreset(parseArgs(process.argv));

  const apiUrl = process.env.AMBER_ID_API_URL;
  const apiKey = process.env.AMBER_ID_API_KEY;
  if (!apiUrl || !apiKey) {
    console.error("AMBER_ID_API_URL and AMBER_ID_API_KEY must be set.");
    process.exit(1);
  }

  const missing = ["privyDid", "phone", "loopSenderId"].filter((k) => !args[k]);
  if (missing.length) {
    console.error(`Missing required flags: ${missing.map((k) => "--" + k).join(", ")}`);
    console.error("See header of this script for usage.");
    process.exit(1);
  }

  const body = {
    privyDid: args.privyDid,
    displayName: args.name || "Unknown",
    phoneNumber: args.phone,
    loopSenderId: args.loopSenderId,
    loopSenderPhone: args.loopSenderPhone || args.phone,
    active: true,
  };

  // Default to dry-run since this writes routing config that drives
  // every inbound webhook for this Loop sender. Operators must opt
  // in with APPLY=1 (or the legacy --apply flag) to write for real.
  const apply = process.env.APPLY === "1" || args.apply === true;
  console.log("Upserting tenant in amber-id:");
  console.log(JSON.stringify(body, null, 2));
  if (!apply) {
    console.log(
      "\nDRY-RUN (default). Re-run with APPLY=1 to actually upsert this tenant.",
    );
    return;
  }

  const res = await fetch(`${apiUrl}/tenants/upsert`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`\nFailed: ${res.status}\n${text}`);
    if (res.status === 404) {
      console.error(
        "\namber-id's /tenants/upsert endpoint is not live yet. " +
          "Payload above is what it should accept (x-api-key auth).",
      );
    }
    process.exit(1);
  }

  console.log(`\nOK: ${text}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
