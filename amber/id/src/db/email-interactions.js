/**
 * WRITING CORRESPONDENCE DOWN, WITHOUT WRITING THE CORRESPONDENCE DOWN.
 *
 * Takes the records gmail-headers.js produced and turns them into rows: who was
 * on which message, when, through which of the owner's mailboxes. No subject,
 * no body, no snippet, because none was ever fetched.
 *
 * THREE THINGS THIS HAS TO GET RIGHT, and each of them is a number somebody
 * will eventually read as "how close am I to this person":
 *
 * 1. ONE MESSAGE COUNTS ONCE. A thread landing in a work mailbox and a personal
 *    one is one exchange. The RFC822 Message-ID is the same string in both, so
 *    the insert conflicts on it and unions the account into seen_accounts
 *    rather than adding a row.
 *
 * 2. AN ADDRESS IS AN IDENTITY, NOT A NEW PERSON. Every counterparty goes
 *    through mergeContact -- the same resolver an Apple sync or a Clay push
 *    goes through -- so emailing somebody already in the address book attaches
 *    to their card instead of making a second one. That is the entire reason
 *    "I email Sagar and I text Sagar" is one contact.
 *
 * 3. NOT EVERY ADDRESS DESERVES A CARD. A person emailed once, two years ago,
 *    about nothing, is not a contact; they are noise that will sit in the graph
 *    forever. So an address unknown to the address book has to be seen
 *    MIN_MESSAGES_TO_CREATE times before a card is created for it. Addresses
 *    already known are attached to immediately, because the judgment has
 *    already been made.
 */

import { query } from "./sql.js";
import { mergeContact } from "./store.js";
import { resolveContactIdentity } from "./contact-identity.js";
import { noteNames } from "./observed-names.js";

/**
 * How many messages an unknown address must appear on before it becomes a card.
 *
 * One is too few: it turns every one-off reply, every conference organizer and
 * every person who ever CC'd you into a permanent node in your network. Two is
 * the smallest number that means "this went both ways or happened twice", which
 * is the weakest honest evidence of a relationship.
 */
export const MIN_MESSAGES_TO_CREATE = 2;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

/**
 * Place one email address on the contact graph.
 *
 * Returns a contact id, or null when the address is not (yet) worth a card.
 * `create` is the caller's decision, made from how often the address has been
 * seen in this batch plus what is already on file.
 */
async function placeAddress(ownerId, { address, name }, { create }) {
  // Look first, always. An address already anchored to a contact attaches
  // there whatever the creation policy says -- the person has already decided
  // this is somebody they know.
  const existing = await resolveContactIdentity(ownerId, {
    emails: [address],
    phones: [],
    fullName: name ?? null,
  }).catch(() => null);
  if (existing?.contactId) {
    /*
     * AND TAKE THE NAME, IF THE CARD HAS NONE WORTH KEEPING.
     *
     * The card usually exists already, created by a calendar invite, and a
     * calendar invite is addresses -- so it is called "i.pandey@pnptc.com",
     * or the humanized "Pandey". The mail header right here says "Ipsha
     * Pandey". Attaching to the card and walking away from the name is how
     * every downstream reader ended up showing an address: this is the only
     * moment the two are in the same place.
     *
     * Only ever fills a name that IS the address or is derived from it. A
     * name somebody typed is left alone.
     */
    const header = String(name ?? "").trim();
    if (header && !header.includes("@")) {
      await query(
        `UPDATE contacts
            SET full_name = $3::text, updated_at = now()
          WHERE owner_id = $1::uuid AND id = $2::uuid AND deleted_at IS NULL
            AND (
              full_name IS NULL
              OR btrim(full_name) = ''
              OR full_name LIKE '%@%'
              OR lower(regexp_replace(full_name, '[^a-zA-Z0-9]', '', 'g'))
                 = lower(regexp_replace(split_part($4::text, '@', 1), '[^a-zA-Z0-9]', '', 'g'))
            )`,
        [ownerId, existing.contactId, header, address],
      ).catch(() => null);
    }
    return String(existing.contactId);
  }

  if (!create) return null;

  const merged = await mergeContact(ownerId, {
    source: "gmail",
    // Derived from the address rather than the display name, so the same person
    // writing under "Sagar" and "Sagar Tiwari" is one card. A name-derived key
    // would merge two different people who share a name, which is the one merge
    // the resolver otherwise refuses to make.
    externalId: `email:${address}`,
    // Falling back to the address is deliberate: a card labeled with an email
    // is honest and searchable, and a card labeled "Unknown" is neither.
    fullName: name || address,
    emails: [address],
    phones: [],
    raw: { address, name: name ?? null, via: "gmail" },
  }).catch((err) => {
    console.error(`EMAIL_PLACE_FAILED owner=${ownerId} ${err?.message || err}`);
    return null;
  });
  return merged?.contactId ? String(merged.contactId) : null;
}

/**
 * Record a batch of parsed messages.
 *
 * Returns { messages, participants, created, skipped } -- counts rather than
 * rows, because a sync writes thousands and the caller wants a log line.
 */
