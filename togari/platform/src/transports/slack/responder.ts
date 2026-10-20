/**
 * @togari/admin — Slack thread replies and reminders for Slack bot
 *
 * Posts formatted confirmation messages and schedules reminders
 * via the Slack Web API.
 */

import { WebClient } from "@slack/web-api";
import { createLogger } from "../../observability/logger";
import type { DealSyncResult } from "./deal-sync";
import { markdownToSlack } from "./mrkdwn";

const logger = createLogger("SlackResponder");

let slackClient: WebClient | null = null;

function getClient(): WebClient {
  if (!slackClient) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) throw new Error("SLACK_BOT_TOKEN not set");
    slackClient = new WebClient(token);
  }
  return slackClient;
}

export async function postThreadReply(
  channel: string,
  threadTs: string,
  dealResult: DealSyncResult,
  calendarEvents?: Array<{ summary: string; htmlLink: string; start: string }>,
): Promise<void> {
  const client = getClient();

  const operationEmoji =
    dealResult.operation === "inserted"
      ? ":new:"
      : dealResult.operation === "updated"
        ? ":arrows_counterclockwise:"
        : ":memo:";
  const operationLabel =
    dealResult.operation === "inserted"
      ? "New Deal Created"
      : dealResult.operation === "updated"
        ? "Deal Updated"
        : "Activity Logged";

  const fields: Array<{ type: string; text: string }> = [];

  if (dealResult.company) {
    fields.push({ type: "mrkdwn", text: `*Company:* ${dealResult.company}` });
  }
  if (dealResult.deal_id) {
    fields.push({
      type: "mrkdwn",
      text: `*Deal ID:* \`${dealResult.deal_id}\``,
    });
  }
  if (dealResult.stage) {
    fields.push({ type: "mrkdwn", text: `*Stage:* ${dealResult.stage}` });
  }
  if (dealResult.value) {
    fields.push({
      type: "mrkdwn",
      text: `*Value:* $${dealResult.value.toLocaleString()}`,
    });
  }

  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${operationEmoji} *${operationLabel}*`,
      },
    },
  ];

  if (fields.length > 0) {
    blocks.push({
      type: "section",
      fields,
    });
  }

  if (calendarEvents && calendarEvents.length > 0) {
    const eventLines = calendarEvents.map(
      (e) => `:calendar: <${e.htmlLink}|${e.summary}> — ${e.start}`,
    );
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Calendar Events:*\n${eventLines.join("\n")}`,
      },
    });
  }

  blocks.push({ type: "divider" });

  try {
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: `${operationLabel}: ${dealResult.company || "Activity logged"}`,
      blocks,
    });
    logger.info("Posted thread reply", {
      channel,
      operation: dealResult.operation,
      company: dealResult.company,
    });
  } catch (err) {
    logger.error("Failed to post thread reply", err as Error, { channel });
  }
}

export async function postClarificationMessage(
  channel: string,
  threadTs: string,
  confidence: number,
): Promise<void> {
  const client = getClient();

  try {
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: `:thinking_face: I wasn't confident enough to process that message (confidence: ${confidence}%). Could you rephrase with more details? For example:\n\n> New deal with Acme Corp, contact John Smith, john@acme.com, discovery call scheduled for next Tuesday at 2pm\n\nInclude: company name, contact info, deal stage, and any next actions.`,
    });
    logger.info("Posted clarification request", { channel, confidence });
  } catch (err) {
    logger.error("Failed to post clarification message", err as Error, {
      channel,
    });
  }
}

export async function postConflictWarning(
  channel: string,
  threadTs: string,
  company: string,
  conflictDeal: { deal_id: string; owner: string; stage: string },
): Promise<void> {
  const client = getClient();

  try {
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: `:warning: A deal for *${company}* already exists.\n\n*Deal ID:* \`${conflictDeal.deal_id}\`\n*Owner:* ${conflictDeal.owner}\n*Stage:* ${conflictDeal.stage}\n\nDid you mean to update it? Reply \`yes update\` or \`no create new\`.`,
    });
    logger.info("Posted conflict warning", {
      channel,
      company,
      dealId: conflictDeal.deal_id,
    });
  } catch (err) {
    logger.error("Failed to post conflict warning", err as Error, { channel });
  }
}

export async function postTextReply(
  channel: string,
  threadTs: string,
  text: string,
): Promise<void> {
  const client = getClient();

  try {
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      // Render the agent's GitHub-flavored markdown as Slack mrkdwn so headers
      // and bold display natively instead of literal `#` / `**` (2026-06-03).
      text: markdownToSlack(text),
    });
    logger.info("Posted text reply", { channel, textLength: text.length });
  } catch (err) {
    logger.error("Failed to post text reply", err as Error, { channel });
  }
}

/** Format a Unix timestamp as a human-readable ET string. */
function formatReminderTime(unixTime: number): string {
  const date = new Date(unixTime * 1000);
  return (
    date.toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }) + " ET"
  );
}

/**
 * Try to set a single reminder via reminders.add.
 * If reminders.add fails with a known permission error, falls back to
 * chat.scheduleMessage (sends a scheduled DM to the target user).
 * Returns the method used ('reminders.add' | 'chat.scheduleMessage') or null on failure.
 */
