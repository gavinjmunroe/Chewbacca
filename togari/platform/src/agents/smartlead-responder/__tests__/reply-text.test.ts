/**
 * Guards the inbound-reply cleanup. The HTML fixture below is the real
 * payload that produced the 2026-09-02 card in #amber-cold-replies —
 * an Apple Mail reply whose markup, signature, confidentiality notice
 * and quoted outbound all landed in the Slack card and the prompt.
 */

import { describe, it, expect } from 'vitest';
import { cleanReplyText, stripEmDashes } from '../reply-text';

const APPLE_MAIL_REPLY = `<html class="apple-mail-supports-explicit-dark-mode"><head><meta http-equiv="content-type" content="text/html; charset=utf-8"></head><body dir="auto">Sure Sagar happy to help give me a call (949) 795-0416 anytime this afternoon after 3pm<div><br><div><div dir="ltr"><div><span style="background-color: rgba(255, 255, 255, 0);">Josh Bois</span></div><div><span style="background-color: rgba(255, 255, 255, 0);">CEO Global Capital Network - &ldquo;Connecting investors to entrepreneurs &amp;amp; deal flow&rdquo;</span></div><div><span>Founder 2030 Ventures, Inc. - &amp;nbsp;"Accelerating Ideas With Capital, Leadership, and Marketing"<br><br><a href="http://www.linkedin.com/in/joshbois" target="_blank">www.linkedin.com/in/joshbois</a><br>(800) 8-EMP-415 | Toll Free<br><br>GLOBAL CAPITAL NETWORK, 2030 VENTURES, INC (2030) Confidentiality&amp;nbsp;<br>Notice:&amp;nbsp; The information contained in this electronic e-mail and any accompanying attachment(s) is intended only for the use of the intended recipient and may be confidential.</span></div></div><div dir="ltr"><br><blockquote type="cite">On Sep 2, 2026, at 2:23 PM, Sagar Tiwari &lt;sagar@bluemodernadvisory.com&gt; wrote:<br><br>Josh, quick one about the $12M in pipeline your Voice AI lab is running.</blockquote></div></div></div></body></html>`;

describe('cleanReplyText', () => {
  it('reduces a real Apple Mail HTML reply to what the prospect actually typed', () => {
    const out = cleanReplyText(APPLE_MAIL_REPLY);

    // The actual reply survives.
    expect(out).toContain('Sure Sagar happy to help give me a call');
    expect(out).toContain('anytime this afternoon after 3pm');

    // No markup or entity debris.
    expect(out).not.toMatch(/[<>]/);
    expect(out).not.toContain('apple-mail');
    expect(out).not.toContain('&nbsp');
    expect(out).not.toContain('&amp');
    expect(out).not.toContain('rgba(');
  });

  it('drops the quoted thread so Claude cannot mistake our outbound for theirs', () => {
    const out = cleanReplyText(APPLE_MAIL_REPLY);
    expect(out).not.toContain('On Sep 2, 2026');
    expect(out).not.toContain('wrote:');
    // This is OUR cold email, quoted back. Drafting against it as though
    // the prospect wrote it is what inverted the voice.
    expect(out).not.toContain('$12M in pipeline');
  });

  it('drops confidentiality boilerplate', () => {
    const out = cleanReplyText(APPLE_MAIL_REPLY);
    expect(out).not.toContain('Confidentiality');
    expect(out).not.toContain('intended recipient');
  });

  it('leaves a plain-text reply alone apart from trimming', () => {
    const plain = 'Thanks for the note. Not a fit right now, but check back in Q1.';
    expect(cleanReplyText(plain)).toBe(plain);
  });

  it('cuts the quoted thread from a plain-text reply too', () => {
    const out = cleanReplyText(
      'Sounds good, call me Tuesday.\n\nOn Sep 1, 2026, at 9:00 AM, Sagar Tiwari <sagar@x.com> wrote:\n> our original pitch',
    );
    expect(out).toBe('Sounds good, call me Tuesday.');
  });

  it('handles Outlook original-message headers', () => {
    const out = cleanReplyText('Interested.\n\n-----Original Message-----\nFrom: Sagar\nSent: Monday');
    expect(out).toBe('Interested.');
  });

  it('keeps paragraph breaks but collapses blank-line rubble', () => {
    expect(cleanReplyText('<div>One</div><div><br></div><div><br></div><div>Two</div>')).toBe('One\n\nTwo');
  });

  it('is safe on empty input', () => {
    expect(cleanReplyText('')).toBe('');
    expect(cleanReplyText(undefined)).toBe('');
    expect(cleanReplyText(null)).toBe('');
  });
});

describe('stripEmDashes', () => {
  it('turns a punctuating em dash into a comma', () => {
    expect(stripEmDashes("I'll give you a ring after 3pm — does 3:30 work?")).toBe(
      "I'll give you a ring after 3pm, does 3:30 work?",
    );
  });

  it('turns a joining dash into a hyphen', () => {
    expect(stripEmDashes('3–4 weeks')).toBe('3-4 weeks');
  });

  it('leaves ordinary hyphens and text alone', () => {
    const s = 'A follow-up call on Tuesday, then we re-assess.';
    expect(stripEmDashes(s)).toBe(s);
  });

  it('does not leave doubled commas behind', () => {
    expect(stripEmDashes('Sure, — happy to help')).toBe('Sure, happy to help');
  });
});
