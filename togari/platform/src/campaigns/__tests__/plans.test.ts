import { describe, expect, it } from "vitest";
import { applyPlans, namedAfter, readPlan } from "../plans";
import type { CampaignSpan } from "../calendar";

describe("readPlan", () => {
  it("takes a name and two dates", () => {
    expect(readPlan({ name: "  HFMA   Region 4 ", start: "2026-10-26", end: "2026-11-06" })).toEqual({
      name: "HFMA Region 4",
      start: "2026-10-26",
      end: "2026-11-06",
    });
  });

  it("says what's wrong in words for the form", () => {
    expect(readPlan({ name: "", start: "2026-10-26", end: "2026-11-06" })).toEqual({ error: "Give the conference a name." });
    expect(readPlan({ name: "X", start: "2026-02-30", end: "2026-03-02" })).toEqual({ error: "Pick a start and an end date." });
    expect(readPlan({ name: "X", start: "2026-11-06", end: "2026-10-26" })).toEqual({ error: "The end date is before the start date." });
    expect(readPlan({ name: "X", start: "2026-01-01", end: "2028-01-01" })).toEqual({ error: "That's over a year. Check the dates." });
    expect(readPlan({ name: "x".repeat(121), start: "2026-10-26", end: "2026-11-06" })).toHaveProperty("error");
    expect(readPlan(null)).toHaveProperty("error");
  });
});

describe("namedAfter", () => {
  it("matches the conference's name, alone or with more after it", () => {
    expect(namedAfter("AVBCC Sequence 1", "AVBCC")).toBe(true);
    expect(namedAfter("HFMA - Region 6", "hfma region 6")).toBe(true);
    expect(namedAfter("HFMA Region 2", "HFMA Region 2")).toBe(true);
    expect(namedAfter("HFMA Region 26", "HFMA Region 2")).toBe(false);
    expect(namedAfter("Lookalike", "Look")).toBe(false);
    expect(namedAfter("Anything", "  ")).toBe(false);
  });
});

describe("applyPlans", () => {
  const camp = (id: string, name: string): CampaignSpan => ({
    id, name, channel: "email", first_send: "2026-10-05", last_send: "2026-10-09", planned_start: null, planned_end: null,
  });

  it("dates the campaigns named after a conference and gives the rest their own bar", () => {
    const out = applyPlans(
      [camp("1", "AVBCC Sequence 1"), camp("2", "AVBCC sequence 2"), camp("3", "NASP")],
      [
        { id: "a", name: "AVBCC", start: "2026-10-01", end: "2026-10-20" },
        { id: "b", name: "HFMA Region 4", start: "2026-10-26", end: "2026-11-06" },
      ],
    );
    expect(out.filter((c) => c.planned_start === "2026-10-01").map((c) => c.id)).toEqual(["1", "2"]);
    expect(out.find((c) => c.id === "3")!.planned_start).toBeNull();
    expect(out.find((c) => c.id === "plan:b")).toMatchObject({ channel: "plan", first_send: null, planned_end: "2026-11-06" });
    expect(out).toHaveLength(4);
  });
});
