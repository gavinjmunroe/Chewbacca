/**
 * One connection research result, as network rows (migration 0049).
 *
 * The same facts the connection pipeline stores in result_json, with the client
 * taken out: who each person is, where they work now, every job a source puts
 * them in, and who was found in a buyer seat. Pure, so the mapping can be
 * tested without BigQuery; src/network/store.ts writes what this returns.
 *
 * The rules match the client pipeline (src/connections/results.ts), so the
 * network never knows something a client's paths would have refused:
 *   - a past job with no source URL is left out;
 *   - a person with no name is left out;
 *   - a buyer is placed on the client's sheet when it can be, so the org they
 *     sit in carries the sheet's domain rather than whatever the model wrote.
 */

import crypto from "crypto";
import type { ConnectionItemRow } from "../connections/store";
import type { ConnectionResultPayload } from "../connections/types";
import {
  matchEmployer,
  normalizeOrgName,
  registrableDomain,
  type TargetAccount,
} from "../connections/targets";

export const RESEARCH_METHOD = "perplexity_computer";

export interface NetworkOrg {
  org_id: string;
  name: string;
  name_normalized: string;
  domain: string | null;
  org_type: string | null;
  segment: string | null;
}

export interface NetworkPerson {
  person_id: string;
  full_name: string;
  linkedin_url: string | null;
  linkedin_slug: string | null;
  email: string | null;
  email_source: string | null;
  current_title: string | null;
  current_org_id: string | null;
  current_org_name: string | null;
  location: string | null;
  persona: string | null;
  history_complete: boolean;
  identity_confirmed: boolean | null;
  researched: boolean;
}

export type Evidence = "career_history" | "current_role" | "client_supplied";

export interface NetworkJob {
  employment_id: string;
  person_id: string;
  org_id: string;
  org_name_as_sourced: string;
  org_domain: string | null;
  title: string | null;
  start_year: number | null;
  end_year: number | null;
  is_current: boolean | null;
  source_url: string | null;
  evidence: Evidence;
}

export interface NetworkRun {
  research_id: string;
  row_id: string;
  client_id: string | null;
  subject_person_id: string;
  subject_org_id: string | null;
  colleague_ids: string[];
  buyer_ids: string[];
  buyer_org_ids: string[];
  identity_confirmed: boolean | null;
  people_found: number;
  jobs_found: number;
}

