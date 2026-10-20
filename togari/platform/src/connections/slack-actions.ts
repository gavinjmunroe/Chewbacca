/**
 * What the digest's buttons do.
 *
 *   connpath_good   record Good path, redraw, draft the intro ask in the thread
 *   connpath_bad    record Not a fit, redraw
 *   connpath_regen  draft the ask again, in place
 *   connpath_edit   open a modal to edit the draft (needs trigger_id, so the
 *                   server awaits it before answering Slack)
 *
 * The modal's submit (callback_id connpath_edit_draft) saves the edit and
 * updates the thread reply. Nothing here sends anything outside Slack.
 */

import { createLogger } from "../observability/logger";
import { getReplybotClient, type ReplybotClientConfig } from "../agents/replybot/client-config";
import { slackBotTokenFor } from "../transports/slack/installations";
import {
  claimVerdict,
  contactEmail,
  getPath,
  pathsInMessage,
  saveDraft,
  type ConnectionPath,
  type PathVerdict,
} from "./paths";
import { escapeMrkdwn, groupByTarget, slackApi, targetListBlocks } from "./digest";
import { draftIntroAsk, draftPurpose } from "./drafts";

const logger = createLogger("connections/slack-actions");

export const CONNECTION_EDIT_CALLBACK_ID = "connpath_edit_draft";

export function isConnectionPathAction(actionId: string): boolean {
  return actionId.startsWith("connpath_");
}

/**
 * The thread reply holding a draft. `failed` replaces the draft with a line
 * saying so, keeping Regenerate, so a Claude hiccup is one click to retry.
 */
export function draftBlocks(
  p: ConnectionPath,
  draft: string | null,
  opts: { editedBy?: string; failed?: boolean } = {},
): any[] {
  const body = draft
    ? draft
        .split("\n")
        .map((line) => `>${escapeMrkdwn(line)}`)
        .join("\n")
    : "_Couldn't draft this one. Press Regenerate to try again._";
  const note = opts.editedBy
    ? `Edited by <@${opts.editedBy}>. Not sent anywhere: copy it into email or LinkedIn.`
    : "Not sent anywhere. Edit it, then copy it into email or LinkedIn.";
  const email = contactEmail(p);
  return [
    {
      type: "section",
      block_id: `connpath_draft:${p.path_id}`,
      text: { type: "mrkdwn", text: `*Draft ask to ${escapeMrkdwn(p.champion_name)}*` },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            `To: ${email ? `<mailto:${email}|${escapeMrkdwn(email)}>` : "_no email on file_"} · ` +
            `For: ${escapeMrkdwn(draftPurpose(p))}`,
        },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: body } },
    ...(opts.failed ? [] : [{ type: "context", elements: [{ type: "mrkdwn", text: note }] }]),
    {
      type: "actions",
      block_id: `connpath_draft_actions:${p.path_id}`,
      elements: [
        ...(draft
          ? [
              {
                type: "button",
                action_id: "connpath_edit",
                text: { type: "plain_text", text: "Edit" },
                value: editButtonValue(p, draft),
              },
            ]
          : []),
        {
          type: "button",
          action_id: "connpath_regen",
          text: { type: "plain_text", text: "Regenerate" },
          value: p.path_id,
        },
      ],
    },
  ];
}

/**
 * Redraw one digest message from BigQuery: the header as Slack has it, the
 * paths as they now stand. Rebuilt rather than patched, so two people
 * deciding on different paths in the same message cannot overwrite each
 * other's verdict.
 */
async function redrawMessage(
  client: ReplybotClientConfig,
  token: string,
  channel: string,
  ts: string,
  existingBlocks: any[],
): Promise<void> {
  const header = existingBlocks.filter(
    (b) => typeof b?.block_id === "string" && b.block_id.startsWith("connhead"),
  );
  const groups = groupByTarget(await pathsInMessage(ts));
  const isTop = header.some((b) => b.block_id === "connhead_title");
  await slackApi(token, "chat.update", {
    channel,
    ts,
    text: "Warm-intro paths",
    blocks: [
      ...header,
      ...(isTop ? [{ type: "divider" }] : []),
      ...targetListBlocks(groups, client.voice.timezone),
    ],
  });
}

/** Draft the ask and post it, or update the reply already holding it. */
async function postDraft(
  client: ReplybotClientConfig,
  token: string,
  p: ConnectionPath,
): Promise<void> {
  const channel = p.slack_channel;
  const threadTs = p.thread_ts ?? p.slack_ts;
  if (!channel || !threadTs) throw new Error(`path ${p.path_id} has no Slack message`);

  let draft: string | null = null;
  try {
    draft = await draftIntroAsk(p, client.displayName);
  } catch (err) {
    logger.error(
      "connections.draft.failed",
      err instanceof Error ? err : new Error(String(err)),
      { pathId: p.path_id },
    );
  }
  const blocks = draftBlocks(p, draft, { failed: !draft });
  const text = `Draft ask to ${p.champion_name}`;

  if (p.draft_ts) {
    await slackApi(token, "chat.update", { channel, ts: p.draft_ts, text, blocks });
    if (draft) await saveDraft({ pathId: p.path_id, draft });
    return;
  }
  const posted = await slackApi(token, "chat.postMessage", {
    channel,
    thread_ts: threadTs,
    text,
    blocks,
    unfurl_links: false,
  });
  await saveDraft({ pathId: p.path_id, draft: draft ?? "", draftTs: String(posted.ts) });
}

/**
 * Everything the Edit modal needs, carried in the button itself.
 *
 * Slack's trigger_id expires three seconds after the click, and a BigQuery
 * read before views.open can spend most of that. So the modal opens from the
 * button's own value — the draft as shown, which is the one to edit anyway —
 * and the database is only touched on Save. Slack caps a value at 2000
 * characters; drafts are kept far below that, but the cap is respected.
 */