export async function recordEmailMessages(ownerId, messages, { accountId = null } = {}) {
  const owner = asUuid(ownerId);
  const account = asUuid(accountId);
  const list = Array.isArray(messages) ? messages.filter(Boolean) : [];
  const out = { messages: 0, participants: 0, created: 0, skipped: 0 };
  if (!owner || list.length === 0) return out;

  // How often each address appears across this batch, which is what decides
  // whether an unknown address has earned a card. Counted over the whole batch
  // rather than per message, so a first sync of a mailbox sees the real
  // frequency instead of judging every address on its first sighting.
  const seen = new Map();
  for (const m of list) {
    for (const p of m.participants ?? []) {
      seen.set(p.address, (seen.get(p.address) ?? 0) + 1);
    }
  }

  /*
   * EVERY NAME ON EVERY HEADER, BEFORE ANY OF THE FILTERING BELOW.
   *
   * Deliberately upstream of the contact-creation threshold and of the
   * from/to/cc rules. One introduction email names five people and copies
   * three more; under the rules below most of them never earn a card, so
   * their names were read and dropped and the graph showed their addresses
   * forever. Whether somebody is a relationship and what they are called are
   * two different questions, and only the first one needs a threshold.
   */
  await noteNames(
    owner,
    list.flatMap((m) => m.participants ?? []),
    { source: "mail" },
  ).catch(() => 0);

  // Resolve every distinct address once, not once per message it appears on.
  const contactByAddress = new Map();
  for (const [address, count] of seen) {
    const entry =
      list.flatMap((m) => m.participants ?? []).find((p) => p.address === address) ?? { address };
    const contactId = await placeAddress(owner, entry, {
      create: count >= MIN_MESSAGES_TO_CREATE,
    });
    if (contactId) {
      contactByAddress.set(address, contactId);
      if (count >= MIN_MESSAGES_TO_CREATE) out.created += 1;
    } else {
      out.skipped += 1;
    }
  }

  for (const m of list) {
    const participants = (m.participants ?? [])
      .map((p) => ({ ...p, contactId: contactByAddress.get(p.address) }))
      .filter((p) => p.contactId);
    // Every address on it was below the bar. The message is real but there is
    // nobody on the graph to hang it off, so counting it would inflate nobody's
    // numbers and leave an orphan row.
    if (participants.length === 0) continue;

    try {
      await query(
        `INSERT INTO email_messages
           (owner_id, message_id, thread_id, occurred_at, direction, seen_accounts)
         VALUES ($1::uuid, $2, $3, $4::timestamptz, $5,
                 CASE WHEN $6::uuid IS NULL THEN '{}'::uuid[] ELSE ARRAY[$6::uuid] END)
         ON CONFLICT (owner_id, message_id) DO UPDATE
           -- THE SAME MESSAGE, SEEN AGAIN FROM ANOTHER MAILBOX. Not a second
           -- exchange: the same one, now known to span two of the owner's
           -- accounts. Union rather than append, so a re-sync of the same
           -- mailbox does not keep growing the array.
           SET seen_accounts = ARRAY(
                 SELECT DISTINCT unnest(email_messages.seen_accounts || EXCLUDED.seen_accounts)
               ),
               thread_id = COALESCE(email_messages.thread_id, EXCLUDED.thread_id)`,
        [owner, m.messageId, m.threadId ?? null, m.occurredAt, m.direction, account],
      );
      out.messages += 1;
    } catch (err) {
      console.error(`EMAIL_MESSAGE_WRITE_FAILED owner=${owner} ${err?.code || ""} ${err?.message || err}`);
      continue;
    }

    for (const p of participants) {
      try {
        const r = await query(
          `INSERT INTO email_participants (owner_id, message_id, contact_id, role)
           VALUES ($1::uuid, $2, $3::uuid, $4)
           ON CONFLICT (owner_id, message_id, contact_id) DO NOTHING`,
          [owner, m.messageId, p.contactId, p.role ?? "to"],
        );
        out.participants += r.rowCount ?? 0;
      } catch (err) {
        // One participant failing is one participant. The message is already
        // recorded and the others still attach.
        console.error(
          `EMAIL_PARTICIPANT_WRITE_FAILED owner=${owner} ${err?.code || ""} ${err?.message || err}`,
        );
      }
    }
  }

  return out;
}

/** The mailbox cursor for one connected account, or null if it has never synced. */
export async function getMailSyncState(ownerId, accountId) {
  const owner = asUuid(ownerId);
  const account = asUuid(accountId);
  if (!owner || !account) return null;
  const { rows } = await query(
    `SELECT account_id, owner_id, history_id, backfilled_to, last_synced_at,
            last_error, last_error_at, read_contents
       FROM mail_sync_state
      WHERE owner_id = $1::uuid AND account_id = $2::uuid`,
    [owner, account],
  );
  return rows[0] ?? null;
}

/** Move the cursor forward, or record why it did not move. */
export async function saveMailSyncState(ownerId, accountId, patch = {}) {
  const owner = asUuid(ownerId);
  const account = asUuid(accountId);
  if (!owner || !account) return false;
  const { historyId = null, backfilledTo = null, error = null } = patch;
  await query(
    `INSERT INTO mail_sync_state
       (account_id, owner_id, history_id, backfilled_to, last_synced_at, last_error, last_error_at)
     VALUES ($1::uuid, $2::uuid, $3, $4::timestamptz, now(), $5,
             CASE WHEN $5::text IS NULL THEN NULL ELSE now() END)
     ON CONFLICT (account_id) DO UPDATE
       SET history_id    = COALESCE(EXCLUDED.history_id, mail_sync_state.history_id),
           -- Only ever reaches further back, never forward: a resumed backfill
           -- must not forget ground it already covered.
           backfilled_to = LEAST(
             COALESCE(mail_sync_state.backfilled_to, EXCLUDED.backfilled_to),
             COALESCE(EXCLUDED.backfilled_to, mail_sync_state.backfilled_to)
           ),
           last_synced_at = now(),
           last_error     = EXCLUDED.last_error,
           last_error_at  = EXCLUDED.last_error_at,
           updated_at     = now()`,
    [account, owner, historyId, backfilledTo, error],
  );
  return true;
}
