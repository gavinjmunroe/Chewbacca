/**
 * dm-each.js — `dm_each_in_group` fan-out tool.
 *
 * When the user asks Medha to "remind everyone individually" / "DM
 * each person" / "follow up with everyone privately," this tool sends
 * a private iMessage to each opted-in participant of the current
 * group chat. Non-opted-in participants are silently skipped (decision
 * 14: strict opt-in). The sender is excluded by default. Medha is
 * excluded by default.
 *
 * Group echo: after the fan-out, Medha posts ONE line in the group
 * confirming the count (default "confirm"). Can be set to "silent"
 * (nothing) or "tapback" (heart-react the trigger message).
 *
 * Per-recipient personalization is opt-in via `personalize: true`
 * (which would burn an LLM call per recipient — not on for v1).
 * For now the same body goes to everyone, with optional {{name}} /
 * {{first_name}} template substitution.
 */

import { sendMessage } from "../transport.js";
import { loadGroupMemory } from "../group-memory.js";
import { eligibleDmRecipients } from "../group-memory.js";
import { filterSuppressed, isSuppressed } from "../suppressions.js";
import { registerCapability } from "../capabilities.js";
import { insertRow, tenantId as pdwTenantId } from "../pdw/bq-client.js";

registerCapability("_tools_DmEach", [
  "Fan-out individual DMs to every opted-in participant of the current group (dm_each_in_group)",
]);

export const DM_EACH_TOOLS = [
  {
    name: "dm_each_in_group",
    description:
      "Send an individual iMessage DM to each opted-in participant of the " +
      "CURRENT group chat. Use when the user asks Medha to remind / " +
      "message / ping / follow up with everyone individually. Does NOT " +
      "post the body in the group. Silently skips participants who " +
      "haven't opted in. Sender is excluded by default.",
    input_schema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description:
            "Body each person receives. May include {{name}} or {{first_name}} " +
            "tokens that get replaced with the recipient's resolved display name.",
        },
        exclude: {
          type: "array",
          items: { type: "string" },
          description:
            "Handles (phone/email) to skip in addition to the sender + Medha.",
        },
        include_sender: {
          type: "boolean",
          description:
            "Default false — the person who asked Medha to fan out usually " +
            "doesn't need a DM. Set true to include them anyway.",
        },
        group_echo: {
          type: "string",
          enum: ["confirm", "silent", "tapback"],
          description:
            "Post-fan-out behavior in the group. confirm (default) posts one " +
            "line like 'DM'd 3 people.'; silent posts nothing; tapback heart-" +
            "reacts the trigger message.",
        },
        dry_run: {
          type: "boolean",
          description:
            "Preview mode. When true, run the full resolution + body render " +
            "but DON'T send. Returns preview[] of {handle, body} the LLM can " +
            "show to the user for confirmation. flaw #15.",
        },
      },
      required: ["message"],
    },
  },
];

/**
 * Render a per-recipient body. Currently supports {{name}} and
 * {{first_name}} substitution. Unknown tokens are left as-is so a
 * malformed prompt doesn't silently lose text. Returns {body, fellBack}
 * so the caller can flag {{name}}-fallback-to-handle cases (flaw #14).
 */
function renderBody(template, recipient) {
  if (!template) return { body: "", fellBack: false };
  const hasName = !!(recipient?.name && String(recipient.name).trim());
  const name = hasName ? recipient.name : recipient?.handle || "";
  const first = name ? String(name).trim().split(/\s+/)[0] : "";
  const usesNameToken = /\{\{\s*(?:name|first_name)\s*\}\}/i.test(template);
  const body = template
    .replace(/\{\{\s*name\s*\}\}/gi, name)
    .replace(/\{\{\s*first_name\s*\}\}/gi, first);
  return { body, fellBack: usesNameToken && !hasName };
}

// flaw #12 — phishing / scam shape guard. Refuses to fan-out body
// content that looks like credential harvesting or known scam shapes.
// Conservative: only blocks obvious patterns so the LLM still has
// freedom to send legit reminders (which sometimes mention links etc).
const DANGEROUS_BODY_PATTERNS = [
  /send (?:me )?your (?:password|otp|2fa|seed|seed phrase|private key|ssn|social)/i,
  /verify your (?:account|identity).{0,40}(?:click|tap|login)/i,
  /click (?:here|this link).{0,40}(?:verify|reset|unlock|claim)/i,
  /(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl)\/[^\s]+.{0,80}(?:verify|unlock|claim|reset)/i,
  /wire \$?\d+|gift card.{0,40}(?:redeem|code)/i,
  /you'?ve won.{0,40}(?:claim|prize|click)/i,
];

function checkSafeBody(body) {
  if (!body) return { ok: true };
  for (const re of DANGEROUS_BODY_PATTERNS) {
    if (re.test(body)) {
      return {
        ok: false,
        reason: `body matched a dangerous pattern (${re.source.slice(0, 40)}...)`,
      };
    }
  }
  return { ok: true };
}

