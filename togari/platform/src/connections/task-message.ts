/**
 * The message Togari sends Perplexity Computer for one person.
 *
 * Built like the reply task (src/perplexity/task-message.ts), and for the same
 * reasons:
 *
 *   1. The method lives in the client's published guide, not here. The guide
 *      is a Google Doc a person can change without a deploy; this message only
 *      points at it and carries the one person to research.
 *   2. The callback token is never in this message. Perplexity keeps a
 *      readable record of every session; the token lives in the project's
 *      credential vault, and connection research runs in the same project as
 *      reply drafting, so the credential already saved there for this host
 *      covers it.
 *   3. The field names are the ones POST /connections/result parses.
 */

import { getReplybotClient } from "../agents/replybot/client-config";
import type { ConnectionItemRow } from "./store";
import { loadTargets } from "./targets";

/** Colleagues researched per person. Each one is more paid searching. */
export const MAX_COLLEAGUES = 8;

/**
 * Matched target accounts whose buyer seats are looked up, per person, and
 * people per account. Bounded for the same reason: every lookup is paid, and
 * a person with a long career can match a dozen accounts.
 */
export const MAX_TARGETS_WITH_CONTACTS = 5;
export const MAX_CONTACTS_PER_TARGET = 3;

function resultEndpoint(): string {
  const base = (
    process.env.TOGARI_PUBLIC_BASE_URL ||
    "https://togari-bma-prod.up.railway.app"
  ).replace(/\/+$/, "");
  return `${base}/connections/result`;
}

export interface ConnectionSources {
  displayName: string;
  guideUrl: string;
  targetsUrl: string;
  clayUrl: string | null;
  colleagueRoles: string[];
  buyerRoles: string[];
}

/**
 * This client's guide, sheet and Clay table, or an error naming what is
 * missing. Never a fallback to another client's: research matched against the
 * wrong client's target list would be confidently, invisibly wrong.
 */
export function connectionSourcesFor(clientId: string): ConnectionSources {
  const client = getReplybotClient(clientId);
  const cfg = client?.connections;
  if (!client || !cfg) {
    throw new Error(`client "${clientId}" is not set up for connection research`);
  }
  const guideUrl = process.env[cfg.guideUrlEnv]?.trim();
  const targetsUrl = process.env[cfg.targetsUrlEnv]?.trim();
  if (!guideUrl) throw new Error(`${cfg.guideUrlEnv} is not set`);
  if (!targetsUrl) throw new Error(`${cfg.targetsUrlEnv} is not set`);
  return {
    displayName: client.displayName,
    guideUrl,
    targetsUrl,
    clayUrl: process.env[cfg.clayUrlEnv]?.trim() || null,
    colleagueRoles: cfg.colleagueRoles,
    buyerRoles: cfg.buyerRoles,
  };
}

/**
 * A role list as numbered-step text: "CEO; COO; ...", wrapped at about 72
 * characters with the step's three-space indent on every line after the first.
 */
function roleLines(lead: string, roles: string[], tail: string): string[] {
  const indent = lead.match(/^\s*/)![0];
  const words = `${lead.trim()} ${roles.join("; ")}${tail}`.split(/\s+/);
  const lines: string[] = [];
  let line = indent;
  for (const w of words) {
    const next = line.trim() ? `${line} ${w}` : `${line}${w}`;
    if (next.length > 72 && line.trim()) {
      lines.push(line);
      line = `   ${w}`;
    } else {
      line = next;
    }
  }
  if (line.trim()) lines.push(line);
  return lines;
}

/** The last two steps of every connection task: the callback, then stop. */
function callbackSteps(step: number, endpoint: string, extra: string[] = []): string[] {
  const host = new URL(endpoint).host;
  return [
    `${step}. POST the result to ${endpoint} as JSON, authenticating with the saved`,
    `   credential for host ${host}. It is already stored in this project's`,
    "   credentials — use it directly. Do NOT open a credential request form:",
    "   nobody is watching this session to approve one, and the request is",
    "   denied, which blocks the whole task.",
    "   Fields, with exactly these names:",
    "     row_id              (use exactly the value given below)",
    "     target_rows_read    how many accounts you read from the sheet",
    "     identity_confirmed  true or false",
    "     people              one entry for the person, one per colleague:",
    "       name, title, relation (self | colleague), linkedin_url,",
    "       source_url (what places them at the company now),",
    "       roles: [ company, company_domain, title, start_year, end_year,",
    "                source_url, target_account, match_basis ]",
    "     target_contacts     one entry per person found in the buyer seat:",
    "       target_account (the sheet's Account value), target_domain, name,",
    "       title, persona (managed_care_contracting | revenue_cycle |",
    "       executive | other), linkedin_url, source_url (what places them",
    "       there now), joined_year",
    "     notes               one line on anything that limited the research",
    ...extra,
    `${step + 1}. Then stop. Do not contact anyone.`,
  ];
}

