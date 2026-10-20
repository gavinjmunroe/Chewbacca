/**
 * @togari/agents/replybot — Per-client replybot configuration
 *
 * Registry of clients served by the reply-approval bot: the Slack channel
 * drafts are posted to, the sender identity approved replies go out as,
 * the drafting voice, and the env var holding the HMAC secret for that
 * client's inbound reply webhook.
 *
 * BMA's entry began as the values that were hardcoded across
 * smartlead-responder before this registry existed. Its drafting voice is
 * still that original prompt verbatim, but its transport has since moved
 * to Clay (static-key auth) and BMA now runs two personas — `amber`
 * (Sagar, whose cold outbound goes out under the Amber brand) and `bma`
 * (Maggie) — one entry each.
 */

import type { ReplyCopy } from "../smartlead-responder/reply-intent";

export type SendMethod = "gmail" | "smartlead" | "clay";

/**
 * How the client's inbound webhook authenticates:
 *  - 'smartlead-hmac': X-Smartlead-Signature HMAC-SHA256 over the raw body
 *    (Smartlead's native webhook signing).
 *  - 'static-key': constant secret in the X-Replybot-Key header, for callers
 *    that can set headers but can't compute an HMAC (e.g. a Clay HTTP API
 *    enrichment column).
 */
export type WebhookAuthMode = "smartlead-hmac" | "static-key";

export interface ReplybotVoice {
  /**
   * System-prompt body handed to Claude: persona + drafting rules.
   * The JSON output contract is appended by the classifier — do not
   * repeat it here.
   */
  systemPrompt: string;
  /**
   * System prompt for first-touch outreach drafts — payloads with no
   * inbound reply to respond to (website form fills, LinkedIn post
   * interactions). Clients without this set do not support those
   * payloads on their webhook.
   */
  outreachSystemPrompt?: string;
  /**
   * Sign-off name, on its own line at the end of every draft. Also used
   * to locate the sign-off when attachment links are injected into a
   * draft, so it must match what systemPrompt instructs.
   */
  signoffName: string;
  /** IANA timezone used for date context in prompts. */
  timezone: string;
  /**
   * Demo/booking calendar link. When set, it is injected verbatim just
   * before the sign-off on first-touch outreach drafts (the outreach
   * prompt writes a lead-in sentence; the URL itself is never left to the
   * model — same discipline as attachment links in classifyAndDraft).
   */
  demoCalendarUrl?: string;
  /**
   * Strip em and en dashes from finished drafts. The prompt asks for this
   * too, but models slip, and Maggie's objection (2026-09-02) is that a
   * single em dash makes the whole email read as AI-written. Prompt plus
   * deterministic pass, same belt-and-braces as URL injection.
   */
  banEmDashes?: boolean;
}

/**
 * Payload kinds that can be routed to their own Slack channel. Anything
 * not listed in channelOverrides falls back to slackChannelId.
 */
export type ReplybotChannelRoute =
  | "reply"
  | "form_fill"
  | "linkedin_interaction"
  /** The daily warm-intro path digest (src/connections/digest.ts). */
  | "connections";

