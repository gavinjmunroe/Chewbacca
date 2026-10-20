import { describe, it, expect } from "vitest";
import {
  canonicalJson,
  hashPayload,
  companyDedupeKey,
  contactDedupeKey,
  normalizeContactName,
  normalizeDomainLike,
} from "../../../src/ingest/clay/parser";
import { ClayWebhookPayloadSchema } from "../../../src/ingest/clay/schema";

describe("canonicalJson", () => {
  it("produces identical output for objects whose keys are written in different orders", () => {
    const a = { b: 1, a: 2, c: [3, { y: 9, x: 8 }] };
    const b = { c: [3, { x: 8, y: 9 }], a: 2, b: 1 };
    expect(canonicalJson(a)).toEqual(canonicalJson(b));
  });
});

describe("hashPayload", () => {
  it("produces the same hash for two semantically identical payloads", () => {
    const payload = ClayWebhookPayloadSchema.parse({
      clay_run_id: "r1",
      rows: [{ company: { name: "Acme" }, contacts: [] }],
    });
    expect(hashPayload(payload)).toEqual(hashPayload(payload));
  });

  it("produces different hashes when a meaningful field changes", () => {
    const p1 = ClayWebhookPayloadSchema.parse({
      clay_run_id: "r1",
      rows: [{ company: { name: "Acme" }, contacts: [] }],
    });
    const p2 = ClayWebhookPayloadSchema.parse({
      clay_run_id: "r1",
      rows: [{ company: { name: "Acme Industrial" }, contacts: [] }],
    });
    expect(hashPayload(p1)).not.toEqual(hashPayload(p2));
  });
});

describe("companyDedupeKey", () => {
  it("prefers website over domain over name", () => {
    expect(
      companyDedupeKey({
        name: "Acme",
        website: "https://www.acme.com/path",
        domain: "acme-corp.com",
      } as any),
    ).toBe("acme.com");
    expect(
      companyDedupeKey({ name: "Acme", domain: "acme-corp.com" } as any),
    ).toBe("acme-corp.com");
    expect(companyDedupeKey({ name: "Acme  " } as any)).toBe("acme");
  });
});

describe("contactDedupeKey", () => {
  it("prefers email over linkedin_url over full_name", () => {
    expect(
      contactDedupeKey({
        email: "JANE@acme.com",
        linkedin_url: "https://x",
      } as any),
    ).toBe("jane@acme.com");
    expect(
      contactDedupeKey({
        linkedin_url: "https://linkedin.com/in/jane",
        full_name: "Jane",
      } as any),
    ).toBe("https://linkedin.com/in/jane");
    expect(contactDedupeKey({ full_name: "Jane Owner" } as any)).toBe(
      "jane owner",
    );
  });
});

describe("normalizeContactName", () => {
  it("splits full_name into first and last when not separately provided", () => {
    expect(normalizeContactName({ full_name: "Jane Owner" } as any)).toEqual({
      full: "Jane Owner",
      first: "Jane",
      last: "Owner",
    });
  });

  it("handles single-word full_name", () => {
    expect(normalizeContactName({ full_name: "Cher" } as any)).toEqual({
      full: "Cher",
      first: "Cher",
      last: null,
    });
  });

  it("falls back to first_name + last_name when full_name absent", () => {
    expect(
      normalizeContactName({ first_name: "Jane", last_name: "Owner" } as any),
    ).toEqual({ full: "Jane Owner", first: "Jane", last: "Owner" });
  });

  it("returns null when nothing usable is present", () => {
    expect(normalizeContactName({} as any)).toBeNull();
  });
});

describe("normalizeDomainLike", () => {
  it("strips scheme, www, path, and trailing slash", () => {
    expect(normalizeDomainLike("https://www.Acme.com/about/")).toBe("acme.com");
    expect(normalizeDomainLike("acme.com")).toBe("acme.com");
    expect(normalizeDomainLike("http://acme.com/")).toBe("acme.com");
  });
});
