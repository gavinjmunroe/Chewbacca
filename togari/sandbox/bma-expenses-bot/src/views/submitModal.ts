import type { View } from "@slack/web-api";
import { PAYEES } from "../config.js";

export const SUBMIT_CALLBACK_ID = "reimburse_submit";

export const BLOCK = {
  payee: "payee_block",
  amount: "amount_block",
  memo: "memo_block",
  receipts: "receipts_block",
} as const;

export const ACTION = {
  payee: "payee_select",
  amount: "amount_input",
  memo: "memo_input",
  receipts: "receipts_input",
} as const;

/**
 * The reimbursement request modal. Payee is a fixed picker sourced from the pre-registered
 * Rho contacts (config.ts) so we never collect bank details in Slack. Receipts use Slack's
 * native file_input so images/PDFs attach inline.
 */
export function buildSubmitModal(): View {
  const payeeOptions = PAYEES.map((p) => ({
    text: { type: "plain_text" as const, text: p.label },
    value: p.key,
  }));

  const payeeElement = payeeOptions.length
    ? {
        type: "static_select" as const,
        action_id: ACTION.payee,
        placeholder: {
          type: "plain_text" as const,
          text: "Select who gets paid",
        },
        options: payeeOptions,
      }
    : {
        // No payees configured yet: still render so the modal opens, but it cannot submit.
        type: "static_select" as const,
        action_id: ACTION.payee,
        placeholder: {
          type: "plain_text" as const,
          text: "No payees configured",
        },
        options: [
          {
            text: { type: "plain_text" as const, text: "No payees configured" },
            value: "__none__",
          },
        ],
      };

  return {
    type: "modal",
    callback_id: SUBMIT_CALLBACK_ID,
    title: { type: "plain_text", text: "Request reimbursement" },
    submit: { type: "plain_text", text: "Submit" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: BLOCK.payee,
        label: { type: "plain_text", text: "Pay to" },
        element: payeeElement,
      },
      {
        type: "input",
        block_id: BLOCK.amount,
        label: { type: "plain_text", text: "Amount (USD)" },
        element: {
          type: "plain_text_input",
          action_id: ACTION.amount,
          placeholder: { type: "plain_text", text: "e.g. 124.50" },
        },
      },
      {
        type: "input",
        block_id: BLOCK.memo,
        label: { type: "plain_text", text: "What was it for?" },
        element: {
          type: "plain_text_input",
          action_id: ACTION.memo,
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Client dinner, software, travel...",
          },
        },
      },
      {
        type: "input",
        block_id: BLOCK.receipts,
        label: { type: "plain_text", text: "Receipt(s)" },
        element: {
          type: "file_input",
          action_id: ACTION.receipts,
          filetypes: ["png", "jpg", "jpeg", "heic", "pdf", "webp"],
          max_files: 10,
        },
      },
    ],
  };
}
