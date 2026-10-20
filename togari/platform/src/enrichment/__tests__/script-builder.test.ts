/**
 * Vitest unit tests for the cold-call script builder.
 *
 * The script builder calls Claude over fetch. The smoke setup stubs
 * global fetch via __smoke.fetch.handlers; we register a handler that
 * returns canned Anthropic-shaped responses so we exercise the parser
 * and shape without hitting the network.
 */

import { describe, it, expect } from "vitest";
import { buildColdCallScript } from "../../dialer/script-builder";

interface SmokeFetchHandlers {
  handlers: Array<{
    match: (url: string, init?: any) => boolean;
    response: (url: string, init?: any) => any;
  }>;
}

function getSmoke(): SmokeFetchHandlers {
  return (globalThis as any).__smoke.fetch as SmokeFetchHandlers;
}

function queueAnthropicResponse(jsonContent: string) {
  getSmoke().handlers.push({
    match: (url) => url.includes("api.anthropic.com"),
    response: () => ({
      content: [{ type: "text", text: jsonContent }],
    }),
  });
}

const BASE_INPUT = {
  thesis: {
    name: "Commercial Landscaping",
    description:
      "$5-50M revenue commercial landscapers in NC, VA, TN with no PE backing",
  },
  company: {
    name: "Springdale Landscaping",
    description:
      "Family-owned commercial landscaping firm based in Charlotte, NC.",
  },
  contact: { full_name: "James Henderson", title: "CEO" },
  call_type: "cold_intro" as const,
  signal: "just opened a Greensboro location in March",
};

const VALID_SCRIPT = JSON.stringify({
  opening_line:
    "Hi James, this is Caleb from Blue Modern. We work with founder-owned landscaping firms in the Carolinas, and your Greensboro expansion caught our eye.",
  qualifying_questions: [
    "What's driving the move into Greensboro right now?",
    "Are you the sole owner, or do you have a partnership structure?",
    "Have you ever had a conversation with a private equity firm before?",
  ],
  objection_handlers: [
    {
      objection: "Not interested.",
      response:
        "Totally fair. Mind if I ask what would have to change for that to be a yes someday? I'll keep it brief.",
    },
    {
      objection: "Send me an email.",
      response:
        "Happy to. What's the best address? And if I share a one-pager on similar firms we've talked to, would you give me 15 minutes after you read it?",
    },
    {
      objection: "Where did you get my number?",
      response:
        "Public business filings â I can send you the source. We only call founders we'd actually want to back.",
    },
    {
      objection: "We already have a buyer.",
      response:
        "Smart to have options. If that one stalls â and these often do â who's the right person to circle back to?",
    },
  ],
  meeting_offer:
    "Could I get 15 minutes on your calendar next Tuesday or Thursday? I'll come prepared with three things specific to Springdale.",
  closing:
    "Thanks James â I appreciate the time. I'll send a calendar invite for Tuesday at 2pm.",
});

describe("buildColdCallScript", () => {
  it("parses a well-formed Claude response into the typed shape", async () => {
    queueAnthropicResponse(VALID_SCRIPT);
    const script = await buildColdCallScript(BASE_INPUT);

    expect(script.opening_line).toMatch(/Greensboro/);
    expect(script.qualifying_questions.length).toBeGreaterThanOrEqual(3);
    expect(script.objection_handlers.length).toBeGreaterThanOrEqual(4);
    expect(script.meeting_offer).toMatch(/15 minutes/);
    expect(script.closing).toMatch(/James/);
  });

  it("strips code fences if Claude wraps JSON in them", async () => {
    queueAnthropicResponse(`\`\`\`json\n${VALID_SCRIPT}\n\`\`\``);
    const script = await buildColdCallScript(BASE_INPUT);
    expect(script.opening_line.length).toBeGreaterThan(0);
    expect(script.qualifying_questions.length).toBeGreaterThan(0);
  });

  it("throws when Claude returns no JSON object", async () => {
    queueAnthropicResponse("Sorry, I cannot help with that.");
    await expect(buildColdCallScript(BASE_INPUT)).rejects.toThrow(
      /No JSON object/,
    );
  });

  it("throws when required sections are missing", async () => {
    queueAnthropicResponse(
      JSON.stringify({
        opening_line: "",
        qualifying_questions: [],
        objection_handlers: [],
        meeting_offer: "",
        closing: "",
      }),
    );
    await expect(buildColdCallScript(BASE_INPUT)).rejects.toThrow(
      /incomplete script/,
    );
  });

  it("drops malformed objection handlers but keeps valid ones", async () => {
    queueAnthropicResponse(
      JSON.stringify({
        opening_line: "Hi James, this is Caleb from Blue Modern.",
        qualifying_questions: ["What's the next 12 months look like?"],
        objection_handlers: [
          {
            objection: "Not interested.",
            response: "Understood, mind if I ask why?",
          },
          { objection: "Send email." }, // missing response â dropped
          { response: "naked response" }, // missing objection â dropped
        ],
        meeting_offer: "Can I have 15 minutes on Tuesday?",
        closing: "Thanks James.",
      }),
    );
    const script = await buildColdCallScript(BASE_INPUT);
    expect(script.objection_handlers).toHaveLength(1);
    expect(script.objection_handlers[0]?.objection).toBe("Not interested.");
  });
});
