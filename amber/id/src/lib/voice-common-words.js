/**
 * AN EVERYDAY WORD MUST NEVER BE REWRITTEN INTO SOMEBODY'S NAME.
 *
 * What happened, in one line from the logs:
 *
 *   VOICE_TRANSCRIBE ... chars=627 corrected=1
 *
 * and what the user saw:
 *
 *   "After the barbershop, I want to Meet Patel a few hardware engineers in
 *    Manhattan..."
 *
 * He said "I want to meet a few hardware engineers". The dictionary had learned
 * `heard = "meet"` -> `corrected_to = "Meet Patel"` (a contact of his), so the
 * verb in his sentence was replaced with a person's name. Everything downstream
 * then did exactly what it was told: the LinkedIn pass searched for "Meet Patel
 * a few hardware engineers" and returned FIVE PEOPLE NAMED PATEL, the model
 * wrote the answer around a name he never said, and the whole turn was about
 * the wrong thing. He read that as the search being biased. It was not biased;
 * it was obeying a corrupted sentence.
 *
 * This is not specific to "meet". Every name in this list is also an ordinary
 * English word, and each one is a sentence waiting to be destroyed:
 *
 *   "I'll mark it as done"        -> "I'll Mark Zhang it as done"
 *   "we may go on Friday"         -> "we May Chen go on Friday"
 *   "I hope she calls"            -> "I Hope Adler she calls"
 *   "can you grant access"        -> "can you Grant Ellis access"
 *
 * WHY A STOPLIST AND NOT A GRAMMAR CHECK. The substitution has no context to
 * work with: it is a regex over a transcript. Part-of-speech tagging a sentence
 * to decide whether "meet" is a verb here is a model call on the transcription
 * path -- the thing this dictionary exists to make faster and more accurate.
 * The set of words that are BOTH common English and common given names is small,
 * closed, and writable by hand, and getting it wrong in the safe direction
 * (refusing to rewrite) costs a misspelled name, which the bias prompt and the
 * name resolver both still catch.
 *
 * THE RULE IS ASYMMETRIC ON PURPOSE. This blocks rewriting a common word INTO
 * something else. It does not stop the dictionary from learning that "a j" means
 * "AJ", or that "shitij" means "Kshitij" -- those heard forms are not words.
 *
 * SINGLE TOKENS ONLY. "meet patel" as a heard form is unambiguous: nobody says
 * that by accident. It is the bare word that is dangerous.
 */

/**
 * Words that are common English AND common names. Lowercase, single tokens.
 *
 * Grouped by why they are here, because the list will be edited by someone who
 * needs to know what belongs in it.
 */
const COMMON_WORDS = new Set([
  // Verbs that are names. The category that caused the outage.
  "meet", "mark", "will", "may", "might", "can", "must", "shall",
  "grant", "chase", "drew", "grace", "hope", "wish", "trust", "rush",
  "sue", "bill", "pierce", "reed", "read", "ford", "wade", "ward", "win",
  "cook", "carter", "baker", "brooks", "banks", "close", "field",
  // Nouns and adjectives that are names.
  "art", "faith", "joy", "rose", "dawn", "summer", "autumn", "winter",
  "sky", "river", "stone", "reign", "rain", "storm", "sunny", "misty",
  "penny", "pearl", "ruby", "jade", "amber", "ivory", "olive", "sage",
  "hunter", "miller", "mason", "cooper", "porter", "parker", "harper",
  "price", "rich", "young", "long", "short", "small", "best", "noble",
  "bird", "wolf", "fox", "bell", "cliff", "dale", "glen", "hill", "lane",
  "moss", "reef", "vale", "wood", "woods", "west", "east", "north", "south",
  // Months and days.
  "january", "april", "june", "july", "august", "september", "october",
  "november", "december", "monday", "friday", "sunday",
  // Function words that appear as nicknames or initials.
  "an", "as", "at", "be", "by", "do", "go", "if", "in", "is", "it", "me",
  "my", "no", "of", "on", "or", "so", "to", "up", "us", "we",
  "and", "but", "for", "her", "him", "his", "how", "its", "not", "now",
  "one", "our", "out", "she", "the", "too", "two", "was", "who", "why",
  "you", "yes", "all", "any", "are", "did", "get", "got", "had", "has",
  "let", "new", "old", "own", "say", "see", "set", "than", "that", "them",
  "then", "they", "this", "were", "what", "when", "with", "your",
  // Verbs from the same sentence shapes people dictate.
  "call", "called", "text", "texted", "ask", "asked", "tell", "told",
  "need", "want", "wanted", "take", "make", "made", "give", "gave",
  "going", "come", "came", "talk", "talked", "walk", "run", "ran",
  "work", "worked", "live", "lives", "love", "like", "look", "looked",
  "mean", "meant", "met", "mind", "note", "plan", "planned", "send", "sent",
  "sound", "guess", "think", "thought", "know", "knew", "found", "find",
  "help", "keep", "kept", "lunch", "dinner", "coffee", "drinks",
]);

/**
 * Is rewriting THIS heard form into something else dangerous?
 *
 * True when the form is a single token that is an ordinary English word. Such a
 * rewrite cannot be justified: the cost of missing a name is a misspelling, and
 * the cost of a false positive is a sentence that says something the speaker
 * did not say.
 */
export function isRiskyHeardForm(heard) {
  const raw = String(heard || "").trim().toLowerCase();
  if (!raw) return true;
  // Multi-token forms are safe: "meet patel", "a j", "de silva".
  if (/[\s.]/.test(raw)) return false;
  return COMMON_WORDS.has(raw);
}

/** Tests, and anything that wants to explain a refusal. */
export function commonWordCount() {
  return COMMON_WORDS.size;
}
