/**
 * Reusing the shared network before paying for research (migration 0049).
 *
 * When a person is dispatched from connection_items, Togari first looks them
 * up in togari_core.network_people. Someone researched in full within the last
 * NETWORK_REUSE_MAX_AGE_DAYS (365) already has every job a source put them in,
 * and so do the colleagues researched with them. Those histories are rebuilt
 * into the shape Perplexity posts (ConnectionResultPayload) and matched
 * against the current client's sheet by the same code a fresh result goes
 * through, so a reused path is held to the same rules as a paid one.
 *
 * What the stored research cannot answer is sent as a smaller top-up task:
 *
 *   - colleagues, when the ones known were found for a client with different
 *     colleague roles (or none were ever searched for);
 *   - buyer seats at matched target accounts no past run searched.
 *
 * When neither is missing the row is finished with no call at all.
 *
 * Three outcomes, recorded on connection_items.research_mode (migration 0050):
 *   reuse  served from the network, no Perplexity call
 *   topup  the network plus a smaller call; the result is merged before matching
 *   full   researched from scratch, as before
 *
 * Any failure reading the network falls back to full research: reuse saves
 * money, it must never be the reason a person is not researched.
 */

import { BigQueryClient } from "../bigquery/client";
import { getReplybotClient } from "../agents/replybot/client-config";
import type { ConnectionItemRow } from "../connections/store";
import type { ConnectionResultPayload, ResultPerson, ResultRole } from "../connections/types";
import { buildConnections } from "../connections/results";
import { matchEmployer, type TargetAccount } from "../connections/targets";
import {
  MAX_CONTACTS_PER_TARGET,
  MAX_TARGETS_WITH_CONTACTS,
  type TopUpRequest,
} from "../connections/task-message";
import { linkedinSlug, orgId, personKey } from "./records";

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DATASET = process.env.NETWORK_DATASET || "togari_core";
const table = (name: string) => `\`${PROJECT_ID}.${DATASET}.${name}\``;

function moduleBq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64 || null,
  );
}

export type ResearchMode = "reuse" | "topup" | "full";

/**
 * How old a stored history may be and still be reused. 0 turns reuse off, so
 * every person is researched in full as before.
 */
export function reuseMaxAgeDays(): number {
  const raw = process.env.NETWORK_REUSE_MAX_AGE_DAYS;
  if (raw === undefined || raw.trim() === "") return 365;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 365;
}

// ── What the network holds ────────────────────────────────────────────────

export interface StoredPerson {
  person_id: string;
  full_name: string;
  linkedin_url: string | null;
  current_title: string | null;
  current_org_id: string | null;
  persona: string | null;
  history_complete: boolean;
  identity_confirmed: boolean | null;
  last_researched_at: string | null;
}

export interface StoredJob {
  person_id: string;
  org_id: string;
  org_name_as_sourced: string | null;
  org_domain: string | null;
  title: string | null;
  start_year: number | null;
  end_year: number | null;
  is_current: boolean | null;
  source_url: string | null;
  evidence: string;
}

export interface StoredRun {
  research_id: string;
  client_id: string | null;
  subject_person_id: string;
  subject_org_id: string | null;
  colleague_ids: string[];
  researched_at: string | null;
}

export interface StoredBuyer {
  person_id: string;
  full_name: string;
  linkedin_url: string | null;
  title: string | null;
  persona: string | null;
  org_id: string;
  joined_year: number | null;
  source_url: string;
}

/**
 * The reads, as one object so tests can replace them. Suppressed people are
 * never returned: an opted-out person is never pathed.
 */
