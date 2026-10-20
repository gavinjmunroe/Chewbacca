import { describe, expect, it } from 'vitest';
import { cleanLeadName, feederAppendsE } from '../lead-name';

describe('lead name cleanup', () => {
  // Real rows from 10/9: the feeder added an "e" to every name.
  it('strips the stray e when the email agrees', () => {
    expect(cleanLeadName('Gary Zimmermane', 'gary.zimmerman@sixtreesventures.com')).toBe('Gary Zimmerman');
    expect(cleanLeadName('Eric Chine', 'echin@crosslinkcapital.com')).toBe('Eric Chin');
    expect(cleanLeadName('Brendan Dunne', 'bdunn@holdun.com')).toBe('Brendan Dunn');
    expect(cleanLeadName('B. P.e', 'b@dvrgntventures.com')).toBe('B. P.');
  });

  it('strips it everywhere for a client whose feeder adds it', () => {
    expect(cleanLeadName('Jeremy Jonkere', 'jeremy@infinityvc.capital', true)).toBe('Jeremy Jonker');
    expect(cleanLeadName('Hunter Walke', 'hunter@homebrew.co', true)).toBe('Hunter Walk');
    expect(cleanLeadName('Philipp Rose', 'philipp.rose@de.bosch.com', true)).toBe('Philipp Rose');
  });

  it('keeps a real name that ends in e', () => {
    expect(cleanLeadName('Philipp Rose', 'philipp.rose@de.bosch.com')).toBe('Philipp Rose');
    expect(cleanLeadName('Leslie Moore', 'leslie@x.test')).toBe('Leslie Moore');
  });

  it('spots a feeder that adds e to every name', () => {
    expect(feederAppendsE(['Hunter Walke', 'Jeremy Jonkere', 'Eric Chine', 'Jack Mclellande', 'Sean Barrette', 'John Lowee', 'Gary Bradskie', 'Mike Freemane'])).toBe(true);
    expect(feederAppendsE(['Hunter Walk', 'Jeremy Jonker', 'Philipp Rose', 'Jack Mclellan', 'Sean Barrett', 'John Lowe', 'Gary Bradski', 'Mike Freeman'])).toBe(false);
  });
});