export interface ReplybotClientConfig {
  clientId: string;
  displayName: string;
  /** Default channel for drafts + approval buttons. Bot must be a member. */
  slackChannelId: string;
  /**
   * Team id of the client's own Slack workspace, for a client that installed
   * Togari there (docs/SLACK_EXTERNAL_WORKSPACE.md). Its cards are posted,
   * updated and threaded with that install's bot token. Unset means Togari's
   * home workspace and SLACK_BOT_TOKEN, as for every client before this.
   *
   * Every channel id and approver id in this entry has to belong to that
   * workspace. A test client derived by spread that posts somewhere else
   * (#test-channel is in the home workspace) must set this back to undefined.
   */
  slackTeamId?: string;
  /**
   * Per-payload-kind channel overrides, for clients who triage different
   * lead sources in different channels (Serif: replies and form fills).
   * The bot must be a member of every channel named here.
   */
  channelOverrides?: Partial<Record<ReplybotChannelRoute, string>>;
  /**
   * Which Perplexity account this client's reply drafting runs on, so the
   * spend sits with them rather than with us. Defaults to the client id when
   * unset, and PERPLEXITY_ACCOUNT_<CLIENT_ID> overrides both — that override is
   * how a client runs on our account before step 14 hands it back to theirs.
   */
  perplexityAccount?: string;
  /**
   * Env var holding this client's published categories/voice guide (step 09) —
   * the document the AI reads before classifying. A NAME, not the URL, matching
   * webhookSecretEnv and clayReplyWebhookUrlEnv: a derived test client inherits
   * the pointer by spread and reads the same guide with no second variable.
   */
  replyGuideUrlEnv?: string;
  /**
   * Warm-intro connection research (POST /connections). A client without this
   * is refused there, so research only ever runs for a client set up for it.
   *
   * Env var NAMES, not values, like replyGuideUrlEnv, so a derived test client
   * inherits all three by spread. Research runs on perplexityAccount, in the
   * same project as reply drafting, so the Togari credential already in that
   * project's vault covers its callback too.
   */
  connections?: {
    /** Published Google Doc the AI reads first: the method and the rules. */
    guideUrlEnv: string;
    /** Published CSV of the target accounts every employer is checked against. */
    targetsUrlEnv: string;
    /** Clay webhook-source table each connection found is POSTed into. */
    clayUrlEnv: string;
    /**
     * Who counts as a senior colleague of the customer contact: the people
     * whose past employers are searched alongside theirs. Each entry is one
     * phrase of the task message ("CFO", "VP / Director of Revenue Cycle").
     *
     * In the message as well as the guide, because a guide that loads only in
     * part must not change who is researched. Reuse of the shared network
     * (src/network/reuse.ts) compares these between clients: colleagues found
     * for a client with a different list are topped up, not assumed complete.
     */
    colleagueRoles: string[];
    /** Who sits in the buyer seat at a target account: where a path ends. */
    buyerRoles: string[];
  };
  /**
   * Env var holding the Clay webhook that sends FIRST-TOUCH outreach (website
   * form fills), as opposed to clayReplyWebhookUrlEnv which answers an existing
   * campaign thread.
   *
   * They cannot be the same destination: Clay's "reply to lead in a campaign"
   * action is keyed on lead id + campaign id, and a form fill has neither —
   * nobody emailed them first. It needs its own Clay table and its own send
   * action.
   *
   * While this is unset, outreach keeps going out over Gmail as before, so
   * setting it is the switch and nothing breaks before the Clay side exists.
   */
  clayOutreachWebhookUrlEnv?: string;
  /**
   * Identity approved replies are sent as. linkedinUrl is the sender's own
   * profile — LinkedIn-interaction payloads matching it are skipped so the
   * sender never gets outreach drafted to themselves.
   */
  sender: { name: string; email: string; linkedinUrl?: string };
  /**
   * How approved replies go out. First entry is the default, used by any
   * card that does not stamp its own route — see buttonPayload, where
   * campaign replies for a Clay client stamp sendVia:'clay' because only
   * they have a lead and campaign to reply into.
   */
  sendMethods: SendMethod[];
  /**
   * Env var holding the secret for this client's inbound webhook
   * (/replybot/:clientId/webhook). Omit it for a client whose replies arrive
   * only on POST /replies, the Perplexity reply loop: the route then refuses
   * everything for that client, in every environment, with no secret to set.
   *
   * When it is named, it must be set in production: unset, the webhook
   * answers 503 there (and skips auth outside production).
   */
  webhookSecretEnv?: string;
  /** How the inbound webhook authenticates. Defaults to 'smartlead-hmac'. */
  webhookAuth?: WebhookAuthMode;
  /**
   * Env var holding the Clay webhook URL that approved replies are POSTed
   * back to, for clients whose sendMethods include 'clay'.
   *
   * Clay's "reply to lead in a campaign" action sends from the campaign's
   * own sending mailbox, which is the whole point: the reply goes back out
   * of the same Smartsenders inbox the prospect wrote to, under the same
   * persona, threaded natively. We never touch the mailbox and no
   * domain-wide delegation is needed.
   *
   * That action is keyed on lead id + campaign id, so both must survive
   * from the inbound payload through the Slack card to the click — see
   * buttonPayload. A card missing either cannot be sent this way.
   *
   * The URL is itself the secret (Clay webhook URLs carry a UUID), so it
   * lives in the environment and never in this file.
   */
  clayReplyWebhookUrlEnv?: string;
  /**
   * Slack user IDs allowed to send/draft for this client. Undefined =
   * anyone who can click the button (BMA's internal-channel behavior).
   * User ids differ per workspace: with slackTeamId set, these are ids in
   * the client's workspace.
   */
  approvers?: string[];
  /**
   * The client's Clay reply feeder appends a stray "e" to every lead name
   * (25 of 25 Zeutara rows, 10/6 to 10/9). Strip it at intake; remove this
   * flag the day the feeder's name column is fixed.
   */
  leadNameTrailingE?: boolean;
  /**
   * Client has been offboarded from the replybot.
   *
   * Retired clients stay in the registry rather than being deleted, and
   * that is deliberate: resolveReplybotClient falls back to the DEFAULT
   * client for ids it doesn't know, so deleting an entry would silently
   * re-point every existing Slack card in that client's channels at
   * BMA — a click would send from Sagar's mailbox to their leads. The
   * tombstone keeps the id resolving to its own config so the webhook
   * can answer 410 and button clicks get a clean refusal.
   *
   * Safe to delete the entry outright only once every card carrying
   * this clientId is gone from Slack.
   */
  retired?: boolean;
  /**
   * Fixed copy for LinkedIn post-interaction outreach. When set, the
   * engine fills {firstName} and posts the card directly — no Claude
   * call, so the copy is identical for every lead (HHH-style
   * Claude-personalized drafts remain the default when unset).
   */
  linkedinInteractionTemplate?: { subject: string; body: string };
  /**
   * When true, manual-review cards (not_interested / other) show the
   * drafted reply with the standard Send / Edit / Draft buttons instead
   * of BMA's "Open in Smartlead" deep link — for clients whose replies
   * arrive via Clay, where Smartlead inbox links don't exist. Cards
   * with no draft (category shortcut, classifier error) keep the link.
   */
  approvalButtonsOnManualReview?: boolean;
  /**
   * Reply cards open with Good fit / Not a fit instead of Send. Good fit
   * unlocks the usual send row, Not a fit closes the card with nothing sent.
   * Pair it with approvers so only the person who judges fit can press them
   * (see smartlead-responder/fit-review.ts).
   */
  fitReview?: boolean;
  /**
   * The client's campaigns as the live page reads them (Chewbacca's apps/live,
   * through GET /api/v1/portal/live). The Clay workspace their campaigns live
   * in, and the name prefix that marks a campaign as theirs, so the stats sync
   * never counts another client's sends. Unset means no live page.
   */
  live?: { clayWorkspaceId: string; campaignPrefix: string };
  /**
   * What Togari reads from the client's Clay workspace itself, with the
   * signed-in session saved for this client (src/integrations/clay/campaign-read.ts).
   * Each job is its own switch, so a client can have its inbox read without
   * a live page or the bounce guard. Auto-send is never one of these: that
   * stays with autopilot. campaignPrefix is for a workspace shared with
   * other clients; a client with its own workspace leaves it out.
   */
  clay?: {
    workspaceId: string;
    campaignPrefix?: string;
    /** Hand every new inbox reply to /replies, as the feeder column does. */
    pollReplies?: boolean;
    /**
     * Replies before this ISO time are never handed over: switching the
     * poller on for a client must not post months of old replies as cards.
     */
    pollSince?: string;
    /**
     * Where polled replies go. "replies" (the default) is POST /replies, the
     * Perplexity reply loop Serif and Zeutara use. "replybot" is the client's
     * own /replybot/<id>/webhook, where Claude drafts in the client's voice,
     * the route BMA's Clay column fed.
     */
    intake?: "replies" | "replybot";
    /** Who gets the daily DM of replies nobody answered (a Slack user id). */
    outcomeAlertUser?: string;
    /** Write sends, replies and bounces into campaign_events for the calendar. */
    syncCalendar?: boolean;
    /** The daily DM of replies still waiting on an answer. */
    outcomeCheck?: boolean;
    /** Pause a campaign in Clay once its bounces pass 3%. Writes to Clay. */
    bounceGuard?: boolean;
    /** Warn #test-channel before the saved Clay session lapses. */
    sessionAlert?: boolean;
  };
  /**
   * The campaign calendar at /dash/<token>/calendar: a month of campaigns with
   * weekly sends, reply rates and outcomes underneath, fed by an HTTP column on
   * each campaign's Clay Events table (docs/CAMPAIGN_CALENDAR_NEW_CLIENT.md).
   * Unset means /campaign-events refuses the client's rows and there is no
   * calendar. campaignPrefix is for a client sharing a Clay workspace: events
   * from campaigns not named with it are dropped on arrival. A client with
   * its own workspace leaves it out. theme names the client's look in
   * src/campaigns/themes.ts; unset is the neutral default. heyreach adds
   * the client's LinkedIn campaigns, read from their HeyReach account with
   * the API key in the named env var (src/campaigns/linkedin.ts).
   */
  campaignCalendar?: {
    campaignPrefix?: string;
    theme?: string;
    heyreach?: { apiKeyEnv: string };
  };
  /**
   * Fit-review replies the bot may send with nobody pressing anything, when
   * the upstream verdict is at least this confident and every check in
   * smartlead-responder/auto-send.ts passes. Unset means every reply waits.
   */
  autoSend?: { minConfidence: number };
  /**
   * Server-side reply autopilot (src/replies/autopilot.ts): forwards, blocklists,
   * schedules out-of-office follow-ups and mails copies, through Clay workflows
   * whose webhook URLs live in these env vars.
   */
  autopilot?: {
    forwardHookEnv: string;
    blocklistHookEnv: string;
    /** A redirect address containing this is ours, and is never mailed. */
    ownDomainHint?: string;
    /** Replies for these companies are also mailed to the client. */
    copy?: { companies: string[]; to: string; from: string; fromName: string };
  };
  /**
   * Facts the reply rules name in a card's next step (reply-intent.ts): who
   * the outreach goes out as, and what the offer is not. Unset means the next
   * steps name no one.
   */
  replyCopy?: ReplyCopy;
  /**
   * The principal's Slack user id in slackChannelId's workspace, tagged when
   * Togari can't answer an investor without something only the principal
   * has (src/replies/repair.ts). Unset posts the principal's name untagged.
   */
  principalSlackUserId?: string;
  /**
   * What Togari knows about the client before it looks anything up, put at
   * the top of the client assistant's prompt (client-assistant/index.ts).
   */
  brief?: string;
  voice: ReplybotVoice;
}

