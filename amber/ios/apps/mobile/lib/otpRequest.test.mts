import test from 'node:test';
import assert from 'node:assert/strict';
import { optInMessagesUrl, requestOtpCode } from './otpRequest.ts';

const baseUrl = 'https://identity.example';
const phone = '+13105550100';

test('OTP request delivery outcomes', async (t) => {
  const cases = [
    [200, { ok: true }, 'ok', undefined],
    [200, {}, 'error', "Couldn't send"],
    [200, { ok: false }, 'error', "Couldn't send"],
    [
      503,
      { error: 'delivery_restricted', message: 'private upstream data' },
      'error',
      'contact Amber support',
    ],
    [429, { error: 'rate_limited' }, 'error', '15 minutes'],
    [429, { error: 'resend_cooldown' }, 'error', 'Wait a moment'],
    [
      409,
      { error: 'phone_needs_opt_in', opt_in_url: 'imessage://test', sender_phone: '+13105550101' },
      'optIn',
      undefined,
    ],
    [422, { error: 'phone_not_imessage', message: 'Enable iMessage.' }, 'error', 'Enable iMessage'],
    [502, null, 'error', "Couldn't send"],
    [502, 'not JSON', 'error', "Couldn't send"],
  ] as const;
  for (const [status, body, kind, copy] of cases) {
    await t.test(`${status}: ${JSON.stringify(body)}`, async (t) => {
      t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
        assert.equal(url, `${baseUrl}/v1/auth/otp/request`);
        assert.deepEqual(JSON.parse(init.body as string), { phone });
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
      });
      const result = await requestOtpCode(baseUrl, phone);
      assert.equal(result.kind, kind);
      if (copy && result.kind === 'error') assert.ok(result.message.includes(copy));
      if (result.kind === 'optIn') assert.equal(result.optInUrl, 'imessage://test');
      if (result.kind === 'error') assert.ok(!result.message.includes('private upstream data'));
    });
  }
});

test('network errors explain connection failure', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed');
  });
  const result = await requestOtpCode(baseUrl, phone);
  assert.equal(result.kind, 'error');
  if (result.kind === 'error') assert.match(result.message, /Check your connection/);
});

test('timeout has distinct recovery copy', async (t) => {
  t.mock.method(globalThis, 'setTimeout', ((callback: () => void) => {
    callback();
    return 0;
  }) as typeof setTimeout);
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.equal(init.signal?.aborted, true);
    throw new Error('aborted');
  });
  const result = await requestOtpCode(baseUrl, phone);
  assert.equal(result.kind, 'error');
  if (result.kind === 'error') assert.match(result.message, /took too long/);
});

test('opt-in prefers an SMS link that iOS can prefill and recovers a missing link', () => {
  assert.equal(
    optInMessagesUrl({ opt_in_sms_url: 'sms:+13105550101&body=Hi', opt_in_url: 'imessage://test' }),
    'sms:+13105550101&body=Hi',
  );
  assert.equal(
    optInMessagesUrl({ sender_phone: '+13105550101' }),
    'sms:+13105550101&body=Hi%20Amber',
  );
  assert.equal(
    optInMessagesUrl({ opt_in_url: 'https://unexpected.example', sender_phone: 'invalid' }),
    undefined,
  );
  assert.equal(optInMessagesUrl({ opt_in_url: 'javascript:alert(1)' }), undefined);
});
