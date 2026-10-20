import { describe, it, expect, beforeEach } from "vitest";
import { getMockState } from "../../../tests/smoke/helpers";
import { parseTargets } from "../../connections/targets";
import { ConnectionResultPayload } from "../../connections/types";
import type { ConnectionItemRow } from "../../connections/store";
import { buildNetworkRecords, linkedinSlug, orgId } from "../records";
import { writeNetworkRecords } from "../store";

const TARGETS = parseTargets(
  [
    "Segment,Type,Account,Company Domain",
    "Health Systems,IDN,Hospital for Special Surgery (HSS),www.hss.edu",
    "Payers,,TriZetto,https://www.cognizant.com/us/en/trizetto",
  ].join("\n"),
);

const ROW: ConnectionItemRow = {
  id: "item-1",
  row_id: "clay_person_1",
  state: "dispatched",
  client_id: "serif",
  person_name: "Shannon Yarrow",
  person_title: "VP Managed Care",
  person_company: "Surgery Partners",
  person_company_domain: "https://www.surgerypartners.com",
  person_linkedin: null,
  person_location: "Nashville, TN",
  person_email: "shannon@surgerypartners.com",
  work_history: null,
  pplx_thread_id: null,
  pplx_account: null,
  attempts: 0,
};

const RESULT = ConnectionResultPayload.parse({
  row_id: "clay_person_1",
  identity_confirmed: "yes",
  people: [
    {
      name: "Shannon Yarrow",
      relation: "self",
      linkedin_url: "https://www.linkedin.com/in/Shannon-Yarrow-1/",
      source_url: "https://surgerypartners.com/team",
      roles: [
        { company: "Tenet Healthcare", company_domain: "tenethealth.com", title: "Director", start_year: 2004, end_year: 2007, source_url: "https://x/1" },
        { company: "No Source Co", title: "Analyst", start_year: 2001, end_year: 2003 },
      ],
    },
    {
      name: "Justin Oppenheimer",
      title: "COO",
      relation: "colleague",
      source_url: "https://surgerypartners.com/team",
      roles: [
        { company: "Hospital for Special Surgery", title: "VP Operations", start_year: 2016, end_year: "2021", source_url: "https://x/2" },
        { company: "Hospital for Special Surgery", title: "VP Operations", start_year: 2016, end_year: 2021, source_url: "https://x/2b" },
      ],
    },
    { name: "", roles: [{ company: "Ghost", source_url: "https://x/3" }] },
  ],
  target_contacts: [
    { target_account: "HSS", target_domain: "hss.edu", name: "Alison Solach", title: "Director, Payer Contracting", persona: "managed_care", source_url: "https://x/4", joined_year: "2018" },
    { target_account: "HSS", target_domain: "hss.edu", name: "No Source", title: "CFO" },
  ],
});