// ── BMA voice ────────────────────────────────────────────────────
// Originally lifted from smartlead-responder/classifier.ts
// BASE_SYSTEM_PROMPT (persona + rules; the JSON output contract stayed in
// the classifier). Guarded by tests/smoke/smartlead.test.ts.
//
// Rewritten 2026-09-02 after the first live cards in #amber-cold-replies
// came out inverted: Claude complimented the prospect's subject line and
// wrote as though HE had pitched Sagar, when Sagar had cold-emailed him.
// Two causes, both fixed. The prompt never stated who contacted whom, and
// the payload's HTML carried our own quoted outbound, which the model read
// as the prospect's words (see reply-text.ts). Hence the DIRECTION block,
// which both persona prompts share verbatim. Em dashes are banned here and
// stripped deterministically after drafting: Maggie's call, they read as
// AI-written. The prompt text itself avoids them so the model has nothing
// to mirror.

const BMA_VOICE_PROMPT = `You are drafting an email reply on behalf of Sagar Tiwari at Blue Modern Advisory. Sagar is warm, direct, and writes like a person, not like AI. Read like a text from a colleague, not a template. Contractions are fine and encouraged (I'm, we're, they've).

DIRECTION OF THE CONVERSATION, and this is the part that matters most: WE sent this person a cold outbound email. They did not contact us, they did not pitch us, and they did not do us a favor by writing back. What you are given is their REPLY to our cold email, and you are writing OUR follow-up to it. Never write as though they approached us. Never compliment their email, their subject line, or their outreach, because there was none. Any subject line you see is ours, from our own cold email. We are the ones who want the next step, so ask for it plainly.

Rules:
- 3-8 sentences. Never longer.
- Match the lead's tone. If they're casual, be casual. If formal, stay professional.
- If they asked a question, answer it specifically.
- If they already said yes or handed you a next step (a time, a phone number, someone else to talk to), just confirm it and stop selling.
- If they're interested but vague, propose one concrete next step (a specific time to talk, a specific resource).
- If they're not interested, thank them briefly and leave the door open without pushing.
- Never repeat our original outbound's language verbatim.
- Never invent details about their company, their role, or what we sent them. If our original email was not given to you, do not guess at what it said and do not reference it.
- Do NOT include any URLs in draftBody. URLs will be appended programmatically after your response.
- No em dashes and no en dashes anywhere in the draft. Use a comma, a period, or a plain hyphen instead. Em dashes read as AI-written.
- Sign off as 'Sagar' on its own line. No 'Best,' no 'Thanks,' no 'Cheers.' Just 'Sagar'.
- Never use: 'strong fit,' 'great fit,' 'synergy,' 'leverage,' 'circle back,' 'touch base,' 'I hope this email finds you well,' 'reach out,' 'reaching out,' 'just wanted to,' 'quick question.'

When the campaign involves placements/profiles, end draftBody with a natural transition sentence for the profiles BEFORE the 'Sagar' sign-off. Example endings: 'Happy to share a few recent placements for context:' / 'A quick snapshot of who we work with:' / 'Here are a few folks we've placed recently:'. The profile URLs will be injected after this sentence automatically.`;

// ── BMA · Maggie voice ───────────────────────────────────────────
// Second BMA persona. Same house rules as Sagar's prompt above, including
// the DIRECTION block; the only intended differences are the name and the
// sign-off, so the two personas read as one company.

const BMA_MAGGIE_VOICE_PROMPT = `You are drafting an email reply on behalf of Maggie Chen at Blue Modern Advisory. Maggie is warm, direct, and writes like a person, not like AI. Read like a text from a colleague, not a template. Contractions are fine and encouraged (I'm, we're, they've).

DIRECTION OF THE CONVERSATION, and this is the part that matters most: WE sent this person a cold outbound email. They did not contact us, they did not pitch us, and they did not do us a favor by writing back. What you are given is their REPLY to our cold email, and you are writing OUR follow-up to it. Never write as though they approached us. Never compliment their email, their subject line, or their outreach, because there was none. Any subject line you see is ours, from our own cold email. We are the ones who want the next step, so ask for it plainly.

Rules:
- 3-8 sentences. Never longer.
- Match the lead's tone. If they're casual, be casual. If formal, stay professional.
- If they asked a question, answer it specifically.
- If they already said yes or handed you a next step (a time, a phone number, someone else to talk to), just confirm it and stop selling.
- If they're interested but vague, propose one concrete next step (a specific time to talk, a specific resource).
- If they're not interested, thank them briefly and leave the door open without pushing.
- Never repeat our original outbound's language verbatim.
- Never invent details about their company, their role, or what we sent them. If our original email was not given to you, do not guess at what it said and do not reference it.
- Do NOT include any URLs in draftBody. URLs will be appended programmatically after your response.
- No em dashes and no en dashes anywhere in the draft. Use a comma, a period, or a plain hyphen instead. Em dashes read as AI-written.
- Sign off as 'Maggie' on its own line. No 'Best,' no 'Thanks,' no 'Cheers.' Just 'Maggie'.
- Never use: 'strong fit,' 'great fit,' 'synergy,' 'leverage,' 'circle back,' 'touch base,' 'I hope this email finds you well,' 'reach out,' 'reaching out,' 'just wanted to,' 'quick question.'

When the campaign involves placements/profiles, end draftBody with a natural transition sentence for the profiles BEFORE the 'Maggie' sign-off. Example endings: 'Happy to share a few recent placements for context:' / 'A quick snapshot of who we work with:' / 'Here are a few folks we've placed recently:'. The profile URLs will be injected after this sentence automatically.`;

// ── Serif Health voice ───────────────────────────────────────────
// Starter voice for Phase 2 testing — Phase 3 tunes this against real
// Serif reply examples and their do/don't rules before anything sends.

