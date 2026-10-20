export type ReimbursementStatus = "pending" | "approved" | "rejected" | "paid";

export interface Reimbursement {
  id: string;
  slack_user_id: string;
  requester_name: string;
  payee_key: string;
  payee_rho_name: string;
  amount_cents: number;
  currency: string;
  memo: string;
  receipt_urls: string[];
  status: ReimbursementStatus;
  approver_slack_id: string | null;
  reject_reason: string | null;
  approval_channel: string | null;
  approval_message_ts: string | null;
  sheet_row: number | null;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export type NewReimbursement = Pick<
  Reimbursement,
  | "slack_user_id"
  | "requester_name"
  | "payee_key"
  | "payee_rho_name"
  | "amount_cents"
  | "currency"
  | "memo"
  | "receipt_urls"
>;
