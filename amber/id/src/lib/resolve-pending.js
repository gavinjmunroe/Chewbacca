/**
 * Shared pending-resolution apply logic.
 * Called by the chat pre-check and the /v1/chat/resolve endpoint so both
 * share one code path. The caller is responsible for fetching + owner-verifying
 * the pending row and determining resolvedId (via tap, name-match, or soft-confirm yes).
 *
 * Returns { ok: true, confirmText } on success. All DB calls are owner-scoped
 * and wrapped in .catch(() => null) so this never throws.
 */

// Straight from the store that owns observations, not through the compat layer:
// this is a new path and there is no legacy shape to preserve.
import { attachResolvedContact } from "../db/observations-store.js";
import { resolvePendingTag } from "../db/note-tags.js";
import {
  correctNameInContent,
  correctNameInTranscript,
  updateContactFields,
  upsertContactNameMemory,
  clearPendingFactContextById,
} from "../db/store.js";
import { query } from "../db/sql.js";

const _normName = (s) => (s || "").toLowerCase().trim();

/**
 * Apply a resolved contact id to the held pending item, flush the pending row,
 * and return the confirmation text to show the user.
 *
 * @param {object} opts
 * @param {string|number} opts.ownerId      - amber_id (owner scope)
 * @param {object}        opts.pending      - full pending_fact_context row
 * @param {string|number} opts.resolvedId   - contact id to apply
 * @param {string|null}   opts.resolvedName - optional display name for confirm text
 * @returns {Promise<{ ok: true, confirmText: string }>}
 */
/**
 * The conversation a pending row belongs to.
 *
 * A pending row points at a note or experience; that row's source_ref is the
 * conversation the words live in. This is the one hop that lets the transcript be
 * corrected without every caller having to remember to pass an id it may not have.
 *
 * Returns null rather than throwing: a missing conversation costs the text rewrite,
 * not the resolution.
 */
