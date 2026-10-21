/**
 * Work out which words a user CORRECTED in a transcript, so those spellings can be
 * learned (Wispr-Flow-style).
 *
 * The problem: the user hears "AJ" come back from a transcript, edits it to "Ajay", and
 * expects every future transcript to say "Ajay". To do that we have to notice the edit,
 * and all we have is the before and after text.
 *
 * The approach is a word-level longest-common-subsequence diff, then a filter that
 * keeps only substitutions that LOOK LIKE A NAME being fixed. The filter is doing most
 * of the work, because a naive diff learns garbage: the user also fixes typos, deletes
 * filler words, and rewrites whole sentences, and feeding any of that into the
 * transcription biasing prompt actively makes future transcripts worse. A wrong entry
 * here is worse than no entry, so every rule below is deliberately conservative --
 * this would rather learn nothing than learn "the".
 */

/** Words that are never worth learning even if they change. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "so", "to", "of", "in", "on",
  "at", "for", "with", "is", "was", "are", "were", "be", "been", "it", "its", "this",
  "that", "these", "those", "i", "you", "he", "she", "we", "they", "me", "him", "her",
  "us", "them", "my", "your", "his", "our", "their", "not", "no", "yes", "just", "like",
]);

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu;

// See the ceiling check in learnableTerms. 400 x 400 is a 160k-cell matrix: ~2ms and a
// few hundred KB, which is the right order of magnitude for a request handler.
const MAX_TOKENS = 400;

function tokenize(text) {
  return String(text || "").match(WORD_RE) ?? [];
}

/** Strip trailing punctuation and lowercase, for comparison only. */
function norm(w) {
  return String(w || "").replace(/[.'’-]+$/u, "").toLowerCase();
}

/**
 * Does this look like a proper noun the user is fixing the spelling of?
 *
 * Capitalised, not a stopword, at least two characters, and containing a letter. The
 * capitalisation check is the important one: it is what separates "Ajay" from "definitely",
 * and transcription engines reliably capitalise what they believe to be names.
 */
function looksLikeName(word) {
  const w = String(word || "").trim();
  if (w.length < 2 || w.length > 40) return false;
  if (!/\p{L}/u.test(w)) return false;
  if (STOPWORDS.has(norm(w))) return false;
  // Must start with an uppercase letter (or be a multi-cap form like "AJ", "McRae").
  return /^\p{Lu}/u.test(w);
}

/**
 * Are these two words close enough that one is plausibly a RESPELLING of the other,
 * rather than an unrelated word swapped in?
 *
 * "AJ" -> "Ajay" and "Kaushik" -> "Koushik" are respellings worth learning. "Tuesday"
 * -> "Thursday" is a factual edit and learning it would be actively harmful. The signal
 * we use is a shared prefix or a small edit distance relative to length -- names that
 * are respelled almost always start the same way, because that is how the speaker said
 * them.
 */
function plausibleRespelling(before, after) {
  const a = norm(before);
  const b = norm(after);
  if (!a || !b || a === b) return false;
  // A shared opening letter is the weakest useful signal; require at least that.
  if (a[0] !== b[0]) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;

  // 1. One is a prefix of the other: "aj" -> "ajay", "matt" -> "matthew". This is what
  //    a half-heard name looks like, and it is the strongest signal we get.
  if (longer.startsWith(shorter)) return true;

  const dist = levenshtein(a, b);

  // 2. A single edit: "kaushik" -> "koushik", "shirly" -> "shirley", "jose" -> "josé".
  //    One character is the overwhelming majority of real respellings.
  if (dist <= 1) return true;

  // 3. More than one edit is only allowed with a SUBSTANTIAL shared prefix.
  //
  //    This clause used to be `dist <= floor(longer/3)` with no prefix requirement,
  //    and it learned "Tuesday" -> "Thursday": same first letter, distance exactly 2,
  //    threshold exactly 2. That is a FACTUAL edit, not a respelling, and biasing every
  //    future transcript toward "Thursday" is precisely the kind of damage a learned
  //    dictionary can do. Requiring three shared leading characters separates a name
  //    being respelled (which nearly always starts the same, because that is how it was
  //    spoken) from two different real words that happen to be near neighbors.
  let shared = 0;
  while (shared < shorter.length && a[shared] === b[shared]) shared += 1;
  if (shared < 3) return false;
  return dist <= Math.max(1, Math.floor(longer.length / 3));
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  const cur = new Array(n + 1);
  for (let i = 1; i <= m; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur.slice();
  }
  return prev[n];
}

/**
 * The terms worth learning from an edit.
 *
 * Returns the CORRECTED spellings only (what the user wants written), newest-intent
 * first, deduped, capped. Returns [] for anything ambiguous.
 */
/**
 * The [heard, intended] PAIRS behind each learnable respelling.
 *
 * This was always what the walk below computed; it just threw the `before` away and
 * returned the `after`. Keeping the pair is what lets a misrecognition be repaired
 * deterministically later (lib/voice-vocab applyVocabCorrections) rather than only
 * nudged against via the bias prompt — bias cannot fix "AJ", because "AJ" is a
 * perfectly ordinary transcription of those sounds no matter what is in the prompt.
 */
export function learnablePairs(original, corrected, { max = 5 } = {}) {
  const a = tokenize(original);
  const b = tokenize(corrected);
  if (a.length === 0 || b.length === 0) return [];

  // HARD TOKEN CEILING, CHECKED BEFORE THE MATRIX IS ALLOCATED. This is a DoS guard, not
  // a tuning knob.
  //
  // The LCS below is O(n*m) in BOTH time and MEMORY -- it allocates an
  // (a+1) x (b+1) matrix and touches every cell. At 10,000 tokens each (which fits
  // inside a 40KB request body, well under the 1MB limit) that is a 10001 x 10001
  // matrix: measured at 10.4 SECONDS of blocking event-loop CPU and 874MB RSS, and a
  // hard OOM crash of the whole API process under a 512MB heap cap. One request was
  // enough; the rate limit never came into it.
  //
  // 400 tokens is roughly a three-minute dictated note, which is longer than anything
  // this feature meaningfully applies to -- a correction is a word or two, not an essay.
  // Past that, decline rather than degrade: returning [] costs one unlearned correction,
  // where the alternative costs the process.
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return [];

  // A rewrite is not a correction. If the user replaced most of the text, there is no
  // reliable per-word intent to extract and guessing produces noise.
  if (b.length > a.length * 3 + 5) return [];

  // Word-level LCS, then walk the two sequences to find substitutions.
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        norm(a[i]) === norm(b[j])
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (norm(a[i]) === norm(b[j])) {
      i += 1;
      j += 1;
      continue;
    }
    // A 1:1 substitution is the shape a respelling takes. A pure insert or delete is
    // the user adding or cutting words, which teaches us nothing about spelling.
    const isSubstitution = lcs[i + 1][j + 1] >= Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    if (isSubstitution) {
      const before = a[i];
      const after = b[j];
      if (looksLikeName(after) && plausibleRespelling(before, after)) {
        out.push([
          before.replace(/[.,;:!?]+$/u, ""),
          after.replace(/[.,;:!?]+$/u, ""),
        ]);
      }
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  const seen = new Set();
  const unique = [];
  for (const pair of out) {
    const k = norm(pair[1]);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    unique.push(pair);
    if (unique.length >= max) break;
  }
  return unique;
}

/**
 * The intended spellings only — the original shape of this function, kept because
 * every existing caller and its tests want a flat list of terms to bias with.
 */
export function learnableTerms(original, corrected, opts = {}) {
  return learnablePairs(original, corrected, opts).map(([, after]) => after);
}