// flaw #13 — per-recipient sliding window rate limit. Sliding 1h window,
// max 5 DMs per recipient through dm_each (regardless of trigger). The
// map is process-local; on restart the window resets, which is fine for
// abuse prevention (the limit is on hot loops, not lifetime quota).
const RECIPIENT_WINDOW_MS = 60 * 60 * 1000;
const RECIPIENT_MAX = 5;
const recipientSends = new Map(); // handle → array of ms timestamps

function checkRateLimit(handle) {
  const now = Date.now();
  const arr = recipientSends.get(handle) || [];
  const recent = arr.filter((t) => now - t < RECIPIENT_WINDOW_MS);
  if (recent.length >= RECIPIENT_MAX) {
    return {
      ok: false,
      reason: `rate-limited: ${recent.length}/${RECIPIENT_MAX} DMs in last hour`,
    };
  }
  recipientSends.set(handle, recent);
  return { ok: true };
}

function recordSend(handle) {
  const arr = recipientSends.get(handle) || [];
  arr.push(Date.now());
  recipientSends.set(handle, arr);
}

// flaw #17 — small retry helper for transient network failures.
const TRANSIENT_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED"]);

async function sendWithRetry(handle, body, opts) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await sendMessage(handle, body, opts);
    } catch (err) {
      lastErr = err;
      const code = err?.code || err?.cause?.code;
      const transient =
        TRANSIENT_CODES.has(code) ||
        /ETIMEDOUT|ECONNRESET/.test(err?.message || "");
      if (attempt >= 2 || !transient) throw err;
      console.warn(
        `[dm_each] transient ${code || "err"} for ${handle}, retrying`,
      );
    }
  }
  throw lastErr;
}

/**
 * Actually run the fan-out. Returns a summary the LLM can use to
 * compose its in-group reply (when group_echo === "confirm" the
 * dispatcher posts the echo itself; for "silent" the LLM may not
 * emit any reply text at all).
 */
