import { describe, it, expect, beforeEach, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";

vi.mock("../../../secrets/manager", () => ({
  getOptionalSecret: async (name: string) =>
    process.env[name.replace(/-/g, "_").toUpperCase()] || undefined,
  getSecret: async (name: string) => {
    const v = process.env[name.replace(/-/g, "_").toUpperCase()];
    if (!v) throw new Error(`Secret "${name}" not found`);
    return v;
  },
}));
import {
  companySearchTool,
  companyEnrichTool,
  personSearchTool,
  personEnrichTool,
  similarCompaniesTool,
  TOGARI_ZOOMINFO_TOOLS,
  register,
} from "../zoominfo";
import { _resetZoomInfoAuthCacheForTests } from "../../../integrations/zoominfo/auth";
import { onFetch } from "../../../../tests/smoke/helpers";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const CTX = { tenantId: "test_tenant", userId: "test-user" };

const FAKE_SERVER_JWT =
  "eyJhbGciOiJIUzI1NiJ9." +
  Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url") +
  ".sig";

function setupZoomInfoCreds(): void {
  process.env.ZOOMINFO_USERNAME = "test-user";
  process.env.ZOOMINFO_CLIENT_ID = "test-client";
  process.env.ZOOMINFO_PRIVATE_KEY = privateKey;
}

beforeEach(() => {
  _resetZoomInfoAuthCacheForTests();
  setupZoomInfoCreds();
  onFetch("api.zoominfo.com/authenticate", () => ({ jwt: FAKE_SERVER_JWT }));
});

describe("zoominfo MCP tools", () => {
  it("registers all five tools under togari.zoominfo.*", () => {
    expect(TOGARI_ZOOMINFO_TOOLS.map((t) => t.name)).toEqual([
      "togari_zoominfo_company_search",
      "togari_zoominfo_company_enrich",
      "togari_zoominfo_person_search",
      "togari_zoominfo_person_enrich",
      "togari_zoominfo_similar_companies",
    ]);
    expect(typeof register).toBe("function");
  });

  it("company_search returns a not-configured error when credentials are missing", async () => {
    delete process.env.ZOOMINFO_PRIVATE_KEY;
    const out = await companySearchTool.handler({ companyName: "Acme" }, CTX);
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toContain(
      "ZoomInfo is not configured for tenant 'test_tenant'",
    );
  });

  it("company_search renders a markdown list of matches", async () => {
    onFetch("api.zoominfo.com/search/company", () => ({
      data: [
        {
          id: 123,
          name: "Acme Manufacturing",
          website: "acme.com",
          industry: "Industrial Machinery",
          revenueRange: "$10 mil. - $25 mil.",
          employeeRange: "50 - 100",
          city: "Chicago",
          state: "IL",
        },
      ],
    }));

    const out = await companySearchTool.handler({ companyName: "Acme" }, CTX);
    const text = out.content[0]!.text;
    expect(text).toContain("ZoomInfo company_search · 1 matches");
    expect(text).toContain("Acme Manufacturing");
    expect(text).toContain("Revenue: $10 mil. - $25 mil.");
  });

  it("company_enrich rejects when neither companyId nor companyWebsite given", async () => {
    const out = await companyEnrichTool.handler({}, CTX);
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toContain(
      "requires either companyId or companyWebsite",
    );
  });

  it("company_enrich renders a full firmographic block", async () => {
    onFetch("api.zoominfo.com/enrich/company", () => ({
      success: true,
      data: {
        result: [
          {
            data: [
              {
                id: 999,
                name: "Acme",
                website: "acme.com",
                revenueRange: "$10 mil. - $25 mil.",
                employeeRange: "50 - 100",
                primaryIndustry: "Industrial Machinery",
                foundedYear: 1985,
                phone: "555-1212",
                city: "Chicago",
                state: "IL",
                country: "USA",
                numberOfContactsInZoomInfo: 12,
              },
            ],
          },
        ],
      },
    }));
    const out = await companyEnrichTool.handler(
      { companyWebsite: "acme.com" },
      CTX,
    );
    const text = out.content[0]!.text;
    expect(text).toContain("Company: Acme (id: 999)");
    expect(text).toContain("Industry: Industrial Machinery");
    expect(text).toContain("Founded: 1985");
    expect(text).toContain("Contacts in ZoomInfo: 12");
  });

  it("person_search rejects when no anchor is provided", async () => {
    const out = await personSearchTool.handler({}, CTX);
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toContain(
      "person_search needs at least one of",
    );
  });

  it("person_search renders summary rows", async () => {
    onFetch("api.zoominfo.com/search/contact", () => ({
      contacts: [
        {
          id: 555,
          firstName: "Jane",
          lastName: "Smith",
          jobTitle: "CEO",
          companyId: 999,
          companyName: "Acme",
          companyWebsite: "acme.com",
          hasEmail: true,
          hasDirectPhone: true,
          contactAccuracyScore: 92,
        },
      ],
    }));
    const out = await personSearchTool.handler(
      {
        companyWebsite: "acme.com",
        titleKeywords: ["CEO", "Founder"],
      },
      CTX,
    );
    const text = out.content[0]!.text;
    expect(text).toContain("ZoomInfo person_search · 1 matches");
    expect(text).toContain("Jane Smith");
    expect(text).toContain("Title: CEO");
    expect(text).toContain("email, direct phone");
  });

  it("person_enrich surfaces email, phones, and LinkedIn URL", async () => {
    onFetch("api.zoominfo.com/enrich/contact", () => ({
      success: true,
      data: {
        result: [
          {
            data: [
              {
                id: 555,
                firstName: "Jane",
                lastName: "Smith",
                jobTitle: "CEO",
                companyName: "Acme",
                companyId: 999,
                email: "jane@acme.com",
                phone: "555-1212",
                mobilePhone: "555-3434",
                externalUrls: [
                  { type: "LinkedIn", url: "https://linkedin.com/in/jane" },
                ],
              },
            ],
          },
        ],
      },
    }));
    const out = await personEnrichTool.handler({ personId: "555" }, CTX);
    const text = out.content[0]!.text;
    expect(text).toContain("Contact: Jane Smith");
    expect(text).toContain("Email: jane@acme.com");
    expect(text).toContain("LinkedIn: https://linkedin.com/in/jane");
  });

  it("similar_companies requires a seed identifier", async () => {
    const out = await similarCompaniesTool.handler({}, CTX);
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toContain(
      "requires either companyId or companyWebsite",
    );
  });

  it("similar_companies drops the seed from its results", async () => {
    onFetch("api.zoominfo.com/enrich/company", () => ({
      success: true,
      data: {
        result: [
          {
            data: [
              {
                id: 999,
                name: "Acme",
                website: "acme.com",
                primaryIndustry: "Industrial Machinery",
                revenueRange: "$10 mil. - $25 mil.",
              },
            ],
          },
        ],
      },
    }));
    onFetch("api.zoominfo.com/search/company", () => ({
      data: [
        { id: 999, name: "Acme", industry: "Industrial Machinery" },
        { id: 1001, name: "Beta Pumps", industry: "Industrial Machinery" },
      ],
    }));
    const out = await similarCompaniesTool.handler(
      { companyWebsite: "acme.com" },
      CTX,
    );
    const text = out.content[0]!.text;
    expect(text).toContain("Beta Pumps");
    expect(text).not.toContain("1. Acme (id: 999)");
  });
});