const NEVER_IMPLY = [
  "Never state or imply that two people know each other. Working at the same",
  "place is all a public source can show. A year no source states is null.",
];

/** Step 3 and 4: every prior employer, and which are on the sheet. */
function historySteps(step: number, who: string): string[] {
  return [
    `${step}. For ${who}, list every prior employer since`,
    "   2005, whether or not it is on the list: the company exactly as the",
    "   source names it, its website domain, title, start year, end year, and",
    "   the source URL for that role. No source URL, leave the role out.",
    "   ALWAYS give the company's website domain. If the role's source does",
    "   not state it, look it up: it describes the company, not the person,",
    "   and it is how the match is checked. Null only if you cannot find one.",
    `${step + 1}. For each prior employer on the list, set target_account to that row's`,
    "   Account value exactly as written in the sheet, and match_basis to",
    "   domain, name, or acquisition. Otherwise target_account is null.",
  ];
}

export function buildConnectionTaskMessage(
  row: ConnectionItemRow,
  sources: ConnectionSources,
  targetCount: number,
): string {
  const endpoint = resultEndpoint();
  const company = row.person_company_domain
    ? `${row.person_company} (${row.person_company_domain})`
    : row.person_company;

  return [
    `You are researching possible warm-introduction paths for ${sources.displayName}.`,
    `One person is given below. Find where they and their senior colleagues used`,
    `to work, which of those employers are on ${sources.displayName}'s target`,
    `account list, and who sits in the buyer seat at those accounts today.`,
    "",
    `First, open and read this document. It defines the method, the roles that`,
    `count, and the rules on sources: ${sources.guideUrl}`,
    "Follow it over your own judgement where the two differ.",
    "",
    `The target account list is a published CSV with ${targetCount} accounts:`,
    sources.targetsUrl,
    "Read all of it. If you can read only part of it, report how many rows you",
    "read. Never fill in the rest from memory.",
    "",
    "Then do this, and stop:",
    "1. Confirm who the person is. A role counts only if a source ties it to",
    "   THIS person, on their current employer plus title or location. If you",
    "   cannot confirm them, set identity_confirmed to false, give them no",
    "   roles, and still do step 2.",
    // The role lists are in the guide too. They are repeated here because a
    // guide that fails to load in full — it has happened — must not change who
    // is researched.
    ...roleLines(
      `2. Find up to ${MAX_COLLEAGUES} people who work at ${row.person_company} NOW in senior roles:`,
      sources.colleagueRoles,
      ".",
    ),
    "   Only people a current public source places there.",
    ...historySteps(3, "the person and each colleague"),
    `5. For each target account you matched (at most ${MAX_TARGETS_WITH_CONTACTS}, the most recent`,
    `   departures first), find up to ${MAX_CONTACTS_PER_TARGET} people who work there NOW in the`,
    ...roleLines("   buyer seat:", sources.buyerRoles, "."),
    "   The document says what to look for at other kinds of organization.",
    "   Only people a current public source places there. For each,",
    "   joined_year is the year they joined that organization (not their",
    "   current role), and only if a source states it.",
    ...callbackSteps(6, endpoint),
    "",
    ...NEVER_IMPLY,
    "",
    ...personBlock(row, company),
    ...(row.work_history
      ? [
          "",
          "What enrichment already found (a starting point, not a source — confirm",
          "anything you report):",
          row.work_history,
        ]
      : []),
  ].join("\n");
}

function personBlock(row: ConnectionItemRow, company: string): string[] {
  return [
    `row_id: ${row.row_id}`,
    "",
    "--- The person ---",
    `Name: ${row.person_name}`,
    `Title: ${row.person_title ?? "(unknown)"}`,
    `Works at: ${company}`,
    `LinkedIn: ${row.person_linkedin ?? "(unknown)"}`,
    `Location: ${row.person_location ?? "(unknown)"}`,
  ];
}

/** What a top-up still has to find, worked out by src/network/reuse.ts. */
export interface TopUpRequest {
  /** Null when the colleagues already known were found for these same roles. */
  colleagues: { known: string[] } | null;
  /** Matched target accounts with no buyer seat in the network yet. */
  buyerTargets: Array<{ account: string; domain: string | null }>;
  /** Accounts whose buyers Togari already holds: never searched again. */
  coveredAccounts: string[];
  /** When the stored history was researched, for the record. */
  researchedAt: string | null;
}

