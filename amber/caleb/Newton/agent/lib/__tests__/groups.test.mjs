/**
 * Tests for the group-chat social governor.
 *
 * Covers the production transcript class of failures:
 * - Two AI agents (Camber + Samber) in an iMessage group
 * - Stale Gaslamp / San Diego topic from earlier in the thread
 * - Newest human request: "can u make custom image" / "caleb coding fireworks"
 * - Shutdown cue: "guys can u both shut up"
 *
 * Expected behavior:
 * - Non-primary / non-addressed agent stays SILENT
 * - Primary / addressed agent gives ONE short action-oriented response
 * - Neither agent brings up Gaslamp / bay cruise / artisan market / weather
 * - "shut up" silences BOTH agents
 *
 * Run with:  node --test Newton/agent/lib/__tests__/groups.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { socialGovernor, detectMultiAddressed } from "../groups.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

const STALE_GASLAMP_HISTORY = [
  {
    role: "user",
    from: "kaitlyn",
    senderLabel: "Kaitlyn",
    content: "what should we do tonight",
  },
  {
    role: "assistant",
    senderLabel: "Camber",
    agentName: "Camber",
    content:
      "Gaslamp's lit on Fridays — could do the bay cruise then hit the artisan market after.",
  },
  {
    role: "assistant",
    senderLabel: "Samber",
    agentName: "Samber",
    content:
      "Yeah honestly the rooftop bars in Gaslamp are vibey, weather's perfect tonight.",
  },
  {
    role: "user",
    from: "caleb",
    senderLabel: "Caleb",
    content: "or we could just chill at home",
  },
];

const HISTORY_OTHER_AGENT_JUST_ANSWERED = [
  {
    role: "user",
    from: "kaitlyn",
    senderLabel: "Kaitlyn",
    content: "what time does the place close",
  },
  {
    role: "assistant",
    senderLabel: "Camber",
    agentName: "Camber",
    content: "Closes at 10pm.",
  },
];

// ── Rule 8: shutdown / social cue silences both agents ────────────────────

test("'guys can u both shut up' → BOTH agents skip", () => {
  for (const agentName of ["Camber", "Samber"]) {
    const r = socialGovernor({
      text: "guys can u both shut up",
      agentName,
      recentHistory: STALE_GASLAMP_HISTORY,
      isCaleb: false,
    });
    assert.equal(r.decision, "skip", `${agentName} should skip on shutdown cue`);
  }
});

test("'chill out' → skip", () => {
  const r = socialGovernor({
    text: "yall chill out for a sec",
    agentName: "Camber",
    recentHistory: [],
  });
  assert.equal(r.decision, "skip");
});

test("'hold on' / 'wait' → skip", () => {
  for (const text of ["hold on", "wait wait wait", "stfu", "be quiet"]) {
    const r = socialGovernor({
      text,
      agentName: "Camber",
      recentHistory: [],
    });
    assert.equal(r.decision, "skip", `"${text}" should skip`);
  }
});

// ── Rule 7: only the OTHER agent named → stay silent ──────────────────────

test("only 'samber' named in message → Camber skips", () => {
  const r = socialGovernor({
    text: "samber what do you think",
    agentName: "Camber",
    recentHistory: [],
  });
  assert.equal(r.decision, "skip");
});

test("only 'samber' named in message → Samber replies", () => {
  const r = socialGovernor({
    text: "samber what do you think",
    agentName: "Samber",
    recentHistory: [],
  });
  assert.equal(r.decision, "reply");
});

// ── Rule 1: directly named → reply (matched persona name) ─────────────────

test("'camber make me an image' → Camber replies, Samber skips", () => {
  const camber = socialGovernor({
    text: "camber make me a custom image",
    agentName: "Camber",
    recentHistory: [],
  });
  assert.equal(camber.decision, "reply");

  const samber = socialGovernor({
    text: "camber make me a custom image",
    agentName: "Samber",
    recentHistory: [],
  });
  assert.equal(samber.decision, "skip");
});

// ── Rule 6: image generation request (Kaitlyn → Caleb's agent) ─────────────

test("'can u make custom image' from Caleb → action request, reply", () => {
  const r = socialGovernor({
    text: "can u make custom image",
    agentName: "Camber",
    recentHistory: STALE_GASLAMP_HISTORY,
    isCaleb: true,
  });
  assert.equal(r.decision, "reply");
});

test("'caleb coding fireworks' image-prompt-style request from owner → reply", () => {
  const r = socialGovernor({
    text: "caleb coding fireworks",
    agentName: "Camber",
    recentHistory: STALE_GASLAMP_HISTORY,
    isCaleb: true,
  });
  // Owner asking for an image-style action — should reply (one short action).
  // (Even if not a hard "reply", it must NOT skip; defer is acceptable.)
  assert.notEqual(r.decision, "skip");
});

test("'caleb coding fireworks' from Caleb → Samber (peer) skips", () => {
  // Same message from Caleb but evaluated as Samber (peer agent for Sagar).
  // Camber should be the one to act; Samber should NOT pile on.
  const r = socialGovernor({
    text: "caleb coding fireworks",
    agentName: "Samber",
    recentHistory: STALE_GASLAMP_HISTORY,
    isCaleb: true,
  });
  // Owner is Caleb, but the request mentions Caleb specifically AND is an
  // action request. Samber isn't named, owner isn't Samber's owner —
  // governor returns "defer" (LLM router will say IGNORE due to default).
  // Either skip or defer is acceptable; the failure mode is "reply".
  assert.notEqual(r.decision, "reply");
});

// ── Rule 2: another AI just answered adequately → skip ────────────────────

test("after Camber answers, Samber should not pile on", () => {
  const r = socialGovernor({
    text: "cool",
    agentName: "Samber",
    recentHistory: HISTORY_OTHER_AGENT_JUST_ANSWERED,
    isCaleb: false,
  });
  assert.equal(r.decision, "skip");
});

// ── Rule 2: pure filler ──────────────────────────────────────────────────

test("'lol' → skip", () => {
  const r = socialGovernor({
    text: "lol",
    agentName: "Camber",
    recentHistory: [],
  });
  assert.equal(r.decision, "skip");
});

test("single emoji → skip", () => {
  const r = socialGovernor({
    text: "🔥",
    agentName: "Camber",
    recentHistory: [],
  });
  assert.equal(r.decision, "skip");
});

// ── Rule 3: newest message wins (stale context ignored) ───────────────────

test("stale Gaslamp thread + newest 'caleb coding fireworks' → reply, do NOT continue Gaslamp", () => {
  // The governor's job is to decide reply/skip; the prompt enforces "drop
  // the old thread". Here we just assert: Camber doesn't skip on this
  // newest action-oriented request.
  const r = socialGovernor({
    text: "caleb coding fireworks",
    agentName: "Camber",
    recentHistory: STALE_GASLAMP_HISTORY,
    isCaleb: true,
  });
  assert.notEqual(r.decision, "skip");
});

test("stale Gaslamp thread + newest 'guys can u both shut up' → BOTH skip", () => {
  for (const agentName of ["Camber", "Samber"]) {
    const r = socialGovernor({
      text: "guys can u both shut up",
      agentName,
      recentHistory: STALE_GASLAMP_HISTORY,
      isCaleb: false,
    });
    assert.equal(
      r.decision,
      "skip",
      `${agentName} must respect 'both shut up' even mid-Gaslamp thread`,
    );
  }
});

// ── Sanity: regular question still gets through to LLM router ─────────────

test("ambiguous question with no agents named → defer to LLM router", () => {
  const r = socialGovernor({
    text: "anyone want pizza later",
    agentName: "Camber",
    recentHistory: [],
    isCaleb: false,
  });
  assert.equal(r.decision, "defer");
});

// ── Sanity: empty text → skip ─────────────────────────────────────────────

test("empty text → skip", () => {
  const r = socialGovernor({
    text: "",
    agentName: "Camber",
    recentHistory: [],
  });
  assert.equal(r.decision, "skip");
});

// ── PROD FAILURE REGRESSION: greeting-reset on Altitude/Gaslamp thread ────
//
// Live failure after PR #30: history had Gaslamp/Altitude/bay cruise
// recommendations from earlier. User said "Yo Camber and Samber what's
// good dawg". Camber replied with "What's good! Saturday night, Altitude
// rooftop on the table, y'all pulling the trigger or what?" — wrong on
// every axis: revived stale topic, asked a planning question, named the
// venue. Governor must catch this case.

const STALE_ALTITUDE_HISTORY = [
  {
    role: "user",
    from: "caleb",
    senderLabel: "Caleb",
    content: "what should we do saturday night",
  },
  {
    role: "assistant",
    senderLabel: "Camber",
    agentName: "Camber",
    content:
      "Altitude rooftop in Gaslamp is fire on Saturdays. Could do bay cruise first.",
  },
  {
    role: "assistant",
    senderLabel: "Samber",
    agentName: "Samber",
    content: "Yeah Altitude's vibey, weather's perfect.",
  },
  {
    role: "user",
    from: "kaitlyn",
    senderLabel: "Kaitlyn",
    content: "maybe, idk",
  },
];

test("PROD FAIL: 'Yo Camber and Samber what's good dawg' → Camber greeting-reset, Samber silent", () => {
  // Caleb-as-sender variant: even with Caleb in chat, peer Samber must not
  // pile on; primary Camber gives a tiny greeting and resets topic.
  const camber = socialGovernor({
    text: "Yo Camber and Samber what's good dawg",
    agentName: "Camber",
    recentHistory: STALE_ALTITUDE_HISTORY,
    isCaleb: true,
  });
  assert.equal(camber.decision, "reply", "Camber should reply (named)");
  assert.equal(
    camber.responseStyle,
    "greeting-reset",
    "Camber must use greeting-reset style to drop stale Altitude/Gaslamp context",
  );

  // Samber: peer agent, also named. From Samber's perspective `isCaleb`
  // is FALSE because the sender (Caleb) is not Samber's tenant owner.
  // Pure greeting + namedOther + non-owner sender → suppress.
  const samber = socialGovernor({
    text: "Yo Camber and Samber what's good dawg",
    agentName: "Samber",
    recentHistory: STALE_ALTITUDE_HISTORY,
    isCaleb: false,
  });
  assert.equal(
    samber.decision,
    "skip",
    "Samber must stay silent on dual-named pure greeting in Caleb's chat",
  );
});

test("PROD FAIL: greeting-reset style is set on the governor result", () => {
  // The presence of responseStyle is the contract that downstream
  // (agent.js + prompts) uses to inject the topic-reset directive into
  // the LLM prompt. Without this flag, Camber would happily say
  // "What's good! Altitude rooftop on the table — y'all pulling the
  // trigger?" (the actual production failure).
  const r = socialGovernor({
    text: "Yo Camber what's good dawg",
    agentName: "Camber",
    recentHistory: STALE_ALTITUDE_HISTORY,
    isCaleb: true,
  });
  assert.equal(r.decision, "reply");
  assert.equal(r.responseStyle, "greeting-reset");
});

test("greeting variants → responseStyle: greeting-reset", () => {
  const variants = [
    "yo camber what's good",
    "sup camber",
    "wyd camber",
    "hey camber how are you",
    "camber wagwan",
    "good morning camber",
    "ayo camber what's poppin",
  ];
  for (const text of variants) {
    const r = socialGovernor({
      text,
      agentName: "Camber",
      recentHistory: STALE_ALTITUDE_HISTORY,
      isCaleb: true,
    });
    assert.equal(r.decision, "reply", `"${text}" should reply`);
    assert.equal(
      r.responseStyle,
      "greeting-reset",
      `"${text}" should carry greeting-reset style`,
    );
  }
});

test("greeting + real ask is NOT greeting-reset", () => {
  // "yo camber can you draft this email" — has a greeting AND a real ask.
  // Must reply normally (no greeting-reset) so the agent can fulfill the
  // request without being neutered into a one-word greeting.
  const r = socialGovernor({
    text: "yo camber can you draft an email to Sagar real quick",
    agentName: "Camber",
    recentHistory: [],
    isCaleb: true,
  });
  assert.equal(r.decision, "reply");
  assert.notEqual(
    r.responseStyle,
    "greeting-reset",
    "request with real ask must not be neutered to greeting-only",
  );
});

test("greeting question 'how are you?' (with question mark) is NOT a substantive ask", () => {
  // The trailing "?" is a soft conversational marker, not a real ask.
  // Must still trigger greeting-reset.
  const r = socialGovernor({
    text: "yo camber how are you",
    agentName: "Camber",
    recentHistory: STALE_ALTITUDE_HISTORY,
    isCaleb: true,
  });
  assert.equal(r.decision, "reply");
  assert.equal(r.responseStyle, "greeting-reset");
});

test("preserves shutdown precedence over greeting", () => {
  // "yo both shut up" — has greeting word but it's a shutdown cue.
  // Shutdown rule must win; both agents skip.
  for (const agentName of ["Camber", "Samber"]) {
    const r = socialGovernor({
      text: "yo guys shut up",
      agentName,
      recentHistory: STALE_ALTITUDE_HISTORY,
      isCaleb: false,
    });
    assert.equal(r.decision, "skip", `${agentName} must respect shutdown`);
  }
});

test("preserves only-other-agent-named precedence", () => {
  // Only Samber named, with greeting → Camber still skips.
  const r = socialGovernor({
    text: "yo samber what's good",
    agentName: "Camber",
    recentHistory: [],
    isCaleb: false,
  });
  assert.equal(r.decision, "skip");
});

// ── PROD FAILURE REGRESSION: multi-addressed multi-intent message ─────────
//
// Live failure after PR #31: user sent one group iMessage:
//   "Camber what do you know about cows? Samber what do you know about pigs?"
// Camber answered cows; Samber stayed silent. That is wrong — each agent
// has its own clause and must answer their own clause without piling on
// the peer's clause.

const COW_PIG_TEXT =
  "Camber what do you know about cows? Samber what do you know about pigs?";

test("PROD FAIL: cow/pig multi-addressed → Camber replies (focused on cows)", () => {
  const r = socialGovernor({
    text: COW_PIG_TEXT,
    agentName: "Camber",
    recentHistory: [],
    isCaleb: true,
  });
  assert.equal(r.decision, "reply");
  assert.equal(r.responseStyle, "multi-addressed");
  assert.ok(r.focusClause, "must carry a focusClause");
  assert.match(r.focusClause, /cows/i, "Camber clause must contain 'cows'");
  assert.doesNotMatch(
    r.focusClause,
    /pigs/i,
    "Camber clause must NOT include 'pigs'",
  );
});

test("PROD FAIL: cow/pig multi-addressed → Samber replies (focused on pigs)", () => {
  const r = socialGovernor({
    text: COW_PIG_TEXT,
    agentName: "Samber",
    recentHistory: [],
    isCaleb: false, // Caleb is sender; Samber's owner is Sagar
  });
  assert.equal(
    r.decision,
    "reply",
    "Samber MUST reply to its own clause even though Caleb sent the message",
  );
  assert.equal(r.responseStyle, "multi-addressed");
  assert.match(r.focusClause, /pigs/i, "Samber clause must contain 'pigs'");
  assert.doesNotMatch(
    r.focusClause,
    /cows/i,
    "Samber clause must NOT include 'cows'",
  );
});

test("multi-addressed: order reversed → both still answer their own clause", () => {
  const text =
    "Samber what do you know about pigs? Camber what do you know about cows?";
  const camber = socialGovernor({
    text,
    agentName: "Camber",
    recentHistory: [],
    isCaleb: true,
  });
  assert.equal(camber.decision, "reply");
  assert.equal(camber.responseStyle, "multi-addressed");
  assert.match(camber.focusClause, /cows/i);
  assert.doesNotMatch(camber.focusClause, /pigs/i);

  const samber = socialGovernor({
    text,
    agentName: "Samber",
    recentHistory: [],
    isCaleb: false,
  });
  assert.equal(samber.decision, "reply");
  assert.equal(samber.responseStyle, "multi-addressed");
  assert.match(samber.focusClause, /pigs/i);
  assert.doesNotMatch(samber.focusClause, /cows/i);
});

test("multi-addressed: two separate commands → both reply with own clause", () => {
  const text = "camber draft the email and samber book the flight";
  const camber = socialGovernor({
    text,
    agentName: "Camber",
    recentHistory: [],
    isCaleb: true,
  });
  assert.equal(camber.decision, "reply");
  assert.equal(camber.responseStyle, "multi-addressed");
  assert.match(camber.focusClause, /draft the email/i);
  assert.doesNotMatch(camber.focusClause, /book the flight/i);

  const samber = socialGovernor({
    text,
    agentName: "Samber",
    recentHistory: [],
    isCaleb: false,
  });
  assert.equal(samber.decision, "reply");
  assert.match(samber.focusClause, /book the flight/i);
  assert.doesNotMatch(samber.focusClause, /draft the email/i);
});

test("multi-addressed: peer reply does NOT suppress the addressed agent", () => {
  // Camber already answered the cows clause; Samber receives the same
  // multi-addressed message with Camber's answer in history. Samber MUST
  // still reply to its own clause — peer-already-answered does NOT apply
  // when each agent has a distinct ask.
  const historyWithCamberAnswer = [
    {
      role: "assistant",
      senderLabel: "Camber",
      agentName: "Camber",
      content:
        "Cows are ruminants — four-chambered stomach, chew their cud, dairy and beef breeds, etc.",
    },
  ];
  const r = socialGovernor({
    text: COW_PIG_TEXT,
    agentName: "Samber",
    recentHistory: historyWithCamberAnswer,
    isCaleb: false,
  });
  assert.equal(
    r.decision,
    "reply",
    "Samber must reply to its own clause despite Camber's prior answer",
  );
  assert.equal(r.responseStyle, "multi-addressed");
  assert.match(r.focusClause, /pigs/i);
});

test("shared greeting still produces ONE primary reply, not multi-addressed", () => {
  // "yo Camber and Samber what's good" — co-mention with a single shared
  // ask. This is NOT multi-addressed (no per-agent clause). Greeting-reset
  // path still applies: Camber (owner) replies, Samber (peer) skips.
  const camber = socialGovernor({
    text: "yo Camber and Samber what's good",
    agentName: "Camber",
    recentHistory: [],
    isCaleb: true,
  });
  assert.equal(camber.decision, "reply");
  assert.equal(
    camber.responseStyle,
    "greeting-reset",
    "shared greeting must NOT be treated as multi-addressed",
  );
  assert.equal(camber.focusClause, undefined);

  const samber = socialGovernor({
    text: "yo Camber and Samber what's good",
    agentName: "Samber",
    recentHistory: [],
    isCaleb: false,
  });
  assert.equal(
    samber.decision,
    "skip",
    "peer agent stays silent on shared greeting (no per-agent clause)",
  );
});

test("shutdown cue still suppresses BOTH agents in a multi-addressed-shaped message", () => {
  // "camber shut up and samber shut up too" — looks structurally like a
  // multi-addressed message but carries a shutdown cue. Shutdown wins.
  for (const agentName of ["Camber", "Samber"]) {
    const r = socialGovernor({
      text: "camber shut up and samber shut up too",
      agentName,
      recentHistory: [],
      isCaleb: false,
    });
    assert.equal(r.decision, "skip", `${agentName} must respect shutdown`);
  }
});

test("DM (no peer agent named) is unaffected by multi-addressed logic", () => {
  // Camber-only DM: "camber what do you know about cows?" — multi-addressed
  // detection requires two distinct personas. With only Camber named the
  // detection returns isMulti=false and the regular reply path is used.
  const r = socialGovernor({
    text: "camber what do you know about cows?",
    agentName: "Camber",
    recentHistory: [],
    isCaleb: true,
  });
  assert.equal(r.decision, "reply");
  assert.notEqual(
    r.responseStyle,
    "multi-addressed",
    "single-agent message must not trigger multi-addressed style",
  );
  assert.equal(r.focusClause, undefined);
});

test("detectMultiAddressed: cow/pig case", () => {
  const r = detectMultiAddressed(COW_PIG_TEXT);
  assert.equal(r.isMulti, true);
  assert.match(r.clauses.camber, /cows/i);
  assert.doesNotMatch(r.clauses.camber, /pigs/i);
  assert.match(r.clauses.samber, /pigs/i);
  assert.doesNotMatch(r.clauses.samber, /cows/i);
});

test("detectMultiAddressed: shared greeting is NOT multi", () => {
  const r = detectMultiAddressed("yo Camber and Samber what's good");
  assert.equal(r.isMulti, false);
});

test("detectMultiAddressed: only one agent named is NOT multi", () => {
  const r = detectMultiAddressed("camber what about cows?");
  assert.equal(r.isMulti, false);
});

test("detectMultiAddressed: empty input is NOT multi", () => {
  const r = detectMultiAddressed("");
  assert.equal(r.isMulti, false);
});
