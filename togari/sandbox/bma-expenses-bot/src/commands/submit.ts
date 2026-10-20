import type { App } from "@slack/bolt";
import { env } from "../env.js";
import { findPayee } from "../config.js";
import { parseAmountToCents } from "../lib/money.js";
import { archiveReceipts, type SlackFile } from "../lib/receipts.js";
import { createReimbursement } from "../db/client.js";
import { buildApprovalCard } from "../views/approvalCard.js";
import {
  ACTION,
  BLOCK,
  SUBMIT_CALLBACK_ID,
  buildSubmitModal,
} from "../views/submitModal.js";
import { supabase } from "../db/client.js";

export function registerSubmit(app: App): void {
  // /reimburse -> open the request modal.
  app.command("/reimburse", async ({ ack, body, client }) => {
    await ack();
    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildSubmitModal(),
    });
  });

  // Modal submission -> validate, persist, post approval card.
  app.view(SUBMIT_CALLBACK_ID, async ({ ack, body, view, client }) => {
    const values = view.state.values;
    const payeeKey =
      values[BLOCK.payee]?.[ACTION.payee]?.selected_option?.value ?? "";
    const amountRaw = values[BLOCK.amount]?.[ACTION.amount]?.value ?? "";
    const memo = values[BLOCK.memo]?.[ACTION.memo]?.value ?? "";
    const files = (values[BLOCK.receipts]?.[ACTION.receipts]?.files ??
      []) as SlackFile[];

    const payee = findPayee(payeeKey);
    const amountCents = parseAmountToCents(amountRaw);

    // Inline validation -> Slack renders these under the offending field.
    const errors: Record<string, string> = {};
    if (!payee) errors[BLOCK.payee] = "Pick a configured payee.";
    if (amountCents === null)
      errors[BLOCK.amount] = "Enter a positive amount like 124.50.";
    if (!files.length) errors[BLOCK.receipts] = "Attach at least one receipt.";
    if (Object.keys(errors).length) {
      await ack({ response_action: "errors", errors });
      return;
    }

    await ack();

    const requesterId = body.user.id;
    let requesterName = body.user.name;
    try {
      const info = await client.users.info({ user: requesterId });
      requesterName = info.user?.real_name || info.user?.name || requesterName;
    } catch {
      // Non-fatal: fall back to the handle.
    }

    const request = await createReimbursement({
      slack_user_id: requesterId,
      requester_name: requesterName,
      payee_key: payee!.key,
      payee_rho_name: payee!.rhoName,
      amount_cents: amountCents!,
      currency: "USD",
      memo,
      receipt_urls: [],
    });

    const receiptUrls = await archiveReceipts(files, request.id);
    if (receiptUrls.length) {
      await supabase
        .from("reimbursements")
        .update({ receipt_urls: receiptUrls })
        .eq("id", request.id);
      request.receipt_urls = receiptUrls;
    }

    const posted = await client.chat.postMessage({
      channel: env.slack.approvalsChannelId,
      text: `New reimbursement request from ${requesterName}`,
      blocks: buildApprovalCard(request),
    });

    // Remember where the card lives so the action handlers can update it in place.
    await supabase
      .from("reimbursements")
      .update({
        approval_channel: posted.channel,
        approval_message_ts: posted.ts,
      })
      .eq("id", request.id);

    // Confirm to the requester.
    await client.chat.postMessage({
      channel: requesterId,
      text: `Your reimbursement request for $${(amountCents! / 100).toFixed(
        2,
      )} was submitted and is awaiting approval.`,
    });
  });
}
