/**
 * Turning what Perplexity found into paths, and handing them to Clay.
 *
 * A full path has four people-shaped stops: the customer contact Clay sent,
 * the bridge (them, or a colleague) who used to work at a target account, the
 * target account, and the person in the buyer seat there today. Connections
 * are the first three; target contacts are the last.
 */

import { createLogger } from "../observability/logger";
import type { ConnectionItemRow } from "./store";
import type { ConnectionResultPayload } from "./types";
import {
  findTargetByAccount,
  isSameOrganization,
  matchEmployer,
  type TargetAccount,
} from "./targets";

const logger = createLogger("connections/results");

/**
 * One former employer of the person or a colleague that is on the target
 * list. Flat, because each one becomes a row in a Clay table.
 *
 * `match` says how sure that is: domain and name were checked by Togari
 * against the sheet; parent_domain matched only the domain of a sheet row
 * that points at part of a larger organization; model_only means Perplexity
 * named the row and Togari could not confirm it — worth a look, not an ask.
 */
export interface Connection {
  bridge_name: string;
  bridge_title: string | null;
  bridge_relation: "self" | "colleague";
  bridge_linkedin: string | null;
  bridge_source_url: string | null;
  former_employer: string;
  former_employer_domain: string | null;
  former_title: string | null;
  start_year: number | null;
  end_year: number | null;
  role_source_url: string;
  target_account: string;
  target_segment: string | null;
  target_type: string | null;
  target_domain: string | null;
  match: "domain" | "parent_domain" | "name" | "model_only";
  model_match_basis: string | null;
}

/**
 * Every reported job on the target list, matched by Togari, plus the ones only
 * Perplexity matched, labelled as such.
 *
 * Dropped, deliberately:
 *   - a role with no source URL: no citation, no connection;
 *   - a match on the customer itself, which is where everyone works now, not
 *     a former employer (three of Serif's customers are also on its list);
 *   - a target Perplexity named that is not on the sheet at all.
 */
