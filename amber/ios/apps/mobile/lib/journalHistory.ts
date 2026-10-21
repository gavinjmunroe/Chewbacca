import { callMedhaId } from './medhaId';
import type { ConversationSummary } from './conversations';
export type JournalCursor = { before: string; beforeId: string };
export function listJournalHistory(options: {
  day?: Date;
  cursor?: JournalCursor;
  signal?: AbortSignal;
}) {
  const parts: string[] = [];
  if (options.day) {
    const start = new Date(
      options.day.getFullYear(),
      options.day.getMonth(),
      options.day.getDate(),
    );
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    parts.push(`from=${encodeURIComponent(start.toISOString())}`);
    parts.push(`to=${encodeURIComponent(end.toISOString())}`);
  }
  if (options.cursor) {
    parts.push(`before=${encodeURIComponent(options.cursor.before)}`);
    parts.push(`beforeId=${encodeURIComponent(options.cursor.beforeId)}`);
  }
  return callMedhaId<{ conversations: ConversationSummary[]; next: JournalCursor | null }>({
    path: `/v1/me/journal${parts.length ? `?${parts.join('&')}` : ''}`,
    method: 'GET',
    requireAuth: true,
    signal: options.signal,
    timeoutMs: 20000,
    retries: 0,
  });
}
