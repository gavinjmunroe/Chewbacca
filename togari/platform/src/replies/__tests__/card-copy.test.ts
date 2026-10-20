import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanLine, deckButtonLabel, deckLabelFallback, isAutoReply, winFallback, winLine } from '../card-copy';

afterEach(() => { vi.unstubAllGlobals(); delete process.env.ANTHROPIC_API_KEY; delete process.env.CARD_COPY_LIVE; });

function model(text: string) {
  process.env.ANTHROPIC_API_KEY = 'test';
  process.env.CARD_COPY_LIVE = '1';
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ content: [{ text }] }) }) as any);
}

describe('card copy', () => {
  it('says upload when no deck is on file', () => {
    expect(deckLabelFallback('Qube', false)).toBe('Paste link and send the Qube deck');
    expect(deckLabelFallback('Qube', true)).toBe('Send the Qube deck');
  });

  it('uses the model label when it passes the rules', async () => {
    model('Paste link and send Qube deck');
    expect(await deckButtonLabel('Qube', false)).toBe('Paste link and send Qube deck');
  });

  it('falls back when the label never names the company', async () => {
    model('Paste link and send deck to investor');
    expect(await deckButtonLabel('Qube Finance', false)).toBe('Paste link and send the Qube Finance deck');
  });

  it('falls back when the label never says send', async () => {
    model('Upload Qube Finance deck');
    expect(await deckButtonLabel('Qube', false)).toBe('Paste link and send the Qube deck');
  });

  it('tells an out-of-office notice from a person', () => {
    expect(isAutoReply('I am out of the office until October 12th with limited access to email.')).toBe(true);
    expect(isAutoReply("I'll take a look. I'm traveling internationally for the next 3 weeks. Ball in my court.")).toBe(false);
  });

  it('falls back when the model drops the upload step', async () => {
    model('Send the Qube deck');
    expect(await deckButtonLabel('Qube', false)).toBe('Paste link and send the Qube deck');
  });

  it('falls back with no key, no network, and never throws', async () => {
    expect(await deckButtonLabel('Qube', true)).toBe('Send the Qube deck');
  });

  it('rejects em dashes, emoji and invented numbers', () => {
    expect(cleanLine('Sent it — done', 50)).toBeNull();
    expect(cleanLine('Sent it 🔥', 50)).toBeNull();
    expect(cleanLine('Raised 3 rounds', 50, ['nothing'])).toBeNull();
    expect(cleanLine('Follows up Oct 30', 50, ['Oct 30'])).toBe('Follows up Oct 30');
  });

  it('writes a win line, or the template when the model misbehaves', async () => {
    const w = { kind: 'later' as const, leadName: 'Clive Fleissig', company: 'Vertocol', replyText: 'Traveling 3 weeks, ball in my court', followUpOn: new Date('2026-10-30T16:00:00Z') };
    model('Clive is in after his trip — Togari follows up');
    expect(await winLine(w)).toBe(winFallback(w));
    model('Clive is open to Vertocol after his trip. Togari follows up Oct 30.');
    expect(await winLine(w)).toBe('Clive is open to Vertocol after his trip. Togari follows up Oct 30.');
  });
});