const SERIF_VOICE_PROMPT = `You are drafting an email reply on behalf of Arham at Serif Health. Arham is warm, direct, and writes like a person — not like AI. Read like a note from a colleague, not a template. Contractions are fine and encouraged (I'm, we're, they've).

You will be given the original outbound we sent, the inbound reply from the lead, and context about the campaign. Your job is to draft a reply that directly addresses what the lead said, references the original outbound naturally, and moves the conversation forward.

Rules:
- 3-8 sentences. Never longer.
- Match the lead's tone. If they're casual, be casual. If formal, stay professional.
- If they asked a question, answer it specifically.
- If they're interested, propose a concrete next step (a time to talk, a specific resource).
- If they're not interested, thank them briefly and leave the door open without pushing.
- Never repeat the original outbound's language verbatim.
- Do NOT include any URLs in draftBody. URLs will be appended programmatically after your response.
- Sign off as 'Arham' on its own line. No 'Best,' no 'Thanks,' no 'Cheers.' Just 'Arham'.
- Never use: 'strong fit,' 'great fit,' 'synergy,' 'leverage,' 'circle back,' 'touch base,' 'I hope this email finds you well,' 'reach out,' 'reaching out,' 'just wanted to,' 'quick question.'`;

const SERIF_OUTREACH_PROMPT = `You're Arham on the Serif Health team, writing the first email to someone who just signed up on serifhealth.com. Write like a real person firing off a genuine note — not a marketing sequence, not a template, no filler. Short, specific, human. Contractions always (I'm, we're, you've).

Serif Health gives health systems, payers, and digital health companies the payer rate data behind price transparency — the negotiated and cash rates they use to benchmark their contracts, find where they're underpaid, and size up new markets. Someone who signs up almost always wants to see what rate data actually exists for their market, their region, or their competitors.

You'll be given whatever we know about the person and their company from the sign-up and enrichment. Use it to make the note feel written FOR them, not blasted at a list:
- Lead with one specific, plausible reason a place like theirs cares about rate data — a health system benchmarking its payer contracts, a digital health company sizing a market, a payer checking its position. Anchor it to their actual company or industry. Never invent facts beyond what you're given; if you know little about them, stay honest and brief rather than reaching for something generic.
- Make exactly one concrete offer: a quick demo where we pull real rates for their market live so they can see the data against their own questions.
- Then, right before your sign-off, write a natural lead-in sentence pointing them to the demo calendar to grab a time. Call it "our demo calendar" so it's clear what it's for. Example lead-ins: 'If you want to see it against your own market, grab a slot on our demo calendar:' / 'Happy to walk you through it live — you can pick a time on our demo calendar:'

Rules:
- 3-6 sentences total. Never longer. No 'Thanks for signing up!' opener and no throat-clearing.
- Curious and useful, never salesy. No hype adjectives.
- Do NOT write any URL yourself. The demo calendar link is added automatically right after your lead-in sentence — just write the sentence that introduces it.
- Sign off as 'Arham' on its own line. No 'Best,' no 'Thanks,' no 'Cheers.' Just 'Arham'.
- Never use: 'strong fit,' 'great fit,' 'synergy,' 'leverage,' 'circle back,' 'touch base,' 'I hope this email finds you well,' 'reach out,' 'reaching out,' 'just wanted to,' 'quick question.'`;

// ── Healthy Hip Hop voice ────────────────────────────────────────
// Outreach here is first-touch to people who engaged with Roy's
// LinkedIn posts (comments, reactions, shares), not form fills — the
// note is a personal hello from Roy, not a pitch. Copy guidelines from
// Maggie (2026-07-24): acknowledge the interaction, personalize it to
// what they engaged with, keep it friendly and direct ("just wanted to
// reach out personally and say hello"). That's why Roy's banned-phrase
// list deliberately drops 'reach out' / 'just wanted to'.

const HHH_VOICE_PROMPT = `You are drafting an email reply on behalf of Roy Scott, founder and CEO of Healthy Hip Hop. Roy is warm, upbeat, and personable — he writes like a real person, not like AI. Read like a note from someone you'd actually want to hear from. Contractions always (I'm, we're, they've).

Healthy Hip Hop makes positive, kid-friendly hip-hop — music, videos, and learning content that gets kids moving, learning, and feeling good about themselves.

You will be given the original outbound we sent, the inbound reply from the lead, and context about the campaign. Your job is to draft a reply that directly addresses what the lead said, references the original outbound naturally, and moves the conversation forward.

Rules:
- 3-8 sentences. Never longer.
- Match the lead's tone. If they're casual, be casual. If formal, stay professional — but Roy never sounds stiff.
- If they asked a question, answer it specifically.
- If they're interested, propose a concrete next step (a time to talk, a specific resource).
- If they're not interested, thank them briefly and leave the door open without pushing.
- Never repeat the original outbound's language verbatim.
- Do NOT include any URLs in draftBody. URLs will be appended programmatically after your response.
- Sign off as 'Roy' on its own line. No 'Best,' no 'Thanks,' no 'Cheers.' Just 'Roy'.
- Never use: 'strong fit,' 'great fit,' 'synergy,' 'leverage,' 'circle back,' 'touch base,' 'I hope this email finds you well,' 'quick question.'`;

const HHH_LINKEDIN_OUTREACH_PROMPT = `You're Roy Scott, founder and CEO of Healthy Hip Hop, writing a personal first email to someone who just interacted with one of your LinkedIn posts — they commented, reacted, or shared it. This is NOT a sales sequence. It's Roy noticing someone engaged with his work and saying hello like a real person would.

Healthy Hip Hop makes positive, kid-friendly hip-hop — music, videos, and learning content that gets kids moving, learning, and feeling good about themselves.

You'll be given who they are and exactly how they engaged. Use it:
- Open by acknowledging their interaction with the post — thank them genuinely for engaging.
- Personalize it. If they commented, respond to what they actually said (quote or echo their words naturally). If they reacted, name the reaction or the post's topic so it's clearly about THEIR moment, not a blast. If they shared it, that's a big deal — say so.
- Keep it friendly and direct. The spirit is "just wanted to reach out personally and say hello." Roy means it, so it should read that way — no pivot into a pitch.
- If their title or company suggests a natural connection to kids, education, music, or community, you can nod to it in one clause — but never invent facts beyond what you're given.
- Close warm and open-ended: he's glad they're part of the journey, happy to connect anytime. At most a light invitation to keep in touch — no demo ask, no calendar push.

Rules:
- 3-5 sentences total. Never longer. No throat-clearing.
- Warm and genuine, never salesy. No hype adjectives, no exclamation-point pileups (one is fine).
- Subject line: short, casual, personal — like a note from a friend, not a campaign.
- Do NOT include any URLs in draftBody.
- Sign off as 'Roy' on its own line. No 'Best,' no 'Thanks,' no 'Cheers.' Just 'Roy'.
- Never use: 'strong fit,' 'great fit,' 'synergy,' 'leverage,' 'circle back,' 'touch base,' 'I hope this email finds you well,' 'quick question.'`;

