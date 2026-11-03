/**
 * WHERE A CONTACT CAME INTO THE BOOK FROM.
 *
 * The graph's outer field -- the people Amber has no interaction history with
 * -- was one undifferentiated cloud of nine hundred dots, and the only honest
 * thing left to order it by is provenance: these came off the phone, those came
 * from Gmail, these three arrived through an MCP call. That is a real fact
 * about each row and it is the one the owner can act on ("why do I have these
 * at all").
 *
 * THE RAW LABELS ARE NOT THE ANSWER. There are thirty-odd of them in this
 * codebase -- apple, gmail, google, imessage, imessage_dm, imessage_addcontact,
 * clay, clay-smoke-test, peoplerank_enrich -- and most of the distinctions are
 * about which code path wrote the row, not about where the human came from.
 * Thirty sectors is the cloud again with extra steps. So they fold into the
 * handful of origins somebody would actually name.
 *
 * MCP IS ONE BUCKET ON PURPOSE. "If it's hard to differentiate if they come in
 * from Perplexity versus Claude versus GPT, then just say MCP." A tool-call
 * origin rarely identifies which assistant made it, and inventing that
 * distinction would be the display asserting something the data does not say.
 *
 * PRIORITY IS THE OWNER'S, NOT ALPHABETICAL. Apple first, Google second, then
 * everything else -- that is the order he asked for, and it is also the order
 * of how much a source means: the phone's address book is people you chose to
 * save, an enrichment vendor is people a machine decided you might know.
 *
 * PURE. Labels in, one origin out.
 */

/** Raw source label -> the origin somebody would name. */
const FOLD = new Map([
  ["apple", "apple"],
  ["ios", "apple"],
  ["apple-contacts", "apple"],
  ["imessage", "apple"],
  ["imessage_dm", "apple"],
  ["imessage_addcontact", "apple"],
  ["imessage_dq", "apple"],

  ["google", "google"],
  ["gmail", "google"],
  ["google-contacts", "google"],

  ["clay", "clay"],
  ["clay-smoke-test", "clay"],

  ["slack", "slack"],
  ["linkedin", "linkedin"],
  ["github", "github"],
  ["notion", "notion"],

  // Anything that arrived through a tool call. See the header for why these
  // are one bucket rather than three.
  ["mcp", "mcp"],
  ["claude", "mcp"],
  ["gpt", "mcp"],
  ["openai", "mcp"],
  ["anthropic", "mcp"],
  ["perplexity", "mcp"],

  ["enrichment", "enrichment"],
  ["stub", "enrichment"],
  ["peoplerank_enrich", "enrichment"],
  ["vendor", "enrichment"],

  ["manual", "added by hand"],
  ["amber_manual", "added by hand"],
  ["amber_note", "added by hand"],
  ["contact_note", "added by hand"],
  ["app_web_save", "added by hand"],
  ["app_voice", "added by hand"],
  ["app_favorite", "added by hand"],
  ["from-web", "added by hand"],
  ["parsed", "added by hand"],

  ["import", "imported file"],
  ["import-file", "imported file"],
  ["csv", "imported file"],
]);

/**
 * The order sectors are laid out in, and the order a multi-source contact's
 * origins are reported in. Anything not named here sorts after everything that
 * is, alphabetically, so a new source label appears in a stable place rather
 * than jumping around between renders.
 */
export const ORIGIN_ORDER = Object.freeze([
  "apple",
  "google",
  "clay",
  "slack",
  "linkedin",
  "github",
  "notion",
  "mcp",
  "imported file",
  "added by hand",
  "enrichment",
]);

const RANK = new Map(ORIGIN_ORDER.map((o, i) => [o, i]));

/** Where an unrecognized label sorts: after every known one, then by name. */
export function originRank(origin) {
  const known = RANK.get(origin);
  return known === undefined ? ORIGIN_ORDER.length : known;
}

export function foldSource(label) {
  const s = String(label ?? "").trim().toLowerCase();
  if (!s) return null;
  const known = FOLD.get(s);
  if (known) return known;
  // An unknown label is kept rather than thrown into "other": a source nobody
  // folded yet is still a real answer to "where did this come from", and
  // burying it would hide exactly the thing worth noticing.
  return s;
}

/**
 * Every origin this contact arrived through, best first.
 *
 * `labels` is whatever the caller has: rows from contact_sources, the row's own
 * `source` column, or both. Deduplicated after folding, so a contact carrying
 * "apple" and "imessage" is one Apple contact rather than two origins.
 */
export function originsOf(labels) {
  const out = new Set();
  for (const l of labels ?? []) {
    const o = foldSource(l);
    if (o) out.add(o);
  }
  return [...out].sort((a, b) => originRank(a) - originRank(b) || a.localeCompare(b));
}
