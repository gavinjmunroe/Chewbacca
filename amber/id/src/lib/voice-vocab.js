/**
 * LEARNED VOICE VOCABULARY — the per-owner dictionary that makes a voice note
 * spell a name the way its owner spells it, and tag the right person.
 *
 * WHY THIS FILE WAS REWRITTEN. It wrote five columns that do not exist -- term,
 * term_key, heard, heard_key, hits -- against a table that has
 * (owner_id, heard, corrected_to, hit_count). Migration 010 redesigned the table
 * and nobody checked the consumer. Both writers caught the resulting error and
 * commented it "fail-open", so:
 *
 *   every correction a user made was thrown away, silently
 *   every read threw and returned [], silently
 *   the bias prompt was always empty, so the decoder never learned a name
 *   contact_id was never stored, so nothing could tag anybody
 *
 * The reported symptom was that voice notes tag the right contact sometimes and
 * nobody other times, with no pattern. There was no pattern: tagging worked only
 * when the raw transcript already happened to be right.
 *
 * AND contactId WAS VALIDATED AS /^\d+$/. contacts.id is a uuid, so even with the
 * column present every id was rejected and stored as NULL. Two independent
 * reasons for the same silence.
 *
 * FAIL-OPEN, BUT NOT FAIL-SILENT. Transcription must not break because the
 * dictionary is unavailable -- that part of the old design was right. But a
 * schema error is a deploy bug, not a data condition, and it now says so with its
 * own log code instead of an empty catch. A swallowed exception is why this cost
 * months.
 *
 * THE DATA MODEL, in the table's own terms:
 *
 *   a correction          heard <> corrected_to   "Ajay" was heard as "A J"
 *   a preferred spelling  heard =  corrected_to   no misheard form yet
 *
 * which makes "is this a real correction" a question about the data rather than
 * about which columns are null.
 */

import { query } from "../db/sql.js";
import { isRiskyHeardForm } from "./voice-common-words.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A contact id, or null. NOT /^\d+$/ -- contacts.id is a uuid. */
function asContactId(v) {
  return typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;
}

/**
 * Log a failure loudly, and say which KIND it is.
 *
 * 42703 undefined_column and 42P01 undefined_table mean the code and the schema
 * disagree, which no amount of retrying fixes and which nobody will notice unless
 * it is shouted. Everything else is an ordinary runtime failure.
 */
function reportVocabError(where, err) {
  const code = err?.code;
  if (code === "42703" || code === "42P01") {
    console.error(
      `VOCAB_SCHEMA_MISMATCH ${where} ${code} ${err?.message || ""} ` +
        `— the dictionary is not being written. Run migrations and check ` +
        `scripts/column-drift-audit.mjs.`,
    );
  } else {
    console.error(`VOCAB_ERR ${where} ${code || ""} ${err?.message || err}`);
  }
}

/**
 * Record preferred spellings for an owner, optionally tied to the contact they
 * belong to. Fire-and-forget safe.
 *
 * Stored with heard = corrected_to: this owner wants this spelling, and no
 * misheard form is known yet. If a correction later arrives for the same term the
 * PK collides and the heard form wins, which is the upgrade we want.
 */