export function buildConnections(
  row: ConnectionItemRow,
  result: ConnectionResultPayload,
  targets: TargetAccount[],
): Connection[] {
  const out: Connection[] = [];
  const seen = new Set<string>();

  for (const person of result.people ?? []) {
    const name = person.name?.trim();
    if (!name) continue;
    const relation = person.relation?.trim().toLowerCase() === "self" ? "self" : "colleague";

    for (const role of person.roles ?? []) {
      const source = role.source_url?.trim();
      if (!role.company || !source) continue;

      const checked = matchEmployer(role, targets);
      let target = checked?.target ?? null;
      let match: Connection["match"] | null = checked?.basis ?? null;
      if (!target) {
        target = findTargetByAccount(role.target_account, targets);
        if (target) match = "model_only";
      }
      if (!target || !match) continue;
      if (isSameOrganization(target, row.person_company, row.person_company_domain)) continue;

      const key = `${name.toLowerCase()}|${target.account}|${role.company.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        bridge_name: name,
        bridge_title: person.title ?? null,
        bridge_relation: relation,
        bridge_linkedin: person.linkedin_url ?? null,
        bridge_source_url: person.source_url ?? null,
        former_employer: role.company,
        former_employer_domain: role.company_domain ?? null,
        former_title: role.title,
        start_year: role.start_year,
        end_year: role.end_year,
        role_source_url: source,
        target_account: target.account,
        target_segment: target.segment,
        target_type: target.type,
        target_domain: target.domainRaw,
        match,
        model_match_basis: role.match_basis,
      });
    }
  }
  return out;
}

/**
 * Did Perplexity read the whole list? Null when either side is unknown.
 *
 * The failure this catches is the nasty one: a truncated read reports success
 * and simply finds fewer matches. Togari's own matching does not depend on
 * Perplexity's read, so a short read costs recall on model_only hints, not
 * correctness — but it is worth seeing.
 */
export function listReadOk(read: number | null | undefined, expected: number | null): boolean | null {
  if (read == null || expected == null || expected === 0) return null;
  return read >= Math.floor(expected * 0.9);
}

/** Someone in a buyer seat at a target account today: where a path ends. */
export interface TargetContact {
  name: string;
  title: string | null;
  persona: string | null;
  linkedin_url: string | null;
  source_url: string;
  joined_year: number | null;
}

/**
 * The buyer-seat people Perplexity found, keyed by the sheet's Account value.
 *
 * Placed on the sheet the same way employers are — domain first, then exact
 * name — so "Tenet Healthcare" with tenethealth.com still lands on the row
 * "Tenet". Someone with no source, or at an organization not on the sheet, is
 * dropped.
 */
export function collectTargetContacts(
  result: ConnectionResultPayload,
  targets: TargetAccount[],
): Map<string, TargetContact[]> {
  const byAccount = new Map<string, TargetContact[]>();
  for (const c of result.target_contacts ?? []) {
    const source = c.source_url?.trim();
    if (!c.name || !source) continue;
    const placed = matchEmployer(
      { company: c.target_account ?? "", company_domain: c.target_domain },
      targets,
    );
    if (!placed) continue;
    const list = byAccount.get(placed.target.account) ?? [];
    if (list.some((x) => x.name.toLowerCase() === c.name!.toLowerCase())) continue;
    list.push({
      name: c.name,
      title: c.title,
      persona: c.persona,
      linkedin_url: c.linkedin_url,
      source_url: source,
      joined_year: c.joined_year,
    });
    byAccount.set(placed.target.account, list);
  }
  return byAccount;
}

export type TenureOverlap = "yes" | "possible" | "no" | "unknown";

/**
 * Were the bridge and the target contact at the target at the same time?
 *
 * Worked out here from the years Perplexity reported, not asked of the model:
 * a model asked whether two people overlapped tends to say "likely", and
 * "likely" is how an AE ends up asking a customer about a relationship that
 * never existed. The contact still works there, so their stint runs from
 * joined_year to now; the bridge's ran from start_year to end_year.
 *
 *   yes       they shared at least one full calendar year
 *   possible  the contact joined the year the bridge left
 *   no        the contact joined after the bridge had gone
 *   unknown   a year is missing, which is never upgraded to a guess
 *
 * Overlapping says they were in the same building, not that they met.
 */
export function tenureOverlap(
  bridge: { start_year: number | null; end_year: number | null },
  joinedYear: number | null,
): { overlap: TenureOverlap; years: number | null } {
  if (bridge.end_year == null || joinedYear == null) return { overlap: "unknown", years: null };
  if (joinedYear > bridge.end_year) return { overlap: "no", years: null };
  if (joinedYear === bridge.end_year) return { overlap: "possible", years: 0 };
  // With no start year the overlap is certain but its length is not.
  const years =
    bridge.start_year == null ? null : bridge.end_year - Math.max(bridge.start_year, joinedYear);
  return { overlap: "yes", years };
}

/** Each connection with the people found at its target, as stored in BigQuery. */
export function withTargetContacts(
  connections: Connection[],
  contacts: Map<string, TargetContact[]>,
): Array<Connection & { target_contacts: TargetContact[] }> {
  return connections.map((c) => ({ ...c, target_contacts: peopleAt(c, contacts) }));
}

/** The fields every Clay row carries, whether or not it has a connection. */
function personFields(
  row: ConnectionItemRow,
  result: ConnectionResultPayload,
  expected: number | null,
  found: number,
  pathsFound: number,
) {
  return {
    client_id: row.client_id,
    person_row_id: row.row_id,
    person_name: row.person_name,
    person_title: row.person_title,
    person_company: row.person_company,
    person_company_domain: row.person_company_domain,
    person_email: row.person_email,
    connections_found: found,
    // Connections that reach a named person at the target.
    paths_found: pathsFound,
    identity_confirmed: result.identity_confirmed ?? null,
    target_rows_read: result.target_rows_read ?? null,
    target_rows_expected: expected,
    list_read_ok: listReadOk(result.target_rows_read, expected),
    notes: result.notes ?? null,
  };
}

/** The target-contact columns of a row with nobody found at the target. */
const NO_TARGET_CONTACT = {
  target_contact_name: null,
  target_contact_title: null,
  target_contact_persona: null,
  target_contact_linkedin: null,
  target_contact_source_url: null,
  target_contact_joined_year: null,
  tenure_overlap: null,
  overlap_years: null,
};

/**
 * The people a connection's path can end at. The bridge works at the customer
 * now, so finding them in a buyer seat at the target is a mix-up, not a path
 * to themselves.
 */
function peopleAt(c: Connection, contacts: Map<string, TargetContact[]>): TargetContact[] {
  return (contacts.get(c.target_account) ?? []).filter(
    (p) => p.name.toLowerCase() !== c.bridge_name.toLowerCase(),
  );
}

/**
 * The rows for the Clay table, one per path.
 *
 *   - A connection with people found at its target: one row per person, so
 *     each row reads end to end, customer contact to buyer.
 *   - A connection with nobody found at its target: one row, with the
 *     target_contact columns empty. Still worth having — the bridge is real
 *     even when the buyer seat is not public.
 *   - No connections at all: one row saying so, so a person who came back
 *     empty is distinguishable from one still being researched.
 *
 * Every row carries every column, null where empty, so Clay's columns line up.
 */
export function clayRows(
  row: ConnectionItemRow,
  result: ConnectionResultPayload,
  connections: Connection[],
  expected: number | null,
  contacts: Map<string, TargetContact[]> = new Map(),
): Record<string, unknown>[] {
  const pathsFound = connections.reduce((n, c) => n + peopleAt(c, contacts).length, 0);
  const base = personFields(row, result, expected, connections.length, pathsFound);
  if (connections.length === 0) return [{ ...base, ...NO_TARGET_CONTACT, target_contacts_found: 0 }];

  const rows: Record<string, unknown>[] = [];
  for (const c of connections) {
    const people = peopleAt(c, contacts);
    if (people.length === 0) {
      rows.push({ ...base, ...c, ...NO_TARGET_CONTACT, target_contacts_found: 0 });
      continue;
    }
    for (const p of people) {
      const { overlap, years } = tenureOverlap(c, p.joined_year);
      rows.push({
        ...base,
        ...c,
        target_contact_name: p.name,
        target_contact_title: p.title,
        target_contact_persona: p.persona,
        target_contact_linkedin: p.linkedin_url,
        target_contact_source_url: p.source_url,
        target_contact_joined_year: p.joined_year,
        tenure_overlap: overlap,
        overlap_years: years,
        target_contacts_found: people.length,
      });
    }
  }
  return rows;
}

/**
 * POST each row to the client's Clay webhook table. Returns how many Clay
 * accepted. Never throws: by the time this runs the result is already saved,
 * and an error here must not make Perplexity retry paid work.
 */
export async function postToClay(url: string, rows: Record<string, unknown>[]): Promise<number> {
  let posted = 0;
  for (const body of rows) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        posted++;
      } else {
        const text = await res.text().catch(() => "");
        logger.error(
          "connections.clay.rejected",
          new Error(`Clay answered ${res.status}: ${text.slice(0, 200)}`),
          { personRowId: body.person_row_id, target: body.target_account ?? null },
        );
      }
    } catch (err) {
      logger.error(
        "connections.clay.failed",
        err instanceof Error ? err : new Error(String(err)),
        { personRowId: body.person_row_id, target: body.target_account ?? null },
      );
    }
  }
  return posted;
}
