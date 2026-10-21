/**
 * Full Cloud SQL purge for account deletion.
 *
 * The account-delete flow used to wipe only Firestore + Privy, leaving every
 * owner-scoped Postgres row behind AND leaving the users row (which holds the
 * phone) in place — so a deleted user could never re-onboard on the same number.
 * This hard-deletes all of a user's data and the user row itself, so "delete my
 * account" means a genuine clean slate: sign up again and go through onboarding
 * from scratch.
 *
 * Each table is deleted best-effort in its own try/catch, so a table that
 * doesn't exist (or lacks the expected column) never blocks the rest. Add tables
 * here as the schema grows.
 */

import { query } from "./sql.js";
import { deleteGcsObject, gcsConfigured } from "../lib/gcs-signing.js";

/**
 * Tables holding a Cloud Storage key that belongs to this owner.
 *
 * DELETING THE ROW IS NOT DELETING THE RECORDING. Every table below was already
 * purged, so the account's audio became unreachable -- but the BYTES stayed in
 * the bucket forever, with no row left pointing at them and therefore nothing
 * that would ever clean them up. For a product whose most sensitive content is
 * voice recordings of the user talking about people, and which has to satisfy an
 * App Store requirement that account deletion deletes the user's data, that is
 * not a housekeeping detail.
 *
 * The keys are collected BEFORE the rows go (afterwards there is nothing left to
 * read them from) and the objects are deleted AFTER. That order is deliberate:
 * if the object deletes fail, the rows are still gone and the data is
 * unreachable, which is the same state as before this existed. The reverse order
 * would risk destroying a live account's recordings and then failing the purge.
 */
const STORAGE_KEY_TABLES = ["media_assets", "profile_voice_bios", "note_audio"];

