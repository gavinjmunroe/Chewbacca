import { describe, it, expect } from "vitest";
import { queueBqRows, getMockState } from "../../../../tests/smoke/helpers";
import { BigQueryClient } from "../../../bigquery/client";
import { buildContactsSearchTool, buildContactsGetTool } from "../contacts";

const CTX = { tenantId: "test_tenant", userId: "test-user" };

function makeBq() {
  return new BigQueryClient("test-project", null, null);
}

describe("togari_contacts_search", () => {
  const tool = buildContactsSearchTool({ bq: makeBq() });

  it("renders contacts table and filters by companyId", async () => {
    queueBqRows([
      {
        id: "p1",
        company_id: "c1",
        full_name: "Jane Owner",
        title: "CEO",
        email: "jane@acme.com",
        email_verified: true,
        linkedin_url: "https://linkedin.com/in/jane",
        is_primary: true,
        primary_score: 95,
        source: "zoominfo",
        created_at: { value: "2026-05-10T10:00:00Z" },
      },
    ]);

    const result = await tool.handler(
      { companyId: "c1", isPrimary: true },
      CTX,
    );
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain("Jane Owner");
    expect(text).toContain("CEO");
    expect(text).toContain("jane@acme.com");
    expect(text).toContain("Returned 1 of up to 25");

    const last = getMockState().bq.queries.at(-1);
    expect(last.params.tenantId).toBe("test_tenant");
    expect(last.params.companyId).toBe("c1");
    expect(last.params.isPrimary).toBe(true);
    expect(last.sql).toContain("c.tenant_id = @tenantId");
    expect(last.sql).toContain("c.company_id = @companyId");
  });

  it("joins mandate_companies when mandateId is set", async () => {
    queueBqRows([]);
    await tool.handler({ mandateId: "mandate_42" }, CTX);
    const last = getMockState().bq.queries.at(-1);
    expect(last.sql).toContain("mandate_companies");
    expect(last.sql).toContain("mc.removed_at IS NULL");
    expect(last.params.mandateId).toBe("mandate_42");
  });

  it("builds a free-text contains pattern", async () => {
    queueBqRows([]);
    await tool.handler({ query: "owner" }, CTX);
    const last = getMockState().bq.queries.at(-1);
    expect(last.params.queryPattern).toBe("%owner%");
    expect(last.sql).toContain("LOWER(IFNULL(c.full_name, ''))");
  });

  it("returns 'No rows.' when nothing matches", async () => {
    queueBqRows([]);
    const result = await tool.handler({}, CTX);
    expect(result.content[0].text).toContain("Returned 0 of up to 25");
    expect(result.content[0].text).toContain("_No rows._");
  });
});

describe("togari_contacts_get", () => {
  const tool = buildContactsGetTool({ bq: makeBq() });

  it("returns the contact DL with provenance breakdown", async () => {
    queueBqRows([
      {
        id: "p1",
        company_id: "c1",
        company_name: "Acme Industrial",
        enrichment_run_id: "run_a",
        source: "zoominfo",
        full_name: "Jane Owner",
        first_name: "Jane",
        last_name: "Owner",
        title: "CEO",
        email: "jane@acme.com",
        email_verified: true,
        mobile_phone: null,
        business_phone: "+1-412-555-0101",
        linkedin_url: "https://linkedin.com/in/jane",
        dc_contact_id: "DC-PERSON-1",
        contact_info: { zoominfo_id: "ZI-9", verified_at: "2026-05-09" },
        is_primary: true,
        primary_score: 95,
        primary_reason: "CEO and majority owner",
        created_at: { value: "2026-05-10T10:00:00Z" },
        updated_at: { value: "2026-05-11T08:00:00Z" },
      },
    ]);

    const result = await tool.handler({ id: "p1" }, CTX);
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain("Jane Owner");
    expect(text).toContain("Acme Industrial");
    expect(text).toContain("**Provenance**");
    expect(text).toContain("Primary source:** zoominfo");
    expect(text).toContain("zoominfo_id");
  });

  it("errors when the contact is not found", async () => {
    queueBqRows([]);
    const result = await tool.handler({ id: "missing" }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No contact found");
  });
});
