import { describe, expect, it } from 'vitest';
import { cleanDeckUrl, companyKey, deckReplyBody } from '../decks';
import { DECK_SEND_ACTION, fitButtons, isReplybotCardAction } from '../../agents/smartlead-responder/fit-review';

describe('deck library helpers', () => {
  it('keys a company the same however it is typed', () => {
    expect(companyKey("Goldie's Good Vibes")).toBe(companyKey('goldies  good vibes'));
  });

  it('accepts only http(s) links', () => {
    expect(cleanDeckUrl(' https://docsend.com/view/abc ')).toBe('https://docsend.com/view/abc');
    expect(cleanDeckUrl('docsend.com/view/abc')).toBeNull();
    expect(cleanDeckUrl('javascript:alert(1)')).toBeNull();
    expect(cleanDeckUrl('')).toBeNull();
  });

  it('writes a short reply with the link and the first name', () => {
    const body = deckReplyBody('Eric Chin', "Goldie's", 'https://x.test/d', 'Jonah');
    expect(body).toContain('Hi Eric,');
    expect(body).toContain("Here's the Goldie's deck: https://x.test/d");
    expect(body.trim().endsWith('Jonah')).toBe(true);
  });
});

describe('deck request card', () => {
  // 2026-10-09: three investors asked for decks and the card only offered
  // "I sent the deck", so each waited on Jonah sending it by hand.
  it('leads with Send the deck, routed to the replybot', () => {
    const buttons = fitButtons('{}', 'deck');
    const [first, second] = buttons;
    expect(buttons).toHaveLength(2);
    expect(first.action_id).toBe(DECK_SEND_ACTION);
    expect(first.text.text).toBe('Send the deck');
    expect(second.text.text).toBe('Already sent');
    expect(isReplybotCardAction(DECK_SEND_ACTION)).toBe(true);
  });

  it('rejects a malformed deck token without a query', async () => {
    const { deckFileByToken } = await import('../decks');
    expect(await deckFileByToken('../etc/passwd')).toBeNull();
  });

  it('leaves other cards alone', () => {
    expect(fitButtons('{}', 'question')[0].text.text).toBe('Reply to this');
  });
});