export async function conversationForPending(ownerId, pending) {
  if (!ownerId) return null;
  const ct = pending?.content_type;
  const cid = pending?.content_id ?? pending?.fact_id ?? null;

  // ── The row it points at, when it points at one ──────────────────────────
  //
  // Same dead tables as correctNameInContent -- see store.js. A note and an
  // experience are both observations now, and the thread they came from is
  // source_conversation_id rather than a generic source_ref.
  if (cid && (ct === "note" || ct === "experience" || !ct)) {
    try {
      const { rows } = await query(
        `SELECT source_conversation_id FROM observations
          WHERE observation_id = $1 AND owner_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [cid, ownerId],
      );
      const ref = rows[0]?.source_conversation_id;
      if (ref) return String(ref);
    } catch {
      /* fall through to the name lookup */
    }
  }

  // ── AND WHEN IT POINTS AT NOTHING, ASK THE NAME ──────────────────────────
  //
  // A pending row legitimately has no observation id: the question is asked
  // from the chat pre-check before anything is written, and for months every
  // unattributed observation was rejected outright by the status CHECK so the
  // row it would have pointed at never existed at all.
  //
  // The note still knows. An unresolved mention is an observation with
  // status 'pending', no contact, and the raw name on it -- so the newest note
  // that still has an open mention of THIS name is the note this question came
  // from. Without this the whole answer path ended in RESOLVE_NOOP: asked,
  // answered, confirmed to the user, and discarded.
  const raw = String(pending?.raw_name ?? "").trim();
  if (!raw) return null;
  try {
    const { rows } = await query(
      `SELECT source_conversation_id FROM observations
        WHERE owner_id = $1
          AND deleted_at IS NULL
          AND status = 'pending'
          AND contact_id IS NULL
          AND source_conversation_id IS NOT NULL
          AND lower(TRIM(raw_name)) = lower($2)
        ORDER BY observed_at DESC
        LIMIT 1`,
      [ownerId, raw],
    );
    const ref = rows[0]?.source_conversation_id;
    return ref ? String(ref) : null;
  } catch {
    return null;
  }
}

/**
 * Fix the WORDS as well as the tag, in both places they are stored: the derived
 * note row, and the transcript the user actually reads back.
 *
 * Pulled out because three branches needed it and only one had it.
 */
async function fixWords({ pending, resolvedName, ownerId, conversationId, correctName, correctTranscript }) {
  if (!resolvedName) return;
  if (pending.content_type && pending.content_id) {
    await correctName({
      ownerId,
      contentType: pending.content_type,
      contentId: pending.content_id,
      fromName: pending.raw_name,
      toName: resolvedName,
    }).catch(() => null);
  }
  if (conversationId) {
    await correctTranscript({
      ownerId,
      conversationId,
      fromName: pending.raw_name,
      toName: resolvedName,
    }).catch(() => null);
  }
}

export async function resolvePendingItem({
  ownerId,
  pending,
  resolvedId,
  resolvedName,
  // The thread the correction happened in. Optional from the caller and DERIVED
  // when absent — see below.
  conversationId = null,
  // Injectable so the rewrite can be asserted without a database.
  correctName = correctNameInContent,
  correctTranscript = correctNameInTranscript,
  findConversation = conversationForPending,
  // Injectable for the same reason as the two above.
  resolveByName = resolvePendingTag,
}) {
  // THE TRANSCRIPT FIX WAS DEAD CODE. Every branch below guards the rewrite on
  // `conversationId`, and not one caller in the codebase passed one — the chat
  // route had it in scope and omitted it, the profile route omitted it, and the
  // client never sent it. So correctNameInTranscript had zero live callers and the
  // Today card and Voice Chat kept the misheard name forever, which is exactly the
  // thing a user notices: they corrected it, and the words did not change.
  //
  // Asking callers to remember was the design error. The pending row knows which
  // NOTE it belongs to, and that row's source_ref IS the conversation id, so it can
  // be looked up here once instead of threaded through four call sites.
  if (!conversationId) {
    conversationId = await findConversation(ownerId, pending).catch(() => null);
  }

  // WHETHER THE ANSWER ACTUALLY LANDED ANYWHERE.
  //
  // Every write below is .catch(() => null) so this function never throws, which
  // also means a write that fails, or a branch that matches nothing, is
  // indistinguishable from success. That is not theoretical: on 2026-09-07 a user
  // answered "which Eli?", contact_name_memory recorded the choice (step 2, which
  // runs unconditionally) and observation_participants got no row at all. The
  // append is guarded on content_type being exactly "note" or "experience"; the
  // name memory is guarded on nothing. So the system remembered who he meant and
  // never attached them, and every surface showed the correction as ignored.
  //
  // `applied` is set by whichever branch actually wrote something. If it is still
  // false at the end of step 1 we log loudly rather than proceed quietly to
  // "Got it, I'll write that down for Eli."
  let applied = false;
  // ONE ID, NOT TWO. pending_fact_context stores a single observation_id and
  // setPendingFactContext writes `factId ?? contentId` into it, dropping
  // content_type and content_id entirely -- so reading content_id gave undefined
  // and this branch attached nothing. Both shapes point at the same observations
  // row, and attachResolvedContact reads the row's own kind to decide whether the
  // contact is its subject or one of its cast.
  const targetObservationId = pending.content_id ?? pending.fact_id ?? null;
  const attach = async () => {
    if (!targetObservationId) return false;
    try {
      return await attachResolvedContact({
        ownerId,
        observationId: targetObservationId,
        contactId: resolvedId,
        rawName: pending.raw_name ?? null,
      });
    } catch (err) {
      console.error(
        `RESOLVE_ATTACH_ERR owner=${ownerId} obs=${targetObservationId} ${err?.message || err}`,
      );
      return false;
    }
  };

  // 1. Apply — strict if/else-if, mutually exclusive by pending.awaiting.
  if (pending.awaiting === "which_participant") {
    const ct = pending.content_type ?? "experience";
    const cid = targetObservationId;
    applied = await attach();
    // AND FIX THE WORDS, not just the tag. A transcript that heard "Roger" for
    // "Raj" got the right contact appended and kept saying Roger on the card
    // forever, so a correction the user made looked like it had been ignored. The
    // tag and the text have to agree or the correction is only half applied.
    await correctName({ ownerId, contentType: ct, contentId: cid, fromName: pending.raw_name, toName: resolvedName });
    // AND THE TRANSCRIPT ITSELF. correctName repairs the derived note; this repairs
    // app_conversation_messages, which is what the Today card and Voice Chat show.
    // Fixing only the note left the voice note still saying "Roger" after the user
    // had already picked Raj — the correction looked ignored in the one place they
    // actually read it back.
    if (conversationId) {
      await correctTranscript({ ownerId, conversationId, fromName: pending.raw_name, toName: resolvedName });
    }
  } else if (pending.awaiting === "which_contact") {
    // THE ROW IT POINTS AT, WHEN IT POINTS AT ONE.
    applied = await attach();

    // AND WHEN IT POINTS AT NOTHING, WHICH HAPPENS AND USED TO END HERE.
    //
    // This branch was `awaiting === "which_contact" && pending.fact_id`, so a
    // pending row with no observation id fell through EVERY branch: nothing was
    // attached, `applied` stayed false, and the log read
    //
    //   RESOLVE_NOOP ... awaiting=which_contact contentId=undefined factId=null
    //   -- the answer attached to nothing
    //
    // while the user was told "Got it, I'll write that down for Mei." That is
    // the worst possible outcome: the question was asked, answered, confirmed,
    // and discarded.
    //
    // A pending row loses its id legitimately -- the question is asked from the
    // chat pre-check before the observation is written, and for months every
    // unattributed observation was rejected outright by the status CHECK, so the
    // row it would have pointed at never existed. But the NOTE knows: its
    // observations carry the raw name with status 'pending', which is exactly
    // what resolvePendingTag settles. So the answer is applied by (conversation,
    // name) instead of by id -- and one answer settles every mention of that
    // name in the note, which is what the user meant by answering once.
    if (!applied && conversationId && pending.raw_name) {
      const byName = await resolveByName(
        ownerId,
        conversationId,
        pending.raw_name,
        String(resolvedId),
      ).catch(() => null);
      if (byName?.ok && (byName.resolved ?? 0) > 0) {
        applied = true;
        console.log(
          `RESOLVE_BY_NAME owner=${ownerId} conv=${conversationId} ` +
            `name=${pending.raw_name} resolved=${byName.resolved}`,
        );
      }
    }
    // AND THE WORDS, on this branch too. A fact-kind ambiguity used to resolve the
    // tag and leave the transcript saying the wrong name — the same half-applied
    // correction the participant branch was fixed for, on a path nobody checked.
    await fixWords({ pending, resolvedName, ownerId, conversationId, correctName, correctTranscript });
  } else if (pending.awaiting === "which_contact_field") {
    let meta = null;
    try { meta = JSON.parse(pending.candidates ?? "null"); } catch { /* ignore */ }
    if (meta?.field && meta?.value !== undefined) {
      await updateContactFields({
        ownerId, contactId: resolvedId,
        [meta.field]: meta.value,
      }).catch(() => null);
      applied = true;
    }
    await fixWords({ pending, resolvedName, ownerId, conversationId, correctName, correctTranscript });
  } else if (pending.awaiting === "soft_confirm") {
    let softMeta = null;
    try { softMeta = JSON.parse(pending.candidates ?? "null"); } catch { /* ignore */ }
    // Participant slot: append to the note/experience row.
    // content_type is always undefined (see targetObservationId above), so this
    // used to fall through to the fact branch and set the SUBJECT even for a
    // note with a cast. Anything that is not an explicit field update is an
    // attach now, and the row's kind decides what that means.
    if (!(softMeta?.kind === "field" && softMeta?.field && softMeta?.value !== undefined)) {
      applied = await attach();
      // Same correction on the soft-confirm path ("you mean Raj, right?" → yes).
      await correctName({
        ownerId,
        contentType: pending.content_type,
        contentId: pending.content_id,
        fromName: pending.raw_name,
        toName: resolvedName,
      });
      // Same on the soft-confirm path ("you mean Raj, right?" -> yes).
      if (conversationId) {
        await correctTranscript({ ownerId, conversationId, fromName: pending.raw_name, toName: resolvedName });
      }
    } else {
      await updateContactFields({
        ownerId, contactId: resolvedId,
        [softMeta.field]: softMeta.value,
      }).catch(() => null);
      applied = true;
    }
  }

  if (!applied) {
    console.error(
      `RESOLVE_NOOP owner=${ownerId} pending=${pending.id} awaiting=${pending.awaiting} ` +
      `contentType=${pending.content_type} contentId=${pending.content_id} factId=${pending.fact_id} ` +
      `resolved=${resolvedId} -- the answer attached to nothing`,
    );
  }

  // 2. Upsert name memory so future mentions of this name auto-resolve faster.
  // EXPLICIT: the user personally answered "who did you mean". Seeded at the
  // trust threshold so the very next mention of this name resolves silently
  // instead of asking the identical question again.
  await upsertContactNameMemory({
    ownerId,
    nameKey: _normName(pending.raw_name ?? ""),
    chosenContactId: String(resolvedId),
    explicit: true,
  }).catch(() => null);

  // 3. Per-item flush — deletes only this row, leaves other pending rows intact.
  await clearPendingFactContextById(pending.id, ownerId).catch(() => null);

  // 4. Compute confirm text — same wording as the original inline pre-check.
  const name = resolvedName ?? pending.raw_name ?? "them";
  const confirmText = pending.awaiting === "which_participant"
    ? `Got it, I'll write that down for ${name}.`
    : pending.awaiting === "soft_confirm"
    ? `Got it, I'll write that down for ${name}.`
    : pending.awaiting === "which_contact_field"
    ? `Updated that for ${name}.`
    : `Got it, I'll write that down for ${name}.`;

  return { ok: true, confirmText };
}
