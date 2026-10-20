/**
 * resolvePullAttachment — the deterministic guard that keeps pulled
 * meetings/events from attaching to unrelated clients (the "internal standup
 * filed under Spinach Records" bug).
 */

import { describe, expect, it } from "vitest";
import {
  resolvePullAttachment,
  type MatchableClient,
} from "../v1";

const INTERNAL = new Set(["bluemodernadvisory.com"]);

const CLIENTS: MatchableClient[] = [
  {
    client_id: "spinach_records_425af0",
    name: "Spinach Records",
    primary_domain: "spinachrecords.com",
    primary_email: null,
  },
  {
    client_id: "freedom_c5624c",
    name: "Freedom",
    primary_domain: "freedom.xyz",
    primary_email: null,
  },
  {
    client_id: "blue_modern_advisory_c5d8f0",
    name: "Blue Modern Advisory",
    primary_domain: "bluemodernadvisory.com",
    primary_email: null,
  },
];

describe("resolvePullAttachment", () => {
  it("routes an internal-only meeting to the internal client, ignoring the LLM's unrelated pick", () => {
    const res = resolvePullAttachment({
      source: "fireflies",
      participants: [
        "sagar@bluemodernadvisory.com",
        "maggie@bluemodernadvisory.com",
      ],
      llmClientId: "spinach_records_425af0",
      clients: CLIENTS,
      internal: INTERNAL,
    });
    expect(res.clientId).toBe("blue_modern_advisory_c5d8f0");
    expect(res.newClientName).toBeUndefined();
  });

  it("leaves an internal-only meeting unattached when no internal client record exists", () => {
    const externalOnly = CLIENTS.filter(
      (c) => c.client_id !== "blue_modern_advisory_c5d8f0",
    );
    const res = resolvePullAttachment({
      source: "calendar",
      participants: ["sagar@bluemodernadvisory.com"],
      llmClientId: "spinach_records_425af0",
      clients: externalOnly,
      internal: INTERNAL,
    });
    expect(res.clientId).toBeUndefined();
    expect(res.newClientName).toBeUndefined();
  });

  it("never mints a new client from an internal standup", () => {
    const res = resolvePullAttachment({
      source: "fireflies",
      participants: ["a@bluemodernadvisory.com", "b@bluemodernadvisory.com"],
      llmNewClientName: "BMA Daily Standup",
      clients: CLIENTS,
      internal: INTERNAL,
    });
    expect(res.newClientName).toBeUndefined();
  });

  it("treats meeting-bot attendees as noise, not external participants", () => {
    const res = resolvePullAttachment({
      source: "fireflies",
      participants: ["sagar@bluemodernadvisory.com", "fred@fireflies.ai"],
      llmClientId: "spinach_records_425af0",
      clients: CLIENTS,
      internal: INTERNAL,
    });
    expect(res.clientId).toBe("blue_modern_advisory_c5d8f0");
  });

  it("keeps the LLM's pick when an attendee domain corroborates it", () => {
    const res = resolvePullAttachment({
      source: "fireflies",
      participants: ["sagar@bluemodernadvisory.com", "alex@freedom.xyz"],
      llmClientId: "freedom_c5624c",
      clients: CLIENTS,
      internal: INTERNAL,
    });
    expect(res.clientId).toBe("freedom_c5624c");
  });

  it("overrides the LLM with the attendee-domain match when they disagree", () => {
    const res = resolvePullAttachment({
      source: "calendar",
      participants: ["sagar@bluemodernadvisory.com", "alex@freedom.xyz"],
      llmClientId: "spinach_records_425af0",
      clients: CLIENTS,
      internal: INTERNAL,
    });
    expect(res.clientId).toBe("freedom_c5624c");
  });

  it("attaches by attendee domain even when the LLM returned nothing", () => {
    const res = resolvePullAttachment({
      source: "fireflies",
      participants: ["alex@freedom.xyz"],
      clients: CLIENTS,
      internal: INTERNAL,
    });
    expect(res.clientId).toBe("freedom_c5624c");
  });

  it("trusts the LLM for meetings with unknown external attendees (a genuine new lead)", () => {
    const res = resolvePullAttachment({
      source: "fireflies",
      participants: ["sagar@bluemodernadvisory.com", "ceo@newlead.io"],
      llmNewClientName: "New Lead",
      clients: CLIENTS,
      internal: INTERNAL,
    });
    expect(res.clientId).toBeUndefined();
    expect(res.newClientName).toBe("New Lead");
  });

  it("never domain-matches a client whose primary domain is free mail", () => {
    // Spinach Records lives at a gmail address; a random gmail attendee
    // ("College Apps w/ Sagar") must not pull the meeting onto Spinach.
    const withFreemail: MatchableClient[] = [
      ...CLIENTS.filter((c) => c.client_id !== "spinach_records_425af0"),
      {
        client_id: "spinach_records_425af0",
        name: "Spinach Records",
        primary_domain: "gmail.com",
        primary_email: "watson.b1229@gmail.com",
      },
    ];
    const res = resolvePullAttachment({
      source: "calendar",
      participants: [
        "colin.evan.sweeney@gmail.com",
        "sagar@bluemodernadvisory.com",
      ],
      llmClientId: "spinach_records_425af0",
      clients: withFreemail,
      internal: INTERNAL,
    });
    expect(res.clientId).toBeUndefined();
  });

  it("still matches a free-mail client by exact attendee email", () => {
    const withFreemail: MatchableClient[] = [
      {
        client_id: "spinach_records_425af0",
        name: "Spinach Records",
        primary_domain: "gmail.com",
        primary_email: "watson.b1229@gmail.com",
      },
    ];
    const res = resolvePullAttachment({
      source: "fireflies",
      participants: ["watson.b1229@gmail.com", "sagar@bluemodernadvisory.com"],
      clients: withFreemail,
      internal: INTERNAL,
    });
    expect(res.clientId).toBe("spinach_records_425af0");
  });

  it("leaves a meeting unattached when no attendee corroborates the LLM's pick", () => {
    const res = resolvePullAttachment({
      source: "fireflies",
      participants: ["sagar@bluemodernadvisory.com", "someone@unknown.io"],
      llmClientId: "spinach_records_425af0",
      clients: CLIENTS,
      internal: INTERNAL,
    });
    expect(res.clientId).toBeUndefined();
  });

  it("drops a hallucinated client_id the store does not contain", () => {
    const res = resolvePullAttachment({
      source: "gmail",
      participants: ["someone@somewhere.com"],
      llmClientId: "not_a_real_client",
      clients: CLIENTS,
      internal: INTERNAL,
    });
    expect(res.clientId).toBeUndefined();
  });

  it("leaves gmail/slack mapping to the LLM (content-based matching)", () => {
    const res = resolvePullAttachment({
      source: "gmail",
      participants: ["sagar@bluemodernadvisory.com"],
      llmClientId: "freedom_c5624c",
      clients: CLIENTS,
      internal: INTERNAL,
    });
    expect(res.clientId).toBe("freedom_c5624c");
  });

  it("keeps the LLM pick when a meeting has no email-shaped attendees to validate against", () => {
    const res = resolvePullAttachment({
      source: "fireflies",
      participants: ["Sagar", "Alex"],
      llmClientId: "freedom_c5624c",
      clients: CLIENTS,
      internal: INTERNAL,
    });
    expect(res.clientId).toBe("freedom_c5624c");
  });
});
