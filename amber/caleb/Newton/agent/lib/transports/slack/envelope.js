/**
 * Slack event -> internal envelope conversion.
 *
 * Medha's agent loop is entered through `enqueueMessage` in agent.js
 * with an 8-element array shaped exactly like a Loop Message inbound:
 *
 *   [from, text, messageId, groupId, groupName, participants,
 *    replyToId, loopSenderId]
 *
 * To plug Slack in without forking the agent loop, we synthesize that
 * same tuple from a Slack `message` or `app_mention` event. The
 * `loopSenderId` we hand to the loop is `MEDHA_EXPERT_SENDER_ID` so
 * the existing tenant resolver short-circuits to the public Medha-expert
 * tenant.
 *
 * Identity mapping has three layers, tried in order:
 *
 *   1. Option A (linked): /v1/slack-links/:team/:user already binds this
 *      Slack identity to a person_id. Use it. Cheap, single Firestore read.
 *
 *   2. Option B (auto-link by email): if there's no existing link, look up
 *      the Slack user's profile email via users.info, then ask medha-id if
 *      any tenant claims that email. If one does, silently auto-bind the
 *      Slack identity to that tenant's phone — no ceremony, no soft P.S.
 *      The user goes straight into the linked-user path on their very first
 *      message. This is the path Sagar (and every other org member with a
 *      Privy tenant) hits.
 *
 *   3. Option C (user-typed phone): everything else. Unlinked users still
 *      get full agent service from message one; Medha answers their
 *      question, then once (and only once) appends a soft link offer as a
 *      separate threaded message. If the user ever replies with an E.164
 *      phone, we bind `slack:team:user` to the person_id derived from
 *      sha256(phone) so future Slack traffic attaches to the same graph as
 *      their iMessage history.
 *
 * Option B is fail-soft on every step (no email exposed by Slack, no
 * tenant matches, medha-id slow / down): the user sees the same Option C
 * experience they had before Option B existed. Zero regressions.
 *
 * The link state lives in medha-id behind /v1/slack-links/* and is
 * fetched / written via identity.js. envelope.js returns one of four
 * outcomes so index.js can route accordingly:
 *
 *   null                                  drop (bot loopback, edit, etc.)
 *   { args, meta: { linked: true } }      linked user, dispatch agent loop
 *   { args, meta: { linked: false,
 *                   offerLink: bool } }   unlinked user, STILL dispatch the
 *                                         agent loop. When offerLink is
 *                                         true, index.js posts the one-time
 *                                         link P.S. as a separate threaded
 *                                         message and marks-prompted.
 *   { ack, action: "complete_link", meta, personId }
 *                                         user just sent a valid E.164 as
 *                                         the entire message, link is now
 *                                         bound. Skip agent loop.
 *   { ack, action: "link_failed", meta }  link complete attempt failed
 *                                         (medha-id unreachable, etc.)
 */

import { createHash } from "crypto";
import {
  lookupLink,
  completeLink,
  isE164,
  toE164,
  wasPrompted,
  lookupTenantByEmail,
  lookupSenderByEmail,
  autoBindSlackLink,
} from "./identity.js";
import { resolveAllMentions, resolveUserEmail } from "./mentions.js";
import { getSlackProfileTimezone } from "./profile.js";

/**
 * Hard ceiling on the total time the mention pre-resolver is allowed to
 * spend on Slack API calls. If Slack hangs, we degrade gracefully back to
 * the original raw text + empty emails array so the envelope still meets
 * its own latency budget.
 */
const MENTION_RESOLVE_BUDGET_MS = 1_500;

/**
 * Hard ceiling on the Slack-profile timezone lookup. The lookup itself
 * is cached for 5 minutes per user, so the worst case is a cold first
 * request. On timeout we fall through to the resolver's documented
 * default (America/New_York) so envelope latency never depends on
 * Slack being responsive.
 */
const TIMEZONE_LOOKUP_BUDGET_MS = 500;
const TIMEZONE_FALLBACK = "America/New_York";

/**
 * Hard ceiling on the total time the Option B auto-link attempt (Slack
 * email lookup + medha-id tenant lookup + medha-id auto-bind) is allowed
 * to spend. If anything in that chain stalls, we silently fall through to
 * the Option C path so the user is never stranded waiting on a
 * background lookup.
 */
const AUTO_LINK_BUDGET_MS = 2_000;

