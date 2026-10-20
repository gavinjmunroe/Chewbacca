import { describe, it, expect, afterEach, vi } from 'vitest';
import { deleteOldLayoutZeutaraCards, OLD_LAYOUT_CARD_TS } from '../one-off-cleanup';

afterEach(() => vi.unstubAllGlobals());

describe('one-off Zeutara card cleanup', () => {
  it('deletes exactly the nine listed cards in #zeutara-cold-replies, with our token', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-home';
    const calls: any[] = [];
    vi.stubGlobal('fetch', (url: any, init: any) => {
      calls.push({ url: String(url), auth: init.headers.Authorization, body: JSON.parse(init.body) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) } as any);
    });
    expect(await deleteOldLayoutZeutaraCards()).toBe(9);
    expect(calls.every((c) => c.url.endsWith('/chat.delete'))).toBe(true);
    expect(calls.every((c) => c.body.channel === 'C0C7RGTR7J8' && c.auth === 'Bearer xoxb-home')).toBe(true);
    expect(calls.map((c) => c.body.ts)).toEqual(OLD_LAYOUT_CARD_TS);
  });

  it('treats an already-deleted card as done', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-home';
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ json: () => Promise.resolve({ ok: false, error: 'message_not_found' }) } as any),
    );
    expect(await deleteOldLayoutZeutaraCards()).toBe(0);
  });
});
