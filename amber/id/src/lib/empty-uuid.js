/**
 * AN EMPTY STRING IS NOT A MISSING UUID, AND POSTGRES AGREES LOUDLY.
 *
 * A browser form holds "no team selected" as "", because that is what an
 * unselected control is in the DOM. A nullable uuid column holds it as NULL.
 * Nothing in between converts, so the first client that forgot `|| null`
 * sent group_id: "" into an INSERT and every post in the company failed with
 *
 *     22P02 invalid input syntax for type uuid: ""
 *
 * which reaches the person as "something went wrong on our end" -- a 500 for
 * what is really a shrug from the client.
 *
 * Fixing the one caller fixes the one bug. This fixes the class: it is applied
 * at the route boundary, where the request stops being JSON and starts being
 * SQL parameters, so a field that is allowed to be absent is absent no matter
 * which of the three ways a client spells that.
 *
 * It deliberately does NOT touch a non-empty value. A malformed uuid that is
 * actually malformed must still fail -- silently turning a typo into "no
 * group" would file somebody's work in the wrong place and tell nobody.
 */

const BLANK = new Set(["", "null", "undefined"]);

/** One value: "" (and friends) become null, everything else passes through. */
export function nullIfBlank(value) {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  return BLANK.has(value.trim().toLowerCase()) ? null : value;
}

/**
 * The named fields of a body, in place.
 *
 * Returns the same object so it can wrap a `request.body` at the point of use.
 * The field list is explicit rather than "anything that looks like an id",
 * because a heuristic here would eventually blank something that was meant to
 * be an empty string.
 */
export function blankToNull(body, fields) {
  if (!body || typeof body !== "object") return body;
  for (const f of fields) {
    if (f in body) body[f] = nullIfBlank(body[f]);
  }
  return body;
}

/** The uuid-shaped fields this service's org routes accept from a client. */
export const ID_FIELDS = Object.freeze([
  "groupId",
  "pageId",
  "parentId",
  "amberId",
  "answerId",
  "fileId",
  "fromGroupId",
  "toGroupId",
]);
