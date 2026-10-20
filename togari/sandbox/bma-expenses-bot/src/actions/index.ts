import type { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { isApprover } from "../config.js";
import {
  getReimbursement,
  markPaid,
  setSheetRow,
  transitionFromPending,
} from "../db/client.js";
import type { Reimbursement } from "../db/types.js";
import { appendRow, updateRow } from "../sheets/ledger.js";
import { buildCsv, buildCsvLine } from "../payout/rhoCsv.js";
import {
  ACTION,
  buildApprovalCard,
  buildPayoutDm,
} from "../views/approvalCard.js";
import { formatCents } from "../lib/money.js";

const REJECT_MODAL = "reimbursement_reject_modal";
const REJECT_REASON_BLOCK = "reject_reason_block";
const REJECT_REASON_ACTION = "reject_reason_input";

/** Re-render the approval card in place to reflect the new status. */
async function refreshCard(client: WebClient, r: Reimbursement): Promise<void> {
  if (!r.approval_channel || !r.approval_message_ts) return;
  await client.chat.update({
    channel: r.approval_channel,
    ts: r.approval_message_ts,
    text: `Reimbursement ${r.status}`,
    blocks: buildApprovalCard(r),
  });
}

async function ephemeral(
  client: WebClient,
  channel: string,
  user: string,
  text: string,
): Promise<void> {
  await client.chat.postEphemeral({ channel, user, text });
}

export function registerActions(app: App): void {
  // ---- Approve ----
  app.action(ACTION.approve, async ({ ack, body, action, client }) => {
    await ack();
    const requestId = (action as { value: string }).value;
    const userId = body.user.id;
    const channel = (body as { channel?: { id: string } }).channel?.id ?? "";

    if (!isApprover(userId)) {
      await ephemeral(
        client,
        channel,
        userId,
        "Only approvers can act on reimbursements.",
      );
      return;
    }

    const updated = await transitionFromPending(requestId, {
      status: "approved",
      approver_slack_id: userId,
      approved_at: new Date().toISOString(),
    });
    if (!updated) {
      await ephemeral(
        client,
        channel,
        userId,
        "That request was already handled.",
      );
      return;
    }

    // Log to the accounting sheet, remember the row for the later paid update.
    try {
      const row = await appendRow(updated);
      if (row) {
        await setSheetRow(updated.id, row);
        updated.sheet_row = row;
      }
    } catch (err) {
      console.error("sheet append failed:", err);
      await ephemeral(
        client,
        channel,
        userId,
        "Approved, but writing to the accounting sheet failed. Check the logs.",
      );
    }

    await refreshCard(client, updated);

    // DM the approver the Rho payout instructions + CSV + Mark paid button.
    const csv = buildCsv(updated);
    const dm = await client.conversations.open({ users: userId });
    const dmChannel = (dm as { channel?: { id: string } }).channel?.id;
    if (dmChannel) {
      await client.chat.postMessage({
        channel: dmChannel,
        text: `Payout ready: ${updated.payee_rho_name} ${formatCents(updated.amount_cents)}`,
        blocks: buildPayoutDm(updated, buildCsvLine(updated)),
      });
      await client.files.uploadV2({
        channel_id: dmChannel,
        filename: `rho-payout-${updated.id.slice(0, 8)}.csv`,
        content: csv,
        title: "Rho bulk-transfer import",
      });
    }
  });

  // ---- Reject: open a small modal to capture an optional reason ----
  app.action(ACTION.reject, async ({ ack, body, action, client }) => {
    await ack();
    const requestId = (action as { value: string }).value;
    const userId = body.user.id;
    const channel = (body as { channel?: { id: string } }).channel?.id ?? "";

    if (!isApprover(userId)) {
      await ephemeral(
        client,
        channel,
        userId,
        "Only approvers can act on reimbursements.",
      );
      return;
    }

    await client.views.open({
      trigger_id: (body as { trigger_id: string }).trigger_id,
      view: {
        type: "modal",
        callback_id: REJECT_MODAL,
        private_metadata: requestId,
        title: { type: "plain_text", text: "Reject request" },
        submit: { type: "plain_text", text: "Reject" },
        close: { type: "plain_text", text: "Cancel" },
        blocks: [
          {
            type: "input",
            block_id: REJECT_REASON_BLOCK,
            optional: true,
            label: {
              type: "plain_text",
              text: "Reason (shared with requester)",
            },
            element: {
              type: "plain_text_input",
              action_id: REJECT_REASON_ACTION,
              multiline: true,
            },
          },
        ],
      },
    });
  });

  app.view(REJECT_MODAL, async ({ ack, body, view, client }) => {
    await ack();
    const requestId = view.private_metadata;
    const userId = body.user.id;
    const reason =
      view.state.values[REJECT_REASON_BLOCK]?.[REJECT_REASON_ACTION]?.value ??
      "";

    const updated = await transitionFromPending(requestId, {
      status: "rejected",
      approver_slack_id: userId,
      reject_reason: reason || null,
    });
    if (!updated) return; // already handled

    await refreshCard(client, updated);
    await client.chat.postMessage({
      channel: updated.slack_user_id,
      text: `Your reimbursement request for ${formatCents(
        updated.amount_cents,
      )} was rejected${reason ? `: ${reason}` : "."}`,
    });
  });

  // ---- Mark paid ----
  app.action(ACTION.markPaid, async ({ ack, body, action, client }) => {
    await ack();
    const requestId = (action as { value: string }).value;
    const userId = body.user.id;
    const channel = (body as { channel?: { id: string } }).channel?.id ?? "";

    if (!isApprover(userId)) {
      await ephemeral(
        client,
        channel,
        userId,
        "Only approvers can mark payouts paid.",
      );
      return;
    }

    const updated = await markPaid(requestId);
    if (!updated) {
      await ephemeral(
        client,
        channel,
        userId,
        "That payout was already marked paid.",
      );
      return;
    }

    // Reflect paid status in the sheet row and on the approval card.
    const full = (await getReimbursement(requestId)) ?? updated;
    try {
      if (full.sheet_row) await updateRow(full, full.sheet_row);
    } catch (err) {
      console.error("sheet paid update failed:", err);
    }
    await refreshCard(client, full);
    await client.chat.postMessage({
      channel: full.slack_user_id,
      text: `Your reimbursement of ${formatCents(full.amount_cents)} has been paid.`,
    });
  });
}
