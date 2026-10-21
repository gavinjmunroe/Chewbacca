/**
 * Togari Slack slash commands (WS-6).
 *
 * Surface: POST /slack/togari — single endpoint that fans out by subcommand.
 *
 *   /togari connect      DM the user a single-use magic link to the dashboard
 *   /togari status       ephemeral pointer to the connect page
 *   /togari revoke-key   ephemeral pointer to the API-keys page
 *   /togari help         usage
 *
 * Every request goes through Slack signing-secret HMAC verification with a
 * 5-minute timestamp window for replay protection.
 *
 * Slack slash commands send `application/x-www-form-urlencoded`, not JSON.
 * The route plugin in `dedup/api/slack.routes.ts` registers a scoped content
 * parser that stashes the raw body on `request.rawBody` so the HMAC base
 * string can be reconstructed verbatim — Slack signs the raw urlencoded body,
 * not the parsed object.
 *
 * Connect issues a magic link by HTTP POST to medha-id's own
 * `/api/v1/magic-link/issue` (service-key gated, owned by WS-4). The HTTP
 * indirection keeps WS-6 decoupled from the magic-link implementation: the
 * route can move, change storage, or change token shape without touching this
 * file.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

interface SlashCommandPayload {
  token?: string;
  team_id?: string;
  team_domain?: string;
  channel_id?: string;
  user_id?: string;
  user_name?: string;
  command?: string;
  text?: string;
  response_url?: string;
  trigger_id?: string;
}

interface EphemeralResponse {
  response_type: "ephemeral";
  text: string;
}

interface MagicLinkResponse {
  url: string;
  expiresAt?: string;
}

// The Fastify route file in dedup/api/slack.routes.ts augments FastifyRequest
// with `rawBody?: string` via a module declaration. The handler reads it
// through a shape-narrowed local alias so this file does not depend on that
// augmentation being in scope.
type WithRawBody = { rawBody?: string };

// Signature verification

export function verifySlackSignature(
  request: FastifyRequest & WithRawBody,
): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    process.stderr.write(
      "[slack-bot] SLACK_SIGNING_SECRET not set; refusing request\n",
    );
    return false;
  }

  const timestamp = request.headers["x-slack-request-timestamp"];
  const slackSig = request.headers["x-slack-signature"];
  if (typeof timestamp !== "string" || typeof slackSig !== "string") {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return false;

  const rawBody = request.rawBody;
  if (typeof rawBody !== "string") {
    process.stderr.write(
      "[slack-bot] missing rawBody on request; cannot verify signature\n",
    );
    return false;
  }

  const basestring = `v0:${timestamp}:${rawBody}`;
  const expected =
    "v0=" +
    createHmac("sha256", signingSecret).update(basestring).digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const gotBuf = Buffer.from(slackSig, "utf8");
  if (expectedBuf.length !== gotBuf.length) return false;
  return timingSafeEqual(expectedBuf, gotBuf);
}

// Slack API helpers

async function slackApiPost(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN not set");

  const res = await fetch(`https://slack.com/api/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!data.ok) {
    throw new Error(`Slack API error (${endpoint}): ${String(data.error)}`);
  }
  return data;
}

async function dmUser(slackUserId: string, text: string): Promise<void> {
  const opened = (await slackApiPost("conversations.open", {
    users: slackUserId,
  })) as { channel?: { id?: string } };
  const channel = opened.channel?.id;
  if (!channel) throw new Error("conversations.open returned no channel id");
  await slackApiPost("chat.postMessage", { channel, text });
}

// Magic-link bridge: POST medha-id's own /api/v1/magic-link/issue.
// Internal call, so default to localhost on the bound port. Service-key gated
// by WS-4; we send MAGIC_LINK_INTERNAL_SECRET as the bearer.

async function issueMagicLink(args: {
  slackUserId: string;
  slackTeamId: string;
}): Promise<MagicLinkResponse> {
  const secret = process.env.MAGIC_LINK_INTERNAL_SECRET;
  if (!secret) throw new Error("MAGIC_LINK_INTERNAL_SECRET not set");

  const base =
    process.env.MAGIC_LINK_INTERNAL_BASE_URL ??
    `http://127.0.0.1:${process.env.PORT ?? "8080"}`;
  const url = `${base.replace(/\/+$/, "")}/api/v1/magic-link/issue`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: "slack",
      slackUserId: args.slackUserId,
      slackTeamId: args.slackTeamId,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `magic-link/issue ${res.status}: ${text || res.statusText}`,
    );
  }
  const data = (await res.json()) as MagicLinkResponse;
  if (!data?.url) throw new Error("magic-link/issue returned no url");
  return data;
}

// Command handlers

function ephemeral(text: string): EphemeralResponse {
  return { response_type: "ephemeral", text };
}

async function handleConnect(
  payload: SlashCommandPayload,
): Promise<EphemeralResponse> {
  const slackUserId = payload.user_id ?? "";
  const slackTeamId = payload.team_id ?? "";
  if (!slackUserId || !slackTeamId) {
    return ephemeral(
      ":x: Could not read your Slack identity from this request.",
    );
  }

  let link: MagicLinkResponse;
  try {
    link = await issueMagicLink({ slackUserId, slackTeamId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[slack-bot] failed to issue magic link: ${msg}\n`);
    return ephemeral(
      ":x: I couldn't mint a connect link right now. Please try again in a minute.",
    );
  }

  const dmText =
    `:link: Here's your one-time connect link for Togari (expires in 10 minutes):\n` +
    `${link.url}\n\n` +
    `It opens the dashboard, where you can plug in Apple Contacts, LinkedIn, ` +
    `and create a \`tgi_live_\` API key for Clay.`;

  try {
    await dmUser(slackUserId, dmText);
    return ephemeral(
      ":white_check_mark: I just DM'd you a one-time link. It expires in 10 minutes.",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[slack-bot] failed to DM connect link: ${msg}\n`);
    // Fall back to ephemeral with the URL so the user isn't stranded.
    return ephemeral(
      `:warning: I couldn't DM you, here's your one-time link (do not share, expires in 10 min):\n${link.url}`,
    );
  }
}

function handleStatus(_payload: SlashCommandPayload): EphemeralResponse {
  const base = process.env.PUBLIC_URL ?? "http://localhost:3000";
  return ephemeral(
    `:bar_chart: Connection status lives on the dashboard: ${base}/connect\n` +
      `Run \`/togari connect\` first if you haven't linked your account yet.`,
  );
}

function handleRevokeKey(_payload: SlashCommandPayload): EphemeralResponse {
  const base = process.env.PUBLIC_URL ?? "http://localhost:3000";
  return ephemeral(
    `:key: Revoke or rotate API keys here: ${base}/api-keys\n` +
      `Use \`/togari connect\` first if you haven't linked your account yet.`,
  );
}

function handleHelp(): EphemeralResponse {
  return ephemeral(
    "*Togari commands*\n" +
      "  `/togari connect`     DM yourself a one-time link to connect platforms and mint an API key\n" +
      "  `/togari status`      see which platforms are connected for your account\n" +
      "  `/togari revoke-key`  open the dashboard to revoke or rotate an API key\n" +
      "  `/togari help`        this message",
  );
}

// Fastify handler

export async function slackCommandsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<EphemeralResponse | undefined> {
  if (!verifySlackSignature(request)) {
    await reply.code(401).send({ error: "Invalid signature" });
    return;
  }

  const payload = (request.body ?? {}) as SlashCommandPayload;
  const subcommand =
    (payload.text ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";

  try {
    switch (subcommand) {
      case "":
      case "help":
        return handleHelp();
      case "connect":
        return await handleConnect(payload);
      case "status":
        return handleStatus(payload);
      case "revoke-key":
      case "revoke":
        return handleRevokeKey(payload);
      default:
        return ephemeral(
          `:question: Unknown command \`${subcommand}\`. Try \`/togari help\`.`,
        );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[slack-bot] handler error: ${msg}\n`);
    return ephemeral(`:x: Something went wrong: ${msg}`);
  }
}
