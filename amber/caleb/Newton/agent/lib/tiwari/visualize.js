/**
 * Tiwari Visualize Bucket: Loop API output layer.
 * Handles: sending iMessages, tapbacks, message formatting, segmentation.
 *
 * Re-exports Loop transport functions and adds iMessage-specific formatting.
 */

import { sendMessage, sendTapback } from "../transport.js";
import { renderForIMessage } from "../safety.js";

// Re-export transport functions for clean tiwari.visualize.* access
export { sendMessage, sendTapback };

// Loop's hard per-message ceiling. Stay under 2000 with margin.
const LOOP_HARD_LIMIT = 1900;

/**
 * Format text for iMessage: converts markdown to Unicode bold,
 * cleans up dashes, and normalizes whitespace.
 * Ported from renderForIMessage in safety.js.
 */
export function formatForIMessage(text) {
  return renderForIMessage(text);
}

/**
 * Hard split that respects whole-character boundaries and prefers a
 * newline or space near `limit`. Returns an array of pieces, each
 * <= limit. Used as the last-resort fallback when paragraphs can't
 * be cleanly broken.
 */
function hardSplit(text, limit) {
  const out = [];
  let remaining = text;
  while (remaining.length > limit) {
    let breakAt = limit;
    const lastNewline = remaining.lastIndexOf("\n", limit);
    if (lastNewline > limit * 0.5) {
      breakAt = lastNewline;
    } else {
      const lastSpace = remaining.lastIndexOf(" ", limit);
      if (lastSpace > limit * 0.5) breakAt = lastSpace;
    }
    out.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) out.push(remaining);
  return out;
}

/**
 * Split a formatted reply into <= limit-sized segments. Pure function;
 * the resume bug from the previous version (a single paragraph longer
 * than the limit was assigned to `current` and then dropped on the
 * next iteration) is fixed here by hard-splitting any oversize chunk
 * at the source instead of relying on the post-loop fallback.
 */
export function planSegments(formatted, limit) {
  if (!formatted) return [];
  if (formatted.length <= limit) return [formatted];

  const paragraphs = formatted.split(/\n\n+/);
  const segments = [];
  let current = "";
  const flush = () => {
    if (current.trim()) segments.push(current.trim());
    current = "";
  };

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Oversize paragraph: flush whatever we have, then hard-split it
    // so we never carry > limit chars in `current`.
    if (trimmed.length > limit) {
      flush();
      for (const piece of hardSplit(trimmed, limit)) segments.push(piece);
      continue;
    }

    const combined = current ? current + "\n\n" + trimmed : trimmed;
    if (combined.length > limit) {
      flush();
      current = trimmed;
    } else {
      current = combined;
    }
  }
  flush();

  return segments.length ? segments : hardSplit(formatted, limit);
}

/**
 * Segment and send a long reply as multiple iMessage bubbles.
 *
 * Bug fixed in this revision: previously, if a single paragraph
 * exceeded `maxLength` it became the new `current` and was never
 * pushed (the only fallback fired when `segments.length === 0`).
 * Long single-paragraph replies were silently dropped after the
 * first segment. We now hard-split oversize paragraphs in place.
 *
 * Bug 2: a failed send mid-stream used to abort and leave the user
 * with half a reply. We now continue on per-segment errors and
 * surface a structured result so the caller can act.
 *
 * @param {string} contact - Phone number or handle
 * @param {string} reply - Full reply text
 * @param {object} opts - { maxLength, delayMs, tenant, group }
 * @returns {Promise<{ sent:number, failed:number, lastMessageId:string|null, segments:number }>}
 */
export async function segmentAndSend(contact, reply, opts = {}) {
  const requested = opts.maxLength ?? 1600;
  const limit = Math.min(LOOP_HARD_LIMIT, requested);
  const { delayMs = 800, tenant, group } = opts;

  const formatted = formatForIMessage(reply);
  const segments = planSegments(formatted, limit);

  if (segments.length === 0) {
    return { sent: 0, failed: 0, lastMessageId: null, segments: 0 };
  }

  if (segments.length === 1) {
    try {
      const sent = await sendMessage(contact, segments[0], { tenant, group });
      return {
        sent: 1,
        failed: 0,
        lastMessageId: sent?.message_id || null,
        segments: 1,
      };
    } catch (err) {
      console.warn(`[segmentAndSend] single-bubble failed: ${err.message}`);
      return { sent: 0, failed: 1, lastMessageId: null, segments: 1, error: err.message };
    }
  }

  let sent = 0;
  let failed = 0;
  let lastMessageId = null;
  for (let i = 0; i < segments.length; i++) {
    try {
      const result = await sendMessage(contact, segments[i], { tenant, group });
      sent++;
      if (result?.message_id) lastMessageId = result.message_id;
    } catch (err) {
      failed++;
      console.warn(
        `[segmentAndSend] bubble ${i + 1}/${segments.length} failed: ${err.message}`,
      );
    }
    if (i < segments.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return { sent, failed, lastMessageId, segments: segments.length };
}