describe("buildNetworkRecords", () => {
  const rec = buildNetworkRecords(ROW, RESULT, TARGETS, new Date("2026-10-01T00:00:00Z"));
  const person = (name: string) => rec.people.find((p) => p.full_name === name)!;

  it("keys orgs on domain, and borrows the sheet's domain for a name-only employer", () => {
    expect(rec.orgs.map((o) => o.org_id).sort()).toEqual([
      "d:hss.edu",
      "d:surgerypartners.com",
      "d:tenethealth.com",
    ]);
    const hss = rec.orgs.find((o) => o.org_id === "d:hss.edu")!;
    expect(hss.segment).toBe("Health Systems");
    expect(hss.org_type).toBe("IDN");
  });

  it("merges the subject with their 'self' entry and keeps client-supplied contact data", () => {
    const s = person("Shannon Yarrow");
    expect(s.person_id).toBe("li:shannon-yarrow-1");
    expect(s.email).toBe("shannon@surgerypartners.com");
    expect(s.email_source).toBe("client_supplied");
    expect(s.history_complete).toBe(true);
    expect(s.identity_confirmed).toBe(true);
    expect(rec.people.filter((p) => p.full_name === "Shannon Yarrow")).toHaveLength(1);
  });

  it("drops unsourced jobs, nameless people and unsourced buyers", () => {
    expect(rec.jobs.some((j) => j.org_name_as_sourced === "No Source Co")).toBe(false);
    expect(rec.orgs.some((o) => o.name === "Ghost")).toBe(false);
    expect(rec.people.some((p) => p.full_name === "No Source")).toBe(false);
  });

  it("records each seat once, current seats as current, past ones as unknown", () => {
    const justin = person("Justin Oppenheimer");
    const hssJobs = rec.jobs.filter((j) => j.person_id === justin.person_id && j.org_id === "d:hss.edu");
    expect(hssJobs).toHaveLength(1);
    expect(hssJobs[0]).toMatchObject({ start_year: 2016, end_year: 2021, is_current: null, evidence: "career_history" });
    const now = rec.jobs.find((j) => j.person_id === justin.person_id && j.org_id === "d:surgerypartners.com")!;
    expect(now).toMatchObject({ is_current: true, evidence: "current_role", title: "COO" });
  });

  it("places buyers in their seat without claiming a full history", () => {
    const alison = person("Alison Solach");
    expect(alison).toMatchObject({ history_complete: false, researched: false, current_org_id: "d:hss.edu", persona: "managed_care" });
    expect(rec.jobs.find((j) => j.person_id === alison.person_id)).toMatchObject({ start_year: 2018, is_current: true });
  });

  it("summarizes the run for reuse", () => {
    expect(rec.run).toMatchObject({
      research_id: "item-1",
      client_id: "serif",
      subject_person_id: "li:shannon-yarrow-1",
      subject_org_id: "d:surgerypartners.com",
      buyer_org_ids: ["d:hss.edu"],
      identity_confirmed: true,
      jobs_found: 2,
    });
    expect(rec.run.colleague_ids).toEqual([person("Justin Oppenheimer").person_id]);
  });

  it("works with no target sheet", () => {
    const bare = buildNetworkRecords(ROW, RESULT, null);
    expect(bare.orgs.find((o) => o.name === "Hospital for Special Surgery")?.org_id).toBe(
      "n:hospital for special surgery",
    );
  });
});

describe("keys", () => {
  it("normalizes LinkedIn slugs and org ids", () => {
    expect(linkedinSlug("https://linkedin.com/in/Jane%20Doe/?x=1")).toBe("jane doe");
    expect(linkedinSlug("https://example.com/in/jane")).toBeNull();
    expect(orgId("Acme, Inc.", null)).toBe("n:acme");
    expect(orgId("Acme", "https://www.acme.co.uk/about")).toBe("d:acme.co.uk");
    expect(orgId("", null)).toBeNull();
  });
});

describe("writeNetworkRecords", () => {
  beforeEach(() => {
    getMockState().bq.writes.length = 0;
  });

  it("MERGEs each table once with deduplicated rows", async () => {
    const rec = buildNetworkRecords(ROW, RESULT, TARGETS);
    await writeNetworkRecords(rec);
    const writes = getMockState().bq.writes as Array<{ sql: string; params: Record<string, unknown> }>;
    const tables = writes.map((w) => w.sql.match(/MERGE `[^`]*\.(network_\w+)`/)?.[1]);
    expect(tables).toEqual([
      "network_organizations",
      "network_people",
      "network_employment",
      "network_research_runs",
    ]);
    ["org_id", "person_id", "employment_id"].forEach((key, i) => {
      const rows = JSON.parse(String(writes[i].params.rows)) as Array<Record<string, unknown>>;
      expect(new Set(rows.map((r) => r[key])).size).toBe(rows.length);
    });
    expect(writes[1].params.clientId).toBe("serif");
    expect(writes[1].params.licensable).toBe(true);
    expect(writes[1].sql).not.toMatch(/suppressed\s*=/);
  });
});
