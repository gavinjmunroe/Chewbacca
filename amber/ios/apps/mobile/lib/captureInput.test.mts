import test from 'node:test';
import assert from 'node:assert/strict';
import { captureContacts, validateCaptureFile } from './captureInput.ts';
import { oauthCallbackStatus } from './oauthCallback.ts';
import { parseMemoActions, validMemoAction } from './memoActions.ts';
test('capture narrows thousands of contacts to matching names and leaves unknown names unresolved', () => {
  const contacts = Array.from({ length: 2300 }, (_, i) => ({ id: String(i), name: `Person ${i}` }));
  contacts.push({ id: 'maya', name: 'Maya Chen' });
  assert.deepEqual(captureContacts('Maya Chen prefers mornings.', contacts), [
    { id: 'maya', name: 'Maya Chen' },
  ]);
  assert.equal(captureContacts('Remember this.', contacts).length, 0);
  assert.equal(captureContacts('Person', contacts).length, 50);
  const [draft] = parseMemoActions(
    JSON.stringify({ actions: [{ kind: 'contact', text: 'Sam loves jazz.', contactId: '' }] }),
    [],
  );
  assert.equal(draft.kind, 'contact');
  assert.equal(validMemoAction(draft, []), false);
});
test('attachments reject oversized and unsupported files and infer audio MIME from extension', () => {
  const file = { name: 'memo.mp3', mimeType: '', size: 3, data: 'YWJj' };
  assert.equal(validateCaptureFile(file).mimeType, 'audio/mpeg');
  assert.throws(() => validateCaptureFile({ ...file, size: 9 * 1024 * 1024 }), /8 MB/);
  assert.throws(() => validateCaptureFile({ ...file, name: 'run.exe' }), /Choose/);
});
test('OAuth success requires the exact app callback, provider and success state', () => {
  assert.equal(
    oauthCallbackStatus('amber://oauth-callback?platform=google&status=connected', 'google'),
    'connected',
  );
  for (const url of [
    'https://oauth-callback?platform=google&status=connected',
    'amber://wrong?platform=google&status=connected',
    'amber://oauth-callback?platform=microsoft&status=connected',
    'amber://oauth-callback?platform=google&status=error',
  ])
    assert.equal(oauthCallbackStatus(url, 'google'), 'failed');
});