export const networkReader = {
  async findSubject(slug: string | null, ids: string[]): Promise<StoredPerson | null> {
    const { rows } = await moduleBq().executeQuery(
      `SELECT ${PERSON_COLUMNS}
         FROM ${table("network_people")}
        WHERE NOT suppressed
          AND (linkedin_slug = @slug OR person_id IN UNNEST(@ids))
        ORDER BY IF(linkedin_slug = @slug, 0, 1), last_researched_at DESC
        LIMIT 1`,
      { slug: slug ?? "", ids },
    );
    return rows[0] ? toPerson(rows[0]) : null;
  },

  /** The latest run that researched this person, as subject or as colleague. */
  async latestRun(personId: string): Promise<StoredRun | null> {
    const { rows } = await moduleBq().executeQuery(
      `SELECT research_id, client_id, subject_person_id, subject_org_id, colleague_ids,
              researched_at
         FROM ${table("network_research_runs")}
        WHERE subject_person_id = @personId OR @personId IN UNNEST(colleague_ids)
        ORDER BY researched_at DESC
        LIMIT 1`,
      { personId },
    );
    const r = rows[0];
    if (!r) return null;
    return {
      research_id: String(r.research_id),
      client_id: str(r.client_id),
      subject_person_id: String(r.subject_person_id),
      subject_org_id: str(r.subject_org_id),
      colleague_ids: Array.isArray(r.colleague_ids) ? r.colleague_ids.map(String) : [],
      researched_at: ts(r.researched_at),
    };
  },

  async people(ids: string[]): Promise<StoredPerson[]> {
    if (ids.length === 0) return [];
    const { rows } = await moduleBq().executeQuery(
      `SELECT ${PERSON_COLUMNS}
         FROM ${table("network_people")}
        WHERE NOT suppressed AND person_id IN UNNEST(@ids)`,
      { ids },
    );
    return rows.map(toPerson);
  },

  async jobs(ids: string[]): Promise<StoredJob[]> {
    if (ids.length === 0) return [];
    const { rows } = await moduleBq().executeQuery(
      `SELECT person_id, org_id, org_name_as_sourced, org_domain, title,
              start_year, end_year, is_current, source_url, evidence
         FROM ${table("network_employment")}
        WHERE person_id IN UNNEST(@ids)`,
      { ids },
    );
    return rows.map((r) => ({
      person_id: String(r.person_id),
      org_id: String(r.org_id),
      org_name_as_sourced: str(r.org_name_as_sourced),
      org_domain: str(r.org_domain),
      title: str(r.title),
      start_year: num(r.start_year),
      end_year: num(r.end_year),
      is_current: r.is_current == null ? null : Boolean(r.is_current),
      source_url: str(r.source_url),
      evidence: String(r.evidence ?? ""),
    }));
  },

  /** Of these orgs, the ones whose buyer seats a run searched since `since`. */
  async coveredBuyerOrgs(orgIds: string[], since: Date): Promise<string[]> {
    if (orgIds.length === 0) return [];
    const { rows } = await moduleBq().executeQuery(
      `SELECT DISTINCT org_id
         FROM ${table("network_research_runs")}, UNNEST(buyer_org_ids) AS org_id
        WHERE org_id IN UNNEST(@orgIds)
          AND researched_at >= TIMESTAMP(@since)`,
      { orgIds, since: since.toISOString() },
    );
    return rows.map((r) => String(r.org_id));
  },

  /** People a run placed in a buyer seat at these orgs, seen there since `since`. */
  async buyersAt(orgIds: string[], since: Date): Promise<StoredBuyer[]> {
    if (orgIds.length === 0) return [];
    const { rows } = await moduleBq().executeQuery(
      `SELECT p.person_id, p.full_name, p.linkedin_url, p.persona,
              e.title, e.org_id, e.start_year, e.source_url
         FROM ${table("network_employment")} e
         JOIN ${table("network_people")} p USING (person_id)
        WHERE e.org_id IN UNNEST(@orgIds)
          AND e.evidence = 'current_role' AND e.is_current
          AND e.source_url IS NOT NULL
          AND e.last_seen_at >= TIMESTAMP(@since)
          AND NOT p.suppressed
          AND p.person_id IN (
            SELECT b FROM ${table("network_research_runs")}, UNNEST(buyer_ids) AS b
             WHERE researched_at >= TIMESTAMP(@since))
        ORDER BY e.last_seen_at DESC`,
      { orgIds, since: since.toISOString() },
    );
    return rows.map((r) => ({
      person_id: String(r.person_id),
      full_name: String(r.full_name),
      linkedin_url: str(r.linkedin_url),
      title: str(r.title),
      persona: str(r.persona),
      org_id: String(r.org_id),
      joined_year: num(r.start_year),
      source_url: String(r.source_url),
    }));
  },
};

