import test from 'node:test';
import assert from 'node:assert/strict';
import { actionKey, blankMemoAction, parseMemoActions, validMemoAction } from './memoActions.ts';
const now = new Date('2026-09-20T10:00:00Z');
const contact = { kind: 'contact', contactId: 'maya', text: 'Maya prefers mornings.' };
const calendar = {
  kind: 'calendar',
  text: 'Coffee at ten for half an hour.',
  title: 'Coffee',
  startsAt: '2026-09-21T10:00:00-07:00',
  endsAt: '2026-09-21T10:30:00-07:00',
};
const parse = (actions: unknown[]) => parseMemoActions(JSON.stringify({ actions }), ['maya'], now);
test('one memo yields independent contact, calendar, and computer drafts', () => {
  assert.deepEqual(
    parse([contact, calendar, { kind: 'task', text: 'Prepare an agenda.' }]).map((a) => a.kind),
    ['contact', 'calendar', 'task'],
  );
});
test('invented contacts, missing dates, invalid ranges and unsupported actions are not actionable', () => {
  assert.deepEqual(
    parse([
      { ...contact, contactId: 'unknown' },
      { ...calendar, startsAt: 'tomorrow' },
      { ...calendar, endsAt: '2026-09-21T09:00:00-07:00' },
      { ...calendar, startsAt: '2026-09-21T10:00:00' },
      { kind: 'send', text: 'send everything' },
    ]),
    [],
  );
});
test('repeated model actions collapse, while different destinations remain independent', () => {
  assert.equal(parse([contact, contact, calendar]).length, 2);
  const a = parse([contact])[0];
  assert.notEqual(actionKey(a), actionKey({ ...a, contactId: 'alex' }));
});
test('receipt keys match original requests across date serialization', () => {
  const a = parse([calendar])[0];
  assert.equal(
    actionKey(a),
    actionKey({
      ...a,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      confirmedAt: now.toISOString(),
      result: 'Saved',
    }),
  );
});
test('manual drafts require their destination and calendar details', () => {
  assert.equal(validMemoAction(blankMemoAction('Remember this', 'contact', now), ['maya']), false);
  assert.equal(validMemoAction(blankMemoAction('Plan this', 'calendar', now), ['maya']), false);
  assert.equal(validMemoAction(blankMemoAction('Prepare an agenda', 'task', now), ['maya']), true);
});
test('malformed model replies are recoverable failures', () => {
  for (const raw of ['oops', 'null', '{}', '{"actions":{}}'])
    assert.throws(() => parseMemoActions(raw, [], now));
});