/**
 * The smaller task sent when the person's history is already in the shared
 * network: only the colleagues and buyer seats that are missing.
 *
 * The person themself is not researched again. Their history, and every known
 * colleague's, is merged back in by POST /connections/result, so the paths the
 * client gets cover both. The method for this is the guide's "Top-up research"
 * section.
 */
export function buildTopUpTaskMessage(
  row: ConnectionItemRow,
  sources: ConnectionSources,
  targetCount: number,
  topUp: TopUpRequest,
): string {
  const endpoint = resultEndpoint();
  const company = row.person_company_domain
    ? `${row.person_company} (${row.person_company_domain})`
    : row.person_company;

  const steps: string[] = [];
  let n = 1;
  if (topUp.colleagues) {
    steps.push(
      ...roleLines(
        `${n}. Find up to ${MAX_COLLEAGUES} people who work at ${row.person_company} NOW in senior roles:`,
        sources.colleagueRoles,
        ".",
      ),
      "   Only people a current public source places there.",
      ...(topUp.colleagues.known.length > 0
        ? [
            "   Togari already has these people. Do NOT include them:",
            ...topUp.colleagues.known.map((name) => `     - ${name}`),
          ]
        : []),
    );
    n++;
    steps.push(...historySteps(n, "each new colleague"));
    n += 2;
  }
  const buyerLead = topUp.buyerTargets.length
    ? [
        `${n}. Find up to ${MAX_CONTACTS_PER_TARGET} people who work NOW in the buyer seat at each of`,
        "   these target accounts:",
        ...topUp.buyerTargets.map((t) => `     - ${t.account}${t.domain ? ` (${t.domain})` : ""}`),
      ]
    : [`${n}. Find up to ${MAX_CONTACTS_PER_TARGET} people who work NOW in the buyer seat`];
  if (topUp.colleagues) {
    buyerLead.push(
      topUp.buyerTargets.length
        ? "   and at any target account a new colleague matched in the steps above,"
        : "   at each target account a new colleague matched in the steps above,",
      `   at most ${MAX_TARGETS_WITH_CONTACTS} accounts in all, the most recent departures first.`,
    );
  }
  if (topUp.colleagues || topUp.buyerTargets.length) {
    steps.push(
      ...buyerLead,
      ...roleLines("   The buyer seat is:", sources.buyerRoles, "."),
      ...(topUp.coveredAccounts.length > 0
        ? [
            "   Togari already has the buyers at these accounts. Do NOT search them:",
            ...topUp.coveredAccounts.map((a) => `     - ${a}`),
          ]
        : []),
      "   Only people a current public source places there. joined_year is the",
      "   year they joined that organization, and only if a source states it.",
    );
    n++;
  }

  return [
    `You are topping up warm-introduction research for ${sources.displayName}.`,
    "Togari already holds this person's career history, and their colleagues',",
    "from earlier research. Do NOT research the person again. Find only what",
    "is listed below.",
    "",
    "First, open and read this document, and follow its section \"Top-up",
    `research\": ${sources.guideUrl}`,
    "Follow it over your own judgement where the two differ.",
    ...(topUp.colleagues
      ? [
          "",
          `The target account list is a published CSV with ${targetCount} accounts:`,
          sources.targetsUrl,
          "Read all of it. If you can read only part of it, report how many rows",
          "you read. Never fill in the rest from memory.",
        ]
      : []),
    "",
    "Then do this, and stop:",
    ...steps,
    ...callbackSteps(n, endpoint, [
      "   In people, give only the new colleagues. Leave the person out and set",
      "   identity_confirmed to null: Togari already has both.",
    ]),
    "",
    ...NEVER_IMPLY,
    "",
    ...personBlock(row, company),
  ].join("\n");
}

/**
 * The message for a queued row, reading the sheet first.
 *
 * Throws when the client is not set up or the sheet cannot be read. The
 * dispatcher calls this before claiming the row, so either one leaves the row
 * queued and costs nothing — there is no point paying Perplexity to read a
 * sheet Togari has just failed to read.
 */
export async function connectionTaskMessageFor(row: ConnectionItemRow): Promise<string> {
  const sources = connectionSourcesFor(row.client_id ?? "");
  const targets = await loadTargets(sources.targetsUrl);
  return buildConnectionTaskMessage(row, sources, targets.length);
}