const PERSON_COLUMNS = `person_id, full_name, linkedin_url, current_title, current_org_id, persona,
              history_complete, identity_confirmed, last_researched_at`;

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** BigQuery returns TIMESTAMP as { value: "..." }. */
const ts = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && "value" in (v as object)) return String((v as { value: unknown }).value);
  return String(v);
};

function toPerson(r: Record<string, unknown>): StoredPerson {
  return {
    person_id: String(r.person_id),
    full_name: String(r.full_name ?? ""),
    linkedin_url: str(r.linkedin_url),
    current_title: str(r.current_title),
    current_org_id: str(r.current_org_id),
    persona: str(r.persona),
    history_complete: Boolean(r.history_complete),
    identity_confirmed: r.identity_confirmed == null ? null : Boolean(r.identity_confirmed),
    last_researched_at: ts(r.last_researched_at),
  };
}

// ── The plan ──────────────────────────────────────────────────────────────

interface Reused {
  /** The stored histories, as Perplexity would have posted them. */
  stored: ConnectionResultPayload;
  subjectId: string;
  /** Colleagues whose histories were reused, for the network run of a top-up. */
  colleagueIds: string[];
  researchedAt: string | null;
}

export type ResearchPlan =
  | { mode: "full"; reason: string }
  | ({ mode: "reuse" } & Reused)
  | ({ mode: "topup"; request: TopUpRequest } & Reused);

/** The org ids the network may have filed this name and domain under. */
function orgCandidates(name: string, domain: string | null, targets: TargetAccount[]): string[] {
  const ids = [orgId(name, domain), orgId(name, null)];
  // records.ts lends the sheet's domain to an org the source gave none for.
  const sheet = matchEmployer({ company: name, company_domain: domain }, targets);
  if (sheet && !sheet.target.domainHasPath) ids.push(orgId(name, sheet.target.domain));
  return [...new Set(ids.filter((x): x is string => !!x))];
}

const sameRoles = (a: string[] | undefined, b: string[] | undefined) =>
  !!a && !!b && JSON.stringify(a.map((r) => r.trim().toLowerCase())) ===
    JSON.stringify(b.map((r) => r.trim().toLowerCase()));

function rolesOf(jobs: StoredJob[], personId: string): ResultRole[] {
  return jobs
    .filter((j) => j.person_id === personId && j.evidence === "career_history" && j.source_url)
    .map((j) => ({
      company: j.org_name_as_sourced ?? "",
      company_domain: j.org_domain,
      title: j.title,
      start_year: j.start_year,
      end_year: j.end_year,
      source_url: j.source_url,
      // Togari matches the sheet itself; a model's hint from another client's
      // sheet means nothing here.
      target_account: null,
      match_basis: null,
    }))
    .filter((r) => r.company);
}

function currentSource(jobs: StoredJob[], personId: string, orgIdNow: string | null): string | null {
  return (
    jobs.find(
      (j) => j.person_id === personId && j.org_id === orgIdNow && j.evidence !== "career_history" && j.source_url,
    )?.source_url ?? null
  );
}

/**
 * Decide how to research one row: reuse, top-up, or full. Reads the network;
 * never writes. Throws only on a read failure, which the caller turns into
 * full research.
 */
