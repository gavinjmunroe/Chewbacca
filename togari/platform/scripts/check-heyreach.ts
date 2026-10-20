/**
 * Check a client's HeyReach API key and the field names the campaign calendar
 * reads (src/integrations/heyreach/client.ts), against a live response.
 *
 * Usage:
 *   npx tsx scripts/check-heyreach.ts                       (SERIF_HEYREACH_API_KEY)
 *   npx tsx scripts/check-heyreach.ts ACME_HEYREACH_API_KEY
 *
 * Reads the key from the environment or .env.
 *
 * Read only. Prints each response's keys and one example, with names and
 * message text cut short, then what the calendar made of it. If a number the
 * calendar reads shows as 0 here while HeyReach's dashboard has it, the field
 * name differs: fix the reader in client.ts.
 */
/* eslint-disable no-console */
import {
  conversations,
  dailyStats,
  listCampaigns,
} from "../src/integrations/heyreach/client";
import { loadDotEnv } from "./load-env";

loadDotEnv();
const envName = process.argv[2] || "SERIF_HEYREACH_API_KEY";
const key = process.env[envName];
if (!key) {
  console.error(`Set ${envName} first.`);
  process.exit(1);
}

const API = "https://api.heyreach.io/api/public";
async function raw(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "X-API-KEY": key!, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(`${path}: HTTP ${res.status}`);
  return res.json().catch(() => null);
}

const clip = (v: unknown) =>
  typeof v === "string" && v.length > 24 ? `${v.slice(0, 24)}…` : v;
function shape(label: string, x: any): void {
  if (!x || typeof x !== "object") return void console.log(label, x);
  console.log(label, "keys:", Object.keys(x).join(", "));
  const first = Array.isArray(x) ? x[0] : (x.items ?? x.data)?.[0];
  if (first)
    console.log(
      `${label} first item:`,
      JSON.stringify(first, (_, v) => clip(v), 2).slice(0, 2000),
    );
}

async function main() {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  shape("campaigns", await raw("/campaign/GetAll", { offset: 0, limit: 5 }));
  const campaigns = await listCampaigns(key!);
  console.log(`\nThe calendar sees ${campaigns.length} campaigns:`);
  for (const c of campaigns.slice(0, 20)) console.log(`  ${c.id}  ${c.status}  ${c.name}`);

  const live = campaigns.find((c) => c.status === "IN_PROGRESS") || campaigns[0];
  if (live) {
    const stats = await raw("/stats/GetOverallStats", {
      accountIds: [],
      campaignIds: [Number(live.id)],
      startDate: `${from}T00:00:00.000Z`,
      endDate: `${to}T23:59:59.999Z`,
    });
    shape("\nstats", stats);
    console.log("stats overall:", JSON.stringify(stats?.overallStats ?? stats?.result?.overallStats));
    const days = await dailyStats(key!, live.id, from, to);
    const total = Object.values(days).reduce(
      (t, d) => ({
        requests: t.requests + d.requests,
        accepted: t.accepted + d.accepted,
        messaged: t.messaged + d.messaged,
        replied: t.replied + d.replied,
      }),
      { requests: 0, accepted: 0, messaged: 0, replied: 0 },
    );
    console.log(`The calendar reads, for "${live.name}" over 30 days:`, total);
  }

  if (live) {
    const convoRaw = await raw("/inbox/GetConversationsV2", {
      filters: { campaignIds: [Number(live.id)] },
      offset: 0,
      limit: 5,
    });
    shape("\nconversations", convoRaw);
  }
  let total = 0, leadLast = 0, withText = 0, tagged = 0;
  for (const c of campaigns) {
    const convos = await conversations(key!, c.id, 1);
    total += convos.length;
    leadLast += convos.filter((x) => x.leadWroteLast).length;
    withText += convos.filter((x) => x.leadText).length;
    tagged += convos.filter((x) => x.tag).length;
  }
  console.log(
    `The calendar read ${total} conversations: ${leadLast} where the lead wrote last, ${withText} with the lead's words, ${tagged} tagged by HeyReach.`,
  );
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