// Tables scoped to a single owner via an `owner_id` column (uuid or text; the
// amber_id is passed as a string and Postgres casts it). Children are listed
// before their parent so foreign keys without ON DELETE CASCADE don't block the
// delete — `contacts` MUST stay last for that reason.
export const OWNER_SCOPED_TABLES = [
  "clay_jobs",
  // Contact-derived data (children of contacts) ---------------------------
  // EVERY FACT, NOTE AND EXPERIENCE IS ONE TABLE NOW. Naming the three old ones
  // here would have left this list looking complete while deleting nothing:
  // the tables do not exist, each miss is caught and recorded as ":skipped",
  // and "delete my account" would quietly keep every fact the account held.
  "observation_dimensions",
  "observation_tags",
  "observation_raw_names",
  "observation_participants",
  "observations",
  "contact_dimension_state",
  "contact_scores",
  "contact_interaction_stats",
  "contact_name_memory",
  "contact_embedding",
  "contact_sources",
  "contact_identity_keys",
  "contact_review_candidates",
  // Merge snapshots hold whole contact rows -- names, phones, emails -- so a
  // purge that skipped this table would leave a copy of the address book
  // behind after the account it belonged to was deleted.
  "contact_merges",
  // Correspondence metadata: who the owner emailed, when, on which of their
  // accounts. No bodies and no subject lines, but a complete map of who
  // somebody talks to is exactly the thing a deleted account must not leave
  // behind. email_participants cascades from email_messages, and is listed
  // anyway so the structural test does not have to reason about cascade order.
  "email_participants",
  "email_messages",
  // The names this mailbox saw beside addresses. No message, no subject, but
  // it is a list of who somebody corresponds with and what they are called,
  // which is the same kind of fact as the line above.
  "observed_names",
  // Two ids saying this person has connected something. It cascades from
  // users anyway; it is named here so the structural test does not have to
  // reason about cascade order, same as email_participants above.
  "memory_refresh_queue",
  "contact_channel_stats",
  "mail_sync_state",
  // What enrichment was spent on, and the per-owner budget. The ledger names
  // contacts by id and by what a vendor said about them; the limits row is
  // small but it is still a fact about a person's account.
  "enrichment_ledger",
  "enrichment_limits",
  "contact_favorites",
  "favorites",
  "pending_fact_context",
  // User-owned standalone data --------------------------------------------
  "user_api_keys",
  "user_facts",
  /**
   * SIX TABLES THAT WERE BEING LEFT BEHIND, found by the structural test at the
   * bottom of purge.test.js rather than by anybody reading this list.
   *
   * Every one of them references users (amber_id) ON DELETE CASCADE, so they DO
   * go when the account row goes -- which is why nobody noticed. They are named
   * here anyway, and the reason is the same one given below for circle_members:
   * this list is what somebody reads to answer "what does delete-my-account
   * actually delete", and a table that only disappears as a side effect of
   * somebody else's foreign key is one schema change from silently surviving.
   *
   * `query_dimensions` is the newest of them (migration 043) and is the one that
   * makes the point: it was added a day earlier, by the same hands, and not
   * added here.
   */
  "permissions",
  "permission_audit",
  "personality_profiles",
  "people_rank_feedback",
  "onboarding_progress",
  "query_dimensions",
  // Calendar accounts, and with them every event they synced -- events.
  // calendar_account_id is ON DELETE CASCADE. Named here rather than left to
  // that cascade for the reason the note below gives: this list is what anybody
  // reads to answer "what does delete-my-account actually delete", and a table
  // that only goes as a side effect of somebody else's FK is one schema change
  // away from silently surviving.
  "calendar_accounts",
  "voice_vocabulary",
  "wall_posts",
  "answers",
  "questions",
  // BEFORE `reminders`, because it references it. reminder_completions would
  // also go by ON DELETE CASCADE, and it is named here anyway for the reason
  // this whole list exists: it is what anybody reads to answer "what does
  // delete-my-account actually delete", and a table that only goes as a side
  // effect of somebody else's FK is one schema change away from surviving.
  "reminder_completions",
  "reminders",
  "agent_data",
  "agent_log",
  // circle_favorites cascades from circles, and profile_voice_bios cascades from
  // users -- but both are named here anyway. This list is what anyone reads to
  // answer "what does delete-my-account actually delete", and a table that is
  // only removed as a side effect of someone else's ON DELETE CASCADE is one FK
  // change away from silently surviving the purge.
  "circle_favorites",
  "circle_members",
  "circles",
  // Derived audiences. cohort_members cascades from cohorts, but it is named
  // here anyway: the comment above says a table only removed as a side effect
  // of somebody else's ON DELETE CASCADE is one FK change away from silently
  // surviving the purge, and that argument applies to derived data exactly as
  // much as to entered data.
  "cohort_members",
  "cohorts",
  // What this person put into the world, and at what audience. An intent is
  // shared, but it is still theirs: a deleted account must not leave its
  // statements matchable by everybody else's agent.
  "intents",
  // Where they said they were. Same argument, and sharper: a location outlives
  // the account that stated it only as a dot on somebody else's map, which is
  // the single worst thing deletion could leave behind. `places` itself is a
  // seeded lookup owned by nobody and is deliberately NOT touched.
  "user_locations",
  "profile_voice_bios",
  "shares",
  "network_visibility",
  "events",
  "tags",
  "discovery_keys",
  // Notes and their audio — the two most sensitive things the account holds,
  // and both were once absent from this list, so "delete my account" left the
  // transcripts and the recordings in place. media_assets is listed FIRST
  // because conversation_messages and conversations are its parents.
  "media_assets",
  "conversation_reactions",
  "conversation_comments",
  "conversation_messages",
  "conversations",
  /*
   * THE VOICE-NOTE TABLES, WHICH WERE NEVER IN THIS LIST.
   *
   * note_shares and note_audio were created by migrations that live only in
   * db/migrations/_archive/, so the structural test below never read them and
   * nobody was told they were missing. They have been in production since
   * August: note_shares records who each voice note was shared with, and
   * note_audio holds the clip's GCS storage_key, its waveform and its size.
   * Deleting an account left both behind, and left the audio objects in the
   * bucket with nothing pointing at them -- the exact failure the storage
   * sweep at the top of this file exists to prevent.
   *
   * 20261013_061_restore_note_tables.sql puts the definitions back in the
   * active set, which is what made the test fail and this fix necessary.
   */
  "note_shares",
  "note_audio",
  // Push tokens, or a deleted account's phone keeps receiving notifications.
  "push_tokens",
  // Holds the user's Clay webhook URL and token — a live credential. Leaving it
  // behind is a secret that outlives the account that owned it.
  "clay_destinations",
  /*
   * The Clay job queue, named here for the same reason as the six tables
   * below: it DOES cascade from users (amber_id) ON DELETE CASCADE, so the
   * rows go when the account row goes and nobody would have noticed. But its
   * `input` and `output` are jsonb holding whatever was searched for and
   * whatever came back about those people, and a table that only disappears
   * as a side effect of somebody else's foreign key is one schema change away
   * from silently surviving.
   *
   * It was invisible to the structural test until now because
   * 20261004_059_clay_jobs.sql was lost and had to be reconstructed; the test
   * reads the migrations, so a table whose CREATE no longer existed could not
   * be checked.
   */
  "clay_jobs",
  // Secrets bag (v1 + v2) --------------------------------------------------
  "secrets",
  "tenant_secrets_v2",
  "tenant_deks",
  "tenant_secret_audit",
  // Parent — keep LAST so its children above are gone first ---------------
  "contacts",
];

