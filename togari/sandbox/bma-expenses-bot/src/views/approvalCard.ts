import type { KnownBlock } from "@slack/web-api";
import type { Reimbursement } from "../db/types.js";
import { formatCents } from "../lib/money.js";

export const ACTION = {
  approve: "reimbursement_approve",
  reject: "reimbursement_reject",
  markPaid: "reimbursement_mark_paid",
} as const;

function statusLine(r: Reimbursement): string {
  switch (r.status) {
    case "approved":
      return `:white_check_mark: Approved by <@${r.approver_slack_id}> — payout prep sent.`;
    case "rejected":
      return `:x: Rejected by <@${r.approver_slack_id}>${
        r.reject_reason ? ` — ${r.reject_reason}` : ""
      }.`;
    case "paid":
      return `:moneybag: Paid. Logged to the accounting sheet.`;
    default:
      return ":hourglass_flowing_sand: Awaiting approval.";
  }
}

function detailBlocks(r: Reimbursement): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Reimbursement: ${formatCents(r.amount_cents, r.currency)}`,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Pay to:*\n${r.payee_rho_name}` },
        { type: "mrkdwn", text: `*Requested by:*\n<@${r.slack_user_id}>` },
        {
          type: "mrkdwn",
          text: `*Amount:*\n${formatCents(r.amount_cents, r.currency)}`,
        },
        { type: "mrkdwn", text: `*Request ID:*\n\`${r.id.slice(0, 8)}\`` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*For:*\n${r.memo || "_No memo provided_"}`,
      },
    },
  ];

  if (r.receipt_urls.length) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Receipts:*\n" +
          r.receipt_urls
            .map((url, i) => `<${url}|Receipt ${i + 1}>`)
            .join("  •  "),
      },
    });
  }

  return blocks;
}

/** The interactive approval message posted to the approvals channel. */
export function buildApprovalCard(r: Reimbursement): KnownBlock[] {
  const blocks = detailBlocks(r);
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: statusLine(r) }],
  });

  if (r.status === "pending") {
    blocks.push({
      type: "actions",
      block_id: "approval_actions",
      elements: [
        {
          type: "button",
          action_id: ACTION.approve,
          style: "primary",
          text: { type: "plain_text", text: "Approve" },
          value: r.id,
        },
        {
          type: "button",
          action_id: ACTION.reject,
          style: "danger",
          text: { type: "plain_text", text: "Reject" },
          value: r.id,
        },
      ],
    });
  }

  return blocks;
}

/** The DM the approver receives once a request is approved: payout instructions + Mark paid. */
export function buildPayoutDm(r: Reimbursement, csvLine: string): KnownBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Payout ready to send in Rho*\n` +
          `Pay *${r.payee_rho_name}* ${formatCents(r.amount_cents, r.currency)} for "${
            r.memo || "reimbursement"
          }".`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "Open Rho → Banking → Move Funds → Pay (or use the bulk-transfer import). " +
          "CSV line for the bulk importer:\n```" +
          csvLine +
          "```",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: ACTION.markPaid,
          style: "primary",
          text: { type: "plain_text", text: "Mark paid" },
          value: r.id,
        },
      ],
    },
  ];
}
