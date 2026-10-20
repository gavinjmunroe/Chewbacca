/**
 * Togari Slack slash commands (WS-7).
 *
 * Surface: POST /slack/commands — single endpoint that fans out by command.
 *
 *   /togari connect      → DM the user a single-use magic link to the dashboard
 *   /togari status       → ephemeral list of connected platforms (placeholder)
 *   /togari revoke-key   → ephemeral deep-link to the API-keys page on the dashboard
 *
 * Every request goes through Slack signing-secret HMAC verification with a
 * 5-minute timestamp window for replay protection. Match the existing pattern
 * in `src/agents/slack-sync/index.ts` so there's one verification path to audit.
 *
 * IMPORTANT: Slack slash commands send `application/x-www-form-urlencoded`, not
 * JSON. `registerSlackCommandsRoute` mounts the route with `express.urlencoded`
 * AND a `verify` hook that stashes the raw body on `req.rawBody` so the HMAC
 * base string can be reconstructed verbatim.
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { Application, Request, Response } from "express";
import express from "express";
import { issueMagicLink } from "../api/magic-link.routes.js";

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

// ─── Signature verification ───────────────────────────────────────────────────

function verifySlackSignature(req: Request): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    process.stderr.write(
      "[slack-bot] SLACK_SIGNING_SECRET not set — refusing request\n",
    );
    return false;
  }

  const timestamp = req.header("x-slack-request-timestamp");
  const slackSig = req.header("x-slack-signature");
  if (!timestamp || !slackSig) return false;

  // Replay window — reject anything older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return false;

  const rawBody = (req as Request & { rawBody?: string }).rawBody;
  if (typeof rawBody !== "string") {
    process.stderr.write(
      "[slack-bot] missing rawBody on request — cannot verify signature\n",
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

// ─── Slack API helpers ────────────────────────────────────────────────────────

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

// ─── Command handlers ─────────────────────────────────────────────────────────

interface EphemeralResponse {
  response_type: "ephemeral";
  text: string;
}

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

  const link = issueMagicLink({ slackUserId, slackTeamId });
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
      `:warning: I couldn't DM you — here's your one-time link (do not share, expires in 10 min):\n${link.url}`,
    );
  }
}

function handleStatus(payload: SlashCommandPayload): EphemeralResponse {
  // Real status lookup is gated on the Slack-user → Auth0-user binding that
  // /togari connect establishes via the dashboard. Until that round-trip is
  // complete, surface a deep-link so users can see status in the dashboard.
  const base = process.env.PUBLIC_URL ?? "http://localhost:3000";
  void payload;
  return ephemeral(
    `:bar_chart: Connection status lives on the dashboard: ${base}/dashboard/connect\n` +
      `Run \`/togari connect\` first if you haven't linked your account yet.`,
  );
}

function handleRevokeKey(payload: SlashCommandPayload): EphemeralResponse {
  const base = process.env.PUBLIC_URL ?? "http://localhost:3000";
  void payload;
  return ephemeral(
    `:key: Revoke or rotate API keys here: ${base}/dashboard/api-keys\n` +
      `Use \`/togari connect\` first if you haven't linked your account yet.`,
  );
}

function handleHelp(): EphemeralResponse {
  return ephemeral(
    "*Togari commands*\n" +
      "• `/togari connect` — DM yourself a one-time link to connect platforms + mint an API key\n" +
      "• `/togari status` — see which platforms are connected for your account\n" +
      "• `/togari revoke-key` — open the dashboard to revoke or rotate an API key\n" +
      "• `/togari help` — this message",
  );
}

// ─── Router ───────────────────────────────────────────────────────────────────

export async function slackCommandsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  if (!verifySlackSignature(req)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const payload = (req.body ?? {}) as SlashCommandPayload;
  const subcommand =
    (payload.text ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";

  try {
    let reply: EphemeralResponse;
    switch (subcommand) {
      case "":
      case "help":
        reply = handleHelp();
        break;
      case "connect":
        reply = await handleConnect(payload);
        break;
      case "status":
        reply = handleStatus(payload);
        break;
      case "revoke-key":
      case "revoke":
        reply = handleRevokeKey(payload);
        break;
      default:
        reply = ephemeral(
          `:question: Unknown command \`${subcommand}\`. Try \`/togari help\`.`,
        );
    }
    res.status(200).json(reply);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[slack-bot] handler error: ${msg}\n`);
    if (!res.headersSent) {
      res.status(200).json(ephemeral(`:x: Something went wrong: ${msg}`));
    }
  }
}

/**
 * Mount POST /slack/commands. Captures the raw body BEFORE form parsing so the
 * Slack HMAC base string can be reconstructed verbatim — Slack signs the raw
 * `application/x-www-form-urlencoded` body, not the parsed object.
 */
export function registerSlackCommandsRoute(app: Application): void {
  app.post(
    "/slack/commands",
    express.urlencoded({
      extended: false,
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: string }).rawBody = buf.toString("utf8");
      },
    }),
    slackCommandsHandler,
  );
}
