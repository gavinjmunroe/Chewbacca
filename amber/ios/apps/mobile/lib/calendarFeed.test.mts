import test from 'node:test';
import assert from 'node:assert/strict';
import { dayFeed } from './calendarFeed.ts';
import { dayBounds, type AgendaItem } from './agenda.ts';
const { start, end } = dayBounds(new Date(2026, 8, 21));
const iso = (n: number) => new Date(start + n).toISOString();
const memo = (id: string, n: number, text = 'Morning thoughts') => ({
  id,
  text,
  createdAt: iso(n),
  destination: 'Journal',
});
const event = (n: number): AgendaItem => ({
  key: 'event',
  source: 'amber',
  title: 'Coffee',
  startsAt: start + n,
  endsAt: start + n + 3600000,
  allDay: false,
  withPerson: null,
  location: 'Park',
  meetingUrl: null,
  virtual: null,
  done: false,
  carriedOver: false,
  kind: 'event',
  accent: null,
  detail: null,
});
const base = {
  entries: [],
  events: [],
  conversations: [],
  friends: [],
  start,
  end,
  query: '',
  mode: 'mine' as const,
};
test('voice memos and plans interleave chronologically without dropping midnight notes', () => {
  const list = dayFeed({
    ...base,
    entries: [memo('later', 7200000), memo('midnight', 0)],
    events: [event(3600000)],
  });
  assert.deepEqual(
    list.map((x) => x.id),
    ['memo:midnight', 'event', 'memo:later'],
  );
});
test('day boundary excludes tomorrow, includes overlapping events, and rejects invalid times', () => {
  const list = dayFeed({
    ...base,
    entries: [
      memo('yesterday', -1),
      memo('tomorrow', end - start),
      { ...memo('bad', 0), createdAt: 'bad' },
    ],
    events: [event(-1800000)],
  });
  assert.deepEqual(
    list.map((x) => x.id),
    ['event'],
  );
});
test('local search filters both memo text and calendar locations, case-insensitively', () => {
  assert.equal(
    dayFeed({ ...base, entries: [memo('a', 1, 'PARK walk')], events: [event(2)], query: ' park ' })
      .length,
    2,
  );
});
test('friends feed never includes private local recordings and searches by friend name', () => {
  const friend = {
    noteId: 'n',
    shareType: 'network' as const,
    transcript: 'Out for a run',
    sharedAt: iso(1),
    sharedBy: { amberId: 'm', name: 'Maya', username: null, avatarUrl: null },
  };
  const list = dayFeed({
    ...base,
    mode: 'friends',
    entries: [memo('private', 1)],
    friends: [friend, friend],
    query: 'maya',
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'friend');
});
test('typed conversations stay out of recording history while legacy unknown entries remain accessible', () => {
  const row = {
    conversationId: 'spoken',
    title: 'Memo',
    lastAt: iso(1),
    messageCount: 1,
    voice: true,
  };
  const list = dayFeed({
    ...base,
    conversations: [
      row,
      { ...row, conversationId: 'typed', voice: false },
      { ...row, conversationId: 'legacy', voice: undefined },
    ],
  });
  assert.deepEqual(list.map((v) => v.conversationId).sort(), ['legacy', 'spoken']);
});
test('a memo saved to Amber appears once while keeping local audio and review actions', () => {
  const local = {
    ...memo('local', 1),
    cloud: { conversationId: 'remote', originalText: 'Morning thoughts', transcriptSaved: true },
  };
  const list = dayFeed({
    ...base,
    entries: [local],
    conversations: [
      {
        conversationId: 'remote',
        title: 'Morning thoughts',
        lastAt: iso(1),
        messageCount: 1,
        voice: true,
      },
    ],
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].memo?.id, 'local');
});

test('one daily timeline interleaves private memos, events and authorized shared updates', () => {
  const friend = {
    noteId: 'shared',
    shareType: 'network' as const,
    transcript: 'Morning run',
    sharedAt: iso(2000),
    sharedBy: { amberId: 'maya', name: 'Maya', username: null, avatarUrl: null },
  };
  const list = dayFeed({
    ...base,
    mode: 'all',
    entries: [memo('mine', 1000)],
    events: [event(3000)],
    friends: [friend],
  });
  assert.deepEqual(
    list.map((item) => item.kind),
    ['memo', 'friend', 'event'],
  );
  assert.equal(
    dayFeed({
      ...base,
      mode: 'all',
      entries: [memo('mine', 1000)],
      friends: [friend],
      query: 'maya',
    })[0].owner,
    'Maya',
  );
});

test('Amber note kind includes typed journals and excludes search chats', () => {
  const row = {
    conversationId: 'note',
    title: 'Typed journal',
    lastAt: iso(1),
    messageCount: 1,
    voice: false,
    kind: 'note',
  };
  const list = dayFeed({
    ...base,
    conversations: [row, { ...row, conversationId: 'search', voice: true, kind: 'chat' }],
  });
  assert.deepEqual(
    list.map((r) => r.conversationId),
    ['note'],
  );
  assert.equal(list[0].voice, false, 'a cloud typed note keeps its note label');
});