export async function planResearch(
  row: ConnectionItemRow,
  targets: TargetAccount[],
  now: Date = new Date(),
  reader: typeof networkReader = networkReader,
): Promise<ResearchPlan> {
  const maxAge = reuseMaxAgeDays();
  if (maxAge === 0) return { mode: "full", reason: "reuse is off" };
  const cfg = getReplybotClient(row.client_id ?? "")?.connections;
  if (!cfg) return { mode: "full", reason: "client not set up" };
  const cutoff = new Date(now.getTime() - maxAge * 86400_000);
  const fresh = (p: StoredPerson) =>
    p.history_complete && !!p.last_researched_at && new Date(p.last_researched_at) >= cutoff;

  // ── 1. The person ──────────────────────────────────────────────────────
  const slug = linkedinSlug(row.person_linkedin);
  const ids = [
    ...(slug ? [`li:${slug}`] : []),
    ...orgCandidates(row.person_company, row.person_company_domain, targets).map((o) =>
      personKey(row.person_name.trim(), null, o),
    ),
  ];
  const subject = ids.length > 0 ? await reader.findSubject(slug, ids) : null;
  if (!subject) return { mode: "full", reason: "not in the network" };
  if (!subject.history_complete) return { mode: "full", reason: "history never researched" };
  // A person research could not confirm has no history to reuse; this
  // client's details may be enough to confirm them.
  if (subject.identity_confirmed === false) return { mode: "full", reason: "identity not confirmed" };
  if (!fresh(subject)) return { mode: "full", reason: `researched over ${maxAge} days ago` };

  // ── 2. Their colleagues, from the latest run that researched them ──────
  const run = await reader.latestRun(subject.person_id);
  let colleagueIds: string[] = [];
  if (run?.subject_person_id === subject.person_id) {
    colleagueIds = run.colleague_ids;
  } else if (run && run.subject_org_id && run.subject_org_id === subject.current_org_id) {
    // Researched as someone else's colleague at the same company: that run's
    // subject and other colleagues are their colleagues too.
    colleagueIds = [run.subject_person_id, ...run.colleague_ids];
  }
  colleagueIds = [...new Set(colleagueIds)].filter((id) => id !== subject.person_id);

  const people = await reader.people([subject.person_id, ...colleagueIds]);
  const colleagues = people.filter(
    (p) =>
      p.person_id !== subject.person_id &&
      fresh(p) &&
      (p.current_org_id == null || p.current_org_id === subject.current_org_id),
  );
  const jobs = await reader.jobs([subject.person_id, ...colleagues.map((c) => c.person_id)]);

  const self: ResultPerson = {
    name: row.person_name,
    title: row.person_title ?? subject.current_title,
    relation: "self",
    linkedin_url: row.person_linkedin ?? subject.linkedin_url,
    source_url: currentSource(jobs, subject.person_id, subject.current_org_id),
    roles: rolesOf(jobs, subject.person_id),
  };
  const others: ResultPerson[] = colleagues.map((c) => ({
    name: c.full_name,
    title: c.current_title,
    relation: "colleague",
    linkedin_url: c.linkedin_url,
    source_url: currentSource(jobs, c.person_id, c.current_org_id),
    roles: rolesOf(jobs, c.person_id),
  }));
  const stored: ConnectionResultPayload = {
    row_id: row.row_id,
    identity_confirmed: subject.identity_confirmed,
    people: [self, ...others],
    target_contacts: [],
    notes: `Served from the Togari network (researched ${subject.last_researched_at?.slice(0, 10) ?? "earlier"}).`,
  };

  // ── 3. Buyer seats at the targets those histories match ────────────────
  const connections = buildConnections(row, stored, targets);
  const byAccount = new Map<string, { target: TargetAccount; last: number }>();
  for (const c of connections) {
    const target = targets.find((t) => t.account === c.target_account);
    if (!target) continue;
    // A role with no end year may be current: most recent of all.
    const last = c.end_year ?? Number.MAX_SAFE_INTEGER;
    const prior = byAccount.get(target.account);
    if (!prior || last > prior.last) byAccount.set(target.account, { target, last });
  }
  const matched = [...byAccount.values()]
    .sort((a, b) => b.last - a.last)
    .slice(0, MAX_TARGETS_WITH_CONTACTS)
    .map((m) => m.target);

  const orgIdsByAccount = new Map(
    matched.map((t) => [
      t.account,
      orgCandidates(t.account, t.domainHasPath ? null : t.domain, targets),
    ]),
  );
  const allOrgIds = [...new Set([...orgIdsByAccount.values()].flat())];
  const covered = new Set(await reader.coveredBuyerOrgs(allOrgIds, cutoff));
  const buyers = await reader.buyersAt([...covered], cutoff);

  const coveredTargets: TargetAccount[] = [];
  const missingTargets: TargetAccount[] = [];
  for (const t of matched) {
    const orgs = orgIdsByAccount.get(t.account) ?? [];
    if (!orgs.some((o) => covered.has(o))) {
      missingTargets.push(t);
      continue;
    }
    coveredTargets.push(t);
    const seen = new Set<string>();
    for (const b of buyers) {
      if (!orgs.includes(b.org_id) || seen.has(b.person_id)) continue;
      if (seen.size >= MAX_CONTACTS_PER_TARGET) break;
      seen.add(b.person_id);
      stored.target_contacts!.push({
        target_account: t.account,
        target_domain: t.domain,
        name: b.full_name,
        title: b.title,
        persona: b.persona,
        linkedin_url: b.linkedin_url,
        source_url: b.source_url,
        joined_year: b.joined_year,
      });
    }
  }

  // ── 4. What is missing ─────────────────────────────────────────────────
  // Colleagues are complete only if they were searched for with these roles.
  const runCfg = run ? getReplybotClient(run.client_id ?? "")?.connections : undefined;
  const colleaguesCovered = !!run && sameRoles(runCfg?.colleagueRoles, cfg.colleagueRoles);

  const reused: Reused = {
    stored,
    subjectId: subject.person_id,
    colleagueIds: colleagues.map((c) => c.person_id),
    researchedAt: subject.last_researched_at,
  };
  if (colleaguesCovered && missingTargets.length === 0) return { mode: "reuse", ...reused };
  return {
    mode: "topup",
    ...reused,
    request: {
      colleagues: colleaguesCovered ? null : { known: colleagues.map((c) => c.full_name) },
      buyerTargets: missingTargets.map((t) => ({ account: t.account, domain: t.domain })),
      coveredAccounts: coveredTargets.map((t) => t.account),
      researchedAt: subject.last_researched_at,
    },
  };
}