function editButtonValue(p: ConnectionPath, draft: string): string {
  return JSON.stringify({
    p: p.path_id,
    k: p.client_id,
    c: p.champion_name.slice(0, 80),
    f: draftPurpose(p).slice(0, 200),
    d: draft.slice(0, 1500),
  });
}

async function openEditModal(
  token: string,
  triggerId: string,
  p: { pathId: string; champion: string; purpose: string; draft: string },
): Promise<void> {
  await slackApi(token, "views.open", {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: CONNECTION_EDIT_CALLBACK_ID,
      private_metadata: JSON.stringify({ pathId: p.pathId }),
      title: { type: "plain_text", text: "Edit intro ask" },
      submit: { type: "plain_text", text: "Save" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `To ${escapeMrkdwn(p.champion)} · ${escapeMrkdwn(p.purpose)}. Saving updates the draft in Slack. Nothing is sent.`,
            },
          ],
        },
        {
          type: "input",
          block_id: "draft_block",
          label: { type: "plain_text", text: "Draft" },
          element: {
            type: "plain_text_input",
            action_id: "draft_input",
            multiline: true,
            initial_value: p.draft,
          },
        },
      ],
    },
  });
}

/**
 * Open the Edit modal straight from the button. The server awaits this before
 * answering Slack, because views.open needs the click's fresh trigger_id.
 */
export async function handleConnectionEditAction(payload: any): Promise<void> {
  const triggerId = payload?.trigger_id;
  let value: { p?: string; k?: string; c?: string; f?: string; d?: string } = {};
  try {
    value = JSON.parse(payload?.actions?.[0]?.value ?? "{}");
  } catch {
    /* an unparseable value is reported below */
  }
  if (!triggerId || !value.p) {
    logger.warn("connections.action.edit_unusable", { hasTrigger: !!triggerId, hasPath: !!value.p });
    return;
  }
  // A trigger_id only works with the token of the workspace the click came
  // from, which is the workspace the client's digest is posted in.
  const client = value.k ? getReplybotClient(value.k) : undefined;
  if (!client) {
    logger.warn("connections.action.edit_unknown_client", { clientId: value.k });
    return;
  }
  const token = await slackBotTokenFor(client.slackTeamId);
  await openEditModal(token, triggerId, {
    pathId: value.p,
    champion: value.c ?? "",
    purpose: value.f ?? "",
    draft: value.d ?? "",
  });
}

/** Handle a click on any other connpath_ button. Runs after Slack is answered. */
export async function handleConnectionPathAction(payload: any): Promise<void> {
  const action = payload?.actions?.[0];
  const actionId: string = action?.action_id ?? "";
  const pathId: string = action?.value ?? "";
  const userId: string = payload?.user?.id ?? "";

  if (actionId === "connpath_edit") {
    await handleConnectionEditAction(payload);
    return;
  }

  const path = await getPath(pathId);
  if (!path) {
    logger.warn("connections.action.unknown_path", { actionId, pathId });
    return;
  }
  const client = getReplybotClient(path.client_id);
  if (!client) {
    logger.warn("connections.action.unknown_client", { actionId, clientId: path.client_id });
    return;
  }
  const token = await slackBotTokenFor(client.slackTeamId);

  if (actionId === "connpath_good" || actionId === "connpath_bad") {
    const verdict: PathVerdict = actionId === "connpath_good" ? "good" : "not_a_fit";
    const claimed = await claimVerdict({ pathId, verdict, userId });
    const channel = payload?.channel?.id ?? path.slack_channel;
    const ts = payload?.message?.ts ?? path.slack_ts;
    if (channel && ts) {
      await redrawMessage(client, token, channel, ts, payload?.message?.blocks ?? []);
    }
    // Only the click that won drafts: a second click on a path someone just
    // judged must not post a second draft.
    if (claimed && verdict === "good") {
      const fresh = (await getPath(pathId)) ?? path;
      await postDraft(client, token, fresh);
    }
    logger.info("connections.action.verdict", { pathId, verdict, claimed });
    return;
  }

  if (actionId === "connpath_regen") {
    await postDraft(client, token, path);
    return;
  }

  logger.warn("connections.action.unknown", { actionId });
}

/** The Edit modal's submit: save the text, update the thread reply, close. */
export async function handleConnectionDraftSubmit(payload: any): Promise<Record<string, unknown>> {
  let pathId = "";
  try {
    pathId = JSON.parse(payload?.view?.private_metadata || "{}").pathId ?? "";
  } catch {
    /* handled below as an unknown path */
  }
  const edited: string =
    payload?.view?.state?.values?.draft_block?.draft_input?.value?.trim() ?? "";
  if (!edited) {
    return { response_action: "errors", errors: { draft_block: "The draft can't be empty." } };
  }

  const path = pathId ? await getPath(pathId) : null;
  const client = path ? getReplybotClient(path.client_id) : undefined;
  if (!path || !client) {
    logger.warn("connections.edit.unknown_path", { pathId });
    return { response_action: "errors", errors: { draft_block: "This path no longer exists." } };
  }

  await saveDraft({ pathId, draft: edited });
  if (path.slack_channel && path.draft_ts) {
    const token = await slackBotTokenFor(client.slackTeamId);
    await slackApi(token, "chat.update", {
      channel: path.slack_channel,
      ts: path.draft_ts,
      text: `Draft ask to ${path.champion_name}`,
      blocks: draftBlocks(path, edited, { editedBy: payload?.user?.id }),
    });
  }
  return { response_action: "clear" };
}
