import { useState } from 'react';
import type { ReactNode } from 'react';
import { ScrollView } from 'react-native';
import { PlanEvents } from './PlanEvents';
import { CalendarMonth } from './CalendarMonth';
import type { MemoEntry } from '../lib/memoActions';
import type { QuickEvent } from './QuickEventSheet';

/** One date control for saved recordings and existing calendar events. */
export function CalendarActivityFeed({
  sample = false,
  entries,
  query,
  onReview,
  onAddMemo,
  onOpenPerson,
  onSync,
  renderDiscussion,
  revision = 0,
}: {
  onOpenPerson?: (id: string) => void;
  sample?: boolean;
  entries: MemoEntry[];
  query: string;
  onAddMemo?: (context: import('../lib/memoContext').MemoContext) => void;
  onReview: (entry: MemoEntry) => void;
  onSync?: (entry: MemoEntry) => Promise<void>;
  renderDiscussion?: (entry: MemoEntry) => ReactNode;
  sampleEvents?: QuickEvent[];
  revision?: number;
}) {
  const [day, setDay] = useState(new Date());
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24, gap: 16 }}
    >
      <CalendarMonth day={day} onChange={setDay} />
      <PlanEvents
        onOpenPerson={onOpenPerson}
        onAddMemo={onAddMemo}
        day={day}
        sample={sample}
        revision={revision}
        query={query}
      />
    </ScrollView>
  );
}