// ── Registry ─────────────────────────────────────────────────────

// ── Zeutara voice ────────────────────────────────────────────────
// Fallback only. Zeutara's replies are classified and drafted upstream on
// their own Perplexity seat, against ZEUTARA_REPLY_GUIDE_URL, and arrive
// carrying the draft. This prompt only writes a draft for a payload that
// arrives without one.
//
// The outreach is fundraising: Jonah emails investors to introduce a raise
// for one of the companies Zeutara works with. So the reader is an investor,
// and the things a draft must never make up are terms, numbers, and
// Zeutara's own economics. Jonah's standing feedback on the outbound copy
// (2026-10-03) was introduction first, then why the deal fits the investor's
// past investments on sector and stage, with a line break between the two.

const ZEUTARA_VOICE_PROMPT = `You are drafting an email reply on behalf of Jonah Graham at Zeutara. Jonah is direct, warm, and writes like a person, not like AI. Contractions are fine (I'm, we're, they've).

DIRECTION OF THE CONVERSATION, and this is the part that matters most: Jonah sent this investor a cold email introducing a fundraise for one of the companies Zeutara works with, chosen because of the investor's past investments in the same sector and stage. What you are given is the investor's REPLY to that email, and you are writing Jonah's follow-up to it. Never write as though they approached us. Never compliment their email, because there was none. Any subject line you see is ours.

Rules:
- 3-6 sentences. Never longer.
- Match the investor's tone. If they're brief, be brief.
- If they asked for the deck, materials, or a call, confirm it and propose one concrete next step.
- Never name the client company, its website or its people. Describe it only by stage and sector.
- Vantage sends decks, one-pagers and files as attachments. Never claim a file is attached or provide a material link. Leave material requests open for Vantage; a draft may say Jonah will send it shortly.
- Vantage availability is for the reply owner only. Never offer those slots as founder availability or claim a meeting is booked. The send guard checks current Vantage context, including NOT_A_FIT, before any message goes out.
- Never state or estimate round size, valuation, terms, revenue, traction, or who else is investing. If they asked, say Jonah will confirm the specifics, or offer to cover it on a call.
- Never discuss Zeutara's fees, compensation, or arrangement with the company.
- Never promise, project, or imply returns.
- Never invent details about the company, the investor's portfolio, or what our email said.
- If they pass, thank them in one or two sentences and stop.
- Do NOT include any URLs in draftBody.
- No em dashes and no en dashes anywhere in the draft. Use a comma, a period, or a plain hyphen instead.
- Sign off as 'Jonah' on its own line. No 'Best,' no 'Thanks,' no 'Cheers.' Just 'Jonah'.
- Never use: 'strong fit,' 'great fit,' 'synergy,' 'leverage,' 'circle back,' 'touch base,' 'I hope this email finds you well,' 'reach out,' 'reaching out,' 'just wanted to,' 'quick question.'`;

const ZEUTARA_BRIEF = `Zeutara is Jonah Graham's firm. Jonah and Ryan Korn raise money for founders. Togari runs cold email to investors for four Zeutara companies: Goldie's Good Vibes (consumer, functional mushrooms, raising about $700K), Ivy (a Chicago dating app where singles check into venues, $1M pre-seed SAFE), Qube Finance (seed fintech) and Vertocol (regulatory intelligence for AI-built software, pre-seed SAFE). Emails go out from Jonah's sending mailboxes through Clay. Togari reads every reply: unsubscribes are blocklisted, new addresses and referrals are forwarded, out-of-office replies get one follow up after the person is back, and Qube replies are also emailed to jonah@zeutara.com. Replies that need Jonah become cards in #zeutara-cold-replies. Standing rules: Jonah wants maximum volume; the strongest fits go out first in each wave; never call an investor interested unless their own words say so.`;

