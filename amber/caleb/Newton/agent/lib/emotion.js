/**
 * Utterance-level emotion recognition.
 *
 * Inspired by declare-lab/awesome-emotion-recognition-in-conversations.
 * Every inbound message from a non-Caleb sender gets tagged with an
 * emotion label so it can:
 *   - be stored on the message in conversation history
 *   - feed Amber's Emotional health dimension for that contact
 *   - inform response calibration (pacing, warmth, escalation)
 *
 * We use Sonar (callPerplexityLight) instead of a local classifier so
 * we get context-aware predictions without bundling a PyTorch model.
 * Calls are fire-and-forget and only triggered when a message is
 * substantive enough to care about (>= 3 words, non-trivial content).
 */

import { callPerplexityLight } from "./tiwari/context.js";
import { registerCapability } from "./capabilities.js";

registerCapability(
  "Emotion",
  "Per-utterance emotion tagging (neutral/happy/sad/angry/anxious/excited/frustrated) that calibrates reply warmth and nudges the contact's Emotional health dim",
);

// The 7 canonical emotion labels we tag. Kept small to stay stable
// across runs and avoid label proliferation. Based on the standard
// MELD/IEMOCAP label sets reduced to what matters for Amber's reply
// calibration.
export const EMOTION_LABELS = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "anxious",
  "excited",
  "frustrated",
];

// Emotions that nudge the Emotional dim downward (negative) or up.
const EMOTION_VALENCE = {
  happy: +2,
  excited: +2,
  neutral: 0,
  sad: -2,
  angry: -2,
  anxious: -1,
  frustrated: -1,
};

/**
 * Quick screen: is this message worth classifying?
 */
export function shouldClassify(text) {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed.length < 8) return false; // "ok", "lol" — skip
  const words = trimmed.split(/\s+/);
  if (words.length < 3) return false;
  // Skip obvious reactions / single-word replies
  if (/^(ok|okay|cool|nice|thanks|thx|yes|no|yep|nope|sure|k)\b/i.test(trimmed))
    return false;
  return true;
}

/**
 * Classify a single utterance. Returns
 *   { label, confidence, intensity }
 * or null on failure.
 *
 * @param {string} text - the incoming message
 * @param {Object} [context] - { speaker, recentMessages[] } optional
 */
export async function classifyEmotion(text, context = {}) {
  if (!shouldClassify(text)) return null;

  const recentBlock = Array.isArray(context.recentMessages)
    ? context.recentMessages
        .slice(-4)
        .map((m) => `${m.senderLabel || m.from || "?"}: ${m.content}`)
        .join("\n")
    : "";

  const prompt = `${recentBlock ? `RECENT CONTEXT:\n${recentBlock}\n\n` : ""}UTTERANCE from ${context.speaker || "user"}:
"${text.slice(0, 600)}"

Classify the emotional tone of the utterance. Return ONLY valid JSON:
{"label": "<one of: ${EMOTION_LABELS.join(" | ")}>", "confidence": 0.0-1.0, "intensity": 0.0-1.0}

- "confidence" is how sure you are of the label.
- "intensity" is how strong the emotion is (0.2 = mild, 0.8 = strong).
- Default to "neutral" if genuinely ambiguous.`;

  try {
    const raw = await callPerplexityLight(prompt, {
      maxTokens: 60,
      timeoutMs: 6_000,
      system:
        "You classify the emotional tone of single conversational utterances. Return ONLY JSON.",
    });
    if (!raw) return null;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!EMOTION_LABELS.includes(parsed.label)) return null;
    return {
      label: parsed.label,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      intensity: Math.max(0, Math.min(1, Number(parsed.intensity) || 0.5)),
    };
  } catch (err) {
    console.warn("[emotion] classify error:", err.message);
    return null;
  }
}

/**
 * Convert an emotion classification into an Emotional-dimension
 * delta for the contact's health profile. Tiny nudges (±0.5 max)
 * so a single upset message doesn't crater the score.
 */
export function emotionToHealthDelta(classification) {
  if (!classification) return 0;
  const valence = EMOTION_VALENCE[classification.label] ?? 0;
  // Scale by confidence × intensity, max ±0.5 points per message
  return valence * classification.confidence * classification.intensity * 0.25;
}

/**
 * Format an emotion classification for injection into a system prompt
 * so Camber can calibrate response warmth/pacing.
 */
export function emotionToPromptHint(classification) {
  if (!classification) return "";
  const { label, confidence, intensity } = classification;
  if (label === "neutral" || confidence < 0.5) return "";
  const descriptor =
    intensity > 0.7 ? "strongly" : intensity > 0.4 ? "moderately" : "mildly";
  return `\n\nEMOTIONAL TONE: the incoming message reads as ${descriptor} ${label} (confidence ${confidence.toFixed(2)}). Calibrate warmth and pacing accordingly — don't ignore the emotion, but don't over-react either.`;
}