async function setOneReminder(
  token: string,
  targetUserId: string,
  reminderText: string,
  unixTime: number,
): Promise<"reminders.add" | "chat.scheduleMessage" | null> {
  const sendParams = { user: targetUserId, text: reminderText, time: unixTime };
  console.log(
    "[reminder] Attempting reminders.add with params:",
    JSON.stringify(sendParams),
  );

  // ── Attempt 1: reminders.add ──
  try {
    const res = await fetch("https://slack.com/api/reminders.add", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(sendParams),
    });

    const resBody = await res.text();
    let data: any;
    try {
      data = JSON.parse(resBody);
    } catch {
      data = { ok: false, error: resBody };
    }

    console.log("[reminder] reminders.add HTTP status:", res.status);
    console.log("[reminder] reminders.add response:", JSON.stringify(data));

    if (!res.ok) {
      console.error(
        "[reminder] reminders.add HTTP error:",
        JSON.stringify({
          httpStatus: res.status,
          responseBody: resBody,
          sentParams: sendParams,
        }),
      );
      logger.error("Slack reminders.add HTTP error", undefined, {
        httpStatus: res.status,
        responseBody: resBody,
        sentParams: sendParams,
      });
    } else if (!data.ok) {
      console.error(
        "[reminder] reminders.add API error:",
        JSON.stringify({
          slackError: data.error,
          fullResponse: data,
          sentParams: sendParams,
        }),
      );
      logger.error("Slack reminders.add API error", undefined, {
        slackError: data.error,
        responseBody: data,
        sentParams: sendParams,
      });
    } else {
      console.log(
        "[reminder] Used reminders.add — success for user:",
        targetUserId,
        "at:",
        unixTime,
      );
      logger.info("Reminder set via reminders.add", {
        userId: targetUserId,
        time: unixTime,
      });
      return "reminders.add";
    }

    // reminders.add requires a user token (not bot token) — it will always fail
    // with bot tokens. Always fall back to chat.scheduleMessage regardless of the
    // specific error from reminders.add.
    console.log(
      "[reminder] reminders.add failed with error:",
      data.error,
      "| Falling back to chat.scheduleMessage",
    );
  } catch (err) {
    console.error(
      "[reminder] reminders.add fetch threw:",
      err instanceof Error ? err.message : err,
    );
    logger.error(
      "reminders.add fetch threw",
      err instanceof Error ? err : new Error(String(err)),
      {
        sentParams: sendParams,
      },
    );
  }

  // ── Attempt 2: chat.scheduleMessage (send a scheduled DM) ──
  const scheduleParams = {
    channel: targetUserId,
    text: `:bell: Reminder: ${reminderText}`,
    post_at: unixTime,
  };
  console.log(
    "[reminder] Falling back to chat.scheduleMessage with params:",
    JSON.stringify(scheduleParams),
  );
  logger.info("Falling back to chat.scheduleMessage", {
    userId: targetUserId,
    time: unixTime,
  });

  try {
    const res = await fetch("https://slack.com/api/chat.scheduleMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(scheduleParams),
    });

    const resBody = await res.text();
    let data: any;
    try {
      data = JSON.parse(resBody);
    } catch {
      data = { ok: false, error: resBody };
    }

    console.log("[reminder] chat.scheduleMessage HTTP status:", res.status);
    console.log(
      "[reminder] chat.scheduleMessage response:",
      JSON.stringify(data),
    );

    if (!res.ok || !data.ok) {
      console.error(
        "[reminder] chat.scheduleMessage also failed:",
        JSON.stringify({
          httpStatus: res.status,
          slackError: data.error,
          fullResponse: data,
          sentParams: scheduleParams,
        }),
      );
      logger.error("chat.scheduleMessage also failed", undefined, {
        httpStatus: res.status,
        slackError: data.error,
        responseBody: data,
        sentParams: scheduleParams,
      });
      return null;
    }

    console.log(
      "[reminder] Fell back to chat.scheduleMessage — success for user:",
      targetUserId,
      "at:",
      unixTime,
      "scheduledMsgId:",
      data.scheduled_message_id,
    );
    logger.info("Reminder set via chat.scheduleMessage fallback", {
      userId: targetUserId,
      time: unixTime,
      scheduledMessageId: data.scheduled_message_id,
    });
    return "chat.scheduleMessage";
  } catch (err) {
    console.error(
      "[reminder] chat.scheduleMessage fetch threw:",
      err instanceof Error ? err.message : err,
    );
    logger.error(
      "chat.scheduleMessage fetch threw",
      err instanceof Error ? err : new Error(String(err)),
      {
        userId: targetUserId,
        time: unixTime,
      },
    );
    return null;
  }
}

/**
 * Schedule native Slack reminders using the new parser fields.
 * Tries reminders.add first; falls back to chat.scheduleMessage on permission errors.
 * Posts a confirmation thread reply.
 */
export async function scheduleNativeReminders(
  reminderText: string,
  targetUserId: string,
  reminderTimes: number[],
  channel: string,
  threadTs: string,
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN not set");

  let successCount = 0;
  const confirmLines: string[] = [];

  for (const unixTime of reminderTimes) {
    const method = await setOneReminder(
      token,
      targetUserId,
      reminderText,
      unixTime,
    );

    if (method) {
      successCount++;
      const methodLabel =
        method === "chat.scheduleMessage" ? " (scheduled DM)" : "";
      confirmLines.push(`• ${formatReminderTime(unixTime)}${methodLabel}`);
    }
  }

  const client = getClient();

  if (successCount > 0) {
    const confirmText = `:bell: Set ${successCount} reminder${successCount > 1 ? "s" : ""} for <@${targetUserId}>:\n${confirmLines.join("\n")}\n\n:memo: ${reminderText}`;
    try {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: confirmText,
      });
    } catch (err) {
      logger.error("Failed to post reminder confirmation", err as Error, {
        channel,
      });
    }
  } else {
    try {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `:warning: Couldn't set the reminder via Slack API. Try using Slack's built-in \`/remind\` command instead.\n\nWhat you wanted: "${reminderText}"`,
      });
    } catch (err) {
      logger.error("Failed to post reminder failure message", err as Error, {
        channel,
      });
    }
  }
}
