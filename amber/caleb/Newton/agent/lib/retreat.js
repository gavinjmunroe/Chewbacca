/**
 * Retreat mode: questionnaire-driven onboarding for retreat participants.
 *
 * Post-migration, the retreat config and responses live in amber-id's
 * operational store under `retreat_config` and `retreat_responses`
 * tables. If the caller's tenant has no retreat_config row, the feature
 * is disabled for that tenant.
 */

import { sbGet, sbUpsert } from "./data.js";
import { normalizeHandle } from "./permissions.js";

export let retreatConfig = null;
export const retreatState = new Map();

// In-memory tenant context set once at load time by agent.js when it
// resolves the tenant. The retreat feature is per-tenant; we cache the
// most recently loaded tenant so save operations can scope correctly.
let loadedForTenant = null;

export async function loadRetreatConfig(tenant = null) {
  loadedForTenant = tenant;
  try {
    const row = await sbGet("retreat_config", "active=eq.true", tenant);
    retreatConfig = row || null;
    if (retreatConfig?.active) {
      console.log(
        `Retreat mode ACTIVE: "${retreatConfig.name}" with ${retreatConfig.questions?.length || 0} questions`,
      );
    }
  } catch (err) {
    console.warn("[retreat] loadRetreatConfig failed:", err.message);
    retreatConfig = null;
  }
}

export async function loadRetreatResponses(tenant = null) {
  loadedForTenant = tenant;
  try {
    const row = await sbGet("retreat_responses", "id=eq.current", tenant);
    if (!row?.responses) return;
    for (const [phone, state] of Object.entries(row.responses)) {
      retreatState.set(phone, state);
    }
    console.log(`Loaded ${retreatState.size} retreat participant states`);
  } catch (err) {
    console.warn("[retreat] loadRetreatResponses failed:", err.message);
  }
}

async function saveRetreatResponses() {
  const obj = {};
  for (const [phone, state] of retreatState) {
    obj[phone] = state;
  }
  try {
    await sbUpsert(
      "retreat_responses",
      { id: "current", responses: obj, updated_at: new Date().toISOString() },
      loadedForTenant,
    );
  } catch (err) {
    console.warn("[retreat] saveRetreatResponses failed:", err.message);
  }
}

export function isRetreatOrganizer(phone) {
  if (!retreatConfig) return false;
  const organizers = retreatConfig.organizer_phones || [];
  const norm = normalizeHandle(phone);
  return organizers.some((o) => normalizeHandle(o) === norm);
}

export async function handleRetreatMessage(from, text) {
  if (!retreatConfig || !retreatConfig.active) return { handled: false };
  if (isRetreatOrganizer(from)) return { handled: false };

  const questions = retreatConfig.questions || [];
  if (questions.length === 0) return { handled: false };

  let state = retreatState.get(from);

  if (!state) {
    state = {
      step: 0,
      answers: [],
      name: null,
      startedAt: new Date().toISOString(),
      completed: false,
    };
    retreatState.set(from, state);

    const intro =
      retreatConfig.intro_message ||
      `Hey! I'm Amber, here to help make the retreat amazing. Quick questions from Sagar:`;
    const firstQ = questions[0];
    saveRetreatResponses().catch(() => {});
    return { handled: true, reply: `${intro}\n\n${firstQ}` };
  }

  if (state.completed) return { handled: false };

  const currentQuestion = questions[state.step];
  state.answers.push({
    question: currentQuestion,
    answer: text,
    timestamp: new Date().toISOString(),
  });
  state.step += 1;

  if (!state.name && state.step === 1) {
    if (retreatConfig.collect_name !== false) {
      const nameMatch = text.match(
        /^(?:i'?m|my name is|i am|it'?s)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
      );
      if (nameMatch) state.name = nameMatch[1].trim();
    }
  }

  if (state.step < questions.length) {
    retreatState.set(from, state);
    saveRetreatResponses().catch(() => {});
    const nextQ = questions[state.step];
    return { handled: true, reply: nextQ };
  }

  state.completed = true;
  state.completedAt = new Date().toISOString();
  retreatState.set(from, state);
  saveRetreatResponses().catch(() => {});

  const thankYou =
    retreatConfig.thank_you_message ||
    `That's it! Thank you so much. See you at the retreat. Text here anytime if you need anything.`;
  return { handled: true, reply: thankYou };
}

export function buildRetreatSummary() {
  if (!retreatConfig) return "No retreat config loaded.";
  const lines = [
    `${retreatConfig.name || "Retreat"} Response Summary`,
    `${retreatState.size} participant${retreatState.size !== 1 ? "s" : ""} so far\n`,
  ];

  let completed = 0;
  for (const [phone, state] of retreatState) {
    const displayName = state.name || phone;
    const status = state.completed
      ? "Done"
      : `Q${state.step + 1}/${(retreatConfig.questions || []).length}`;
    lines.push(`${status} ${displayName}`);
    for (const a of state.answers) {
      lines.push(`  Q: ${a.question}`);
      lines.push(`  A: ${a.answer}`);
    }
    lines.push("");
    if (state.completed) completed++;
  }

  lines.push(`${completed}/${retreatState.size} completed`);
  return lines.join("\n");
}
