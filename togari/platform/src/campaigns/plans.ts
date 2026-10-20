/**
 * Conferences added on the campaign calendar (migration 0047): a name and the
 * days its outreach should run. Maggie, 2026-10-14: a button on the calendar
 * to add a conference, with the campaign name being the conference and the
 * dates the campaign should start and end.
 *
 * A conference gives its dates to every campaign named after it ("AVBCC"
 * covers "AVBCC Sequence 1" and "AVBCC sequence 2"), drawn dashed beyond the
 * days they actually sent. With no campaign of that name yet, it gets a bar of
 * its own, so a conference shows on the calendar before anything is built.
 *
 * Anyone with the client's calendar link can add or remove one. Removing only
 * stamps removed_at, so a mistaken removal can be put back from BigQuery.
 */
import crypto from "crypto";
import { BigQueryClient } from "../bigquery/client";
import { resolveDataset } from "../services/dataset-resolver";
import type { CampaignSpan } from "./calendar";

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const T = () => `\`${PROJECT_ID}.${resolveDataset()}.calendar_plans\``;

export interface Plan {
  id: string;
  name: string;
  start: string;
  end: string;
}

const MAX_NAME = 120;
// A conference push longer than a year is a typo in the year.
const MAX_DAYS = 366;

function bq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

/** A conference from the form, or what's wrong with it in words for the form. */
export function readPlan(
  body: unknown,
): { name: string; start: string; end: string } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = String(b.name ?? "").replace(/\s+/g, " ").trim();
  const start = String(b.start ?? "").trim();
  const end = String(b.end ?? "").trim();
  if (!name) return { error: "Give the conference a name." };
  if (name.length > MAX_NAME)
    return { error: `Keep the name under ${MAX_NAME} characters.` };
  const ok = (d: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
  if (!ok(start) || !ok(end)) return { error: "Pick a start and an end date." };
  if (end < start) return { error: "The end date is before the start date." };
  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
  if (days > MAX_DAYS) return { error: "That's over a year. Check the dates." };
  return { name, start, end };
}

export async function listPlans(clientId: string): Promise<Plan[]> {
  const { rows } = await bq().executeQuery(
    `SELECT plan_id, name, CAST(start_date AS STRING) AS start_day, CAST(end_date AS STRING) AS end_day
       FROM ${T()}
      WHERE client_id = @clientId AND removed_at IS NULL
      ORDER BY start_date, name`,
    { clientId },
  );
  return (rows as any[]).map((r) => ({
    id: String(r.plan_id),
    name: String(r.name),
    start: String(r.start_day),
    end: String(r.end_day),
  }));
}

export async function addPlan(
  clientId: string,
  plan: { name: string; start: string; end: string },
): Promise<string> {
  const id = crypto.randomUUID();
  await bq().executeWrite(
    `INSERT INTO ${T()} (plan_id, client_id, name, start_date, end_date, created_at)
     VALUES (@id, @clientId, @name, DATE(@start), DATE(@end), CURRENT_TIMESTAMP())`,
    { id, clientId, name: plan.name, start: plan.start, end: plan.end },
  );
  return id;
}

/** True when a conference was there to remove. */
export async function removePlan(
  clientId: string,
  id: string,
): Promise<boolean> {
  const res = await bq().executeWrite(
    `UPDATE ${T()} SET removed_at = CURRENT_TIMESTAMP()
      WHERE client_id = @clientId AND plan_id = @id AND removed_at IS NULL`,
    { clientId, id },
  );
  return Number(res.numDmlAffectedRows ?? "0") > 0;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Whether a campaign is named after the conference: the same name, or it plus more. */
export function namedAfter(campaign: string, conference: string): boolean {
  const c = norm(campaign);
  const p = norm(conference);
  return p !== "" && (c === p || c.startsWith(`${p} `));
}

/**
 * Give each conference's dates to the campaigns named after it, and a bar of
 * its own to any conference no campaign is named after.
 */
export function applyPlans(
  campaigns: CampaignSpan[],
  plans: Plan[],
): CampaignSpan[] {
  const out = campaigns.map((c) => ({ ...c }));
  for (const p of plans) {
    const matched = out.filter(
      (c) => c.channel !== "plan" && namedAfter(c.name, p.name),
    );
    for (const c of matched) {
      c.planned_start = p.start;
      c.planned_end = p.end;
    }
    if (!matched.length) {
      out.push({
        id: `plan:${p.id}`,
        name: p.name,
        channel: "plan",
        first_send: null,
        last_send: null,
        planned_start: p.start,
        planned_end: p.end,
      });
    }
  }
  return out;
}
