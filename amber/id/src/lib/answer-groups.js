/**
 * Split the people on a turn into the LABELED SECTIONS the answer already uses.
 *
 * An answer that says "these two are worth calling about the raise, and these
 * four you just owe a catch-up" and then renders one undifferentiated list of
 * six cards makes its own prose a lie. The reader has to map sentence to card by
 * hand, which is the work the answer was supposed to do. The client has rendered
 * `turn.groups` since the Ask view was written; nothing ever produced it.
 *
 * This reads the FINISHED answer — it never invents a grouping the text does not
 * claim, and it never re-ranks. The order the ranker chose survives inside each
 * section, and a person the answer does not place is simply left out of the
 * sections (the caller falls back to the flat list when that leaves too little).
 *
 * FAIL-CLOSED TO THE FLAT LIST: null on no key, error, timeout, bad shape, or an
 * answer that genuinely has one section. The flat list is a correct rendering, so
 * there is never a reason to risk a worse one.
 */

const _ANTHRO_URL = "https://api.anthropic.com/v1/messages";
const _MODEL = process.env.ANSWER_GROUPS_MODEL || "claude-haiku-4-5-20251001";
// Six seconds. This runs AFTER the answer and the cards are on screen, so the
// only thing it delays is the turn's own completion; it must never be the reason
// a turn hits the 40s deadline.
const _TIMEOUT_MS = 6000;

/** Below this a grouping is noise — two cards do not need a heading. */
export const MIN_PEOPLE_TO_GROUP = 3;

const _SYSTEM = [
  "You are given an answer that was written about a list of people, and the list.",
  "The answer sorts those people into groups, in its own words. Recover that grouping.",
  "",
  "RULES:",
  "- Use ONLY groupings the answer actually makes. If it treats everyone the same way, return [].",
  "- A label is 2-5 words, lifted from the answer's own language, with no trailing punctuation.",
  "- `note` is the ONE sentence from the answer that explains that group, trimmed. Omit if there isn't one.",
  "- Each id appears in at most ONE group. Omit anyone the answer does not place.",
  "- Keep the ids in the order they were given to you.",
  "- Two or more groups, or none at all. A single group covering everyone is the same as [].",
  "",
  'Return ONLY a JSON array: [{"label":"...","note":"...","ids":["3","7"]}] or [].',
].join("\n");

/**
 * Does this answer even look sectioned? A cheap gate so the common case — one
 * short paragraph naming three people — never spends a model call.
 */
export function looksSectioned(answer) {
  const t = String(answer || "");
  if (t.trim().length < 120) return false;
  return (
    /^#{1,4}\s+\S/m.test(t) || // a markdown heading
    /^\s*[-*]\s+\S/m.test(t) || // a bullet list
    /^\s*\d{1,2}[.)]\s+\S/m.test(t) || // a numbered list
    /\*\*[^*\n]{2,40}\*\*\s*:?/.test(t) || // a bolded lead-in used as a heading
    /:\s*$/m.test(t) || // a line that ends in a colon, i.e. introduces a set
    t.split(/\n\s*\n/).length >= 3 // three or more paragraphs
  );
}

/**
 * @param {object} a
 * @param {string} a.answer  the finished answer text
 * @param {Array<{contactId:string,name:string}>} a.people  the ranked people, in order
 * @returns {Promise<Array<{label:string,note?:string,people:Array<{id:string,name:string}>}>|null>}
 */
export async function groupAnswerPeople({
  answer,
  people,
  fetchImpl = globalThis.fetch,
  timeoutMs = _TIMEOUT_MS,
} = {}) {
  const list = (Array.isArray(people) ? people : []).filter((p) => p?.contactId && p?.name);
  if (list.length < MIN_PEOPLE_TO_GROUP) return null;
  if (!answer || !looksSectioned(answer)) return null;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || typeof fetchImpl !== "function") return null;

  // Index by POSITION, not contact id. Contact ids are the user's own row ids;
  // there is no reason to put them in a third-party prompt when a 1-based index
  // does the same job, and it keeps the payload small.
  const byIndex = new Map(list.map((p, i) => [String(i + 1), p]));

  try {
    const user =
      `ANSWER:\n${String(answer).slice(0, 6000)}\n\nPEOPLE:\n` +
      list.map((p, i) => `${i + 1}: ${p.name}`).join("\n") +
      `\n\nJSON array of groups:`;
    const resp = await fetchImpl(_ANTHRO_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: _MODEL,
        max_tokens: 700,
        temperature: 0,
        system: _SYSTEM,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    const raw = (await resp.json())?.content?.[0]?.text?.trim() || "";
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return null;
    let parsed;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const claimed = new Set();
    const groups = [];
    for (const g of parsed) {
      if (!g || typeof g !== "object") continue;
      const label = typeof g.label === "string" ? g.label.trim().replace(/[:.]+$/, "") : "";
      if (!label || label.length > 60) continue;
      const members = [];
      for (const id of Array.isArray(g.ids) ? g.ids : []) {
        const key = String(id).trim();
        // NEVER INVENT A PERSON, and never show one twice. An index the model
        // made up, or one it already used, is dropped rather than trusted.
        const p = byIndex.get(key);
        if (!p || claimed.has(key)) continue;
        claimed.add(key);
        members.push({ id: String(p.contactId), name: p.name });
      }
      if (members.length === 0) continue;
      const note = typeof g.note === "string" && g.note.trim() ? g.note.trim().slice(0, 240) : undefined;
      groups.push(note ? { label, note, people: members } : { label, people: members });
    }

    // A single section is the flat list wearing a heading, and grouping that
    // covers barely anyone is worse than not grouping: the cards the answer
    // placed would render under headings and the rest would silently vanish.
    if (groups.length < 2) return null;
    if (claimed.size < Math.ceil(list.length / 2)) return null;
    return groups;
  } catch {
    return null;
  }
}
