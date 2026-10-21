import test from 'node:test';
import assert from 'node:assert/strict';
import { fromAmberEvent } from './agenda.ts';
test('Google events preserve provenance and never open an Amber-only editor', () => {
  const event = fromAmberEvent({
    id: 'google-event',
    provider: 'google',
    title: 'Test',
    startsAt: '2026-09-30T06:00:00Z',
  });
  assert.equal(event?.provider, 'google');
  assert.equal(event?.detail, null);
  assert.ok(
    fromAmberEvent({ id: 'local', provider: 'capture', startsAt: '2026-09-30T06:00:00Z' })?.detail,
  );
});
