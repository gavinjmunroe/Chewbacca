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
  zoomInfoCompanyEnrich,
  zoomInfoCompanySearch,
  zoomInfoPersonEnrich,
  zoomInfoPersonSearch,
  zoomInfoSimilarCompanies,
  isZoomInfoConfiguredForTenant,
} from "../client";
import { _resetZoomInfoAuthCacheForTests } from "../auth";
import { onFetch, getMockState } from "../../../../tests/smoke/helpers";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const FAKE_SERVER_JWT =
  "eyJhbGciOiJIUzI1NiJ9." +
  Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url") +
  ".sig";

beforeEach(() => {
  _resetZoomInfoAuthCacheForTests();
  process.env.ZOOMINFO_USERNAME = "test-user";
  process.env.ZOOMINFO_CLIENT_ID = "test-client";
  process.env.ZOOMINFO_PRIVATE_KEY = privateKey;
  onFetch("api.zoominfo.com/authenticate", () => ({ jwt: FAKE_SERVER_JWT }));
});

describe("isZoomInfoConfiguredForTenant", () => {
  it("returns true with the full env triple", async () => {
    expect(await isZoomInfoConfiguredForTenant("test_tenant")).toBe(true);
  });

  it("returns false when missing the private key", async () => {
    delete process.env.ZOOMINFO_PRIVATE_KEY;
    expect(await isZoomInfoConfiguredForTenant("test_tenant")).toBe(false);
  });
});

describe("zoomInfoCompanySearch", () => {
  it("posts to /search/company and normalizes the response", async () => {
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
          country: "USA",
        },
      ],
    }));

    const results = await zoomInfoCompanySearch({
      companyName: "Acme",
      companyWebsite: "acme.com",
      maxResults: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.companyId).toBe("123");
    expect(results[0]?.companyName).toBe("Acme Manufacturing");
    expect(results[0]?.industry).toBe("Industrial Machinery");

    const call = getMockState().fetch.calls.find((c: any) =>
      c.url.endsWith("/search/company"),
    );
    expect(call).toBeTruthy();
    const body = JSON.parse(call.init.body);
    expect(body.companyName).toBe("Acme");
    expect(body.companyWebsite).toBe("http://acme.com");
    expect(body.rpp).toBe(5);
  });

  it("returns an empty array when ZoomInfo returns no matches", async () => {
    onFetch("api.zoominfo.com/search/company", () => ({ data: [] }));
    const results = await zoomInfoCompanySearch({ companyName: "Nope" });
    expect(results).toEqual([]);
  });
});

describe("zoomInfoCompanyEnrich", () => {
  it("normalizes the nested enrich envelope", async () => {
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
                primaryIndustry: ["Industrial Machinery", "Pumps"],
                foundedYear: "1985",
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

    const detail = await zoomInfoCompanyEnrich({ companyWebsite: "acme.com" });
    expect(detail).not.toBeNull();
    expect(detail!.companyId).toBe("999");
    expect(detail!.primaryIndustry).toBe("Industrial Machinery, Pumps");
    expect(detail!.yearFounded).toBe(1985);
    expect(detail!.numberOfContactsInZoomInfo).toBe(12);
  });

  it("rejects when neither companyId nor companyWebsite is provided", async () => {
    await expect(zoomInfoCompanyEnrich({})).rejects.toThrow(
      /requires either companyId or companyWebsite/,
    );
  });

  it("rejects a malformed website that the normalizer drops", async () => {
    await expect(
      zoomInfoCompanyEnrich({ companyWebsite: "N/A" }),
    ).rejects.toThrow(/not a usable domain/);
  });
});

describe("zoomInfoPersonSearch", () => {
  it("posts to /search/contact, joins titleKeywords with OR, normalizes results", async () => {
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
          hasDirectPhone: false,
          hasMobilePhone: true,
          contactAccuracyScore: 92,
        },
      ],
    }));

    const results = await zoomInfoPersonSearch({
      companyWebsite: "acme.com",
      titleKeywords: ["CEO", "Founder"],
      minimumConfidence: 80,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.fullName).toBe("Jane Smith");
    expect(results[0]?.hasEmail).toBe(true);
    expect(results[0]?.hasMobilePhone).toBe(true);

    const call = getMockState().fetch.calls.find((c: any) =>
      c.url.endsWith("/search/contact"),
    );
    const body = JSON.parse(call.init.body);
    expect(body.jobTitle).toBe("CEO OR Founder");
    expect(body.contactAccuracyScoreMin).toBe("80");
    expect(body.companyWebsite).toBe("http://acme.com");
  });
});

describe("zoomInfoPersonEnrich", () => {
  it("returns the full person detail from the nested envelope", async () => {
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
                companyWebsite: "acme.com",
                email: "jane@acme.com",
                phone: "555-1212",
                mobilePhone: "555-3434",
                externalUrls: [
                  { type: "LinkedIn", url: "https://linkedin.com/in/jane" },
                ],
                contactAccuracyScore: 95,
                city: "Chicago",
                state: "IL",
                country: "USA",
              },
            ],
          },
        ],
      },
    }));

    const detail = await zoomInfoPersonEnrich({ personId: "555" });
    expect(detail).not.toBeNull();
    expect(detail!.email).toBe("jane@acme.com");
    expect(detail!.linkedinUrl).toBe("https://linkedin.com/in/jane");
    expect(detail!.fullName).toBe("Jane Smith");
  });

  it("returns null when ZoomInfo returns an empty result envelope", async () => {
    onFetch("api.zoominfo.com/enrich/contact", () => ({
      success: true,
      data: { result: [] },
    }));
    const detail = await zoomInfoPersonEnrich({ personId: "nope" });
    expect(detail).toBeNull();
  });
});

describe("zoomInfoSimilarCompanies", () => {
  it("enriches the seed then searches by primary industry, drops the seed from results", async () => {
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
                primaryIndustry: "Industrial Machinery",
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
        { id: 1002, name: "Gamma Valves", industry: "Industrial Machinery" },
      ],
    }));

    const results = await zoomInfoSimilarCompanies({
      companyWebsite: "acme.com",
      maxResults: 5,
    });
    expect(results.map((r) => r.companyName)).toEqual([
      "Beta Pumps",
      "Gamma Valves",
    ]);
  });

  it("returns an empty array when the seed has no primary industry", async () => {
    onFetch("api.zoominfo.com/enrich/company", () => ({
      success: true,
      data: {
        result: [
          {
            data: [{ id: 999, name: "Acme", website: "acme.com" }],
          },
        ],
      },
    }));
    const results = await zoomInfoSimilarCompanies({
      companyWebsite: "acme.com",
    });
    expect(results).toEqual([]);
  });
});
