/**
 * Whole-word matching for people's names.
 *
 * `\b` in JavaScript is defined against `\w`, which is `[A-Za-z0-9_]` — ASCII
 * only. So `/\bJosé\b/` cannot match "José" (the boundary after "é" fails,
 * because "é" is not a `\w` character and neither is the space after it, so
 * there is no transition). The same is true of Zoë, Müller, Nuñez, 李, and
 * every other name the voice-correction and mention features exist to serve.
 *
 * The fix is a Unicode-aware boundary expressed as lookarounds over
 * `\p{L}\p{N}_` — "not preceded by, and not followed by, a letter, digit, or
 * underscore." That still refuses to match inside a longer word ("Sam" in
 * "Samantha") which is the entire point of the boundary, but it treats a
 * letter as a letter no matter what alphabet it comes from.
 */

/** Escape a raw name for literal use in a regex. Names come from transcripts. */
export function escapeRegex(s) {
  return String(s ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A whole-word, Unicode-aware regex for `name`.
 *
 * @param {string} name  Raw name; escaped for you.
 * @param {string} flags Regex flags. `u` is always added. Pass "gi" to replace
 *                       every occurrence, "i" to test.
 * @returns {RegExp|null} null when there is nothing to match, so callers can
 *                        bail without a try/catch.
 */
export function nameBoundaryRegex(name, flags = "i") {
  const raw = String(name ?? "").trim();
  if (!raw) return null;
  const f = flags.includes("u") ? flags : `${flags}u`;
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapeRegex(raw)}(?![\\p{L}\\p{N}_])`,
    f,
  );
}

/**
 * Does `name` appear as a whole word in `text`?
 * Cheap wrapper so callers do not build a regex and remember `lastIndex`.
 */
export function mentionsName(text, name) {
  const hay = String(text ?? "");
  if (!hay) return false;
  const re = nameBoundaryRegex(name, "i");
  return re ? re.test(hay) : false;
}

/**
 * Replace every whole-word occurrence of `fromName` with `toName`.
 * Returns the original string when nothing matched, so `next === current` stays
 * a valid "no change" test at the call sites.
 */
export function replaceName(text, fromName, toName) {
  const hay = String(text ?? "");
  if (!hay) return hay;
  const re = nameBoundaryRegex(fromName, "gi");
  if (!re) return hay;
  return hay.replace(re, String(toName ?? ""));
}