async function dmEachInGroup(input, ctx = {}) {
  const {
    message,
    exclude = [],
    include_sender = false,
    group_echo = "confirm",
    dry_run = false,
  } = input || {};
  const { tenant, normFrom, groupId, isGroup } = ctx;

  if (!message || typeof message !== "string") {
    return { error: "message is required" };
  }
  if (!isGroup || !groupId) {
    return {
      error:
        "dm_each_in_group can only be called from inside a group chat. " +
        "The CURRENT group_id is missing.",
    };
  }
  if (!tenant) {
    return { error: "tenant context required" };
  }

  // flaw #12 — safety guard on the body BEFORE we resolve recipients.
  const safety = checkSafeBody(message);
  if (!safety.ok) {
    console.warn(
      `[dm_each] refused unsafe body in group ${groupId}: ${safety.reason}`,
    );
    return {
      error: "unsafe_body",
      reason: safety.reason,
      llm_summary:
        "I didn't send that — the message body looked like a scam / phishing " +
        "pattern. Rewrite it without the suspicious bits and try again.",
    };
  }

  // flaw #16 — include_sender visibility. Log when used so we can see the
  // model exercising it (and confirm the path is actually wired).
  if (include_sender) {
    console.log(
      `[dm_each] include_sender=true in group ${groupId} (sender=${normFrom})`,
    );
  }

  // Load the current group's memory to read the opt-in roster.
  const groupMem = await loadGroupMemory(groupId, tenant).catch(() => null);
  if (!groupMem) {
    return { error: `could not load group memory for ${groupId}` };
  }

  // Build the excluded set: the requester (unless include_sender),
  // Medha's own sender phone (never DM ourselves), and any explicit
  // excludes the caller passed.
  const excludeList = [
    ...exclude,
    tenant?.loopSenderPhone || null,
    tenant?.phoneNumber || null,
  ].filter(Boolean);
  if (!include_sender && normFrom) excludeList.push(normFrom);

  // Two-layer gate: (1) per-group opt-in roster, (2) global STOP list.
  // A STOP from any prior DM thread universally mutes that handle
  // across every group, even if their per-group status still says
  // opted_in. STOP wins.
  const optInEligible = eligibleDmRecipients(groupMem, {
    exclude: excludeList,
  });
  const recipientHandles = filterSuppressed(optInEligible);
  const suppressed_skipped = optInEligible.filter((h) => isSuppressed(h));

  if (recipientHandles.length === 0) {
    // No one is opted in (yet). The LLM should tell the group that
    // they need to 👍 the handshake first; we surface that explicitly.
    return {
      sent_handles: [],
      failed: [],
      skipped_non_opted_in: Object.entries(groupMem.optInStatus || {})
        .filter(([, s]) => s !== "opted_in")
        .map(([h]) => h),
      note: "no opted-in recipients yet — group still needs to 👍 the handshake.",
    };
  }

  // Build a name lookup from the participants list so {{name}} works.
  const participantByHandle = new Map();
  for (const p of groupMem.participants || []) {
    if (typeof p === "string") {
      participantByHandle.set(p, { handle: p, name: null });
    } else if (p?.handle) {
      participantByHandle.set(p.handle, p);
    }
  }

  // flaw #15 — dry_run short-circuit. Do all the work except the send.
  if (dry_run) {
    const preview = recipientHandles.map((handle) => {
      const recipient = participantByHandle.get(handle) || { handle };
      const { body, fellBack } = renderBody(message, recipient);
      return { handle, body, name_fallback: fellBack };
    });
    return {
      dry_run: true,
      preview,
      would_skip_global_stop: suppressed_skipped,
      llm_summary: `preview: would DM ${preview.length} ${preview.length === 1 ? "person" : "people"} (dry run — nothing sent).`,
    };
  }

  // Fan out. Sequentially to avoid Loop rate-limit spikes; the group
  // is at most ~30 people so this is fine. Catch per-recipient so one
  // bad send doesn't abort the rest.
  const sent = [];
  const failed = [];
  const rate_limited = [];
  const unresolved_names = []; // flaw #14
  for (const handle of recipientHandles) {
    // flaw #13 — per-recipient rate limit. Refuse-then-record-on-success.
    const rl = checkRateLimit(handle);
    if (!rl.ok) {
      rate_limited.push({ handle, reason: rl.reason });
      failed.push({ handle, error: rl.reason });
      continue;
    }
    const recipient = participantByHandle.get(handle) || { handle };
    const { body, fellBack } = renderBody(message, recipient);
    if (fellBack) unresolved_names.push(handle); // flaw #14
    try {
      // flaw #17 — retry on transient network failures.
      const result = await sendWithRetry(handle, body, { tenant });
      if (result?.duplicate) {
        // The transport's idempotency guard suppressed it (same body to
        // same recipient within 60s). Count as sent — the user already
        // got this exact message.
        sent.push(handle);
        recordSend(handle);
      } else if (result?.message_id || result?.contact) {
        sent.push(handle);
        recordSend(handle);
      } else {
        failed.push({ handle, error: "no message_id returned" });
      }
    } catch (err) {
      failed.push({ handle, error: err?.message || String(err) });
    }
  }

  // Compose an `llm_summary` field so the model has a single string to
  // riff on in the group echo without inventing facts. Distinguishes
  // never-opted-in (handshake outcome) from globally-stopped (STOP'd in
  // a prior DM — they're an opted-in member of the group but Medha
  // promised never to DM them again). Without this, the LLM has been
  // saying things like "Sarah's in but I can't reach her" which gaslights.
  const skippedNonOpted = Object.entries(groupMem.optInStatus || {})
    .filter(([, s]) => s !== "opted_in")
    .map(([h]) => h);
  const summaryParts = [
    `DM'd ${sent.length} ${sent.length === 1 ? "person" : "people"}`,
  ];
  if (skippedNonOpted.length > 0) {
    summaryParts.push(
      `${skippedNonOpted.length} not yet opted in (need to 👍 the handshake)`,
    );
  }
  if (suppressed_skipped.length > 0) {
    // flaw #19 — give the LLM the exact phrasing for STOPped recipients
    // so it doesn't have to invent it.
    summaryParts.push(
      `${suppressed_skipped.length} previously texted STOP — they need to text YES to opt back in`,
    );
  }
  if (rate_limited.length > 0) {
    summaryParts.push(`${rate_limited.length} rate-limited (>5/hr cap)`);
  }
  if (failed.length > 0) {
    summaryParts.push(`${failed.length} failed to send`);
  }
  if (unresolved_names.length > 0) {
    summaryParts.push(
      `${unresolved_names.length} got the phone-number version (no display name in memory)`,
    );
  }

  // flaw #20 — audit log every dm_each invocation to event_messages.
  // Fire-and-forget; never block the reply path on BQ.
  // flaw #83 — also resolve from_person_id from the inbound handle so
  // the dashboard can join on persons instead of free-text handles.
  try {
    const { personIdFromHandle } = await import("../pdw/person-resolver.js");
    insertRow("event_messages", {
      message_id: `dm_each_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenant_id: pdwTenantId(),
      group_id: groupId,
      person_handle: normFrom || null,
      from_person_id: normFrom ? personIdFromHandle(normFrom) || null : null,
      direction: "dm_each_invoke",
      body: JSON.stringify({
        sent: sent.length,
        sent_handles: sent,
        failed,
        skipped_non_opted_in: skippedNonOpted,
        skipped_global_stop: suppressed_skipped,
        rate_limited,
        unresolved_names,
      }),
      occurred_at: new Date().toISOString(),
    }).catch(() => {});
  } catch {}

  // flaw #18 — result shape consistency. Drop `sent` (number) in favor
  // of the canonical `sent_handles` (array). Callers can do
  // `result.sent_handles.length` for the count. The llm_summary still
  // contains the human-readable count.
  return {
    sent_handles: sent,
    failed,
    skipped_non_opted_in: skippedNonOpted,
    skipped_global_stop: suppressed_skipped,
    rate_limited,
    unresolved_names, // flaw #14
    group_echo,
    llm_summary: summaryParts.join("; "),
  };
}

export async function executeDmEachTool(toolName, input, ctx = {}) {
  switch (toolName) {
    case "dm_each_in_group":
      return dmEachInGroup(input, ctx);
    default:
      return { error: `unknown dm-each tool: ${toolName}` };
  }
}