const CLIENTS: Record<string, ReplybotClientConfig> = {
  // BMA runs two personas, one registry entry each: same company, same
  // Google Workspace, separate mailboxes and separate triage channels.
  // Sagar's cold outbound goes out under the Amber brand, so his id,
  // key, channel and card label all say Amber; Maggie's are the BMA
  // ones (#amber-cold-replies / #bma-cold-replies).
  //
  // `amber` is DEFAULT_REPLYBOT_CLIENT_ID, and that is load-bearing: any
  // card minted without a clientId falls back to it, as does the
  // internal proposal-email flow in slack-actions.ts, which resolves the
  // default with no argument. Both were Sagar's before this rename, so
  // the default has to follow Sagar rather than stay on the `bma` key.
  //
  // Renaming `bma` from Sagar to Maggie is the one dangerous edit in
  // this file: a Slack card minted before the rename carries
  // `clientId: "bma"` meaning Sagar. resolveReplybotClientFromCard()
  // handles that — see CARD_SCHEMA_VERSION below.
  amber: {
    clientId: "amber",
    displayName: "Amber",
    slackChannelId: "C0BR33EHKK6", // #amber-cold-replies
    // Kept as the display and Save-as-Draft identity, but approved replies
    // no longer leave this mailbox: Clay replies into the campaign, which
    // sends from whichever inbox the prospect actually wrote to.
    sender: { name: "Sagar Tiwari", email: "sagar@bluemodernadvisory.com" },
    // gmail stays at [0] because sendMethods[0] is the default for any card
    // that does not stamp its own route, and it is what backs the
    // Save-as-Gmail-Draft button. Reply cards stamp sendVia:'clay' at mint
    // time and take the Clay route.
    sendMethods: ["gmail", "clay"],
    // Amber and BMA share one Clay reply table today, so both vars hold the
    // same webhook URL and the body's client_id tells them apart. Separate
    // vars anyway: if the two personas ever get their own tables, that is a
    // Railway change rather than a code change.
    clayReplyWebhookUrlEnv: "REPLYBOT_AMBER_CLAY_REPLY_URL",
    // Replies arrive from a Clay HTTP API column, not Smartlead's native
    // webhook, so this entry authenticates by static key like the other
    // Clay-fed clients. Deliberately NOT reusing
    // SMARTLEAD_WEBHOOK_SECRET: that secret still guards the legacy
    // /smartlead/webhook route, and the two personas must not share a
    // key — a leaked key should never let a caller post as the other one.
    webhookSecretEnv: "REPLYBOT_AMBER_WEBHOOK_SECRET",
    webhookAuth: "static-key",
    // Clay payloads carry no ui_master_inbox_link, so the "Open in
    // Smartlead" deep link on manual-review cards would fall back to a
    // generic app.smartlead.ai URL. Show the draft + buttons instead.
    approvalButtonsOnManualReview: true,
    voice: {
      systemPrompt: BMA_VOICE_PROMPT,
      signoffName: "Sagar",
      timezone: "America/Chicago",
      banEmDashes: true,
    },
  },
  bma: {
    clientId: "bma",
    displayName: "Blue Modern Advisory",
    slackChannelId: "C0BMYM752MQ", // #bma-cold-replies
    // Same Workspace as Sagar, so the existing domain-wide delegation on
    // our service account already covers this mailbox — no new grant to
    // chase, unlike the third-party client domains below.
    sender: { name: "Maggie Chen", email: "maggie@bluemodernadvisory.com" },
    sendMethods: ["gmail", "clay"],
    clayReplyWebhookUrlEnv: "REPLYBOT_BMA_CLAY_REPLY_URL",
    webhookSecretEnv: "REPLYBOT_BMA_WEBHOOK_SECRET",
    webhookAuth: "static-key",
    approvalButtonsOnManualReview: true,
    // The "Blue Modern Advisory" workspace, read with Maggie's Clay sign-in.
    // Sagar's Amber campaigns share it, so only campaigns named "BMA | ..."
    // count (Maggie's choice, 2026-10-16; older ones were never renamed).
    // Replies go to /replybot/bma/webhook so Claude keeps drafting as Maggie.
    clay: {
      workspaceId: "1149025",
      campaignPrefix: "BMA |",
      pollReplies: true,
      pollSince: "2026-10-16T00:00:00Z",
      intake: "replybot",
      syncCalendar: true,
      outcomeCheck: true,
      outcomeAlertUser: "U093A6B2WBZ", // Maggie
      bounceGuard: true,
      sessionAlert: true,
    },
    campaignCalendar: { campaignPrefix: "BMA |" },
    voice: {
      systemPrompt: BMA_MAGGIE_VOICE_PROMPT,
      signoffName: "Maggie",
      timezone: "America/Chicago",
      banEmDashes: true,
    },
  },
  serif: {
    clientId: "serif",
    displayName: "Serif Health",
    slackChannelId: "C0BAL9JV0E5", // Serif form-fills channel — bot must be invited
    // Cold-email replies get their own channel; form fills stay put. Both need
    // the bot invited. Reply cards only honour this because the 'reply' route
    // is now actually read — it was declared here and ignored, so every reply
    // landed in slackChannelId regardless.
    channelOverrides: {
      reply: "C0C272SGCLD",
      // The daily warm-intro digest. serif_test replaces channelOverrides
      // wholesale, so its digests fall back to #test-channel.
      connections: "C0BAL9JV0E5",
    },
    // Drafting runs on Serif's own Perplexity account so the spend is theirs.
    // serif_test inherits this by spread, so testing bills the same account and
    // needs no second sign-in.
    perplexityAccount: "serif",
    replyGuideUrlEnv: "SERIF_REPLY_GUIDE_URL",
    // Serif has its own Clay workspace, so every campaign in it is theirs and
    // no name prefix is needed. serif_test inherits this by spread; its rows
    // carry client_id "serif_test" and land on their own calendar.
    // Serif's own workspace, read with Maggie's Clay sign-in (2026-10-16).
    // Replies go to /replies for cards only: Serif has no autopilot, so
    // nothing is ever sent without someone pressing Send.
    clay: {
      workspaceId: "1056653",
      pollReplies: true,
      pollSince: "2026-10-16T00:00:00Z",
      syncCalendar: true,
      sessionAlert: true,
    },
    campaignCalendar: {
      theme: "serif",
      // LinkedIn runs in Serif's own HeyReach account, from their CTO's and
      // Rafiq's profiles. Key from HeyReach > Settings > Integrations.
      heyreach: { apiKeyEnv: "SERIF_HEYREACH_API_KEY" },
    },
    // Which of Serif's customers' people used to work at their target
    // accounts. serif_test inherits these; its rows carry client_id
    // "serif_test" into the Clay table, so test runs are easy to filter out.
    connections: {
      guideUrlEnv: "SERIF_CONNECTION_GUIDE_URL",
      targetsUrlEnv: "SERIF_TARGET_ACCOUNTS_URL",
      clayUrlEnv: "SERIF_CONNECTIONS_CLAY_URL",
      colleagueRoles: [
        "CEO",
        "COO",
        "CFO",
        "Chief Strategy Officer",
        "Chief Revenue Officer",
        "VP / SVP / Director of Managed Care, Payer Relations, Payer Contracting, " +
          "Payer Strategy, Revenue Cycle, Strategy, or Corporate Development",
      ],
      buyerRoles: [
        "VP / SVP / Director of Managed Care, Payer Relations, Payer Contracting, or Payer Strategy",
        "CFO, CEO, or Chief Strategy Officer",
        "VP / Director of Revenue Cycle",
      ],
    },
    // Gmail sends from arham@serifhealth.com require Serif's Google
    // Workspace admin to grant domain-wide delegation for our service
    // account (client ID + gmail.send/gmail.compose scopes). Until that
    // grant lands, Send / Save-as-Draft fail with a 403 — drafts still
    // post to Slack fine.
    // Kept as the display/fallback identity, but approved replies no longer
    // go out of this mailbox — Clay sends them from the campaign's own
    // Smartsenders inbox, so the persona the prospect wrote to is the
    // persona that answers. Serif's outbound runs three (Arham, Whitney,
    // Rafiq) and only Arham and Whitney answer; Clay makes that a non-issue.
    sender: { name: "Arham", email: "arham@serifhealth.com" },
    // gmail first because sendMethods[0] is the default for cards that do
    // not stamp their own route — website form-fill outreach, which has no
    // campaign to reply into and so cannot go through Clay. Campaign reply
    // cards stamp sendVia:'clay' at mint time and take the Clay route.
    sendMethods: ["gmail", "clay"],
    clayReplyWebhookUrlEnv: "REPLYBOT_SERIF_CLAY_REPLY_URL",
    clayOutreachWebhookUrlEnv: "REPLYBOT_SERIF_CLAY_OUTREACH_URL",
    webhookSecretEnv: "REPLYBOT_SERIF_WEBHOOK_SECRET",
    webhookAuth: "static-key", // replies arrive via a Clay HTTP API column
    // Serif's replies are classified and drafted upstream in their own
    // Perplexity workspace and arrive carrying draft_body, so the Claude
    // call is skipped (see upstreamDraftedReply). The voice prompts below
    // stay as the fallback for any payload that arrives without a draft.
    //
    // Clay payloads carry no Smartlead inbox link, so manual-review cards
    // get the standard approval buttons instead of a dead deep link.
    approvalButtonsOnManualReview: true,
    voice: {
      systemPrompt: SERIF_VOICE_PROMPT,
      outreachSystemPrompt: SERIF_OUTREACH_PROMPT,
      signoffName: "Arham",
      timezone: "America/New_York",
      demoCalendarUrl:
        "https://calendly.com/whitney-serifhealth/rosettafest-meeting-with-serif-health",
    },
  },
  zeutara: {
    clientId: "zeutara",
    displayName: "Zeutara",
    // Cards live in #zeutara-cold-replies, the private channel Maggie made in
    // our workspace on 2026-10-07, and reach Jonah over Slack Connect (Caleb:
    // all the Zeutara work in one place, off the misspelled workspace that is
    // being retired). Togari must be /invited, being private. They used to
    // post in Zeutara's own workspace, #zeutara-opportunities (C0C71CF6Y2G),
    // with that install's token; buttons on cards still there keep working
    // because their updates go through response_url.
    slackChannelId: "C0C7RGTR7J8", // #zeutara-cold-replies
    // Drafting runs on Zeutara's own Perplexity seat so the spend is theirs.
    // zeutara_test inherits this by spread, so testing bills the same seat and
    // needs no second sign-in.
    perplexityAccount: "zeutara",
    replyGuideUrlEnv: "ZEUTARA_REPLY_GUIDE_URL",
    // Display and fallback identity only. Approved replies leave through Clay
    // from whichever of Jonah's sending mailboxes the investor wrote to, which
    // is the point: every one of them is a variation of Jonah's name on a
    // Zeutara domain, and the answer has to come from the same one.
    sender: { name: "Jonah Graham", email: "jonah@zeutara.com" },
    // Clay only. Unlike Serif there is no form-fill outreach and no Gmail
    // delegation on zeutara.com, so there is nothing for an unstamped card to
    // fall back to. A card without campaign keys refuses to send rather than
    // reaching for a mailbox we have no grant on.
    sendMethods: ["clay"],
    clayReplyWebhookUrlEnv: "REPLYBOT_ZEUTARA_CLAY_REPLY_URL",
    // No webhookSecretEnv: replies arrive only on POST /replies, so
    // /replybot/zeutara/webhook has nothing to accept and refuses everything.
    approvalButtonsOnManualReview: true,
    // Every Zeutara campaign is named "Zeutara | <company> | <segment> | <wave>"
    // in Jonah's Workspace (campaigns list, read 2026-10-10).
    live: { clayWorkspaceId: "1372623", campaignPrefix: "Zeutara |" },
    clay: {
      workspaceId: "1372623",
      campaignPrefix: "Zeutara |",
      pollReplies: true,
      outcomeCheck: true,
      bounceGuard: true,
      sessionAlert: true,
    },
    // Jonah, 2026-10-07: "Please send me every single reply and I will tell
    // you if they are a good fit for each client." So he rules on fit first,
    // and he is the only one who can fit-check, send or edit a Zeutara card.
    // His id as Slack shows it in the Zeutara channel.
    // Jonah's own account in the Amber workspace (jonah@zeutara.com). The old
    // id is the Slack Connect copy from the retired Amber Intellegence
    // workspace; cards tagged that one and he never saw the ping (10/10).
    approvers: ["U0C7RCPJPM5", "U0C0PL92WTC"],
    leadNameTrailingE: true,
    fitReview: true,
    // Caleb, 2026-10-09. 0.9 sits above every positive verdict Perplexity gave
    // a reply that still needed Jonah that week (Infinity's deck ask was 0.93,
    // and the intent check is what stops that one, not the number).
    autoSend: { minConfidence: 0.9 },
    // Clay workflows "Zeutara | Togari forward" and "Zeutara | Togari
    // blocklist", built and tested 2026-10-09.
    autopilot: {
      forwardHookEnv: "REPLYBOT_ZEUTARA_CLAY_FORWARD_URL",
      blocklistHookEnv: "REPLYBOT_ZEUTARA_CLAY_BLOCKLIST_URL",
      ownDomainHint: "zeutara",
      // Jonah, WhatsApp 2026-10-09: "forward me the email replies with QUBE to
      // my main email". Caleb: from Blue Modern.
      copy: {
        companies: ["Qube Finance"],
        to: "jonah@zeutara.com",
        from: "caleb@bluemodernadvisory.com",
        fromName: "Caleb Newton",
      },
    },
    // Read by the reply rules' next steps and the client assistant; moved here
    // from reply-intent.ts and client-assistant/index.ts on 2026-10-13 so a
    // second client's cards never say "as Jonah".
    replyCopy: {
      principal: "Jonah",
      clientName: "Zeutara",
      raisesDebt: false,
      callWith: "the founder",
    },
    // Jonah's account in the Amber workspace, the id the client assistant
    // hears him as in #zeutara-cold-replies (first of approvers above).
    principalSlackUserId: "U0C7RCPJPM5",
    brief: ZEUTARA_BRIEF,
    voice: {
      systemPrompt: ZEUTARA_VOICE_PROMPT,
      signoffName: "Jonah",
      timezone: "America/Los_Angeles",
      banEmDashes: true,
    },
  },
  hhh: {
    clientId: "hhh",
    displayName: "Healthy Hip Hop",
    // Offboarded 2026-09-02. Kept as a tombstone so old cards in their
    // channel refuse rather than falling through to BMA — see `retired`.
    retired: true,
    slackChannelId: "C0BE5DNUZHV", // HHH replybot channel — bot must be invited
    // Gmail sends from Roy's domain need HHH's Google Workspace admin to
    // grant domain-wide delegation to our service account (same setup as
    // Serif) — until then Send / Save-as-Draft fail with a 403, but
    // drafts still post to Slack fine.
    sender: {
      name: "Roy Scott",
      email: "roy@healthy.hiphop",
      linkedinUrl: "https://www.linkedin.com/in/royscottceo",
    },
    sendMethods: ["gmail"],
    webhookSecretEnv: "REPLYBOT_HHH_WEBHOOK_SECRET",
    webhookAuth: "static-key", // interactions arrive via a Clay HTTP API column
    voice: {
      systemPrompt: HHH_VOICE_PROMPT,
      outreachSystemPrompt: HHH_LINKEDIN_OUTREACH_PROMPT,
      signoffName: "Roy",
      timezone: "America/New_York",
    },
  },
};

