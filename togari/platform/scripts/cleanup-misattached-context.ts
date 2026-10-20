/**
 * One-time cleanup of duplicate / misattached context rows created by the
 * pre-dedup daily refresh (2026-07-25..27), scoped to brand `bma` and the two
 * clients called out in the bug report:
 *
 *   spinach_records_425af0 — 12 misfiled Fireflies rows (BMA Daily Standup ×8,
 *     Amber Stand Up ×4) + 4 duplicate calendar rows ("College Apps w/ Sagar",
 *     a personal event that matched Spinach only via the gmail.com domain).
 *   freedom_c5624c — 9 duplicate Fireflies rows for the "Freedom <> Blue
 *     Modern Advisory Intro" meeting (two Fireflies transcript ids).
 *
 * Actions (per group: keep ONE row per source_ref, delete the rest):
 *   - BMA Daily Standup rows   -> keep 1 per transcript, move to blue_modern_advisory_c5d8f0
 *   - Amber Stand Up rows      -> keep 1, move to a NEW "Amber" internal client
 *   - College Apps w/ Sagar    -> keep 1, detach (personal event, no client)
 *   - Freedom intro rows       -> keep 1 per transcript, stay on freedom_c5624c
 *   - blue_modern_advisory_c5d8f0 gets primary_domain=bluemodernadvisory.com
 *     so the new internal-meeting routing can find it.
 *   - kept rows get their occurred_at corrected to the real meeting time
 *     (taken from the meeting DateString embedded in the row content).
 *
 * All context_ids below were verified against live data on 2026-07-27 via
 * scripts/inspect-misattached-context.ts. The script re-verifies every id
 * before writing and aborts if the data has drifted.
 *
 * Usage:
 *   set -a; source .env; set +a
 *   npx tsx scripts/cleanup-misattached-context.ts            # dry run
 *   npx tsx scripts/cleanup-misattached-context.ts --apply    # execute
 */
/* eslint-disable no-console */

import crypto from "crypto";
import { BigQueryClient } from "../src/bigquery/client";

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DATASET = "togari_data_lake";
const BRAND = "bma";
const t = (name: string) => `\`${PROJECT_ID}.${DATASET}.${name}\``;

const APPLY = process.argv.includes("--apply");

const BMA_CLIENT = "blue_modern_advisory_c5d8f0";

interface Group {
  label: string;
  sourceRef: string;
  keep: string; // context_id to keep
  delete: string[]; // context_ids to delete
  moveTo?: string | null | "AMBER"; // undefined = leave attachment as is;
  //                                   null = detach; "AMBER" = new client
  occurredAt?: string; // corrected meeting time for the kept row
  title?: string; // corrected title for the kept row
}

const GROUPS: Group[] = [
  // freedom_c5624c — same intro meeting, two Fireflies transcripts
  {
    label: "Freedom <> BMA Intro (transcript 01KY8GC…)",
    sourceRef: "01KY8GCBJE8K76EM31CRBRS74Y",
    keep: "ctx_fa9f690093cc",
    delete: [
      "ctx_f1bdcdac8bc1",
      "ctx_4c34a22d16ff",
      "ctx_a89c6039dbb9",
      "ctx_068968a6cacc",
      // 10th copy of the same transcript, stored unattached (found by the
      // dry-run's post-state sweep on source_ref).
      "ctx_f62133076655",
    ],
    occurredAt: "2026-07-24T15:00:00Z",
  },
  {
    label: "Freedom <> BMA Intro (transcript 01KYAAD…)",
    sourceRef: "01KYAADMXXG80F3V06ZGEAHAFP",
    keep: "ctx_8735a004c0c4",
    delete: ["ctx_4781c53c93ba", "ctx_a68201fd4ecb", "ctx_c806699ad135"],
    occurredAt: "2026-07-24T15:00:00Z",
  },
  // spinach_records_425af0 — internal standups misfiled by the fallback
  {
    label: "BMA Daily Standup (transcript 01KXQ7M…)",
    sourceRef: "01KXQ7MNR9VWZ0J0WWG4Q420ZX",
    keep: "ctx_721dca2cda07",
    delete: ["ctx_99d100fadd73", "ctx_981fbbcf6a25", "ctx_761cfcea9b80"],
    moveTo: BMA_CLIENT,
    occurredAt: "2026-07-24T16:00:00Z",
  },
  {
    label: "BMA Daily Standup (transcript 01KYADV…)",
    sourceRef: "01KYADVY3WSDY5TTYTQ6D3WASM",
    keep: "ctx_a34519908c7d",
    delete: ["ctx_11686796a993", "ctx_17ee8e31eaaf", "ctx_f252a7073a97"],
    moveTo: BMA_CLIENT,
    occurredAt: "2026-07-24T16:03:16Z",
  },
  {
    label: "Amber Stand Up",
    sourceRef: "01KYAG9MNB9DBAPBJGXBCYQZZR",
    keep: "ctx_9806cb48c075",
    delete: ["ctx_f91182044f13", "ctx_b98622f051e3", "ctx_33b4e57366a4"],
    moveTo: "AMBER",
    occurredAt: "2026-07-24T16:45:43Z",
  },
  {
    label: "College Apps w/ Sagar (personal calendar event)",
    sourceRef: "31b918sgot1it78a9nj59m181f",
    keep: "ctx_698662d2b4d9",
    delete: ["ctx_e59d977d15f5", "ctx_5b07cd9e0019", "ctx_d14b124401ac"],
    moveTo: null,
    title: "Calendar: College Apps w/ Sagar",
  },
];

const bq = new BigQueryClient(
  PROJECT_ID,
  null,
  process.env.GCP_CREDENTIALS_BASE64 ||
    process.env.GOOGLE_CREDENTIALS_BASE64 ||
    null,
);