export async function recordVoiceVocab(ownerId, terms, contactId = null) {
  if (!ownerId || !Array.isArray(terms)) return 0;
  const cid = asContactId(contactId);
  const clean = [
    ...new Set(
      terms.map((t) => String(t || "").trim()).filter((t) => t && t.length <= 80),
    ),
  ];
  if (clean.length === 0) return 0;

  // ONLY THE TERMS THAT ACTUALLY NAME THE CONTACT GET LINKED TO IT.
  //
  // Callers pass a batch of terms and one contactId -- "here is what I learned
  // while writing about this person" -- and the batch is usually a mix: their
  // name, their company, a place. Attaching the contact to all of it means a
  // later transcript saying "Rytual" tags Ajay, which is a false positive
  // arriving from the tagging system's own memory. That is one of the shapes of
  // "sometimes it tags the wrong person".
  //
  // So a term is linked only if it matches a token of the contact's name (or the
  // whole name). Everything else is stored as vocabulary with no contact, which
  // still feeds the bias prompt -- getting the spelling right and claiming to
  // know whose name it is are two different promises.
  let named = new Set();
  if (cid) {
    try {
      const { rows } = await query(
        `SELECT full_name, first_name, last_name FROM contacts
          WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [ownerId, cid],
      );
      const parts = [rows[0]?.full_name, rows[0]?.first_name, rows[0]?.last_name]
        .filter(Boolean)
        .flatMap((v) => [String(v).toLowerCase(), ...String(v).toLowerCase().split(/\s+/)]);
      named = new Set(parts.filter(Boolean));
    } catch (err) {
      reportVocabError("recordVoiceVocab:name", err);
      // Unknown name means we cannot justify the link, so we do not make one.
    }
  }
  const linked = clean.map((t) => (cid && named.has(t.toLowerCase()) ? cid : null));

  try {
    // ONE STATEMENT, NOT ONE PER TERM. The old loop issued a round trip per word
    // on the transcription path.
    const { rowCount } = await query(
      `INSERT INTO voice_vocabulary (owner_id, heard, corrected_to, contact_id, hit_count, updated_at)
       SELECT $1, t, t, cid, 1, now()
         FROM unnest($2::text[], $3::uuid[]) AS u(t, cid)
       ON CONFLICT (owner_id, heard) DO UPDATE
         SET hit_count  = voice_vocabulary.hit_count + 1,
             contact_id = COALESCE(EXCLUDED.contact_id, voice_vocabulary.contact_id),
             updated_at = now()`,
      [ownerId, clean, linked],
    );
    return rowCount ?? 0;
  } catch (err) {
    reportVocabError("recordVoiceVocab", err);
    return 0;
  }
}

/**
 * Most-recently-reinforced spellings for an owner, newest first. This is what
 * goes into the decoder's bias prompt.
 */
export async function getVoiceVocab(ownerId, limit = 20) {
  if (!ownerId) return [];
  try {
    const { rows } = await query(
      `SELECT corrected_to, max(updated_at) AS at
         FROM voice_vocabulary
        WHERE owner_id = $1
        GROUP BY corrected_to
        ORDER BY at DESC
        LIMIT $2`,
      [ownerId, Number(limit) > 0 ? Number(limit) : 20],
    );
    return rows.map((r) => r.corrected_to).filter(Boolean);
  } catch (err) {
    reportVocabError("getVoiceVocab", err);
    return [];
  }
}

/**
 * Record a CORRECTION: what was heard, and what the user actually meant.
 *
 * Bias (getVoiceVocab -> the decoder's prompt) is the primary mechanism and is
 * strictly better, because it fixes the transcript at the source. But bias is a
 * suggestion to a decoder, not a guarantee, and when it does not take there has to
 * be something to fall back on. Storing the pair makes the repair deterministic.
 *
 * Fire-and-forget safe. Returns whether it was stored, so a caller that cares can
 * tell the difference between "nothing to record" and "it did not work".
 */
export async function recordVoiceCorrection(ownerId, heard, intended, contactId = null) {
  if (!ownerId) return false;
  const from = String(heard || "").trim();
  const to = String(intended || "").trim();
  if (!from || !to || from.length > 80 || to.length > 80) return false;
  // A correction that changes nothing is noise, and one differing only in case is
  // handled by the display form rather than by substitution.
  if (from.toLowerCase() === to.toLowerCase()) return false;
  // AND AN EVERYDAY WORD IS NEVER LEARNED AS A HEARD FORM.
  //
  // `heard = "meet"` -> `corrected_to = "Meet Patel"` is how "I want to meet a
  // few hardware engineers" became "I want to Meet Patel a few hardware
  // engineers", which sent the whole turn looking for people named Patel. See
  // voice-common-words.js. Refused at the door as well as at the point of use,
  // so the row never gets written again.
  if (isRiskyHeardForm(from)) {
    console.warn(
      `VOCAB_REFUSED heard="${from}" is an everyday word; not learning it as a ` +
        `correction to "${to}". Rewriting it would change what the speaker said.`,
    );
    return false;
  }
  const cid = asContactId(contactId);
  try {
    await query(
      `INSERT INTO voice_vocabulary (owner_id, heard, corrected_to, contact_id, hit_count, updated_at)
       VALUES ($1, $2, $3, $4, 1, now())
       ON CONFLICT (owner_id, heard) DO UPDATE
         SET corrected_to = EXCLUDED.corrected_to,
             hit_count    = voice_vocabulary.hit_count + 1,
             contact_id   = COALESCE(EXCLUDED.contact_id, voice_vocabulary.contact_id),
             updated_at   = now()`,
      [ownerId, from, to, cid],
    );
    return true;
  } catch (err) {
    reportVocabError("recordVoiceCorrection", err);
    return false;
  }
}

/**
 * Every heard -> intended pair for an owner, strongest first.
 *
 * `heard <> corrected_to` is the filter, because a row where they are equal is a
 * preferred spelling rather than a repair, and substituting a word for itself is
 * work that can only introduce bugs.
 */
/**
 * ONE NOTICE PER ROW, NOT ONE PER TRANSCRIPTION.
 *
 * This warning fired on EVERY voice note -- the same "MeeT" row, forever, in a
 * hosted log stream -- because the refusal happens on the read path and the
 * read path runs on every clip. A diagnostic that repeats on a hot path stops
 * being a diagnostic and becomes the noise you scroll past to find the real
 * error.
 *
 * The row is deliberately NOT deleted: the bias prompt still uses it to spell
 * the name right at the source, which is a better fix than rewriting the text
 * afterwards. Only the substitution is refused, and now it is only said once.
 *
 * Process-lifetime, and bounded in practice by how many risky rows a
 * deployment's users actually have: a handful, each a short string. It resets
 * on deploy, which is when somebody would want to hear it again anyway.
 */
const warnedSkips = new Set();
function warnSkippedOnce(ownerId, heard, correctedTo) {
  const key = `${ownerId}:${heard}`;
  if (warnedSkips.has(key)) return;
  warnedSkips.add(key);
  console.warn(
    `VOCAB_SKIPPED heard="${heard}" -> "${correctedTo}": an everyday ` +
      `word is never substituted. Delete the row to stop this notice.`,
  );
}

export async function getVoiceCorrections(ownerId) {
  if (!ownerId) return [];
  try {
    const { rows } = await query(
      `SELECT heard, corrected_to, contact_id
         FROM voice_vocabulary
        WHERE owner_id = $1 AND heard <> corrected_to
        ORDER BY hit_count DESC, updated_at DESC
        LIMIT 200`,
      [ownerId],
    );
    // FILTERED HERE TOO, and that is not belt-and-braces: the dangerous rows are
    // already in the database, written before the guard above existed. A read
    // filter fixes every existing owner with no data migration, and the row is
    // left in place so the bias prompt can still use it to spell the name right.
    const out = [];
    for (const r of rows) {
      if (!r.heard || !r.corrected_to) continue;
      if (isRiskyHeardForm(r.heard)) {
        warnSkippedOnce(ownerId, r.heard, r.corrected_to);
        continue;
      }
      out.push({ heard: r.heard, term: r.corrected_to, contactId: r.contact_id ?? null });
    }
    return out;
  } catch (err) {
    reportVocabError("getVoiceCorrections", err);
    return [];
  }
}

/**
 * Which contacts an owner's dictionary can name, as term -> contactId.
 *
 * THE POINT OF THE WHOLE FILE. A transcript that says "AJ" is only taggable if
 * something remembers which contact "AJ" is; this is that something. Both forms
 * are returned, because a transcript may contain either the misheard spelling or
 * the corrected one.
 */
export async function getVocabContactMap(ownerId) {
  if (!ownerId) return new Map();
  try {
    const { rows } = await query(
      `SELECT heard, corrected_to, contact_id
         FROM voice_vocabulary
        WHERE owner_id = $1 AND contact_id IS NOT NULL
        ORDER BY hit_count DESC`,
      [ownerId],
    );
    const map = new Map();
    for (const r of rows) {
      // Strongest first, so the first writer of a key wins and a weaker later row
      // cannot steal a name from a better-reinforced one.
      for (const form of [r.corrected_to, r.heard]) {
        const k = String(form || "").trim().toLowerCase();
        if (k && !map.has(k)) map.set(k, r.contact_id);
      }
    }
    return map;
  } catch (err) {
    reportVocabError("getVocabContactMap", err);
    return new Map();
  }
}

/**
 * Apply an owner's learned corrections to a transcript.
 *
 * WHOLE WORDS ONLY, and case-insensitively matched. Substring replacement on a
 * transcript is how "AJ" turns "major" into "majay" — the single most embarrassing
 * possible failure for a feature whose entire promise is that it gets names right.
 * The boundaries are explicit rather than \b because a learned term can legitimately
 * contain punctuation or spaces ("J.R.", "de Silva"), which \b does not handle.
 *
 * The replacement PRESERVES the sentence: only the matched span changes.
 *
 * @returns {{ text: string, applied: {heard: string, term: string}[] }}
 */
export function applyVocabCorrections(text, pairs) {
  const src = String(text || "");
  if (!src || !Array.isArray(pairs) || pairs.length === 0) return { text: src, applied: [] };

  // Longest first, so "A J" wins over "A" when both are learned.
  const ordered = [...pairs].sort((a, b) => String(b.heard).length - String(a.heard).length);
  const applied = [];
  let out = src;

  for (const { heard, term } of ordered) {
    const h = String(heard || "");
    if (!h) continue;
    // THE LAST GATE. This function is exported and called with pairs from
    // anywhere; the one operation that can destroy a sentence should refuse
    // outright rather than trusting its caller to have filtered.
    if (isRiskyHeardForm(h)) continue;
    const escaped = h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // (^|non-word) TERM (non-word|$). Kept as a manual boundary rather than \b so a
    // term containing a dot or a space still matches at its real edges.
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=[^\\p{L}\\p{N}]|$)`, "giu");
    let hit = false;
    out = out.replace(re, (_m, pre) => {
      hit = true;
      return `${pre}${term}`;
    });
    if (hit) applied.push({ heard: h, term });
  }
  return { text: out, applied };
}