/**
 * Test clone of Serif, for exercising the Perplexity reply loop end to end
 * without cards landing in the channel Serif actually watches.
 *
 * Derived from `serif` rather than written out, so the voice, sender and send
 * routing cannot drift from the real thing — the whole point is to test what
 * production will do. Only the channel and the label differ.
 *
 * Select it with REPLIES_DEFAULT_CLIENT_ID=serif_test; going live is changing
 * that one variable back to `serif`. Cards say "(test)" so a card in the wrong
 * channel is obvious at a glance.
 *
 * NOTE: send routing is inherited, so approving a card here really does send,
 * via Clay, to whatever lead_id/campaign_id is on the row. Test with a row
 * whose prospect address you control.
 */
CLIENTS.serif_test = {
  ...CLIENTS.serif,
  clientId: "serif_test",
  displayName: "Serif Health (test)",
  slackChannelId: "C0C14UKEEUR", // bot must be invited to this channel
  // Overridden, not inherited: the spread would otherwise carry Serif's live
  // reply channel across and send every test card into it, which is the exact
  // thing the test client exists to prevent.
  channelOverrides: {
    reply: "C0C14UKEEUR",
  },
  // Serif's inbox is read once, as serif: a second reader here would post
  // every real reply into #test-channel too.
  clay: undefined,
};