// ── Merging a top-up into what was stored ─────────────────────────────────

const roleKey = (r: ResultRole) =>
  [r.company.toLowerCase(), (r.title ?? "").toLowerCase(), r.start_year ?? ""].join("|");
const nameKey = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * The stored histories plus what the top-up found, so the paths cover both.
 * A person in both keeps every role either had; a buyer in both is listed once.
 * The top-up's read of the sheet and its notes are the ones reported.
 */
export function mergeResults(
  stored: ConnectionResultPayload,
  topUp: ConnectionResultPayload,
): ConnectionResultPayload {
  const people: ResultPerson[] = (stored.people ?? []).map((p) => ({ ...p, roles: [...(p.roles ?? [])] }));
  for (const p of topUp.people ?? []) {
    const isSelf = p.relation?.trim().toLowerCase() === "self";
    const match = people.find((q) =>
      isSelf ? q.relation === "self" : nameKey(q.name) !== "" && nameKey(q.name) === nameKey(p.name),
    );
    if (!match) {
      people.push(p);
      continue;
    }
    const have = new Set((match.roles ?? []).map(roleKey));
    for (const r of p.roles ?? []) {
      if (!have.has(roleKey(r))) {
        match.roles!.push(r);
        have.add(roleKey(r));
      }
    }
    match.linkedin_url ??= p.linkedin_url;
    match.source_url ??= p.source_url;
  }

  const contacts = [...(stored.target_contacts ?? [])];
  const seen = new Set(contacts.map((c) => `${nameKey(c.target_account)}|${nameKey(c.name)}`));
  for (const c of topUp.target_contacts ?? []) {
    const key = `${nameKey(c.target_account)}|${nameKey(c.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    contacts.push(c);
  }

  return {
    row_id: topUp.row_id,
    target_rows_read: topUp.target_rows_read ?? stored.target_rows_read ?? null,
    identity_confirmed: stored.identity_confirmed ?? topUp.identity_confirmed ?? null,
    people,
    target_contacts: contacts,
    notes: [stored.notes, topUp.notes].filter((n) => n && n.trim()).join(" ") || null,
  };
}
