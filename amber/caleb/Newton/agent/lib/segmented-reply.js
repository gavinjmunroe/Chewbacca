/**
 * Segmented reply: split long messages into multiple iMessage bubbles.
 *
 * Two layers of intelligence:
 *
 *   1. MODEL-CONTROLLED (primary). The system prompt teaches Medha to insert
 *      a `[NEW]` marker on its own line wherever she wants the user to see
 *      a new iMessage bubble. The model decides — no hardcoded char floor,
 *      no "always one bubble under N chars" rule. A 40-char joke can be
 *      two bubbles ("got it" → [NEW] → "on it") if that's the rhythm she
 *      wants. A 1200-char structured report can stay one bubble if she
 *      thinks it reads better whole.
 *
 *   2. HARDWARE-CAP FALLBACK. Loop's API rejects messages over 2000 chars.
 *      If a single model segment still exceeds LOOP_CHAR_LIMIT (e.g. the
 *      model forgot to insert markers in a wall of text), we fall back to
 *      the old paragraph / bullet / sentence heuristic to keep delivery
 *      working. This is purely a safety net, not the primary intent.
 *
 * Marker syntax accepted (case-insensitive, with optional surrounding
 * whitespace):
 *   [NEW]
 *   [SPLIT]
 *   [NEW_MESSAGE]
 *
 * Strip whatever marker the model emitted from each segment before sending.
 */

const LOOP_CHAR_LIMIT = 1900; // Loop hard cap is 2000; stay under with margin
const MAX_SEGMENTS = 12; // Safety: any one turn over 12 bubbles is probably a runaway

// Matches a marker on its own line OR an inline marker with surrounding whitespace.
// Anchored so partial matches inside other text ([NEW YORK]) aren't caught.
const MARKER_RE = /\s*\[(?:NEW(?:_MESSAGE)?|SPLIT)\]\s*/gi;

/**
 * Split a reply into iMessage-ready segments.
 *
 * @param {string} text  Full reply text. May contain model-emitted [NEW] markers.
 * @returns {string[]}   Array of message segments. Each is under LOOP_CHAR_LIMIT.
 */
export function segmentReply(text) {
  if (!text) return [text];

  // Layer 1: model-controlled split on [NEW] markers.
  const hasMarker = MARKER_RE.test(text);
  // Reset lastIndex because we just exec'd the global regex.
  MARKER_RE.lastIndex = 0;

  let segments;
  if (hasMarker) {
    segments = text
      .split(MARKER_RE)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } else if (text.length <= LOOP_CHAR_LIMIT) {
    // No marker, under the hardware cap — send as one bubble.
    return [text];
  } else {
    // No marker AND too long for one bubble. Model didn't structure it,
    // so fall back to heuristic splitting to keep delivery working.
    segments = heuristicSplit(text);
  }

  // Cap at MAX_SEGMENTS; merge overflow into the last segment.
  while (segments.length > MAX_SEGMENTS) {
    const last = segments.pop();
    segments[segments.length - 1] += "\n\n" + last;
  }

  // Final safety: hard-split any segment still over the hardware cap.
  // (Can happen if the model put a marker between two short paragraphs but
  // left a third paragraph that's 3000 chars on its own.)
  const safe = [];
  for (const seg of segments) {
    if (seg.length <= LOOP_CHAR_LIMIT) {
      safe.push(seg);
    } else {
      safe.push(...hardSplit(seg));
    }
  }

  return safe.length > 0 ? safe : [text];
}

/**
 * Fallback heuristic splitter — only runs when the model didn't insert a
 * marker AND the reply exceeds the hardware cap. Same logic that used to
 * be primary; now demoted to safety net.
 */
function heuristicSplit(text) {
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim());
  if (paragraphs.length > 1) return mergeToLimit(paragraphs);

  const bullets = text.split(/\n(?=[•\-\*] )/);
  if (bullets.length > 1) return mergeToLimit(bullets);

  const sentences = text.match(/[^.!?]+[.!?]+\s*/g);
  if (sentences && sentences.length > 1) return mergeToLimit(sentences);

  return hardSplit(text);
}

/**
 * Merge text chunks so each segment stays under LOOP_CHAR_LIMIT.
 */
function mergeToLimit(chunks) {
  const segments = [];
  let current = "";
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const combined = current ? current + "\n\n" + trimmed : trimmed;
    if (combined.length > LOOP_CHAR_LIMIT && current.length > 0) {
      segments.push(current.trim());
      current = trimmed;
    } else {
      current = combined;
    }
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

/**
 * Hard split text at the hardware cap, preferring newline or space breaks.
 */
function hardSplit(text) {
  const segments = [];
  let remaining = text;
  while (remaining.length > LOOP_CHAR_LIMIT) {
    let breakAt = LOOP_CHAR_LIMIT;
    const lastNewline = remaining.lastIndexOf("\n", LOOP_CHAR_LIMIT);
    if (lastNewline > LOOP_CHAR_LIMIT * 0.5) {
      breakAt = lastNewline;
    } else {
      const lastSpace = remaining.lastIndexOf(" ", LOOP_CHAR_LIMIT);
      if (lastSpace > LOOP_CHAR_LIMIT * 0.5) breakAt = lastSpace;
    }
    segments.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining.trim()) segments.push(remaining.trim());
  return segments;
}