// Tables whose owner column is NOT named `owner_id`, or that need a subquery
// (a child keyed only by its parent id). Ordered: children before parents.
// Every statement is owner-scoped and parameterized on $1 = amberId.
function customDeletes(amberId) {
  return [
    // Question / answer threads. thread_messages has no owner_id — it hangs off
    // question_threads(id), so delete it (and answers) BEFORE question_threads.
    ["answers_by_thread_owner", `DELETE FROM answers WHERE owner_id = $1`],
    [
      "thread_messages",
      `DELETE FROM thread_messages
        WHERE thread_id IN (SELECT id FROM question_threads WHERE owner_id = $1)`,
    ],
    ["question_threads", `DELETE FROM question_threads WHERE owner_id = $1`],
    // Two-sided relationships: the user owns their half on either side.
    // a_amber_id / b_amber_id, not user_a / user_b. Those two columns have not
    // existed since migration 004, so this DELETE threw -- and a purge that
    // throws on a table leaves that table's rows behind. Deletion failing quietly
    // is the worst possible place for a column rename to hide.
    /*
     * THE RELATIONSHIP MEMORY, THE HALF OF IT THAT IS THEIRS.
     *
     * org_person_edges is derived -- it is a fold over org_interactions -- so
     * deleting this person's edges loses nothing that cannot be recomputed,
     * and leaving them would mean a departed employee still appears to know
     * every contact they ever emailed.
     *
     * org_memory_sources is their CONSENT: "I agreed that my calendar may
     * feed the company graph". A grant has to die with the person who gave
     * it, and the interactions that came in under it go with it -- which is
     * why org_interactions carries connection_id and why that delete runs
     * first, before the grant that identifies which rows to take.
     *
     * The ledger itself and the contacts are NOT here; see the exemptions in
     * purge.test.js for why.
     */
    [
      "org_interactions_from_revoked_sources",
      `DELETE FROM org_interactions
        WHERE connection_id IN (SELECT id FROM org_memory_sources WHERE amber_id = $1)`,
    ],
    ["org_memory_sources", `DELETE FROM org_memory_sources WHERE amber_id = $1`],

    /*
     * An AI import is the most personal record in this system: it is the
     * trace of one person's own history with an assistant. The interactions
     * it produced go with it, by import_id, for the same reason revoked
     * consent takes its data back -- what arrived under one decision leaves
     * under its reversal.
     *
     * The order matters: the interactions are found THROUGH the import rows,
     * so deleting the imports first would strand them.
     */
    [
      "org_interactions_from_ai_imports",
      `DELETE FROM org_interactions
        WHERE import_id IN (SELECT id FROM org_ai_imports WHERE amber_id = $1)`,
    ],
    ["org_ai_imports", `DELETE FROM org_ai_imports WHERE amber_id = $1`],
    ["org_person_edges", `DELETE FROM org_person_edges WHERE member_id = $1`],
    ["connections", `DELETE FROM connections WHERE a_amber_id = $1 OR b_amber_id = $1`],
    [
      "connection_requests",
      `DELETE FROM connection_requests WHERE requester_amber_id = $1 OR addressee_amber_id = $1`,
    ],
    [
      "intro_requests",
      // owner_id, not owner_amber_id — same story, same consequence.
      `DELETE FROM intro_requests WHERE requester_amber_id = $1 OR owner_id = $1`,
    ],
    ["circle_member_seen", `DELETE FROM circle_member_seen WHERE viewer_amber_id = $1`],

    /*
     * LEAVING THE COMPANY, BECAUSE THE PERSON IS GONE.
     *
     * Three tables from migration 062, all keyed on amber_id rather than
     * owner_id, so none of them is reachable by the owner_id loop below.
     *
     * THE ORGANIZATION ITSELF IS NOT TOUCHED, and that is the point worth
     * stating. Deleting your account removes YOU from the roster; it does not
     * delete a company other people are still working in. What survives is the
     * company, its groups, its policy -- and, deliberately, the org_invites row
     * that records an invitation having been issued and accepted, which names
     * the inviter by a column this delete does not clear. An admin who deletes
     * their account leaves a history of invites behind; that is a record of
     * what was done to accounts, which is the same argument audit_log is
     * exempt under.
     *
     * The order matters: group membership points at the membership row by
     * composite FK, so it goes first. Both would in fact cascade from
     * users(amber_id) -- and both are named here anyway, for the reason this
     * whole list exists.
     *
     * email_login_tokens holds live sign-in capability for this account. A
     * purge that left them would leave working links to an account that no
     * longer exists; they expire in fifteen minutes, which is not an argument
     * for keeping them.
     */
    /*
     * BOTH HALVES OF A WORKSPACE LINK.
     *
     * account_links is written in symmetric pairs, so deleting only the rows
     * where this person is amber_id would leave the other account still
     * listing a deleted workspace in its picker -- and the picker is the one
     * place an account names another account.
     *
     * Both sides cascade from users(amber_id) and both are named here anyway,
     * for the reason this whole list exists.
     */
    ["account_links:own", `DELETE FROM account_links WHERE amber_id = $1`],
    ["account_links:other", `DELETE FROM account_links WHERE linked_amber_id = $1`],
    /*
     * SHARES ADDRESSED TO THIS PERSON BY NAME.
     *
     * A 'person' audience row is a grant to one named account, so it is this
     * person's uuid sitting in another company's table and it goes. Group rows
     * are not touched: they name a group, not a person, and the membership row
     * that connected the two is deleted on the next line.
     *
     * An item shared with ONLY this person is left restricted with no audience
     * rows, which means readable by its author alone. That is the correct end
     * state and the reason migration 074 has no constraint forbidding it --
     * the alternative, widening somebody's private file to the whole company
     * because its one recipient closed their account, is not a purge.
     */
    ["org_audiences", `DELETE FROM org_audiences WHERE kind = 'person' AND ref = $1`],
    /*
     * REACTIONS AND MENTIONS THIS PERSON MADE OR RECEIVED.
     *
     * A reaction is their gesture and goes with them -- the count on somebody
     * else's post drops by one, which is the honest end state for an account
     * that no longer exists. A mention row names them as the addressee and is
     * worthless once there is nobody to address; the post itself keeps the
     * text, because that is the author's writing, not this person's.
     */
    /*
     * A SHARED CALENDAR IS THIS PERSON'S GRANT AND GOES WITH THEM.
     *
     * The row says "I am showing this calendar to that team". It is not the
     * team's data, it is permission this account gave, and it is worthless the
     * moment the account and its calendar_accounts rows are gone. Leaving it
     * would be a dangling grant naming a deleted person.
     */
    ["org_group_calendars", `DELETE FROM org_group_calendars WHERE amber_id = $1`],
    ["org_post_reactions", `DELETE FROM org_post_reactions WHERE amber_id = $1`],
    ["org_post_mentions", `DELETE FROM org_post_mentions WHERE amber_id = $1`],
    ["org_feed_reads", `DELETE FROM org_feed_reads WHERE amber_id = $1`],
    ["org_group_members", `DELETE FROM org_group_members WHERE amber_id = $1`],
    ["org_members", `DELETE FROM org_members WHERE amber_id = $1`],
    ["email_login_tokens", `DELETE FROM email_login_tokens WHERE amber_id = $1`],

    /*
     * DIRECT MESSAGES. THE WHOLE THREAD, NOT JUST THIS PERSON'S HALF.
     *
     * These were not purged at all. dm_messages holds `body` -- the actual text
     * of every message the account ever sent -- and `storage_key` for voice
     * notes, and all of it survived "delete my account". The structural test
     * that is supposed to catch exactly this looked for an owner column, and a
     * DM thread has none: it belongs to two people, as a_amber_id and
     * b_amber_id. The test has been widened alongside this.
     *
     * DELETING THE COUNTERPARTY'S MESSAGES TOO is the deliberate part. A thread
     * is a two-party object; once one side's account is gone the other side
     * cannot render it -- there is no counterparty identity left to show -- and
     * leaving the deleted person's messages in place under a dangling uuid is
     * precisely what "delete my account" must not mean. The other party loses
     * the conversation. That is the correct trade and it is worth saying out
     * loud rather than discovering later.
     *
     * Children before parents: reactions and reads reference messages,
     * messages reference threads.
     */
    [
      "dm_reactions_in_threads",
      `DELETE FROM dm_reactions WHERE message_id IN (
         SELECT m.id FROM dm_messages m JOIN dm_threads t ON t.id = m.thread_id
          WHERE t.a_amber_id = $1 OR t.b_amber_id = $1)`,
    ],
    [
      "dm_reads",
      `DELETE FROM dm_reads WHERE amber_id = $1 OR thread_id IN (
         SELECT id FROM dm_threads WHERE a_amber_id = $1 OR b_amber_id = $1)`,
    ],
    [
      "dm_clears",
      `DELETE FROM dm_clears WHERE amber_id = $1 OR thread_id IN (
         SELECT id FROM dm_threads WHERE a_amber_id = $1 OR b_amber_id = $1)`,
    ],
    [
      "dm_messages",
      `DELETE FROM dm_messages WHERE thread_id IN (
         SELECT id FROM dm_threads WHERE a_amber_id = $1 OR b_amber_id = $1)`,
    ],
    ["dm_threads", `DELETE FROM dm_threads WHERE a_amber_id = $1 OR b_amber_id = $1`],
    [
      "dm_blocks",
      `DELETE FROM dm_blocks WHERE blocker_amber_id = $1 OR blocked_amber_id = $1`,
    ],

    /*
     * PROPOSALS, FROM BOTH SIDES.
     *
     * A proposal is a suggestion about two people, so it is keyed on both and
     * belongs to neither alone. Same argument as the DM threads above: once one
     * side's account is gone the other side cannot render it, and leaving a
     * suggestion about a deleted person in somebody's feed is worse than losing
     * it. The intents it cites are ON DELETE SET NULL, so ordering here does
     * not matter, but they go first anyway to keep the row complete while it
     * exists.
     */
    [
      "proposals",
      `DELETE FROM proposals WHERE a_amber_id = $1 OR b_amber_id = $1`,
    ],

    /*
     * SIGN-IN IDENTITIES. The single most important row for "sign up again and
     * get a clean slate": it holds the email, the provider and the provider's
     * subject id. Left behind, a re-registration either collides with a row
     * pointing at a user that no longer exists, or silently re-attaches the new
     * account to the old identity -- which is the opposite of a clean slate.
     */
    ["user_identities", `DELETE FROM user_identities WHERE amber_id = $1`],

    /*
     * THE WEIGHTS THE RANKER LEARNED FROM THIS PERSON. Small, and entirely
     * derived from their behavior. A new account must not inherit the old
     * account's idea of what matters to them.
     */
    ["user_dimension_weights", `DELETE FROM user_dimension_weights WHERE amber_id = $1`],

    /*
     * BLOCKS THIS PERSON MADE. Their own decision, their own data, so it goes.
     *
     * Blocks made AGAINST them are deliberately NOT deleted -- see the
     * exemption note in purge.test.js. Somebody else decided they did not want
     * to hear from this person, and letting an account deletion clear that
     * would make "delete and re-register" a way around being blocked.
     */
    ["blocked_handles", `DELETE FROM blocked_handles WHERE blocker_amber_id = $1`],
    // Reactions and comments on notes: the user is on both sides — their own
    // notes' reactions, and the reactions they left on other people's notes.
    // Deleting only one side leaves their uuid attached to someone else's feed.
    // Reactions and comments the user left on OTHER PEOPLE'S notes. Their own
    // notes' reactions go with the conversation, by foreign key; these do not,
    // because the parent belongs to somebody else and must survive.
    [
      "conversation_reactions",
      `DELETE FROM conversation_reactions WHERE reactor_amber_id = $1`,
    ],
    [
      "conversation_comments",
      `DELETE FROM conversation_comments WHERE author_amber_id = $1`,
    ],
    [
      "dm_reactions",
      `DELETE FROM dm_reactions WHERE reactor_amber_id = $1`,
    ],
    /**
     * REACTIONS AND COMMENTS ON OTHER PEOPLE'S WALL POSTS.
     *
     * These were missing, and the shape of the miss is the same one the note
     * above describes: a person's own posts take their reactions and comments
     * with them by foreign key (post_reactions and post_comments both cascade
     * from wall_posts, which is owner-scoped), so a spot check looks clean.
     * What does not cascade is what they left on SOMEBODY ELSE'S post -- the
     * parent belongs to another account and has to survive -- so deleting your
     * account left your uuid on their feed, permanently, as a reaction and a
     * comment with your name on it.
     */
    [
      "post_reactions",
      `DELETE FROM post_reactions WHERE reactor_amber_id = $1`,
    ],
    [
      "post_comments",
      `DELETE FROM post_comments WHERE author_amber_id = $1`,
    ],
    /**
     * REACTIONS AND COMMENTS ON VOICE NOTES, FROM BOTH SIDES.
     *
     * The post_* case above gets one delete each because those tables cascade
     * from wall_posts, so a person's own posts take their reactions with them.
     * note_reactions and note_comments have NO foreign keys -- the archived
     * migration that created them declares none -- so nothing cascades in
     * either direction. One delete here would leave half the rows behind, and
     * which half depends on whose note it was.
     *
     * So both sides are named: the rows on THIS person's notes, keyed on
     * note_owner_id, and the rows they left on SOMEBODY ELSE'S notes, keyed on
     * reactor_amber_id and author_amber_id. The second kind is the one that
     * outlives the account on another person's feed.
     */
    [
      "note_reactions:own",
      `DELETE FROM note_reactions WHERE note_owner_id = $1`,
    ],
    [
      "note_reactions:left",
      `DELETE FROM note_reactions WHERE reactor_amber_id = $1`,
    ],
    [
      "note_comments:own",
      `DELETE FROM note_comments WHERE note_owner_id = $1`,
    ],
    [
      "note_comments:left",
      `DELETE FROM note_comments WHERE author_amber_id = $1`,
    ],
  ];
}

