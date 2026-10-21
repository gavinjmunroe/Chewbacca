/**
 * Guardrail: DM-vs-group tool arming parity.
 *
 * The arming layer (lib/tool-arming.js) must NEVER take isGroup. If anyone
 * adds an isGroup arg, this test breaks at the first signature check and
 * the rest of the test confirms behavior is identical anyway.
 *
 * Why: Caleb 2026-05-27 — "all functionality available in DM should also
 * be in groupchat, make it so we never have to update both of them
 * manually when we add new functionality." This file is the lock.
 *
 * Run: node --test Newton/agent/lib/__tests__/tool-arming-parity.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  armTools,
  CALENDAR_ALWAYS_ARMED,
  REMINDER_ALWAYS_ARMED,
  VOICE_ALWAYS_ARMED,
} from "../tool-arming.js";

const FAKE_TOOLS = [
  { name: "task_create", description: "Create a beads task." },
  { name: "task_list", description: "List beads tasks." },
  { name: "github_search", description: "Search github." },
  { name: "github_open_pr", description: "Open a github PR." },
  { name: "schedule_event", description: "Schedule on the calendar." },
  { name: "list_events", description: "List events." },
  { name: "get_availability", description: "Check freebusy." },
  { name: "reschedule_event", description: "Move an event." },
  { name: "cancel_event", description: "Delete an event." },
  // Tab 25 — block scheduling + focus time (added to CALENDAR_ALWAYS_ARMED).
  { name: "find_free_block", description: "Find a free calendar window." },
  { name: "schedule_focus_block", description: "Block focus time." },
  { name: "propose_reschedule", description: "Draft a reschedule note." },
  { name: "send_email", description: "Send an email." },
  { name: "web_search", description: "Search the web." },
  { name: "deep_research", description: "Research deeply." },
  {
    name: "schedule_reminder",
    description: "Schedule a cross-person reminder.",
  },
  {
    name: "list_my_reminders",
    description: "List the caller's reminders.",
  },
  {
    name: "cancel_reminder",
    description: "Cancel a pending reminder.",
  },
  {
    name: "find_relationship",
    description: "Look up a person across pipelines.",
  },
  {
    name: "tts_generate",
    description: "Generate spoken audio (MP3) from text.",
  },
];

function names(tools) {
  return new Set((tools || []).map((t) => t.name));
}

test("armTools signature does not accept isGroup", () => {
  // Defensive: if anyone adds an isGroup param, the function length changes
  // (Node counts non-default params before the first default). The single
  // param is `{ allTools, text, ... }` so length === 1.
  assert.equal(
    armTools.length,
    1,
    "armTools must take exactly one options object — adding isGroup would mean a second positional param or destructuring it inside, both of which violate the parity invariant.",
  );
});

test("parity: same text, same tenant flags → same tools in DM and group", () => {
  const text = "schedule a sync with Sagar tomorrow at 3";
  const a = armTools({
    allTools: FAKE_TOOLS,
    text,
    toolsEnabled: true,
    isExpert: true,
  });
  const b = armTools({
    allTools: FAKE_TOOLS,
    text,
    toolsEnabled: true,
    isExpert: true,
  });
  assert.deepEqual(
    names(a.tools),
    names(b.tools),
    "Two arming calls with identical inputs must produce identical tool sets.",
  );
});

test("expert mode arms calendar tools regardless of keyword match", () => {
  const text = "yo";
  const armed = armTools({
    allTools: FAKE_TOOLS,
    text,
    toolsEnabled: true,
    isExpert: true,
  });
  for (const calendarTool of CALENDAR_ALWAYS_ARMED) {
    assert.ok(
      names(armed.tools).has(calendarTool),
      `expert mode should always-arm ${calendarTool} even when the user just says "yo"`,
    );
  }
});

test("expert mode arms reminder tools regardless of keyword match (PR-H)", () => {
  // PR-H: closes the proactive-reminders gap from the 2026-05-28 audit.
  // The audit recorded Medha apologizing verbally ("I can take a note...")
  // instead of scheduling because the keyword selector only fired on the
  // literal word "reminder". Sagar's "ping me Tuesday 9am" and "note to
  // self" phrasings never matched. Always-arming for experts closes the
  // door so a future keyword regression cannot dark-room these tools again.
  const text = "ping me tuesday 9am to send the deck";
  const armed = armTools({
    allTools: FAKE_TOOLS,
    text,
    toolsEnabled: true,
    isExpert: true,
  });
  for (const reminderTool of REMINDER_ALWAYS_ARMED) {
    assert.ok(
      names(armed.tools).has(reminderTool),
      `expert mode should always-arm ${reminderTool} regardless of keyword match`,
    );
  }
});

test("expert mode arms reminder tools on 'yo' (no keyword match at all)", () => {
  const armed = armTools({
    allTools: FAKE_TOOLS,
    text: "yo",
    toolsEnabled: true,
    isExpert: true,
  });
  assert.ok(
    names(armed.tools).has("schedule_reminder"),
    "schedule_reminder must be armed for experts even with zero keyword signal",
  );
});

test("non-expert: reminder tools only armed when keyword matches", () => {
  const armed = armTools({
    allTools: FAKE_TOOLS,
    text: "hello",
    toolsEnabled: true,
    isExpert: false,
  });
  for (const reminderTool of REMINDER_ALWAYS_ARMED) {
    assert.ok(
      !names(armed.tools).has(reminderTool),
      `non-expert + no reminder keyword should NOT arm ${reminderTool}`,
    );
  }
});

test("non-expert: calendar tools only armed when keyword matches", () => {
  const armed = armTools({
    allTools: FAKE_TOOLS,
    text: "hello",
    toolsEnabled: true,
    isExpert: false,
  });
  for (const calendarTool of CALENDAR_ALWAYS_ARMED) {
    assert.ok(
      !names(armed.tools).has(calendarTool),
      `non-expert + no calendar keyword should NOT arm ${calendarTool}`,
    );
  }
});

test("non-expert: 'what's on my calendar' arms list_events via keyword", () => {
  const armed = armTools({
    allTools: FAKE_TOOLS,
    text: "what's on my calendar today",
    toolsEnabled: true,
    isExpert: false,
  });
  assert.ok(
    names(armed.tools).has("list_events"),
    "list_events should be selected when the user mentions 'calendar'",
  );
});

test("tools disabled + no intent → no tools armed", () => {
  const armed = armTools({
    allTools: FAKE_TOOLS,
    text: "random question",
    toolsEnabled: false,
    isExpert: false,
  });
  assert.equal(armed.tools, undefined);
});

test("tools disabled + matching intent → core tools fall through", () => {
  const armed = armTools({
    allTools: FAKE_TOOLS,
    text: "add a task",
    toolsEnabled: false,
    isExpert: false,
    detectedIntent: { type: "create_task" },
  });
  assert.ok(
    names(armed.tools).has("task_create"),
    "fallback intent should arm core task_* tools even when toolsEnabled is false",
  );
});

test("no duplicates when a tool is both core and keyword-matched", () => {
  // task_* is core. If a user says "create a task", the keyword selector
  // also matches task_create. Dedupe should leave it in exactly once.
  const armed = armTools({
    allTools: FAKE_TOOLS,
    text: "create a task to follow up with sagar",
    toolsEnabled: true,
    isExpert: true,
  });
  const occurrences = (armed.tools || []).filter(
    (t) => t.name === "task_create",
  ).length;
  assert.ok(
    occurrences <= 1,
    `task_create appeared ${occurrences} times — dedup is broken`,
  );
});

test("expert mode arms tts_generate regardless of keyword match (Tab 23)", () => {
  // Tab 23: an explicit spoken-reply request ("voice mode on", "read this
  // back to me", "reply as voice") must never land on a turn where
  // tts_generate was dark. Some of those phrasings don't carry the literal
  // "voice"/"speak"/"audio" tokens the keyword selector keys off, so we
  // always-arm for experts the same way calendar/reminder/gen-file banks do.
  const armed = armTools({
    allTools: FAKE_TOOLS,
    text: "read this back to me",
    toolsEnabled: true,
    isExpert: true,
  });
  for (const voiceTool of VOICE_ALWAYS_ARMED) {
    assert.ok(
      names(armed.tools).has(voiceTool),
      `expert mode should always-arm ${voiceTool} regardless of keyword match`,
    );
  }
});

test("expert mode arms tts_generate on 'yo' (no keyword match at all)", () => {
  const armed = armTools({
    allTools: FAKE_TOOLS,
    text: "yo",
    toolsEnabled: true,
    isExpert: true,
  });
  assert.ok(
    names(armed.tools).has("tts_generate"),
    "tts_generate must be armed for experts even with zero voice keyword signal",
  );
});

test("non-expert: tts_generate only armed when keyword matches", () => {
  const armed = armTools({
    allTools: FAKE_TOOLS,
    text: "hello",
    toolsEnabled: true,
    isExpert: false,
  });
  for (const voiceTool of VOICE_ALWAYS_ARMED) {
    assert.ok(
      !names(armed.tools).has(voiceTool),
      `non-expert + no voice keyword should NOT arm ${voiceTool}`,
    );
  }
});

test("non-expert: 'reply as voice' arms tts_generate via keyword", () => {
  const armed = armTools({
    allTools: FAKE_TOOLS,
    text: "reply as voice please",
    toolsEnabled: true,
    isExpert: false,
  });
  assert.ok(
    names(armed.tools).has("tts_generate"),
    "tts_generate should be selected when the user mentions 'voice'",
  );
});
