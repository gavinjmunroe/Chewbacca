/**
 * THE REACTION VOCABULARY. One list, for the whole app.
 *
 * There were three copies of this: dm-store.js, note-media-store.js and
 * post-social.js each declared the same five strings, and each declared them
 * because the author of the second and third one looked at the first and typed
 * it out again. Each copy also has its own CHECK constraint in its own table.
 *
 * That is six places one word has to be added to, and the only thing keeping
 * them equal has been that nobody has added one in a while. The symptom when it
 * finally slips is not an error anybody sees in review -- it is a reaction that
 * works on a shared note, fails on a direct message with "Couldn't save that
 * reaction", and looks like a network problem.
 *
 * So: the list lives here, the three stores import it, and
 * db/migrations/20260911_045_reactions_add_heart.sql widens all three
 * constraints in one file. The client keeps its own copy -- it has to, it is a
 * different codebase -- and pins it against this one in a test.
 *
 * ADDING A KIND is therefore: this list, one migration, and the client's table
 * in lib/noteMedia.ts. The migration must be applied BEFORE a client that can
 * send the new value ships, or every tap on it fails the check and rolls back.
 */

/**
 * `heart` was added last (migration 045) and the order here is historical, not
 * a reading order -- the client decides how they are presented. Nothing should
 * depend on the order of this array.
 */
export const REACTION_KINDS = Object.freeze([
  "emphasis",
  "like",
  "dislike",
  "laugh",
  "question",
  "heart",
]);

const KIND_SET = new Set(REACTION_KINDS);

/** Is this one of the reactions the database will accept? */
export function isReactionKind(kind) {
  return typeof kind === "string" && KIND_SET.has(kind);
}
