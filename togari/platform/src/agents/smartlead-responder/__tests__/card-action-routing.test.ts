import { describe, expect, it } from 'vitest';
import { fitButtons, isReplybotCardAction, sendButtons } from '../fit-review';
import type { ReplybotClientConfig } from '../../replybot/client-config';

// sendButtons reads only sendMethods.
const clay = { sendMethods: ['clay'] } as unknown as ReplybotClientConfig;
const gmail = { sendMethods: ['gmail'] } as unknown as ReplybotClientConfig;

// Every button a reply card can show must be routed to the replybot by the
// interactivity endpoint. The handler tests press buttons by calling the
// handler directly, which is how a Good fit button that the server never
// routed shipped and sat dead in front of Jonah on 2026-10-08.
describe('reply card buttons reach the handler', () => {
  const buttons = [
    ...fitButtons('{}'),
    ...sendButtons(clay, '{}'),
    ...sendButtons(gmail, '{}'),
  ];

  for (const b of buttons) {
    it(`routes ${b.action_id}`, () => {
      expect(isReplybotCardAction(b.action_id)).toBe(true);
    });
  }

  it('routes the done button an off-email task shows', () => {
    for (const b of fitButtons('{}', 'deck')) expect(isReplybotCardAction(b.action_id)).toBe(true);
  });

  it('offers the task, not Reply / Skip, when the next step is not an email', () => {
    expect(fitButtons('{}', 'deck').map((b) => b.text.text)).toEqual(['Send the deck', 'Already sent']);
    expect(fitButtons('{}', 'form').map((b) => b.text.text)).toEqual(['I filled out the form', 'Send a holding reply']);
    expect(fitButtons('{}', 'question').map((b) => b.text.text)).toEqual(['Reply to this', 'Skip, no reply']);
  });

  it('says what the button does', () => {
    const labels = fitButtons('{}').map((b) => b.text.text);
    expect(labels).toEqual(['Reply to this', 'Skip, no reply']);
  });
});