export interface NetworkRecords {
  clientId: string | null;
  researchId: string;
  observedAt: string;
  orgs: NetworkOrg[];
  people: NetworkPerson[];
  jobs: NetworkJob[];
  run: NetworkRun;
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** "https://www.linkedin.com/in/Jane-Doe-12ab/?x=1" -> "jane-doe-12ab". */
export function linkedinSlug(url: string | null | undefined): string | null {
  const m = (url ?? "").match(/linkedin\.com\/(?:in|pub)\/([^/?#\s]+)/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).toLowerCase();
  } catch {
    return m[1].toLowerCase();
  }
}

/** d:<domain> when the domain is known, else n:<normalized name>. */
export function orgId(name: string | null | undefined, domain: string | null | undefined): string | null {
  const d = registrableDomain(domain).domain;
  if (d) return `d:${d}`;
  const n = normalizeOrgName(name);
  return n ? `n:${n}` : null;
}

/** person_id: li:<slug> when the LinkedIn URL is known, else n:<name>@<org_id>. */
export function personKey(name: string, linkedin: string | null, org: string | null): string {
  const slug = linkedinSlug(linkedin);
  if (slug) return `li:${slug}`;
  const n = name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return `n:${n}@${org ?? "unknown"}`;
}

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * How a result was produced, when it is not a full research run.
 *
 * A top-up (src/network/reuse.ts) researched only new colleagues and buyer
 * seats. Its subject was not researched again, so recording them as researched
 * would restart their freshness clock on facts that are a year old; and the
 * colleagues already known still belong in the run, or the next reuse would
 * see only the new ones.
 */
export interface RecordOptions {
  subjectResearched?: boolean;
  priorColleagueIds?: string[];
}

export function buildNetworkRecords(
  row: ConnectionItemRow,
  result: ConnectionResultPayload,
  targets: TargetAccount[] | null,
  observedAt: Date = new Date(),
  opts: RecordOptions = {},
): NetworkRecords {
  const subjectResearched = opts.subjectResearched ?? true;
  const orgs = new Map<string, NetworkOrg>();
  const people = new Map<string, NetworkPerson>();
  const jobs = new Map<string, NetworkJob>();

  /** Register an org, preferring the client's sheet for its name and domain. */
  const addOrg = (name: string | null, domain: string | null): NetworkOrg | null => {
    const sheet = targets && name ? matchEmployer({ company: name, company_domain: domain }, targets) : null;
    // A sheet row pointing inside a bigger company (cognizant.com/.../trizetto)
    // only proves the parent's domain, so it does not lend its domain here.
    const sheetDomain = sheet && !sheet.target.domainHasPath ? sheet.target.domain : null;
    const finalDomain = registrableDomain(domain).domain ?? sheetDomain;
    const finalName = clean(name) ?? sheet?.target.account ?? finalDomain;
    const id = orgId(finalName, finalDomain);
    if (!id || !finalName) return null;
    const prior = orgs.get(id);
    if (prior) {
      prior.domain ??= finalDomain;
      prior.segment ??= sheet?.target.segment ?? null;
      prior.org_type ??= sheet?.target.type ?? null;
      return prior;
    }
    const org: NetworkOrg = {
      org_id: id,
      name: finalName,
      name_normalized: normalizeOrgName(finalName),
      domain: finalDomain,
      org_type: sheet?.target.type ?? null,
      segment: sheet?.target.segment ?? null,
    };
    orgs.set(id, org);
    return org;
  };

  const addPerson = (p: Omit<NetworkPerson, "person_id" | "linkedin_slug">): NetworkPerson => {
    const id = personKey(p.full_name, p.linkedin_url, p.current_org_id);
    const prior = people.get(id);
    if (prior) {
      // The same person reported twice (as "self" and as a colleague, say):
      // keep what either said, and the stronger claim on history.
      for (const k of Object.keys(p) as Array<keyof typeof p>) {
        if (prior[k] == null && p[k] != null) (prior as unknown as Record<string, unknown>)[k] = p[k];
      }
      prior.history_complete ||= p.history_complete;
      prior.researched ||= p.researched;
      return prior;
    }
    const person: NetworkPerson = { ...p, person_id: id, linkedin_slug: linkedinSlug(p.linkedin_url) };
    people.set(id, person);
    return person;
  };

  const addJob = (j: Omit<NetworkJob, "employment_id">) => {
    const id = sha([j.person_id, j.org_id, (j.title ?? "").toLowerCase().trim(), j.start_year ?? ""].join("|"));
    const prior = jobs.get(id);
    if (prior) {
      prior.end_year ??= j.end_year;
      prior.source_url ??= j.source_url;
      prior.is_current ??= j.is_current;
      return;
    }
    jobs.set(id, { ...j, employment_id: id });
  };

  // ── The person Clay sent, at the customer, as the client knows them ──────
  const customer = addOrg(row.person_company, row.person_company_domain);
  const self = (result.people ?? []).find((p) => p.relation?.trim().toLowerCase() === "self");
  const subject = addPerson({
    full_name: row.person_name.trim(),
    linkedin_url: clean(row.person_linkedin) ?? clean(self?.linkedin_url),
    email: clean(row.person_email),
    email_source: clean(row.person_email) ? "client_supplied" : null,
    current_title: clean(row.person_title) ?? clean(self?.title),
    current_org_id: customer?.org_id ?? null,
    current_org_name: customer?.name ?? null,
    location: clean(row.person_location),
    persona: null,
    history_complete: subjectResearched,
    identity_confirmed: result.identity_confirmed ?? null,
    researched: subjectResearched,
  });
  if (customer) {
    addJob({
      person_id: subject.person_id,
      org_id: customer.org_id,
      org_name_as_sourced: row.person_company,
      org_domain: customer.domain,
      title: subject.current_title,
      start_year: null,
      end_year: null,
      is_current: true,
      source_url: clean(self?.source_url),
      evidence: "client_supplied",
    });
  }

  // ── Everyone Perplexity researched: the subject and their colleagues ─────
  const colleagueIds: string[] = [...(opts.priorColleagueIds ?? [])];
  for (const p of result.people ?? []) {
    const name = clean(p.name);
    if (!name) continue;
    const isSelf = p === self;
    const person = isSelf
      ? subject
      : addPerson({
          full_name: name,
          linkedin_url: clean(p.linkedin_url),
          email: null,
          email_source: null,
          current_title: clean(p.title),
          current_org_id: customer?.org_id ?? null,
          current_org_name: customer?.name ?? null,
          location: null,
          persona: null,
          history_complete: true,
          identity_confirmed: null,
          researched: true,
        });
    if (!isSelf) {
      colleagueIds.push(person.person_id);
      if (customer) {
        addJob({
          person_id: person.person_id,
          org_id: customer.org_id,
          org_name_as_sourced: row.person_company,
          org_domain: customer.domain,
          title: person.current_title,
          start_year: null,
          end_year: null,
          is_current: true,
          source_url: clean(p.source_url),
          evidence: "current_role",
        });
      }
    }
    for (const role of p.roles ?? []) {
      const source = clean(role.source_url);
      if (!role.company || !source) continue;
      const org = addOrg(role.company, role.company_domain);
      if (!org) continue;
      addJob({
        person_id: person.person_id,
        org_id: org.org_id,
        org_name_as_sourced: role.company,
        org_domain: registrableDomain(role.company_domain).domain,
        title: role.title,
        start_year: role.start_year,
        end_year: role.end_year,
        is_current: null,
        source_url: source,
        evidence: "career_history",
      });
    }
  }

  // ── Buyers: placed in their seat today, history not researched ───────────
  const buyerIds: string[] = [];
  const buyerOrgIds = new Set<string>();
  for (const c of result.target_contacts ?? []) {
    const source = clean(c.source_url);
    if (!c.name || !source) continue;
    const org = addOrg(c.target_account, c.target_domain);
    if (!org) continue;
    buyerOrgIds.add(org.org_id);
    const person = addPerson({
      full_name: c.name,
      linkedin_url: clean(c.linkedin_url),
      email: null,
      email_source: null,
      current_title: clean(c.title),
      current_org_id: org.org_id,
      current_org_name: org.name,
      location: null,
      persona: clean(c.persona),
      history_complete: false,
      identity_confirmed: null,
      researched: false,
    });
    buyerIds.push(person.person_id);
    addJob({
      person_id: person.person_id,
      org_id: org.org_id,
      org_name_as_sourced: c.target_account ?? org.name,
      org_domain: org.domain,
      title: person.current_title,
      start_year: c.joined_year,
      end_year: null,
      is_current: true,
      source_url: source,
      evidence: "current_role",
    });
  }

  const jobList = [...jobs.values()];
  return {
    clientId: row.client_id,
    researchId: row.id,
    observedAt: observedAt.toISOString(),
    orgs: [...orgs.values()],
    people: [...people.values()],
    jobs: jobList,
    run: {
      research_id: row.id,
      row_id: row.row_id,
      client_id: row.client_id,
      subject_person_id: subject.person_id,
      subject_org_id: customer?.org_id ?? null,
      colleague_ids: [...new Set(colleagueIds)],
      buyer_ids: [...new Set(buyerIds)],
      buyer_org_ids: [...buyerOrgIds],
      identity_confirmed: result.identity_confirmed ?? null,
      people_found: people.size,
      jobs_found: jobList.filter((j) => j.evidence === "career_history").length,
    },
  };
}
