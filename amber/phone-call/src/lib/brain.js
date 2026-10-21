// amber-phone-call is a voice adapter, not a brain. Every turn of
// conversation is forwarded to the real Amber backend, which owns:
//   - Claude reasoning
//   - Perplexity embeddings for relational / contact memory
//   - Perplexity search for deep research
//   - Todoist, Calendar, health, Clay, GitHub tools
//   - Multi-tenant identity and conversation history
//
// This module is intentionally thin. It POSTs the caller's transcript
// and gets back a text reply ready to be spoken.

const DEFAULT_TIMEOUT_MS = 25_000; // Twilio waits up to 30s for TwiML

export async function askAmber({ callSid, caller, userText }) {
  const url = process.env.AMBER_AGENT_URL;
  if (!url) {
    return fallbackReply(userText);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/api/voice-turn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.AMBER_AGENT_SECRET
          ? { Authorization: `Bearer ${process.env.AMBER_AGENT_SECRET}` }
          : {}),
      },
      body: JSON.stringify({
        callSid,
        caller,
        userText,
        channel: "phone",
      }),
      signal: controller.signal,
    });

    const rawBody = await res.text();
    const contentType = res.headers.get("content-type") || "";
    const looksJson = contentType.includes("application/json");

    if (!res.ok) {
      console.warn(
        `[brain] amber-agent ${res.status}: ${rawBody.slice(0, 160)}`,
      );
      return fallbackReply(userText, "backend_error");
    }

    if (!looksJson) {
      // amber-agent's default text handler responded — the /api/voice-turn
      // route isn't deployed yet. Fall back instead of crashing the call.
      console.warn(
        "[brain] amber-agent returned non-JSON. Voice-turn route likely missing.",
      );
      return fallbackReply(userText, "route_missing");
    }

    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      console.warn("[brain] amber-agent returned malformed JSON");
      return fallbackReply(userText, "parse_error");
    }

    if (!data || typeof data.reply !== "string" || !data.reply.trim()) {
      console.warn("[brain] amber-agent returned no reply field");
      return fallbackReply(userText, "no_reply");
    }

    return data.reply.trim();
  } catch (err) {
    console.warn("[brain] askAmber failed:", err.message);
    return fallbackReply(userText, "exception");
  } finally {
    clearTimeout(timer);
  }
}

// Signals call end to the brain so it can flush conversation state,
// embed the transcript, update contact memory, etc.
export async function endSession(callSid) {
  const url = process.env.AMBER_AGENT_URL;
  if (!url || !callSid) return;
  try {
    await fetch(`${url.replace(/\/+$/, "")}/api/voice-turn/end`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.AMBER_AGENT_SECRET
          ? { Authorization: `Bearer ${process.env.AMBER_AGENT_SECRET}` }
          : {}),
      },
      body: JSON.stringify({ callSid }),
    });
  } catch (err) {
    console.warn("[brain] endSession failed:", err.message);
  }
}

// Used when the brain backend is unreachable, undeployed, or returns
// junk. Keeps the call alive so the line never dead-airs.
function fallbackReply(userText, reason = "no_url") {
  if (reason === "no_url") {
    console.warn(
      "[brain] AMBER_AGENT_URL is not set. Responding with fallback.",
    );
  }
  const reasons = {
    no_url: "my backend isn't connected yet",
    route_missing: "my brain endpoint isn't deployed yet",
    backend_error: "my brain is having a moment",
    parse_error: "my brain is having a moment",
    no_reply: "my brain came back empty",
    exception: "I lost the line to my brain",
  };
  const why = reasons[reason] || "I'm not all here right now";
  if (!userText) {
    return `Hey, ${why}. Give me a few minutes and try again.`;
  }
  return `I caught that, but ${why}. Try me again in a minute.`;
}