/**
 * Race a promise against a fixed timeout. On timeout, resolve with `fallback`
 * rather than rejecting so callers can treat the slow path as "no enrichment"
 * instead of an error.
 */
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * Derive a stable synthetic `from` identifier for a Slack user. Looks
 * like `slack:T0123:U0456` for human readability in logs. Used as the
 * agent-loop `from` field when no phone link exists yet, and as the
 * session key in either case.
 */
export function deriveSlackFrom(teamId, userId) {
  return `slack:${teamId || "T?"}:${userId || "U?"}`;
}

/**
 * Fallback person_id derivation for the brief window before a link is
 * formed. Once a link exists, the person_id comes from medha-id
 * (derived from the bound phone, matching iMessage identity).
 */
export function deriveSlackPersonId(teamId, userId) {
  return createHash("sha256")
    .update(`slack:${teamId || ""}:${userId || ""}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Try the full Option B chain: Slack profile email -> medha-id tenant
 * lookup -> medha-id auto-bind. Returns `{ personId, phone, sourceEmail,
 * tenantDid }` on a successful end-to-end match, or null at the first
 * step that can't produce a result.
 *
 * Every internal call already times out at 4s on its own; this function
 * additionally races the whole chain against AUTO_LINK_BUDGET_MS so a
 * combined slow-path can't blow the envelope's latency budget. All
 * failures (no bot token, no email, no tenant match, network error,
 * timeout) collapse into a single `null` return.
 */
async function tryAutoLinkByEmail({ team, user, botToken }) {
  if (!team || !user || !botToken) return null;
  try {
    const email = await resolveUserEmail(user, botToken);
    if (!email) return null;
    const tenant = await lookupTenantByEmail(email);
    if (!tenant || !tenant.phone || !tenant.did) return null;
    const bound = await autoBindSlackLink({
      team,
      user,
      tenantDid: tenant.did,
      phone: tenant.phone,
      sourceEmail: email,
    });
    if (!bound || !bound.personId) return null;
    return {
      personId: bound.personId,
      phone: bound.phone || tenant.phone,
      sourceEmail: email,
      tenantDid: tenant.did,
      displayName: tenant.displayName || null,
      matchedVia: tenant.matchedVia || null,
      matchedKey: tenant.matchedKey || null,
    };
  } catch (err) {
    console.warn(`[slack] tryAutoLinkByEmail threw: ${err.message}`);
    return null;
  }
}

/**
 * Strip the leading bot mention (`<@U0BOT>`) from the inbound text.
 * Mid-message mentions are left intact so any future @-aware logic can
 * still see them.
 */
function stripLeadingBotMention(text, botUserId) {
  if (!text || !botUserId) return text || "";
  const re = new RegExp(`^\\s*<@${botUserId}>\\s*`);
  return text.replace(re, "").trim();
}

/**
 * Convert a Slack event payload into the Loop-shaped envelope tuple
 * that agent.js's enqueueMessage expects, plus a `meta` block carrying
 * Slack routing info (channel, thread_ts) for the responder. May also
 * return an `ack`-only result for the identity-link flow when the
 * sender is not yet bound to a phone (see file header).
 *
 * Returns null if the event is not actionable (not a message/app_mention,
 * bot message, empty text after stripping the mention, etc.). Callers
 * should treat null as "ack and do nothing".
 *
 * @param {Object} slackEvent — the full Slack outer payload
 *   (so we can read event_id at the top level)
 * @param {Object} opts
 * @param {string} opts.botUserId — process.env.SLACK_BOT_USER_ID, used to
 *   strip self-mentions and to skip events emitted by our own bot
 * @param {string} opts.senderUuid — process.env.MEDHA_EXPERT_SENDER_ID,
 *   threaded in as the synthetic `loopSenderId` so resolveTenant returns
 *   the Medha-expert tenant
 */
export async function slackEventToInternal(slackEvent, opts = {}) {
  const { botUserId, senderUuid } = opts;
  const event = slackEvent?.event;
  if (!event || typeof event !== "object") return null;

  // We only handle DMs (`message` with channel_type === "im") and
  // @mentions (`app_mention`). Everything else (channel joins, edits,
  // reactions, file shares without text) is ignored for the MVP.
  const type = event.type;
  if (type !== "app_mention" && type !== "message") return null;

  // Bot messages loop back to us as `message` events with bot_id set.
  // Skip them so Medha doesn't reply to herself.
  if (event.bot_id) return null;
  if (event.subtype) return null; // message_changed, message_deleted, channel_join, etc.
  if (botUserId && event.user === botUserId) return null;

  // For plain `message` events, only act on DMs (channel_type === "im").
  // Channel posts without an @mention are not Medha's concern.
  if (type === "message" && event.channel_type !== "im") return null;

  const slackUserId = event.user || null;
  const channel = event.channel || null;
  const teamId = slackEvent?.team_id || event.team || null;
  // Threading signals (Tab 29). `realThreadTs` is set ONLY when Slack tells
  // us the inbound was already inside a thread; `messageTs` is the inbound
  // message's own ts (the anchor used to OPEN a thread for a long top-level
  // channel reply). `channelType` distinguishes DMs ("im") from channels.
  // app_mention events carry no channel_type, so they fall through as a
  // channel. The reply-time decision lives in threading.js — see
  // decideSlackThreadTs.
  const realThreadTs = event.thread_ts || null;
  const messageTs = event.ts || null;
  const channelType = event.channel_type || null;
  const inThread = Boolean(realThreadTs);
  // Legacy field kept for the link-ceremony / soft-offer system replies,
  // which post directly via sendSlackReply (index.js) rather than through
  // the agent loop. Reply into the existing thread when there is one,
  // otherwise anchor off the inbound ts. The agent-reply path no longer
  // reads this — it routes through decideSlackThreadTs instead.
  const threadTs = realThreadTs || messageTs || null;
  const rawText = String(event.text || "");
  const strippedText = stripLeadingBotMention(rawText, botUserId);

  // Slack file shares come through as event.files[] (Slack also fires bare
  // file_share message subtypes which are filtered above; the normal case is
  // a regular message event with a non-empty files array). We only need a
  // few fields per file: id (for logging), name (for the prompt marker), the
  // url_private (which requires Bearer auth via SLACK_BOT_TOKEN), and the
  // mimetype/filetype so index.js knows the right extension when hosting.
  const slackFiles =
    Array.isArray(event.files) && event.files.length > 0
      ? event.files
          .map((f) => ({
            id: f?.id || null,
            name: f?.name || null,
            mimetype: f?.mimetype || null,
            filetype: f?.filetype || null,
            url_private: f?.url_private || null,
            url_private_download: f?.url_private_download || null,
            size: typeof f?.size === "number" ? f.size : null,
          }))
          .filter((f) => f.url_private)
      : [];

  // A file-only Slack message (e.g. drop a PDF into a DM with no caption)
  // still routes — without this, the !strippedText guard below dropped it
  // before the OCR pipeline ever saw the upload. When there is no caption,
  // synthesize the same placeholder Loop uses so handleWebhookMessage's
  // attachment block treats the OCR text as the entire turn.
  if (!strippedText && slackFiles.length === 0) return null;
  if (!slackUserId || !channel) return null;
  const effectiveText = strippedText || "[attachment-only message]";

  // Pre-resolve <@U…>, <!subteam^S…>, and <#C…|name> tokens to email
  // addresses / channel names so the agent loop sees usable identifiers
  // inline. Slack API calls are bounded by MENTION_RESOLVE_BUDGET_MS; on
  // timeout we fall through with the original text and empty arrays so
  // the envelope stays within its own latency budget.
  const botToken = process.env.SLACK_BOT_TOKEN;
  const fallbackMentionResult = {
    resolvedText: effectiveText,
    emails: [],
    unresolved: [],
  };
  // Only run the mention resolver when there is real user text — for a pure
  // file-only message effectiveText is the synthetic "[attachment-only]"
  // placeholder and there is nothing to resolve.
  const mentionResult =
    botToken && strippedText
      ? await withTimeout(
          resolveAllMentions(strippedText, botToken),
          MENTION_RESOLVE_BUDGET_MS,
          fallbackMentionResult,
        )
      : fallbackMentionResult;
  const cleanedText = mentionResult.resolvedText || effectiveText;
  const mentionedEmails = Array.isArray(mentionResult.emails)
    ? mentionResult.emails
    : [];
  const unresolvedMentions = Array.isArray(mentionResult.unresolved)
    ? mentionResult.unresolved
    : [];

  const from = deriveSlackFrom(teamId, slackUserId);
  // Loop's message_id has no natural Slack analogue. Reuse the Slack
  // event_id (stable, unique per delivery) so downstream dedup and any
  // logging stay coherent.
  const messageId =
    slackEvent?.event_id || event.client_msg_id || event.ts || null;

  // We deliberately set groupId to null. Channel @mentions could be
  // modeled as groups, but Medha's group-routing code is Loop-specific
  // (opt-in handshakes, dm_each_in_group, etc.) and not safe to wire
  // against Slack channels without more design work. Treat every Slack
  // surface as a 1:1 conversation for now.
  const groupId = null;
  const groupName = null;
  const participants = [];
  const replyToId = null;

  const baseMeta = {
    transport: "slack",
    channel,
    thread_ts: threadTs,
    // Tab 29 threading signals, carried through to the session so the
    // outbound transport can run the length-aware reply-placement decision.
    slackRealThreadTs: realThreadTs,
    slackMessageTs: messageTs,
    slackChannelType: channelType,
    slackInThread: inThread,
    slackUserId,
    team: teamId,
    botUserId: botUserId || null,
    eventId: slackEvent?.event_id || null,
    eventType: type,
    mentionedEmails,
    unresolvedMentions,
    // event.files[] when the inbound message included one or more uploads.
    // index.js downloads each (Bearer SLACK_BOT_TOKEN), stores via
    // image-host, and passes the resulting public URLs to the agent loop as
    // the 9th positional arg (attachments) — same path Loop attachments use.
    slackFiles,
  };

  // ── Slack-profile timezone enrichment ────────────────────────────
  // Pull the user's IANA timezone off their Slack profile so the
  // date-resolver and any tz-aware tool can anchor day-of-week math
  // against it. The lookup itself is cached for 5 minutes per user, so
  // amortized cost is ~0; bound the cold path with a 500ms race so a
  // slow Slack response never blocks envelope construction. Every
  // failure mode (no token, network error, missing scope) silently
  // collapses to the documented America/New_York fallback.
  try {
    baseMeta.timezone = await withTimeout(
      getSlackProfileTimezone(slackUserId, botToken),
      TIMEZONE_LOOKUP_BUDGET_MS,
      TIMEZONE_FALLBACK,
    );
  } catch (err) {
    console.warn(
      `[slack] timezone lookup threw, defaulting to ${TIMEZONE_FALLBACK}: ${err.message}`,
    );
    baseMeta.timezone = TIMEZONE_FALLBACK;
  }

  // ── Identity resolution ───────────────────────────────────────────
  // Try three paths, in order:
  //   1. Option A — existing link in medha-id (cheap Firestore read).
  //   2. Option B — auto-link via Slack profile email matching a Privy
  //      tenant. Bounded to AUTO_LINK_BUDGET_MS so a slow chain can't
  //      hold up the envelope; on timeout / any failure we fall through.
  //   3. Option C — the original "send me your phone" ceremony.
  const existing = await lookupLink({ team: teamId, user: slackUserId });
  if (existing) {
    const loopSenderId = senderUuid || null;
    return {
      args: [
        from,
        cleanedText,
        messageId,
        groupId,
        groupName,
        participants,
        replyToId,
        loopSenderId,
      ],
      meta: {
        ...baseMeta,
        personId: existing.personId,
        phone: existing.phone || null,
        linked: true,
      },
    };
  }

  // ── Option B (auto-link by email) ────────────────────────────────
  // First-time unlinked user. Before falling into Option C, try to match
  // them to an existing Privy tenant via their Slack profile email. If
  // we hit a match, the user goes straight into the linked-user path on
  // their very first message — no ceremony, no soft P.S. Everything
  // here is wrapped in a try/catch + timeout race so any single slow or
  // failing step silently degrades to Option C.
  try {
    const botToken = process.env.SLACK_BOT_TOKEN;
    if (botToken) {
      const autoLink = await Promise.race([
        tryAutoLinkByEmail({
          team: teamId,
          user: slackUserId,
          botToken,
        }),
        new Promise((resolve) =>
          setTimeout(() => resolve(null), AUTO_LINK_BUDGET_MS),
        ),
      ]);
      if (autoLink) {
        const matchedViaLog = autoLink.matchedVia
          ? ` matchedVia=${autoLink.matchedVia}`
          : "";
        const matchedKeyLog = autoLink.matchedKey
          ? ` matchedKey=${autoLink.matchedKey}`
          : "";
        console.log(
          `[slack] auto-linked via email team=${teamId} user=${slackUserId} email=${autoLink.sourceEmail} tenantDid=${autoLink.tenantDid}${matchedViaLog}${matchedKeyLog}`,
        );
        const loopSenderId = senderUuid || null;
        return {
          args: [
            from,
            cleanedText,
            messageId,
            groupId,
            groupName,
            participants,
            replyToId,
            loopSenderId,
          ],
          meta: {
            ...baseMeta,
            personId: autoLink.personId,
            phone: autoLink.phone || null,
            linked: true,
            autoLinked: true,
            sourceEmail: autoLink.sourceEmail,
            matchedVia: autoLink.matchedVia || null,
            matchedKey: autoLink.matchedKey || null,
            // T19: thread the sender's display name through so the agent
            // can address them by name instead of the channel owner's
            // displayName. For the auto-linked tenant case the name
            // comes from the matched tenant's owner profile.
            senderKind: "tenant_owner",
            senderDid: autoLink.tenantDid,
            senderDisplayName: autoLink.displayName || null,
          },
        };
      }
    }
  } catch (err) {
    // Defensive: tryAutoLinkByEmail already swallows its own errors, but
    // belt-and-suspenders so a future regression on the inner side never
    // crashes the envelope.
    console.warn(`[slack] Option B auto-link attempt threw: ${err.message}`);
  }

  // ── Option B-contact (T19) ────────────────────────────────────────
  // Unlinked sender whose Slack profile email maps to a CONTACT in some
  // tenant's address book (not a tenant themselves). We can't auto-bind
  // — contacts don't carry their own DIDs / phones — but we CAN attach
  // their human name to the envelope so the agent addresses them
  // correctly instead of inheriting the channel owner's identity.
  //
  // Sagar's canonical example: caleb@bluemodernadvisory.com is in his
  // contact book but isn't a Privy tenant. When Caleb DMs Sagar's
  // shared Medha, the agent should say "hey Caleb" not "hey Sagar".
  //
  // Bounded to AUTO_LINK_BUDGET_MS — same budget as Option B — so a slow
  // medha-id can never blow the envelope's latency budget. The Slack
  // profile email lookup is reused (resolveUserEmail caches), so the
  // only new wire-time is one medha-id call which is itself cached for
  // 1h per email inside identity.js.
  let contactSender = null;
  try {
    const botTokenForContact = process.env.SLACK_BOT_TOKEN;
    if (botTokenForContact) {
      contactSender = await withTimeout(
        (async () => {
          const email = await resolveUserEmail(slackUserId, botTokenForContact);
          if (!email) return null;
          const hit = await lookupSenderByEmail(email);
          if (!hit || hit.kind !== "contact") return null;
          return { email, hit };
        })(),
        AUTO_LINK_BUDGET_MS,
        null,
      );
    }
  } catch (err) {
    console.warn(`[slack] Option B-contact lookup threw: ${err.message}`);
  }

  // Unlinked + the inbound text is JUST an E.164 phone (no other content) —
  // treat the whole message as the link opt-in. Bind now, ack with a
  // "Linked." confirmation, do NOT dispatch the phone digits to the agent
  // loop (it's a credential, not a question).
  if (isE164(cleanedText)) {
    const phoneE164 = toE164(cleanedText);
    const completion = await completeLink({
      team: teamId,
      user: slackUserId,
      phoneE164,
    });
    if (completion?.personId) {
      return {
        ack: true,
        action: "complete_link",
        personId: completion.personId,
        meta: {
          ...baseMeta,
          personId: completion.personId,
          phone: phoneE164,
          linked: true,
        },
      };
    }
    return {
      ack: true,
      action: "link_failed",
      meta: { ...baseMeta, attemptedPhone: phoneE164 },
    };
  }

  // Unlinked + a real question — STILL dispatch to the agent loop so the
  // user gets an actual answer. Decide whether index.js should also post
  // the one-time link P.S. as a follow-up thread reply. Fail-closed: if
  // wasPrompted errors, it returns true so we don't double-prompt during
  // an outage.
  const alreadyPrompted = await wasPrompted({
    team: teamId,
    user: slackUserId,
  });
  const loopSenderId = senderUuid || null;
  // If Option B-contact found a match, attach identity so the agent can
  // address the inbound sender by name even though they are unlinked.
  // Suppress the soft link offer in this case — we already know who they
  // are and pushing them to "send your phone in international format"
  // would be jarring.
  const contactMeta = contactSender
    ? {
        senderKind: "contact",
        senderDid: contactSender.hit.did,
        senderContactId: contactSender.hit.contactId || null,
        senderDisplayName: contactSender.hit.displayName || null,
        sourceEmail: contactSender.email,
      }
    : null;
  if (contactSender) {
    console.log(
      `[slack] identified unlinked sender as contact name=${contactSender.hit.displayName} ownerDid=${contactSender.hit.did} email=${contactSender.email}`,
    );
  }
  return {
    args: [
      from,
      cleanedText,
      messageId,
      groupId,
      groupName,
      participants,
      replyToId,
      loopSenderId,
    ],
    meta: {
      ...baseMeta,
      personId: deriveSlackPersonId(teamId, slackUserId),
      linked: false,
      offerLink: contactSender ? false : !alreadyPrompted,
      ...(contactMeta || {}),
    },
  };
}