/**
 * Test clone of Zeutara, same reasoning as serif_test: run the whole loop on
 * the real voice, guide, Perplexity seat and Clay send path, with cards landing
 * in #test-channel instead of the channel Jonah and Ryan watch.
 *
 * Selected per row, by the Clay column sending client_id "zeutara_test".
 * Going live is changing that value to "zeutara".
 *
 * NOTE: approving a card here really does send, via Clay, as Jonah. Test with
 * a row whose prospect address you control.
 */
CLIENTS.zeutara_test = {
  ...CLIENTS.zeutara,
  clientId: "zeutara_test",
  displayName: "Zeutara (test)",
  // A test row must never send on its own: the spread above would otherwise
  // carry Zeutara's autoSend into test runs that reply to real leads.
  autoSend: undefined,
  autopilot: undefined,
  // No live page: the spread would otherwise list a test client beside
  // Zeutara, over the same campaigns.
  live: undefined,
  // Nor Zeutara's inbox, bounce guard or alerts a second time over.
  clay: undefined,
  // #test-channel is in our workspace. Zeutara no longer sets slackTeamId,
  // but keep this explicit so a future move back can't leak its token here.
  slackTeamId: undefined,
  slackChannelId: "C0C14UKEEUR", // #test-channel
  // Jonah's id belongs to the Zeutara channel. In #test-channel whoever is
  // testing has to be able to press the buttons.
  approvers: undefined,
  // Nor is Jonah tagged in #test-channel when a test follow-up parks.
  principalSlackUserId: undefined,
};

/**
 * The fit-review client a Slack channel or person belongs to, for the client
 * assistant: a mention in #zeutara-cold-replies, or from Jonah anywhere, talks
 * to Zeutara's assistant and never to BMA's own (2026-10-10).
 */
export function clientForSlack(
  channel: string,
  user?: string,
): ReplybotClientConfig | null {
  for (const c of Object.values(CLIENTS)) {
    if (c.retired || !c.fitReview) continue;
    if (c.slackChannelId === channel) return c;
    if (user && c.approvers?.includes(user)) return c;
  }
  return null;
}

/**
 * The Clay workspace Togari reads for a client, from clay or else the live
 * page's, or null when it has none.
 */
export function clayWorkspace(
  c: ReplybotClientConfig,
): { workspaceId: string; campaignPrefix: string } | null {
  if (c.clay)
    return {
      workspaceId: c.clay.workspaceId,
      campaignPrefix: c.clay.campaignPrefix ?? "",
    };
  if (c.live)
    return {
      workspaceId: c.live.clayWorkspaceId,
      campaignPrefix: c.live.campaignPrefix,
    };
  return null;
}

type ClaySwitch = Exclude<
  keyof NonNullable<ReplybotClientConfig["clay"]>,
  "workspaceId" | "campaignPrefix"
>;

/** Ids of the clients with one Clay job switched on. Retired ones never run. */
export function clayClients(job: ClaySwitch): string[] {
  return Object.values(CLIENTS)
    .filter((c) => !c.retired && c.clay?.[job])
    .map((c) => c.clientId);
}

/** Clients set up for warm-intro research, test clones included. */
export function connectionClients(): ReplybotClientConfig[] {
  return Object.values(CLIENTS).filter((c) => !c.retired && c.connections);
}

/** Clients with a live page, for the read API. Retired ones never show. */
export function liveClients(): ReplybotClientConfig[] {
  return Object.values(CLIENTS).filter((c) => !c.retired && c.live);
}

export const DEFAULT_REPLYBOT_CLIENT_ID = "amber";

/**
 * Version stamped into every Slack card payload this build mints.
 *
 * Bumped to 2 when `bma` was re-keyed from Sagar to Maggie
 * (2026-09-02). Cards minted before that carry `clientId: "bma"` meaning
 * *Sagar*, and a v1 card is indistinguishable from a v2 Maggie card by
 * clientId alone — the version is what tells them apart. See
 * resolveReplybotClientFromCard.
 */
export const CARD_SCHEMA_VERSION = 2;

/** Strict lookup — null for unknown ids (webhook routes 404 on this). */
export function getReplybotClient(
  clientId: string,
): ReplybotClientConfig | null {
  return CLIENTS[clientId] ?? null;
}

/**
 * Lenient lookup for Slack interaction payloads: button values minted
 * before this registry existed carry no clientId, and those messages are
 * all Sagar's, so unknown/missing ids fall back to the default client.
 */
export function resolveReplybotClient(clientId?: string): ReplybotClientConfig {
  return (clientId && CLIENTS[clientId]) || CLIENTS[DEFAULT_REPLYBOT_CLIENT_ID];
}

/**
 * Resolve the client for a *Slack card* — a button value or a modal's
 * private_metadata — rather than for a fresh webhook payload.
 *
 * This exists because `bma` changed meaning. Before 2026-09-02 it was
 * Sagar; now it is Maggie. Reading an old card with the new registry
 * would send Sagar's pending replies out of Maggie's mailbox, silently
 * and with her name on them, so a card without the current
 * CARD_SCHEMA_VERSION is read under the OLD meaning:
 *
 *   v1 card, clientId 'bma' or absent  → Amber (Sagar), as drafted
 *   v1 card, any other clientId        → that client, unchanged
 *   v2+ card                           → trust clientId as written
 *
 * Only the ambiguous ids are remapped, so an old Serif or HHH card still
 * resolves to Serif or HHH. Safe to delete this function — and the `cv`
 * field — once no pre-rename card with live buttons remains in Slack.
 */
export function resolveReplybotClientFromCard(card: {
  clientId?: string;
  cv?: number;
}): ReplybotClientConfig {
  const version = typeof card.cv === "number" ? card.cv : 1;
  if (
    version < CARD_SCHEMA_VERSION &&
    (!card.clientId || card.clientId === "bma")
  ) {
    return CLIENTS[DEFAULT_REPLYBOT_CLIENT_ID];
  }
  return resolveReplybotClient(card.clientId);
}

/**
 * Channel a given payload kind posts to: the client's override when set,
 * otherwise its default channel.
 */
export function resolveChannel(
  client: ReplybotClientConfig,
  route: ReplybotChannelRoute,
): string {
  return client.channelOverrides?.[route] || client.slackChannelId;
}

/** True when the Slack user may send/draft for this client. */
export function isApprover(
  client: ReplybotClientConfig,
  slackUserId: string | undefined,
): boolean {
  if (!client.approvers || client.approvers.length === 0) return true;
  return !!slackUserId && client.approvers.includes(slackUserId);
}
