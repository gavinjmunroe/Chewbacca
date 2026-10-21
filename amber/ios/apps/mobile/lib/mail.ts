import { callMedhaId } from './medhaId';
export type MailAccount = {
  accountId: string; email: string | null; lastSyncedAt: string | null;
  lastError: string | null; readsContents: boolean; neverSynced: boolean;
};
export type MailSync = { accounts: { accountId: string; ok: boolean; counted?: number; more?: boolean }[] };
export const getMailAccounts = () => callMedhaId<{ accounts: MailAccount[] }>({
  path: '/v1/me/mail/accounts', requireAuth: true,
});
export const syncMail = () => callMedhaId<MailSync>({
  path: '/v1/me/mail/sync', method: 'POST', requireAuth: true, timeoutMs: 120000, retries: 0,
});
export function mailSyncMessage(result: MailSync): string {
  if (!Array.isArray(result.accounts) || !result.accounts.length) return 'No Gmail mailbox was synced. Connect Google with Gmail access first.';
  if (result.accounts.some(a => !a.ok)) return 'Some mailboxes need attention. Reconnect Google with Gmail access, then retry.';
  return result.accounts.some(a => a.more)
    ? 'Gmail synced. More history is available; sync again to continue.'
    : 'Gmail synced. Your relationship activity is up to date.';
}
