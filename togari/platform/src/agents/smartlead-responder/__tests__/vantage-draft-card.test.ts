import { describe, expect, it, vi } from "vitest";

vi.mock("../../../replies/vantage", () => ({
  vantageEnabled: (client: string) => client === "zeutara",
  vantageContext: async () => ({ policy: { neverNameClient: true } }),
  vantageProblem: (draft: string) =>
    /ivy/i.test(draft)
      ? 'the draft uses "ivy", which Vantage says never to say'
      : null,
}));

import { vantageDraftProblem } from "../index";

// 2026-10-16: a card drafted "The company is Ivy" for a client Vantage says
// never to name, so pressing send could only fail.
describe("Vantage check on a reply card's draft", () => {
  it("names the rule a draft breaks", async () => {
    expect(
      await vantageDraftProblem(
        "zeutara",
        "ethan@fund.example",
        "The company is Ivy.",
      ),
    ).toContain("never to say");
  });
  it("passes a draft that follows the rules", async () => {
    expect(
      await vantageDraftProblem(
        "zeutara",
        "ethan@fund.example",
        "It's the dating app from my note.",
      ),
    ).toBeNull();
  });
  it("skips clients without Vantage and empty drafts", async () => {
    expect(
      await vantageDraftProblem("serif", "a@b.example", "The company is Ivy."),
    ).toBeNull();
    expect(await vantageDraftProblem("zeutara", "a@b.example", "")).toBeNull();
  });
});
