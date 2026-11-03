/**
 * WHAT WHISPER SAYS WHEN IT HEARS NOTHING.
 *
 *   "I gave a long note here about asking me to remind me of certain things...
 *    None of that got recorded somehow, even though I saw the recording
 *    happening, and then it somehow added 'Thank you for watching' at the
 *    bottom. I have no idea why."
 *
 * The model was trained on an enormous amount of YouTube audio, subtitles
 * included, so silence and near-silence decode to the things that reliably
 * follow silence in that corpus: an outro, a subscribe plea, a subtitling
 * credit. It is not a bug in the recording and it is not random -- it is the
 * single most likely continuation of "no speech", and it arrives with ordinary
 * confidence because as a sentence it is perfectly plausible.
 *
 * WHY A LIST AND NOT A CONFIDENCE THRESHOLD. voice.js already escalates on
 * segment confidence, and it did not catch this: the numbers are averaged over
 * segments, and one short hallucination on an otherwise quiet clip averages out
 * to something unremarkable. The hallucinations themselves are a small, stable,
 * well-documented set. Matching them by name is the blunt instrument that
 * actually works.
 *
 * TWO PLACES ONLY: the very start and the very end. Somebody can legitimately
 * say "thanks for watching" in the middle of a note about a video they made,
 * and a filter that hunted through the body would eat it. Whisper's
 * hallucinations bracket the real audio rather than interrupting it, so that is
 * where this looks.
 *
 * AND AN ALL-FILLER TRANSCRIPT IS NOT A TRANSCRIPT. When everything that came
 * back is filler, the honest answer is that nothing was said -- which lets the
 * caller escalate to another engine or keep the audio, instead of filing a note
 * that reads "Thank you for watching!" and calling it the user's words.
 */

/**
 * The phrases, as regexes anchored to a whole sentence.
 *
 * Deliberately narrow. "Thanks" on its own is a real thing to say and is not
 * here; "thanks for watching" is not something anybody says to their own
 * reminders app. Each of these has been seen in the wild on silent audio and
 * most are documented in Whisper's own issue tracker.
 */
const FILLER = [
  /**
   * "for watching" IS REQUIRED, and that is the whole line between a
   * hallucination and manners. A note that ends "Thanks." is somebody being
   * polite to their own reminders app, and eating it would be the filter
   * rewriting real speech -- the exact failure this must not have.
   */
  /^thank(?:s| you)(?: (?:so|very) much)? for watching(?: (?:this|my|the) video)?[!.…]*$/i,
  /^(?:and )?(?:please )?(?:don'?t forget to )?(?:like(?:,| and)? )?subscribe(?: to (?:my|the) channel)?[!.…]*$/i,
  /^(?:please )?like and subscribe[!.…]*$/i,
  /^subtitles? (?:by|created by|provided by) .*$/i,
  /^(?:sub(?:title)?s )?(?:by )?amara\.org.*$/i,
  /^transcription by .*$/i,
  /^(?:closed captions?|captioning) (?:by|provided by) .*$/i,
  /^the end[!.…]*$/i,
  /^bye(?:[ -]?bye)?[!.…]*$/i,
  /^(?:see you|catch you) (?:next time|later|in the next (?:one|video))[!.…]*$/i,
  /^\[?\s*(?:blank_?audio|silence|music|inaudible|no speech)\s*\]?[!.…]*$/i,
  /^[♪♫\s.…-]+$/,
  /^you[!.…]*$/i,
  /^www\.[a-z0-9.-]+\.[a-z]{2,}[/\s]*$/i,
];

/** Does this one sentence look like a hallucination and nothing else? */
function isFiller(sentence) {
  const s = sentence.trim();
  if (!s) return true;
  return FILLER.some((re) => re.test(s));
}

/**
 * Split into sentences WITHOUT losing anything.
 *
 * LOSSLESS BY CONSTRUCTION: every piece carries the whitespace that followed
 * it, so parts.join("") is the original string. This function's whole job is to
 * hand back the user's words unaltered when there is nothing to remove, and a
 * split that normalized spacing would quietly rewrite every transcript that
 * passed through it.
 *
 * BREAKS ONLY WHEN WHITESPACE FOLLOWS THE PUNCTUATION, which is what keeps
 * "Subtitles by the Amara.org community" in one piece. The first version broke
 * on every period and turned that into "Subtitles by the Amara." plus "org
 * community" -- the first half matched, the second half survived, and the
 * transcript came out as the word "org community".
 */
function sentences(text) {
  const parts = text.split(/(?<=[.!?…])(\s+)/);
  const out = [];
  for (let i = 0; i < parts.length; i += 2) {
    const piece = (parts[i] ?? "") + (parts[i + 1] ?? "");
    if (piece) out.push(piece);
  }
  return out.length > 0 ? out : [text];
}

/**
 * Strip Whisper's silence-hallucinations from the ends of a transcript.
 *
 * @param {string} raw
 * @returns {{ text: string, removed: string[], allFiller: boolean }}
 *   `text` is the transcript with the filler gone, trimmed only at the edges.
 *   `allFiller` is true when there was nothing else in it, which the caller
 *   should treat as "nothing was said" rather than as a transcript.
 */
export function stripTranscriptFiller(raw) {
  const text = typeof raw === "string" ? raw : "";
  if (!text.trim()) return { text: "", removed: [], allFiller: false };

  const parts = sentences(text);
  const removed = [];

  let start = 0;
  let end = parts.length;
  // From the front, then from the back. A clip that is silent at both ends can
  // pick one up at each, and a clip that is silent throughout collapses to
  // nothing -- which is the answer.
  while (start < end && isFiller(parts[start])) {
    removed.push(parts[start].trim());
    start += 1;
  }
  while (end > start && isFiller(parts[end - 1])) {
    removed.push(parts[end - 1].trim());
    end -= 1;
  }

  const kept = parts.slice(start, end).join("").trim();
  return {
    text: kept,
    removed: removed.filter(Boolean),
    // Everything was filler, and there WAS something to begin with.
    allFiller: kept.length === 0,
  };
}