async function verifyGroups(): Promise<void> {
  const allIds = GROUPS.flatMap((g) => [g.keep, ...g.delete]);
  const params: Record<string, unknown> = { brand: BRAND };
  const inList = allIds.map((id, i) => {
    params[`id${i}`] = id;
    return `@id${i}`;
  });
  const { rows } = await bq.executeQuery(
    `SELECT context_id, client_id, source_ref FROM ${t("client_context")}
      WHERE client_brand = @brand AND context_id IN (${inList.join(",")})`,
    params,
  );
  const byId = new Map(rows.map((r) => [r.context_id as string, r]));
  const problems: string[] = [];
  for (const g of GROUPS) {
    for (const id of [g.keep, ...g.delete]) {
      const row = byId.get(id);
      if (!row) {
        problems.push(`${g.label}: ${id} not found`);
      } else if (row.source_ref !== g.sourceRef) {
        problems.push(
          `${g.label}: ${id} has source_ref ${row.source_ref}, expected ${g.sourceRef}`,
        );
      }
    }
  }
  if (problems.length) {
    console.error("Data drifted since inspection — aborting:\n" + problems.join("\n"));
    process.exit(1);
  }
  console.log(`Verified ${allIds.length} context rows match the plan.`);
}

async function ensureAmberClient(): Promise<string> {
  const { rows } = await bq.executeQuery(
    `SELECT client_id FROM ${t("clients")}
      WHERE client_brand = @brand AND LOWER(name) = 'amber' LIMIT 1`,
    { brand: BRAND },
  );
  if (rows.length) {
    console.log(`Amber client already exists: ${rows[0].client_id}`);
    return rows[0].client_id as string;
  }
  const clientId = `amber_${crypto.randomBytes(3).toString("hex")}`;
  if (!APPLY) {
    console.log(`[dry-run] would create Amber client ${clientId}`);
    return clientId;
  }
  await bq.executeWrite(
    `INSERT INTO ${t("clients")}
       (client_id, client_brand, name, stage, pipeline, status, summary,
        source, created_at, updated_at)
     VALUES
       (@client_id, @brand, 'Amber', NULL, 'default', 'active',
        @summary, 'cleanup', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
    {
      client_id: clientId,
      brand: BRAND,
      summary:
        "Internal bucket for Amber (BMA's own venture): standup notes and tasks. Not an external client.",
    },
  );
  console.log(`Created Amber client ${clientId}`);
  return clientId;
}

async function main() {
  console.log(APPLY ? "=== APPLY MODE ===" : "=== DRY RUN (pass --apply to execute) ===");
  await verifyGroups();
  const amberId = await ensureAmberClient();

  for (const g of GROUPS) {
    const target = g.moveTo === "AMBER" ? amberId : g.moveTo;
    const sets: string[] = [];
    const params: Record<string, unknown> = { brand: BRAND, keep: g.keep };
    if (g.moveTo !== undefined) {
      sets.push("client_id = @target");
      params.target = target ?? null;
    }
    if (g.occurredAt) {
      sets.push("occurred_at = @occurredAt");
      params.occurredAt = g.occurredAt;
    }
    if (g.title) {
      sets.push("title = @title");
      params.title = g.title;
    }

    console.log(`\n${g.label}`);
    console.log(
      `  keep ${g.keep}` +
        (g.moveTo !== undefined ? ` -> client ${target ?? "(unattached)"}` : "") +
        (g.occurredAt ? `, occurred_at ${g.occurredAt}` : "") +
        (g.title ? `, retitle` : ""),
    );
    console.log(`  delete ${g.delete.join(", ")}`);

    if (!APPLY) continue;

    if (sets.length) {
      await bq.executeWrite(
        `UPDATE ${t("client_context")} SET ${sets.join(", ")}
          WHERE context_id = @keep AND client_brand = @brand`,
        params,
      );
    }
    const delParams: Record<string, unknown> = { brand: BRAND };
    const delList = g.delete.map((id, i) => {
      delParams[`d${i}`] = id;
      return `@d${i}`;
    });
    await bq.executeDelete(
      `DELETE FROM ${t("client_context")}
        WHERE client_brand = @brand AND context_id IN (${delList.join(",")})`,
      delParams,
    );
  }

  // Give the internal client its identity so internal-meeting routing works.
  console.log(
    `\n${BMA_CLIENT}: set primary_domain=bluemodernadvisory.com (was NULL)`,
  );
  if (APPLY) {
    await bq.executeWrite(
      `UPDATE ${t("clients")}
          SET primary_domain = 'bluemodernadvisory.com',
              updated_at = CURRENT_TIMESTAMP()
        WHERE client_id = @clientId AND client_brand = @brand
          AND primary_domain IS NULL`,
      { clientId: BMA_CLIENT, brand: BRAND },
    );
  }

  // Post-state
  const { rows: after } = await bq.executeQuery(
    `SELECT client_id, context_id, source_ref, title, occurred_at
       FROM ${t("client_context")}
      WHERE client_brand = @brand
        AND (client_id IN ('spinach_records_425af0','freedom_c5624c',
                           @amber, '${BMA_CLIENT}')
             OR source_ref IN UNNEST(@refs))
      ORDER BY client_id, source_ref`,
    { brand: BRAND, amber: amberId, refs: GROUPS.map((g) => g.sourceRef) },
  );
  console.log(`\n=== ${APPLY ? "post-apply" : "current"} state of affected rows ===`);
  for (const r of after) {
    console.log(
      `${r.client_id ?? "(unattached)"} | ${r.context_id} | ${r.source_ref} | ${String(r.title).slice(0, 60)}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
