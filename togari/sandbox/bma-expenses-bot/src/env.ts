import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

const socketMode =
  optional("SLACK_SOCKET_MODE", "true").toLowerCase() === "true";

export const env = {
  slack: {
    botToken: required("SLACK_BOT_TOKEN"),
    signingSecret: required("SLACK_SIGNING_SECRET"),
    appToken: socketMode
      ? required("SLACK_APP_TOKEN")
      : optional("SLACK_APP_TOKEN"),
    socketMode,
    approvalsChannelId: required("APPROVALS_CHANNEL_ID"),
    approverIds: required("APPROVER_SLACK_IDS")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  },
  supabase: {
    url: required("SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    receiptsBucket: optional("SUPABASE_RECEIPTS_BUCKET", "receipts"),
  },
  sheets: {
    sheetId: required("GOOGLE_SHEET_ID"),
    tab: optional("GOOGLE_SHEET_TAB", "Reimbursements"),
    serviceAccountJson: optional("GOOGLE_SERVICE_ACCOUNT_JSON"),
    credentialsPath: optional("GOOGLE_APPLICATION_CREDENTIALS"),
  },
  port: Number(optional("PORT", "3000")),
} as const;
