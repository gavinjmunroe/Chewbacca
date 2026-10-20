import { describe, it, expect } from "vitest";
import { ClayWebhookPayloadSchema } from "../../../src/ingest/clay/schema";

const baseValid = {
  clay_run_id: "run_abc123",
  mandate_id: "mandate_42",
  tenant_id: "48north",
  completed_at: "2026-05-11T20:00:00Z",
  total_records: 1,
  rows: [
    {
      company: {
        name: "Acme Industrial",
        website: "https://acme.com",
        industry: "Industrial Services",
      },
      contacts: [
        {
          full_name: "Jane Owner",
          title: "CEO",
          email: "jane@acme.com",
          email_verified: true,
          linkedin_url: "https://linkedin.com/in/janeowner",
        },
      ],
    },
  ],
};

describe("ClayWebhookPayloadSchema", () => {
  it("accepts a well-formed payload", () => {
    const result = ClayWebhookPayloadSchema.safeParse(baseValid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rows[0].company.name).toBe("Acme Industrial");
      expect(result.data.rows[0].contacts[0].email).toBe("jane@acme.com");
    }
  });

  it("defaults tenant_id to bma when omitted", () => {
    const { tenant_id, ...withoutTenant } = baseValid;
    void tenant_id;
    const result = ClayWebhookPayloadSchema.safeParse(withoutTenant);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tenant_id).toBe("bma");
  });

  it("rejects payloads missing clay_run_id", () => {
    const { clay_run_id, ...withoutRunId } = baseValid;
    void clay_run_id;
    const result = ClayWebhookPayloadSchema.safeParse(withoutRunId);
    expect(result.success).toBe(false);
  });

  it("rejects payloads with an empty rows array", () => {
    const result = ClayWebhookPayloadSchema.safeParse({
      ...baseValid,
      rows: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects rows with missing company.name", () => {
    const bad = {
      ...baseValid,
      rows: [{ company: { website: "https://x.com" }, contacts: [] }],
    };
    const result = ClayWebhookPayloadSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('normalizes "N/A" string fields to null', () => {
    const result = ClayWebhookPayloadSchema.safeParse({
      ...baseValid,
      rows: [
        {
          company: { name: "Foo", website: "N/A", industry: "   " },
          contacts: [{ full_name: "X", email: "null" }],
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rows[0].company.website).toBeNull();
      expect(result.data.rows[0].company.industry).toBeNull();
      expect(result.data.rows[0].contacts[0].email).toBeNull();
    }
  });

  it('coerces revenue_estimate strings like "$5,000,000" to numbers', () => {
    const result = ClayWebhookPayloadSchema.safeParse({
      ...baseValid,
      rows: [
        {
          company: {
            name: "Foo",
            revenue_estimate: "$5,000,000" as unknown as number,
          },
          contacts: [],
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data.rows[0].company.revenue_estimate).toBe(5_000_000);
  });

  it("defaults email_verified to false when absent", () => {
    const result = ClayWebhookPayloadSchema.safeParse({
      ...baseValid,
      rows: [
        {
          company: { name: "Foo" },
          contacts: [{ full_name: "Jane", email: "jane@foo.com" }],
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data.rows[0].contacts[0].email_verified).toBe(false);
  });

  it("treats contacts array as optional (defaults to [])", () => {
    const result = ClayWebhookPayloadSchema.safeParse({
      ...baseValid,
      rows: [
        {
          company: { name: "Foo" },
        } as unknown as (typeof baseValid.rows)[number],
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.rows[0].contacts).toEqual([]);
  });
});
