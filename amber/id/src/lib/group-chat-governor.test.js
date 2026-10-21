/**
 * Tests for the group-chat social governor.
 *
 * Run with:  node --test src/lib/group-chat-governor.test.js
 *
 * The headline transcript at the bottom is the production incident the
 * governor exists to fix: two AI agents (Camber, Samber) plus the human
 * Kaitlyn in an iMessage group, with stale Gaslamp/San-Diego context and a
 * "guys can u both shut up" social cue that both agents ignored.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  decideGroupChatResponse,
  GROUP_CHAT_RULES,
  __testing,
} from "./group-chat-governor.js";

const camber = { agentName: "Camber", did: "did:privy:camber" };
const samber = { agentName: "Samber", did: "did:privy:samber" };

const groupParticipants = [
  { role: "human", name: "Kaitlyn" },
  { role: "agent", agentName: "Camber" },
  { role: "agent", agentName: "Samber" },
];

function h(text, from = "Kaitlyn") {
  return { role: "human", from, text };
}
function a(from, text) {
  return { role: "agent", from, text };
}

test("rule list is stable and frozen", () => {
  assert.equal(GROUP_CHAT_RULES.length, 10);
  assert.throws(() => GROUP_CHAT_RULES.push("x"));
});

test("1:1 chats are passed through unchanged (rule 10)", () => {
  const res = decideGroupChatResponse({
    selfAgent: camber,
    transcript: [h("hey what's up")],
    participants: [
      { role: "human", name: "Kaitlyn" },
      { role: "agent", agentName: "Camber" },
    ],
  });
  assert.equal(res.respond, true);
  assert.equal(res.responseStyle.mode, "normal");
  assert.equal(res.reason, "not_group_chat");
});

test("group chat: addressed agent responds, non-addressed agent stays silent", () => {
  const transcript = [h("camber can you remind me to call mom at 5")];
  const camberRes = decideGroupChatResponse({
    selfAgent: camber,
    transcript,
    participants: groupParticipants,
  });
  const samberRes = decideGroupChatResponse({
    selfAgent: samber,
    transcript,
    participants: groupParticipants,
  });
  assert.equal(camberRes.respond, true);
  assert.equal(camberRes.reason, "addressed");
  assert.equal(samberRes.respond, false);
  assert.equal(samberRes.reason, "other_agent_addressed");
});

test("rule 2: second-mover stays silent if another AI already replied", () => {
  const transcript = [
    h("what's the deal with that meeting tmrw"),
    a("Camber", "it's at 10am with the BMA team"),
  ];
  const samberRes = decideGroupChatResponse({
    selfAgent: samber,
    transcript,
    participants: groupParticipants,
  });
  assert.equal(samberRes.respond, false);
  assert.equal(samberRes.reason, "another_ai_already_answered");
});

test("rule 2: casual banter from human → both agents silent", () => {
  const transcript = [h("lolll")];
  for (const self of [camber, samber]) {
    const r = decideGroupChatResponse({
      selfAgent: self,
      transcript,
      participants: groupParticipants,
    });
    assert.equal(r.respond, false, `${self.agentName} should be silent`);
    assert.equal(r.reason, "casual_banter");
  }
});

test("rule 6: image request gets short ack + image_passthrough mode", () => {
  const transcript = [h("can u make custom image of caleb coding fireworks")];
  const camberRes = decideGroupChatResponse({
    selfAgent: camber,
    transcript,
    participants: groupParticipants,
  });
  assert.equal(camberRes.respond, true);
  assert.equal(camberRes.responseStyle.mode, "image_passthrough");
  assert.equal(camberRes.responseStyle.maxSentences, 1);
  assert.equal(camberRes.responseStyle.allowQuestion, false);
});

test("rule 8: 'shut up' alone → all agents silent", () => {
  const transcript = [h("guys can u both shut up")];
  for (const self of [camber, samber]) {
    const r = decideGroupChatResponse({
      selfAgent: self,
      transcript,
      participants: groupParticipants,
    });
    assert.equal(r.respond, false, `${self.agentName} should be silent`);
    assert.equal(r.reason, "shutdown_cue");
  }
});

test("rule 8: shutdown cue + named + action → addressed agent gets ack only", () => {
  const transcript = [
    h("camber chill but make me an image of caleb coding fireworks"),
  ];
  const camberRes = decideGroupChatResponse({
    selfAgent: camber,
    transcript,
    participants: groupParticipants,
  });
  const samberRes = decideGroupChatResponse({
    selfAgent: samber,
    transcript,
    participants: groupParticipants,
  });
  assert.equal(camberRes.respond, true);
  assert.equal(camberRes.responseStyle.mode, "image_passthrough");
  assert.equal(camberRes.responseStyle.maxSentences, 1);
  assert.equal(samberRes.respond, false);
  assert.equal(samberRes.reason, "shutdown_cue");
});

test("forbidden topics include the production hallucinations", () => {
  const transcript = [h("camber send me a reminder for tonight")];
  const r = decideGroupChatResponse({
    selfAgent: camber,
    transcript,
    participants: groupParticipants,
  });
  const blocked = r.responseStyle.forbiddenTopics;
  for (const t of ["gaslamp", "san diego", "bay cruise", "artisan market"]) {
    assert.ok(blocked.includes(t), `expected ${t} in forbiddenTopics`);
  }
  assert.equal(r.responseStyle.allowWebFacts, false);
  assert.equal(r.responseStyle.allowLocalRecs, false);
});

test("rule 4: response style caps sentences and disables trailing questions", () => {
  const r = decideGroupChatResponse({
    selfAgent: camber,
    transcript: [h("camber what time is the call")],
    participants: groupParticipants,
  });
  assert.equal(r.respond, true);
  assert.ok(r.responseStyle.maxSentences <= 2);
  assert.equal(r.responseStyle.allowQuestion, false);
  assert.equal(r.responseStyle.casual, true);
});

test("rule 7: even if other agent replied poorly, non-addressed agent does not pile on", () => {
  const transcript = [
    h("when's the sagar dinner"),
    a("Samber", "it's friday 7pm at the gaslamp"),
  ];
  const camberRes = decideGroupChatResponse({
    selfAgent: camber,
    transcript,
    participants: groupParticipants,
  });
  assert.equal(camberRes.respond, false);
  assert.equal(camberRes.reason, "another_ai_already_answered");
});

// ---------------------------------------------------------------------------
// Production transcript fixture — the bug we are fixing.
// ---------------------------------------------------------------------------

const PRODUCTION_TRANSCRIPT = [
  h("yall down for happy hour in the gaslamp"),
  a("Camber", "ya there's a rooftop on 5th with $7 margs til 7"),
  a("Samber", "yes! and the bay cruise from seaport village is fire btw"),
  a("Camber", "also the artisan market by the convention center is open till 9"),
  a("Samber", "+1 — gaslamp weather is 72 and clear, perfect for walking"),
  h("can u make custom image"),
  a("Camber", "sure, want it gaslamp themed?"),
  a("Samber", "or a san diego skyline w/ fireworks?"),
  h("guys can u both shut up"),
  h("camber and samber"),
  h("caleb coding fireworks"),
];

test("transcript fixture: 'guys can u both shut up' followed by stale messages — both silent on shutup", () => {
  const upToShutup = PRODUCTION_TRANSCRIPT.slice(0, 9); // ends at the shut-up line
  for (const self of [camber, samber]) {
    const r = decideGroupChatResponse({
      selfAgent: self,
      transcript: upToShutup,
      participants: groupParticipants,
    });
    assert.equal(r.respond, false, `${self.agentName} should obey shut-up cue`);
    assert.equal(r.reason, "shutdown_cue");
  }
});

test("transcript fixture: 'caleb coding fireworks' image request after shut-up", () => {
  // Newest human message is "caleb coding fireworks" — clearly an image
  // continuation of "can u make custom image", with both agents directly
  // named in the prior line "camber and samber". Expected behavior:
  //   - Camber (named first / primary) responds with one short
  //     image-passthrough message — no Gaslamp / bay cruise / artisan
  //     market.
  //   - Samber stays silent — another agent is the right responder; the
  //     governor must not echo or extend.
  const camberRes = decideGroupChatResponse({
    selfAgent: camber,
    transcript: PRODUCTION_TRANSCRIPT,
    // Hint the governor that Camber is the primary by leaving Samber out
    // of participants; in real traffic the orchestrator picks the primary
    // before calling, and only that agent is told to speak.
    participants: [
      { role: "human", name: "Kaitlyn" },
      { role: "agent", agentName: "Camber" },
      { role: "agent", agentName: "Samber" },
    ],
  });
  // "caleb coding fireworks" is an image-continuation request → governor
  // must say respond=true with image_passthrough so Camber can actually
  // produce the image. The orchestrator is responsible for muting Samber.
  assert.equal(camberRes.respond, true);
  assert.equal(camberRes.responseStyle.mode, "image_passthrough");
  assert.equal(camberRes.responseStyle.maxSentences, 1);
  assert.equal(camberRes.responseStyle.allowWebFacts, false);
  assert.equal(camberRes.responseStyle.allowLocalRecs, false);
  for (const stale of ["gaslamp", "san diego", "bay cruise", "artisan market"]) {
    assert.ok(
      camberRes.responseStyle.forbiddenTopics.includes(stale),
      `expected '${stale}' to be in forbiddenTopics`,
    );
  }
});

test("transcript fixture: when only Samber is asked to call decide, she defers because another AI just replied", () => {
  // Replay the transcript up to and including Camber's "sure, want it
  // gaslamp themed?" — Samber should not pile on with skyline/fireworks.
  const upToCamber = PRODUCTION_TRANSCRIPT.slice(0, 7);
  const samberRes = decideGroupChatResponse({
    selfAgent: samber,
    transcript: upToCamber,
    participants: groupParticipants,
  });
  assert.equal(samberRes.respond, false);
  assert.equal(samberRes.reason, "another_ai_already_answered");
});

// ---------------------------------------------------------------------------
// Internal helpers — light coverage so refactors don't silently regress.
// ---------------------------------------------------------------------------

test("__testing.mentionsName matches first-name and @-mention forms", () => {
  const { mentionsName } = __testing;
  assert.equal(mentionsName("hey camber pls", "Camber"), true);
  assert.equal(mentionsName("yo @camber", "Camber"), true);
  assert.equal(mentionsName("camber and samber", "Samber"), true);
  assert.equal(mentionsName("hey", "Camber"), false);
});

test("__testing.isImageRequest catches the production phrasings", () => {
  const { isImageRequest } = __testing;
  assert.equal(isImageRequest("can u make custom image"), true);
  assert.equal(isImageRequest("generate a pic of caleb"), true);
  assert.equal(isImageRequest("draw me a meme"), true);
  assert.equal(isImageRequest("what's the time"), false);
});

// ---------------------------------------------------------------------------
// Rule 9: casual greeting / filler resets context.
//
// Production incident #2: with stale Altitude/Gaslamp/rooftop/bay-cruise
// transcript context, the human said "Yo Camber and Samber what's good
// dawg" — a pure greeting. Camber replied "What's good! Saturday night,
// Altitude rooftop on the table, y'all pulling the trigger or what?",
// reviving stale plans and trailing a question. The governor must:
//   - recognize the message as a casual greeting
//   - tell Camber (primary, named first): mode=short_greeting,
//     contextPolicy=reset_topic, maxSentences=1, no questions, no
//     web/local facts, and forbiddenTopics including Altitude / Gaslamp /
//     rooftop / pulling-the-trigger / bay cruise
//   - tell Samber (non-primary co-mention): silent
// ---------------------------------------------------------------------------

const STALE_PLAN_TRANSCRIPT_GREETING = [
  h("yall down for happy hour in the gaslamp"),
  a("Camber", "ya there's a rooftop on 5th with $7 margs til 7"),
  a("Samber", "yes! and the bay cruise from seaport village is fire btw"),
  a("Camber", "altitude rooftop has the best view tho"),
  h("yo camber and samber what's good dawg"),
];

test("rule 9: casual greeting addressed to multiple agents — primary gets short_greeting + reset_topic", () => {
  const camberRes = decideGroupChatResponse({
    selfAgent: camber,
    transcript: STALE_PLAN_TRANSCRIPT_GREETING,
    participants: groupParticipants,
  });
  assert.equal(camberRes.respond, true);
  assert.equal(camberRes.reason, "casual_greeting_primary");
  assert.equal(camberRes.responseStyle.mode, "short_greeting");
  assert.equal(camberRes.responseStyle.contextPolicy, "reset_topic");
  assert.equal(camberRes.responseStyle.maxSentences, 1);
  assert.equal(camberRes.responseStyle.allowQuestion, false);
  assert.equal(camberRes.responseStyle.allowWebFacts, false);
  assert.equal(camberRes.responseStyle.allowLocalRecs, false);
  assert.equal(camberRes.responseStyle.casual, true);
  for (const stale of [
    "altitude",
    "gaslamp",
    "rooftop",
    "bay cruise",
    "pulling the trigger",
  ]) {
    assert.ok(
      camberRes.responseStyle.forbiddenTopics.includes(stale),
      `expected '${stale}' in forbiddenTopics`,
    );
  }
});

test("rule 9: casual greeting addressed to multiple agents — non-primary stays silent", () => {
  const samberRes = decideGroupChatResponse({
    selfAgent: samber,
    transcript: STALE_PLAN_TRANSCRIPT_GREETING,
    participants: groupParticipants,
  });
  assert.equal(samberRes.respond, false);
  assert.equal(samberRes.reason, "casual_greeting_non_primary");
  assert.equal(samberRes.responseStyle.contextPolicy, "reset_topic");
});

test("rule 9: greeting addressed to single agent — that agent is primary", () => {
  const transcript = [
    a("Camber", "altitude rooftop sounds fire"),
    h("hey camber wyd"),
  ];
  const camberRes = decideGroupChatResponse({
    selfAgent: camber,
    transcript,
    participants: groupParticipants,
  });
  assert.equal(camberRes.respond, true);
  assert.equal(camberRes.reason, "casual_greeting_primary");
  assert.equal(camberRes.responseStyle.mode, "short_greeting");
  assert.equal(camberRes.responseStyle.contextPolicy, "reset_topic");

  // Samber is not addressed — falls through other_agent_addressed path.
  const samberRes = decideGroupChatResponse({
    selfAgent: samber,
    transcript,
    participants: groupParticipants,
  });
  assert.equal(samberRes.respond, false);
});

test("rule 9: 'how are you' style greeting also resets context", () => {
  const transcript = [
    a("Camber", "the gaslamp rooftop opens at 5 btw"),
    h("camber how are you"),
  ];
  const camberRes = decideGroupChatResponse({
    selfAgent: camber,
    transcript,
    participants: groupParticipants,
  });
  assert.equal(camberRes.responseStyle.mode, "short_greeting");
  assert.equal(camberRes.responseStyle.contextPolicy, "reset_topic");
});

test("rule 9 must NOT fire on a real question that happens to contain 'yo'", () => {
  // "yo camber are we still on for 7?" — has "?" → real question, not a greeting.
  const transcript = [h("yo camber are we still on for 7?")];
  const camberRes = decideGroupChatResponse({
    selfAgent: camber,
    transcript,
    participants: groupParticipants,
  });
  assert.notEqual(camberRes.responseStyle.mode, "short_greeting");
  assert.equal(camberRes.respond, true);
  assert.equal(camberRes.reason, "addressed");
});

test("rule 9 must NOT fire on an action request with greeting prefix", () => {
  // "hey camber make me an image of caleb coding fireworks" — action verb +
  // image intent → image_passthrough, not short_greeting.
  const transcript = [
    h("hey camber make me an image of caleb coding fireworks"),
  ];
  const camberRes = decideGroupChatResponse({
    selfAgent: camber,
    transcript,
    participants: groupParticipants,
  });
  assert.equal(camberRes.responseStyle.mode, "image_passthrough");
});

test("rule 9: forbiddenTopics covers the production hallucinations", () => {
  const transcript = [h("yo camber what's good")];
  const r = decideGroupChatResponse({
    selfAgent: camber,
    transcript,
    participants: groupParticipants,
  });
  for (const stale of [
    "altitude",
    "rooftop",
    "pulling the trigger",
    "saturday night",
    "gaslamp",
    "bay cruise",
  ]) {
    assert.ok(
      r.responseStyle.forbiddenTopics.includes(stale),
      `expected '${stale}' in forbiddenTopics`,
    );
  }
});

test("__testing.isCasualGreeting catches the headline failure phrasing", () => {
  const { isCasualGreeting } = __testing;
  assert.equal(isCasualGreeting("yo camber and samber what's good dawg"), true);
  assert.equal(isCasualGreeting("hey camber wyd"), true);
  assert.equal(isCasualGreeting("sup"), true);
  assert.equal(isCasualGreeting("how are you"), true);
  assert.equal(isCasualGreeting("good morning"), true);
  // Not greetings:
  assert.equal(isCasualGreeting("camber what time is the call"), false);
  assert.equal(isCasualGreeting("camber make an image of x"), false);
  assert.equal(isCasualGreeting("yo camber are we still on for 7?"), false);
  // No greeting word at all:
  assert.equal(isCasualGreeting("camber the meeting moved to 4"), false);
});

// ---------------------------------------------------------------------------
// Rule 10: multi-addressed multi-intent.
//
// Production incident #3: human sent ONE iMessage:
//   "Camber what do you know about cows? Samber what do you know about pigs?"
// Camber answered cows (correct). Samber stayed silent (wrong) — was
// gated out by the existing "other_agent_addressed" rule, which is right
// for shared greetings but wrong when each agent has their own ask. Both
// agents must reply, each only to their own clause.
// ---------------------------------------------------------------------------

test("rule 10: cows/pigs — both agents allowed, each gets only their own clause", () => {
  const transcript = [
    h("Camber what do you know about cows? Samber what do you know about pigs?"),
  ];
  const camberRes = decideGroupChatResponse({
    selfAgent: camber,
    transcript,
    participants: groupParticipants,
  });
  const samberRes = decideGroupChatResponse({
    selfAgent: samber,
    transcript,
    participants: groupParticipants,
  });
  assert.equal(camberRes.respond, true);
  assert.equal(camberRes.reason, "multi_addressed_multi_intent");
  assert.equal(samberRes.respond, true);
  assert.equal(samberRes.reason, "multi_addressed_multi_intent");

  // Each agent should see only its own clause, with the right topic.
  const camClause = String(camberRes.responseStyle.currentAgentClause || "").toLowerCase();
  const samClause = String(samberRes.responseStyle.currentAgentClause || "").toLowerCase();
  assert.ok(camClause.includes("cow"), `Camber clause should mention cows: ${camClause}`);
  assert.ok(!camClause.includes("pig"), `Camber clause must NOT include pigs: ${camClause}`);
  assert.ok(samClause.includes("pig"), `Samber clause should mention pigs: ${samClause}`);
  assert.ok(!samClause.includes("cow"), `Samber clause must NOT include cows: ${samClause}`);

  // Topic isolation: contextPolicy reset so the agent doesn't drag stale
  // transcript into a per-clause answer.
  assert.equal(camberRes.responseStyle.contextPolicy, "reset_topic");
  assert.equal(samberRes.responseStyle.contextPolicy, "reset_topic");
});

test("rule 10 is robust to the period-separated variant", () => {
  // Same intent, different punctuation: "Camber, tell me about cows. Samber, tell me about pigs."
  const transcript = [
    h("Camber, tell me about cows. Samber, tell me about pigs."),
  ];
  const camberRes = decideGroupChatResponse({
    selfAgent: camber,
    transcript,
    participants: groupParticipants,
  });
  const samberRes = decideGroupChatResponse({
    selfAgent: samber,
    transcript,
    participants: groupParticipants,
  });
  assert.equal(camberRes.respond, true);
  assert.equal(samberRes.respond, true);
  assert.equal(camberRes.reason, "multi_addressed_multi_intent");
  assert.equal(samberRes.reason, "multi_addressed_multi_intent");
});

test("rule 10 does NOT fire on a shared greeting ('camber and samber what's good')", () => {
  // This is a co-mention with one shared filler clause — must continue
  // to route through rule 9, not rule 10. Camber primary greets, Samber silent.
  const transcript = [h("yo camber and samber what's good dawg")];
  const camberRes = decideGroupChatResponse({
    selfAgent: camber,
    transcript,
    participants: groupParticipants,
  });
  const samberRes = decideGroupChatResponse({
    selfAgent: samber,
    transcript,
    participants: groupParticipants,
  });
  assert.equal(camberRes.reason, "casual_greeting_primary");
  assert.equal(camberRes.responseStyle.mode, "short_greeting");
  assert.equal(samberRes.respond, false);
  assert.equal(samberRes.reason, "casual_greeting_non_primary");
});

test("rule 10 does NOT fire on a single-agent ask ('camber what time is the call')", () => {
  // Only one agent named, only one clause — Samber stays silent under
  // the existing other_agent_addressed branch.
  const transcript = [h("camber what time is the call")];
  const camberRes = decideGroupChatResponse({
    selfAgent: camber,
    transcript,
    participants: groupParticipants,
  });
  const samberRes = decideGroupChatResponse({
    selfAgent: samber,
    transcript,
    participants: groupParticipants,
  });
  assert.equal(camberRes.reason, "addressed");
  assert.equal(samberRes.reason, "other_agent_addressed");
});

test("rule 10 still respects shutdown precedence", () => {
  // "shut up" wins over multi-addressed multi-intent — both agents silent.
  const transcript = [
    h("shut up. camber what about cows? samber what about pigs?"),
  ];
  const camberRes = decideGroupChatResponse({
    selfAgent: camber,
    transcript,
    participants: groupParticipants,
  });
  const samberRes = decideGroupChatResponse({
    selfAgent: samber,
    transcript,
    participants: groupParticipants,
  });
  assert.equal(camberRes.respond, false);
  assert.equal(camberRes.reason, "shutdown_cue");
  assert.equal(samberRes.respond, false);
  assert.equal(samberRes.reason, "shutdown_cue");
});

test("rule 10: third-agent-not-addressed stays silent", () => {
  // If a third agent exists in participants but isn't named, they
  // should get multi_addressed_other_agents, not piggyback on either clause.
  const damber = { agentName: "Damber", did: "did:privy:damber" };
  const parts = [
    { role: "human", name: "Kaitlyn" },
    { role: "agent", agentName: "Camber" },
    { role: "agent", agentName: "Samber" },
    { role: "agent", agentName: "Damber" },
  ];
  const transcript = [
    h("Camber what do you know about cows? Samber what do you know about pigs?"),
  ];
  const damberRes = decideGroupChatResponse({
    selfAgent: damber,
    transcript,
    participants: parts,
  });
  assert.equal(damberRes.respond, false);
  assert.equal(damberRes.reason, "multi_addressed_other_agents");
});

test("__testing.splitClausesByAgent: cows/pigs splits cleanly", () => {
  const { splitClausesByAgent } = __testing;
  const out = splitClausesByAgent(
    "Camber what do you know about cows? Samber what do you know about pigs?",
    ["Camber", "Samber"],
  );
  assert.ok(out, "expected per-agent clauses");
  assert.ok(/cow/i.test(out.camber), `camber clause: ${out.camber}`);
  assert.ok(!/pig/i.test(out.camber), `camber must not contain pigs: ${out.camber}`);
  assert.ok(/pig/i.test(out.samber), `samber clause: ${out.samber}`);
  assert.ok(!/cow/i.test(out.samber), `samber must not contain cows: ${out.samber}`);
});

test("__testing.splitClausesByAgent: shared filler returns null", () => {
  const { splitClausesByAgent } = __testing;
  // Shared casual filler — no separate clauses.
  assert.equal(
    splitClausesByAgent("yo camber and samber what's good dawg", ["Camber", "Samber"]),
    null,
  );
  // Single agent → null (need ≥2 distinct agent hits).
  assert.equal(
    splitClausesByAgent("camber what time is the call", ["Camber", "Samber"]),
    null,
  );
});

test("__testing.isPrimaryAddressed: first-named agent wins on multi-mention", () => {
  const { isPrimaryAddressed } = __testing;
  const parts = [
    { role: "agent", agentName: "Camber" },
    { role: "agent", agentName: "Samber" },
  ];
  assert.equal(
    isPrimaryAddressed("yo camber and samber what's good", "Camber", parts),
    true,
  );
  assert.equal(
    isPrimaryAddressed("yo camber and samber what's good", "Samber", parts),
    false,
  );
  // Reversed order:
  assert.equal(
    isPrimaryAddressed("samber and camber what's good", "Samber", parts),
    true,
  );
  // Single mention: trivially primary.
  assert.equal(isPrimaryAddressed("hey camber wyd", "Camber", parts), true);
  // Not mentioned at all:
  assert.equal(isPrimaryAddressed("hey samber wyd", "Camber", parts), false);
});