/**
 * Rows keyed on the IDENTITY rather than the amber_id: the Privy DID or the
 * phone number. These cannot be reached from an amber_id, which is why they
 * survived every previous delete — including device_sessions, whose refresh
 * tokens would otherwise stay valid for an account that no longer exists.
 */
function identityDeletes({ privyDid, phone }) {
  const out = [];
  if (privyDid) {
    out.push([
      "device_sessions_by_subject",
      `DELETE FROM device_sessions WHERE subject_id = $1`,
      privyDid,
    ]);
  }
  if (phone) {
    out.push(
      ["device_sessions_by_phone", `DELETE FROM device_sessions WHERE phone = $1`, phone],
      ["otp_codes", `DELETE FROM otp_codes WHERE phone = $1`, phone],
      ["slack_links", `DELETE FROM slack_links WHERE phone_e164 = $1`, phone],
    );
  }
  return out;
}

// Postgres codes for "that table does not exist" and "that column does not
// exist". A best-effort purge list SHOULD contain tables that a given
// deployment has never created; those are skips, not failures. Anything else —
// a permission error, a foreign-key violation, the connection dropping — is a
// real failure and must not be reported as a completed deletion.
const MISSING_SCHEMA_CODES = new Set(["42P01", "42703"]);

export async function purgeOwnerData(
  amberId,
  // queryImpl is injectable ONLY so the rules below (what is a skip, what is a
  // real error, what makes userRowDeleted false) are testable without a database.
  // Production always uses the real query(). Same for the two storage hooks.
  {
    privyDid = null,
    phone = null,
    queryImpl = query,
    deleteObject = deleteGcsObject,
    storageConfigured = gcsConfigured,
  } = {},
) {
  // `errors` is only ever a REAL failure now. A table this deployment has never
  // created lands in `skipped` instead, so the caller can treat a non-empty
  // `errors` as "the data is still there" and mean it — which is what lets the
  // delete-account route stop reporting a completed deletion as an error and
  // start reporting a failed one.
  const result = {
    deleted: {},
    skipped: [],
    errors: [],
    userRowDeleted: false,
    // Reported separately from `errors` on purpose. `errors` means "the rows may
    // still be there", which is what the delete-account route turns into a
    // failed deletion. A bucket that would not answer is a leftover object, not
    // a surviving account, and conflating the two would start reporting
    // successful purges as failures.
    storageObjectsDeleted: 0,
    storageErrors: [],
  };
  if (!amberId) return result;

  const run = async (label, sql, params) => {
    try {
      const r = await queryImpl(sql, params);
      result.deleted[label] = r?.rowCount ?? 0;
      return true;
    } catch (err) {
      if (MISSING_SCHEMA_CODES.has(err?.code)) {
        result.skipped.push(label);
        return true;
      }
      result.errors.push({ label, code: err?.code ?? null, message: err?.message ?? String(err) });
      return false;
    }
  };

  // 0. Collect the storage keys while the rows that hold them still exist.
  //    Best-effort and never fatal: a table this deployment has never created,
  //    or a read that fails, means we clean up fewer objects -- it must not stop
  //    the account from being deleted.
  // A Set, not an array: the two tables use different key prefixes so a
  // collision is not expected, but deleting the same object twice would count it
  // twice and invite a spurious "already gone" error on the second attempt.
  const storageKeys = new Set();

  // DIRECT-MESSAGE VOICE NOTES, collected separately because dm_messages has no
  // owner_id -- it is keyed on the THREAD, and the thread is keyed on the two
  // participants. That shape is exactly why these were missed: every guard in
  // this file and its test looked for an owner column, and a table that belongs
  // to two people equally does not have one.
  try {
    const r = await queryImpl(
      `SELECT m.storage_key
         FROM dm_messages m
         JOIN dm_threads t ON t.id = m.thread_id
        WHERE (t.a_amber_id = $1 OR t.b_amber_id = $1)
          AND m.storage_key IS NOT NULL`,
      [amberId],
    );
    for (const row of r?.rows ?? []) {
      if (typeof row?.storage_key === "string" && row.storage_key) storageKeys.add(row.storage_key);
    }
  } catch (err) {
    if (!MISSING_SCHEMA_CODES.has(err?.code)) {
      result.storageErrors.push({
        label: "dm_messages:read",
        code: err?.code ?? null,
        message: err?.message ?? String(err),
      });
    }
  }

  for (const table of STORAGE_KEY_TABLES) {
    try {
      const r = await queryImpl(
        `SELECT storage_key FROM ${table} WHERE owner_id = $1`,
        [amberId],
      );
      for (const row of r?.rows ?? []) {
        if (typeof row?.storage_key === "string" && row.storage_key) {
          storageKeys.add(row.storage_key);
        }
      }
    } catch (err) {
      if (!MISSING_SCHEMA_CODES.has(err?.code)) {
        result.storageErrors.push({
          label: `${table}:read`,
          code: err?.code ?? null,
          message: err?.message ?? String(err),
        });
      }
    }
  }

  // 1. Custom-column / subquery deletes first (children before parents).
  for (const [label, sql] of customDeletes(amberId)) {
    await run(label, sql, [amberId]);
  }

  // 2. The straightforward owner_id-scoped tables.
  for (const table of OWNER_SCOPED_TABLES) {
    // Table names come only from the constant list above — never user input.
    await run(table, `DELETE FROM ${table} WHERE owner_id = $1`, [amberId]);
  }

  // 3. Rows reachable only from the DID or the phone, not from the amber_id.
  for (const [label, sql, param] of identityDeletes({ privyDid, phone })) {
    await run(label, sql, [param]);
  }

  // 4. Hard-delete the user row LAST so the phone is freed for a clean
  //    re-onboard. The users table's primary key is `amber_id` (uuid) — NOT
  //    `id`; the previous `WHERE id = $1` silently errored, leaving the row (and
  //    its phone) in place, which is what blocked re-onboarding after delete.
  //
  //    userRowDeleted is reported separately because it is the one delete whose
  //    failure means the account still exists. Note that rowCount 0 is a
  //    SUCCESS here: it means no such row, which is the state we wanted.
  result.userRowDeleted = await run("users", `DELETE FROM users WHERE amber_id = $1`, [amberId]);

  // 5. The recordings themselves, now that every row pointing at them is gone.
  //
  //    Every key came from a row filtered on `owner_id = $1`, so this can only
  //    ever touch objects this account owned. One object failing does not stop
  //    the others, and none of it can fail the purge -- see storageErrors.
  if (storageKeys.size > 0) {
    if (!storageConfigured()) {
      result.storageErrors.push({
        label: "storage",
        code: null,
        message: `storage not configured; ${storageKeys.size} object(s) left in place`,
      });
    } else {
      for (const key of storageKeys) {
        try {
          await deleteObject(key);
          result.storageObjectsDeleted += 1;
        } catch (err) {
          result.storageErrors.push({
            label: key,
            code: err?.code ?? null,
            message: err?.message ?? String(err),
          });
        }
      }
    }
  }

  return result;
}
