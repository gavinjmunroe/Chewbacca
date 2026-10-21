import type { MemoEntry } from './memoActions';
import type { AgendaItem } from './agenda';
import type { ConversationSummary } from './conversations';
import type { FeedItem } from './noteShares';
export type DayFeedItem = {
  id: string;
  at: number;
  title: string;
  owner: string;
  kind: 'memo' | 'event' | 'friend';
  memo?: MemoEntry;
  event?: AgendaItem;
  conversationId?: string;
  voice?: boolean | null;
  shared?: FeedItem;
};
export function dayFeed({
  entries,
  events,
  conversations,
  friends,
  start,
  end,
  query,
  mode,
}: {
  entries: MemoEntry[];
  events: AgendaItem[];
  conversations: ConversationSummary[];
  friends: FeedItem[];
  start: number;
  end: number;
  query: string;
  mode: 'mine' | 'friends' | 'all';
}): DayFeedItem[] {
  const sharedItems: DayFeedItem[] = friends.map((item) => ({
    id: `friend:${item.sharedBy.amberId}:${item.noteId}`,
    at: Date.parse(item.sharedAt),
    title: item.transcript,
    owner: item.sharedBy.name,
    kind: 'friend',
    shared: item,
  }));
  const ownItems: DayFeedItem[] = [
    ...entries.map((memo) => ({
      id: `memo:${memo.id}`,
      at: Date.parse(memo.createdAt),
      title: memo.text || 'Voice recording',
      owner: 'You',
      kind: 'memo' as const,
      voice: !!memo.media,
      memo,
    })),
    ...events.map((event) => ({
      id: event.key,
      at: event.startsAt,
      title: event.title,
      owner: 'You',
      kind: 'event' as const,
      event,
    })),
    ...conversations
      .filter(
        (row) =>
          (row.kind ? row.kind === 'note' : row.voice !== false) &&
          !entries.some((memo) => memo.cloud?.conversationId === row.conversationId),
      )
      .map((row) => ({
        id: `conversation:${row.conversationId}`,
        at: Date.parse(row.lastAt || ''),
        title: row.title || row.preview || 'Voice recording',
        owner: 'You',
        kind: 'memo' as const,
        conversationId: row.conversationId,
        voice: row.voice,
      })),
  ];
  const items =
    mode === 'all' ? [...ownItems, ...sharedItems] : mode === 'friends' ? sharedItems : ownItems;
  const seen = new Set<string>();
  return items
    .filter((item) => {
      const overlaps = item.event && (item.event.endsAt ?? item.at) > start;
      if (
        !Number.isFinite(item.at) ||
        item.at >= end ||
        (item.at < start && !overlaps && !item.event?.carriedOver) ||
        seen.has(item.id)
      )
        return false;
      if (
        !`${item.title} ${item.owner} ${item.event?.location || ''}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      )
        return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
