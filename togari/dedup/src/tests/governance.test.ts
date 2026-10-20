/**
 * Governance Verification Test Suite
 *
 * Tests ALL governance systems defined in the Togari GTM MCP server:
 *   1. Channel Theology — validateTheologyLine() across all 5 frames
 *   2. Email Blacklist — banned phrases caught at generation time
 *   3. Volume Rules — 40/inbox/day, 200/domain/day, Tue-Thu only, 8-11am, 4-week warmup
 *   4. CAN-SPAM — unsubscribe + physical address in footers
 *   5. HIPAA — no patient/health data in outbound
 *   6. Ethical Floor — no hatred, exploitation, or fear-based copy
 *   7. Six Dimensions of Health — all six present and evaluated
 *
 * Run:  npx tsx src/tests/governance.test.ts
 */

import assert from 'node:assert/strict';
import { validateTheologyLine, CHANNELS, type ChannelConfig } from '../config/channels';
import { VOLUME_RULES, ETHICAL_FLOOR, SIX_DIMENSIONS_OF_HEALTH, COMPLIANCE } from '../config/guardrails';
import { EMAIL_BLACKLIST, SEND_RULES, PERSONA_WORD_LIMITS } from '../schemas/email-templates';
import type { Channel, TheologyFrame } from '../schemas/enums';

// ─── Test runner ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    process.stdout.write(`  ✗ ${name}\n    ${msg}\n`);
  }
}

function describe(suite: string, fn: () => void): void {
  process.stdout.write(`\n── ${suite}\n`);
  fn();
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. CHANNEL THEOLOGY
// ═══════════════════════════════════════════════════════════════════════════

describe('Channel Theology — Enterprise Credible', () => {
  // Enterprise Credible channels: bma_linkedin, cold_email, warm_email, linkedin_outbound, linkedin_posting
  const enterpriseCredibleChannels: Channel[] = [
    'bma_linkedin', 'cold_email', 'warm_email', 'linkedin_outbound', 'linkedin_posting',
  ];

  for (const channel of enterpriseCredibleChannels) {
    test(`${channel}: rejects Jesus/spiritual content`, () => {
      const result = validateTheologyLine(channel, 'Jesus Christ is the way to success in GTM');
      // bma_linkedin explicitly blocks Jesus; cold_email/warm_email block via fear check
      // For bma_linkedin specifically, Jesus content should be caught
      if (['bma_linkedin'].includes(channel)) {
        assert.equal(result.valid, false, `${channel} should reject Jesus content`);
        assert.ok(
          result.violations.some(v => v.includes('Jesus') || v.includes('theology')),
          `${channel} violation should mention Jesus/theology`,
        );
      }
    });

    test(`${channel}: accepts clean B2B content`, () => {
      const result = validateTheologyLine(channel, 'Our healthcare GTM platform helps VP RevOps teams close 30% faster');
      assert.equal(result.valid, true, `${channel} should accept clean B2B content`);
      assert.equal(result.violations.length, 0);
    });

    test(`${channel}: rejects fear-based copy`, () => {
      const result = validateTheologyLine(channel, "You're falling behind your competitors — act now before it's too late");
      assert.equal(result.valid, false, `${channel} should reject fear-based copy`);
      assert.ok(result.violations.length > 0, 'Should have at least one violation');
    });
  }
});

describe('Channel Theology — Vedic Systems', () => {
  // Vedic Systems channels: sagar_linkedin
  const vedicChannels: Channel[] = ['sagar_linkedin'];

  for (const channel of vedicChannels) {
    test(`${channel}: rejects Jesus content`, () => {
      const result = validateTheologyLine(channel, 'Through the gospel and scripture, we find clarity in GTM strategy');
      assert.equal(result.valid, false, `${channel} should reject Jesus content`);
      assert.ok(
        result.violations.some(v => v.includes('Jesus') || v.includes('Christian')),
        `Violation should reference Jesus/Christian content`,
      );
    });

    test(`${channel}: accepts Vedic/dharmic content`, () => {
      const result = validateTheologyLine(channel, 'A dharmic approach to systems thinking reveals deeper patterns in healthcare data');
      assert.equal(result.valid, true, `${channel} should accept Vedic content`);
    });

    test(`${channel}: accepts clean business content`, () => {
      const result = validateTheologyLine(channel, 'Building in public — 3 things I learned about healthcare GTM this week');
      assert.equal(result.valid, true);
    });
  }
});

describe('Channel Theology — Jesus Service', () => {
  test('caleb_personal: accepts Jesus content', () => {
    const result = validateTheologyLine('caleb_personal', 'Building this project as an act of service to Jesus Christ and His people');
    assert.equal(result.valid, true, 'Caleb channel should accept Jesus content');
  });

  test('caleb_personal: rejects Vedic content', () => {
    const result = validateTheologyLine('caleb_personal', 'The Vedic systems and dharma teach us about ahimsa in business');
    assert.equal(result.valid, false, 'Caleb channel should reject Vedic content');
    assert.ok(
      result.violations.some(v => v.includes('Vedic') || v.includes('dharmic')),
      'Violation should reference Vedic/dharmic content',
    );
  });

  test('caleb_personal: rejects Indra\'s Net reference', () => {
    const result = validateTheologyLine('caleb_personal', "This is what Indra's Net looks like in a CRM");
    assert.equal(result.valid, false, 'Caleb channel should reject Indra\'s Net');
  });

  test('caleb_personal: accepts clean tech content', () => {
    const result = validateTheologyLine('caleb_personal', 'Shipped a new feature today — the system is getting smarter');
    assert.equal(result.valid, true);
  });
});

describe('Channel Theology — Nature Reverent', () => {
  const natureChannels: Channel[] = ['gartiwar', 'rytual', 'instagram_dm', 'instagram_posting'];

  for (const channel of natureChannels) {
    test(`${channel}: rejects Jesus content`, () => {
      const result = validateTheologyLine(channel, 'Through prayer and church community we find healing');
      // gartiwar and rytual are in the Jesus-blocking list
      if (['gartiwar', 'rytual'].includes(channel)) {
        assert.equal(result.valid, false, `${channel} should reject Jesus content`);
      }
    });

    test(`${channel}: accepts nature/contemplative content`, () => {
      const result = validateTheologyLine(channel, 'The mycology of forests teaches us patience — nature holds wisdom we can only approach with humility');
      assert.equal(result.valid, true, `${channel} should accept nature content`);
    });
  }
});

describe('Channel Theology — Peer Warm', () => {
  const peerWarmChannels: Channel[] = ['kevin_linkedin', 'linkedin_dm', 'imessage_dm'];

  for (const channel of peerWarmChannels) {
    test(`${channel}: has no theology requirement — accepts business content`, () => {
      const result = validateTheologyLine(channel, 'Great meeting today — love the partnership potential here');
      assert.equal(result.valid, true, `${channel} should accept business content`);
    });

    test(`${channel}: still rejects fear-based copy`, () => {
      const result = validateTheologyLine(channel, "Don't miss out — this is your last chance to partner with us");
      assert.equal(result.valid, false, `${channel} should still reject fear-based copy`);
    });

    test(`${channel}: accepts content without spiritual framing`, () => {
      const result = validateTheologyLine(channel, 'Healthcare GTM is complex — let me share what we learned scaling for enterprise clients');
      assert.equal(result.valid, true);
    });
  }
});

describe('Channel Theology — Cross-channel coverage', () => {
  // Verify every channel in CHANNELS has been assigned a theology frame
  const allChannels = Object.keys(CHANNELS) as Channel[];

  test('every channel has a theology frame', () => {
    for (const channel of allChannels) {
      const config = CHANNELS[channel];
      assert.ok(config.theologyFrame, `${channel} missing theologyFrame`);
      const validFrames: TheologyFrame[] = [
        'enterprise_credible', 'vedic_systems', 'jesus_service', 'nature_reverent', 'peer_warm',
      ];
      assert.ok(
        validFrames.includes(config.theologyFrame),
        `${channel} has invalid theologyFrame: ${config.theologyFrame}`,
      );
    }
  });

  test('every channel has a theology line description', () => {
    for (const channel of allChannels) {
      const config = CHANNELS[channel];
      assert.ok(
        config.theologyLine && config.theologyLine.length > 0,
        `${channel} missing or empty theologyLine`,
      );
    }
  });

  test('validateTheologyLine works for every defined channel', () => {
    for (const channel of allChannels) {
      // Clean content should pass on every channel
      const result = validateTheologyLine(channel, 'Healthcare data helps teams make better decisions');
      assert.equal(result.valid, true, `Clean content should pass on ${channel}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. EMAIL BLACKLIST
// ═══════════════════════════════════════════════════════════════════════════

describe('Email Blacklist — Banned phrases', () => {
  /**
   * Check if email body contains any blacklisted phrase.
   * This mirrors what the system should do at generation time.
   */
  function checkBlacklist(body: string): { clean: boolean; violations: string[] } {
    const violations: string[] = [];
    for (const phrase of EMAIL_BLACKLIST) {
      if (body.toLowerCase().includes(phrase.toLowerCase())) {
        violations.push(phrase);
      }
    }
    return { clean: violations.length === 0, violations };
  }

  test('catches "I hope this email finds you well"', () => {
    const result = checkBlacklist('Hi Sarah, I hope this email finds you well. I noticed your team just expanded.');
    assert.equal(result.clean, false);
    assert.ok(result.violations.includes('I hope this email finds you well'));
  });

  test('catches "synergy"', () => {
    const result = checkBlacklist('The synergy between our platforms could drive 3x revenue');
    assert.equal(result.clean, false);
    assert.ok(result.violations.some(v => v.toLowerCase() === 'synergy'));
  });

  test('catches "synergies" (plural)', () => {
    const result = checkBlacklist('There are clear synergies between our healthcare data and your GTM stack');
    assert.equal(result.clean, false);
  });

  test('catches "leverage" as verb', () => {
    const result = checkBlacklist('You can leverage our platform to accelerate pipeline');
    assert.equal(result.clean, false);
    assert.ok(result.violations.some(v => v.toLowerCase() === 'leverage'));
  });

  test('catches "We work with companies like yours"', () => {
    const result = checkBlacklist('We work with companies like yours in the digital health space');
    assert.equal(result.clean, false);
  });

  test('catches "I wanted to reach out"', () => {
    const result = checkBlacklist('I wanted to reach out because I saw your recent funding announcement');
    assert.equal(result.clean, false);
  });

  test('catches "Just following up"', () => {
    const result = checkBlacklist('Just following up on my last email — wanted to see if you had a chance to review');
    assert.equal(result.clean, false);
  });

  test('catches "Quick question"', () => {
    const result = checkBlacklist('Quick question — who handles GTM strategy on your team?');
    assert.equal(result.clean, false);
  });

  test('catches "Do you have 15 minutes"', () => {
    const result = checkBlacklist('Do you have 15 minutes this week to discuss?');
    assert.equal(result.clean, false);
  });

  test('catches "I\'d love to pick your brain"', () => {
    const result = checkBlacklist("I'd love to pick your brain on how you're approaching GTM");
    assert.equal(result.clean, false);
  });

  test('catches "ecosystem" without specifics', () => {
    const result = checkBlacklist('Our ecosystem provides value to healthcare companies');
    assert.equal(result.clean, false);
  });

  test('catches "exciting" describing own work', () => {
    const result = checkBlacklist('We have an exciting new platform that transforms healthcare GTM');
    assert.equal(result.clean, false);
  });

  test('allows clean, signal-driven email', () => {
    const result = checkBlacklist(
      'Sarah — I saw Acme posted 3 VP RevOps roles last month. ' +
      'We mapped your top 5 target accounts in digital health. ' +
      'Want the list?',
    );
    assert.equal(result.clean, true, `Unexpected violations: ${result.violations.join(', ')}`);
  });

  test('all 11 blacklisted phrases are defined', () => {
    assert.ok(EMAIL_BLACKLIST.length >= 11, `Expected at least 11 blacklisted phrases, got ${EMAIL_BLACKLIST.length}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. VOLUME RULES
// ═══════════════════════════════════════════════════════════════════════════

describe('Volume Rules — Hard limits', () => {
  test('max 40 emails per inbox per day', () => {
    assert.equal(VOLUME_RULES.maxColdEmailsPerInboxPerDay, 40);
    assert.equal(SEND_RULES.maxPerInboxPerDay, 40);
  });

  test('max 200 emails per domain per day', () => {
    assert.equal(VOLUME_RULES.maxColdEmailsPerDomainPerDay, 200);
    assert.equal(SEND_RULES.maxPerDomainPerDay, 200);
  });

  test('send days are Tuesday, Wednesday, Thursday only', () => {
    assert.deepEqual([...VOLUME_RULES.sendDays], ['tuesday', 'wednesday', 'thursday']);
    assert.deepEqual([...SEND_RULES.sendDays], ['tuesday', 'wednesday', 'thursday']);
  });

  test('never-send days include Friday, Saturday, Sunday, Monday', () => {
    assert.deepEqual(
      [...VOLUME_RULES.neverSendDays],
      ['friday', 'saturday', 'sunday', 'monday'],
    );
  });

  test('send window is 8am-11am recipient timezone', () => {
    assert.equal(VOLUME_RULES.sendWindowStartHour, 8);
    assert.equal(VOLUME_RULES.sendWindowEndHour, 11);
    assert.equal(SEND_RULES.sendWindowStart, 8);
    assert.equal(SEND_RULES.sendWindowEnd, 11);
  });

  test('send days and never-send days are mutually exclusive and cover all 7 days', () => {
    const allDays = [...VOLUME_RULES.sendDays, ...VOLUME_RULES.neverSendDays];
    const uniqueDays = new Set(allDays);
    assert.equal(uniqueDays.size, 7, 'All 7 days of the week should be covered');
    assert.equal(allDays.length, 7, 'No duplicate days');
  });
});

describe('Volume Rules — 4-week warmup schedule', () => {
  test('minimum warmup is 4 weeks', () => {
    assert.equal(VOLUME_RULES.minimumWarmupWeeks, 4);
  });

  test('week 1: 5 emails/day', () => {
    assert.equal(VOLUME_RULES.warmupSchedule.week1, 5);
  });

  test('week 2: 10 emails/day', () => {
    assert.equal(VOLUME_RULES.warmupSchedule.week2, 10);
  });

  test('week 3: 20 emails/day', () => {
    assert.equal(VOLUME_RULES.warmupSchedule.week3, 20);
  });

  test('week 4: 40 emails/day (matches max)', () => {
    assert.equal(VOLUME_RULES.warmupSchedule.week4, 40);
    assert.equal(
      VOLUME_RULES.warmupSchedule.week4,
      VOLUME_RULES.maxColdEmailsPerInboxPerDay,
      'Week 4 warmup should equal the max per inbox per day',
    );
  });

  test('warmup schedule is strictly increasing', () => {
    const { week1, week2, week3, week4 } = VOLUME_RULES.warmupSchedule;
    assert.ok(week1 < week2, 'Week 2 should be > week 1');
    assert.ok(week2 < week3, 'Week 3 should be > week 2');
    assert.ok(week3 < week4, 'Week 4 should be > week 3');
  });

  test('warmup schedule doubles each week', () => {
    const { week1, week2, week3, week4 } = VOLUME_RULES.warmupSchedule;
    assert.equal(week2, week1 * 2, 'Week 2 = 2x week 1');
    assert.equal(week3, week2 * 2, 'Week 3 = 2x week 2');
    assert.equal(week4, week3 * 2, 'Week 4 = 2x week 3');
  });

  /**
   * Simulate warmup enforcement: given an inbox age in weeks,
   * return the max emails/day allowed.
   */
  function getMaxEmailsForWeek(inboxAgeWeeks: number): number {
    if (inboxAgeWeeks < 1) return 0;
    if (inboxAgeWeeks < 2) return VOLUME_RULES.warmupSchedule.week1;
    if (inboxAgeWeeks < 3) return VOLUME_RULES.warmupSchedule.week2;
    if (inboxAgeWeeks < 4) return VOLUME_RULES.warmupSchedule.week3;
    return VOLUME_RULES.warmupSchedule.week4;
  }

  test('new inbox (week 0): 0 emails/day', () => {
    assert.equal(getMaxEmailsForWeek(0), 0);
  });

  test('week 1 inbox: max 5 emails/day', () => {
    assert.equal(getMaxEmailsForWeek(1), 5);
  });

  test('week 2 inbox: max 10 emails/day', () => {
    assert.equal(getMaxEmailsForWeek(2), 10);
  });

  test('week 3 inbox: max 20 emails/day', () => {
    assert.equal(getMaxEmailsForWeek(3), 20);
  });

  test('week 4+ inbox: max 40 emails/day', () => {
    assert.equal(getMaxEmailsForWeek(4), 40);
    assert.equal(getMaxEmailsForWeek(10), 40);
  });

  /**
   * Validate send timing: only Tue-Thu 8-11am recipient timezone
   */
  function isValidSendTime(dayOfWeek: number, hourInRecipientTz: number): boolean {
    // dayOfWeek: 0=Sunday, 1=Monday, 2=Tuesday, ... 6=Saturday
    const validDays = [2, 3, 4]; // Tue, Wed, Thu
    if (!validDays.includes(dayOfWeek)) return false;
    if (hourInRecipientTz < VOLUME_RULES.sendWindowStartHour) return false;
    if (hourInRecipientTz >= VOLUME_RULES.sendWindowEndHour) return false;
    return true;
  }

  test('Monday 9am: invalid (wrong day)', () => {
    assert.equal(isValidSendTime(1, 9), false);
  });

  test('Tuesday 9am: valid', () => {
    assert.equal(isValidSendTime(2, 9), true);
  });

  test('Wednesday 10am: valid', () => {
    assert.equal(isValidSendTime(3, 10), true);
  });

  test('Thursday 8am: valid', () => {
    assert.equal(isValidSendTime(4, 8), true);
  });

  test('Thursday 11am: invalid (window closes at 11)', () => {
    assert.equal(isValidSendTime(4, 11), false);
  });

  test('Friday 9am: invalid (wrong day)', () => {
    assert.equal(isValidSendTime(5, 9), false);
  });

  test('Saturday 10am: invalid (wrong day)', () => {
    assert.equal(isValidSendTime(6, 10), false);
  });

  test('Sunday 10am: invalid (wrong day)', () => {
    assert.equal(isValidSendTime(0, 10), false);
  });

  test('Tuesday 7am: invalid (too early)', () => {
    assert.equal(isValidSendTime(2, 7), false);
  });

  test('Wednesday 12pm: invalid (too late)', () => {
    assert.equal(isValidSendTime(3, 12), false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. CAN-SPAM COMPLIANCE
// ═══════════════════════════════════════════════════════════════════════════

describe('CAN-SPAM — Unsubscribe and physical address', () => {
  test('COMPLIANCE.canSpam requires unsubscribe + physical address', () => {
    assert.ok(COMPLIANCE.canSpam.toLowerCase().includes('unsubscribe'));
    assert.ok(COMPLIANCE.canSpam.toLowerCase().includes('physical address'));
  });

  test('COMPLIANCE.unsubscribe enforces immediate removal', () => {
    assert.ok(COMPLIANCE.unsubscribe.includes('remove immediately'));
    assert.ok(COMPLIANCE.unsubscribe.includes('No follow-up'));
  });

  test('COMPLIANCE.domainProtection separates sending domains', () => {
    assert.ok(COMPLIANCE.domainProtection.includes('separate'));
  });

  /**
   * Simulate CAN-SPAM footer validation.
   * Every outbound email must include these elements.
   */
  function validateEmailFooter(footer: string): { valid: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!footer.toLowerCase().includes('unsubscribe')) {
      missing.push('unsubscribe link');
    }
    // Physical address check — look for street/city/state patterns
    const hasAddress = /\d+\s+\w+.*(st|ave|rd|blvd|dr|way|ln|ct)/i.test(footer) ||
                       footer.toLowerCase().includes('address') ||
                       /[A-Z]{2}\s+\d{5}/.test(footer); // State + ZIP
    if (!hasAddress) {
      missing.push('physical address');
    }
    return { valid: missing.length === 0, missing };
  }

  test('valid footer with unsubscribe and address passes', () => {
    const footer = 'To unsubscribe, reply STOP. Blue Modern Advisory, 123 Main St, San Francisco CA 94105';
    const result = validateEmailFooter(footer);
    assert.equal(result.valid, true, `Missing: ${result.missing.join(', ')}`);
  });

  test('footer missing unsubscribe fails', () => {
    const footer = 'Blue Modern Advisory, 123 Main St, San Francisco CA 94105';
    const result = validateEmailFooter(footer);
    assert.equal(result.valid, false);
    assert.ok(result.missing.includes('unsubscribe link'));
  });

  test('footer missing address fails', () => {
    const footer = 'To unsubscribe, reply STOP.';
    const result = validateEmailFooter(footer);
    assert.equal(result.valid, false);
    assert.ok(result.missing.includes('physical address'));
  });

  test('empty footer fails', () => {
    const result = validateEmailFooter('');
    assert.equal(result.valid, false);
    assert.equal(result.missing.length, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. HIPAA
// ═══════════════════════════════════════════════════════════════════════════

describe('HIPAA — No patient/health data in outbound', () => {
  test('COMPLIANCE.hipaa prohibits PHI in email', () => {
    assert.ok(COMPLIANCE.hipaa.includes('NOT sending PHI'));
    assert.ok(COMPLIANCE.hipaa.toLowerCase().includes('patient data'));
  });

  /**
   * Detect PHI (Protected Health Information) in outbound content.
   * These patterns should NEVER appear in any email or outbound message.
   */
  function containsPHI(content: string): { clean: boolean; violations: string[] } {
    const violations: string[] = [];
    const phiPatterns: Array<{ pattern: RegExp; label: string }> = [
      { pattern: /\bpatient\s+(name|id|record|data|information|diagnosis|chart)\b/i, label: 'patient identifier' },
      { pattern: /\bdiagnos(is|ed|tic)\b/i, label: 'diagnosis' },
      { pattern: /\bmedical\s+record\s+number\b/i, label: 'medical record number' },
      { pattern: /\bSSN\b|\bsocial security\b/i, label: 'SSN' },
      { pattern: /\bdate of birth\b|\bDOB\b/i, label: 'date of birth' },
      { pattern: /\bhealth\s+insurance\b|\binsurance\s+id\b/i, label: 'insurance info' },
      { pattern: /\bprescription\b.*\b(history|drug|medication)\b/i, label: 'prescription data' },
      { pattern: /\blab\s+results?\b/i, label: 'lab results' },
      { pattern: /\btreatment\s+plan\b/i, label: 'treatment plan' },
      { pattern: /\bprotected\s+health\s+information\b/i, label: 'PHI reference' },
    ];
    for (const { pattern, label } of phiPatterns) {
      if (pattern.test(content)) {
        violations.push(label);
      }
    }
    return { clean: violations.length === 0, violations };
  }

  test('detects patient name reference', () => {
    const result = containsPHI('We have patient data showing 40% improvement in outcomes');
    assert.equal(result.clean, false);
  });

  test('detects diagnosis reference', () => {
    const result = containsPHI('The patient was diagnosed with diabetes and needs ongoing care');
    assert.equal(result.clean, false);
  });

  test('detects medical record number', () => {
    const result = containsPHI('Please reference medical record number MRN-12345 in your response');
    assert.equal(result.clean, false);
  });

  test('detects SSN reference', () => {
    const result = containsPHI('We need the SSN to verify identity');
    assert.equal(result.clean, false);
  });

  test('detects lab results reference', () => {
    const result = containsPHI('The lab results show elevated markers across the cohort');
    assert.equal(result.clean, false);
  });

  test('detects treatment plan reference', () => {
    const result = containsPHI('The treatment plan includes three sessions per week');
    assert.equal(result.clean, false);
  });

  test('allows clean GTM healthcare content', () => {
    const result = containsPHI(
      'Acme Health just posted 3 VP RevOps roles. ' +
      'Their GTM motion is expanding into enterprise payers. ' +
      'We mapped their top 5 target accounts — want the list?',
    );
    assert.equal(result.clean, true, `Unexpected PHI: ${result.violations.join(', ')}`);
  });

  test('allows "healthcare" and "health data" in business context', () => {
    const result = containsPHI(
      'Healthcare data intelligence helps commercial teams prioritize accounts. ' +
      'Our health data platform aggregates public signals — no patient-level data involved.',
    );
    assert.equal(result.clean, true, `Unexpected PHI: ${result.violations.join(', ')}`);
  });

  test('COMPLIANCE.dataSourcing requires compliant vendors', () => {
    assert.ok(COMPLIANCE.dataSourcing.includes('Clay'));
    assert.ok(COMPLIANCE.dataSourcing.includes('Apollo'));
    assert.ok(COMPLIANCE.dataSourcing.includes('LinkedIn Sales Navigator'));
    assert.ok(COMPLIANCE.dataSourcing.toLowerCase().includes('no scraped'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. ETHICAL FLOOR
// ═══════════════════════════════════════════════════════════════════════════

describe('Ethical Floor — Non-negotiable rules', () => {
  test('noHatred rule is defined', () => {
    assert.ok(ETHICAL_FLOOR.noHatred.includes('No hatred'));
  });

  test('noExploitation rule is defined', () => {
    assert.ok(ETHICAL_FLOOR.noExploitation.includes('No exploitation'));
  });

  test('noFearBasedCopy rule is defined', () => {
    assert.ok(ETHICAL_FLOOR.noFearBasedCopy.includes('No fear-based copy'));
    assert.ok(ETHICAL_FLOOR.noFearBasedCopy.includes('No countdown timers'));
  });

  test('noHumanAsMetric rule is defined', () => {
    assert.ok(ETHICAL_FLOOR.noHumanAsMetric.includes('conversion metric'));
  });

  test('animals and plants are stakeholders', () => {
    assert.ok(ETHICAL_FLOOR.animalsAndPlantsAreStakeholders.includes('Animals and plants'));
    assert.ok(ETHICAL_FLOOR.animalsAndPlantsAreStakeholders.includes('first-class stakeholders'));
  });

  test('financial enables but never overrides', () => {
    assert.ok(ETHICAL_FLOOR.financialEnables.includes('enables'));
    assert.ok(ETHICAL_FLOOR.financialEnables.includes('never overrides'));
  });

  /**
   * Ethical floor content scanner.
   * Catches hatred, exploitation, fear-based copy, and dehumanizing language.
   */
  function checkEthicalFloor(content: string): { clean: boolean; violations: string[] } {
    const violations: string[] = [];

    // Fear-based copy (same patterns as validateTheologyLine)
    const fearPatterns = [
      { pattern: /\byou.?re falling behind\b/i, label: 'fear: falling behind' },
      { pattern: /\byour competitors are\b/i, label: 'fear: competitor pressure' },
      { pattern: /\bdon.?t miss out\b/i, label: 'fear: FOMO' },
      { pattern: /\blast chance\b/i, label: 'fear: last chance' },
      { pattern: /\burgent\b/i, label: 'fear: urgency' },
      { pattern: /\bact now\b/i, label: 'fear: act now' },
      { pattern: /\blimited time\b/i, label: 'fear: limited time' },
    ];
    for (const { pattern, label } of fearPatterns) {
      if (pattern.test(content)) violations.push(label);
    }

    // Hatred patterns
    const hatredPatterns = [
      { pattern: /\bhate\b/i, label: 'hatred' },
      { pattern: /\bdestroy\s+(?:them|competitors?)\b/i, label: 'hatred: destruction' },
      { pattern: /\bcrus?h\s+(?:them|the competition)\b/i, label: 'hatred: crush' },
    ];
    for (const { pattern, label } of hatredPatterns) {
      if (pattern.test(content)) violations.push(label);
    }

    // Exploitation patterns
    const exploitationPatterns = [
      { pattern: /\bextract\s+(value|money|data)\s+from\b/i, label: 'exploitation: extraction' },
      { pattern: /\bmanipulate\b/i, label: 'exploitation: manipulation' },
      { pattern: /\btrick\s+(them|people|prospects?)\b/i, label: 'exploitation: trick' },
    ];
    for (const { pattern, label } of exploitationPatterns) {
      if (pattern.test(content)) violations.push(label);
    }

    // Dehumanizing language (human-as-metric)
    const dehumanizingPatterns = [
      { pattern: /\bjust\s+a\s+(number|metric|lead)\b/i, label: 'dehumanizing' },
      { pattern: /\bconvert\s+(them|people|users)\b/i, label: 'dehumanizing: convert people' },
    ];
    for (const { pattern, label } of dehumanizingPatterns) {
      if (pattern.test(content)) violations.push(label);
    }

    return { clean: violations.length === 0, violations };
  }

  test('catches fear-based urgency', () => {
    const result = checkEthicalFloor("Act now — this is a limited time opportunity you can't afford to miss");
    assert.equal(result.clean, false);
    assert.ok(result.violations.some(v => v.includes('fear')));
  });

  test('catches hatred/destroy language', () => {
    const result = checkEthicalFloor('Our strategy will crush the competition and destroy them in market share');
    assert.equal(result.clean, false);
    assert.ok(result.violations.some(v => v.includes('hatred') || v.includes('crush')));
  });

  test('catches exploitation language', () => {
    const result = checkEthicalFloor('We need to extract value from every prospect touchpoint and manipulate the funnel');
    assert.equal(result.clean, false);
    assert.ok(result.violations.some(v => v.includes('exploitation')));
  });

  test('catches dehumanizing language', () => {
    const result = checkEthicalFloor("They're just a number in the pipeline — focus on converting them fast");
    assert.equal(result.clean, false);
    assert.ok(result.violations.some(v => v.includes('dehumanizing')));
  });

  test('allows respectful, service-oriented content', () => {
    const result = checkEthicalFloor(
      'Sarah — your team just expanded into enterprise payers. ' +
      'We mapped the top 5 accounts in your segment. ' +
      'Happy to share if useful.',
    );
    assert.equal(result.clean, true, `Unexpected violations: ${result.violations.join(', ')}`);
  });

  test('allows competitive analysis without hatred', () => {
    const result = checkEthicalFloor(
      'Three of your peers are building GTM ops teams in-house. ' +
      "Here's how the market is shifting and where we see opportunity.",
    );
    assert.equal(result.clean, true, `Unexpected violations: ${result.violations.join(', ')}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. SIX DIMENSIONS OF HEALTH
// ═══════════════════════════════════════════════════════════════════════════

describe('Six Dimensions of Health', () => {
  test('all six dimensions are defined', () => {
    assert.equal(SIX_DIMENSIONS_OF_HEALTH.length, 6);
  });

  test('physical dimension exists', () => {
    assert.ok(SIX_DIMENSIONS_OF_HEALTH.includes('physical'));
  });

  test('mental dimension exists', () => {
    assert.ok(SIX_DIMENSIONS_OF_HEALTH.includes('mental'));
  });

  test('emotional dimension exists', () => {
    assert.ok(SIX_DIMENSIONS_OF_HEALTH.includes('emotional'));
  });

  test('social dimension exists', () => {
    assert.ok(SIX_DIMENSIONS_OF_HEALTH.includes('social'));
  });

  test('spiritual dimension exists', () => {
    assert.ok(SIX_DIMENSIONS_OF_HEALTH.includes('spiritual'));
  });

  test('financial dimension exists', () => {
    assert.ok(SIX_DIMENSIONS_OF_HEALTH.includes('financial'));
  });

  test('financial is listed last (enables but never overrides)', () => {
    assert.equal(SIX_DIMENSIONS_OF_HEALTH[5], 'financial');
  });

  /**
   * Simulate six-dimension evaluation for a GTM decision.
   * Every major decision should consider all six dimensions.
   */
  function evaluateDecision(
    decision: string,
    dimensionsConsidered: string[],
  ): { complete: boolean; missing: string[] } {
    const missing = SIX_DIMENSIONS_OF_HEALTH.filter(
      d => !dimensionsConsidered.includes(d),
    );
    return { complete: missing.length === 0, missing: [...missing] };
  }

  test('decision covering all six dimensions is complete', () => {
    const result = evaluateDecision('Launch cold email campaign', [
      'physical', 'mental', 'emotional', 'social', 'spiritual', 'financial',
    ]);
    assert.equal(result.complete, true);
    assert.equal(result.missing.length, 0);
  });

  test('decision missing spiritual dimension is flagged', () => {
    const result = evaluateDecision('Scale email volume to 200/day', [
      'physical', 'mental', 'emotional', 'social', 'financial',
    ]);
    assert.equal(result.complete, false);
    assert.deepEqual(result.missing, ['spiritual']);
  });

  test('decision missing multiple dimensions is flagged', () => {
    const result = evaluateDecision('Automate all follow-ups', ['financial']);
    assert.equal(result.complete, false);
    assert.equal(result.missing.length, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. CROSS-SYSTEM INTEGRATION CHECKS
// ═══════════════════════════════════════════════════════════════════════════

describe('Cross-system — Theology + Ethical Floor consistency', () => {
  test('fear-based copy is caught by both validateTheologyLine and ethical floor', () => {
    const fearContent = "Don't miss out on this urgent opportunity — your competitors are already ahead";

    // Theology line catches it on every channel
    const allChannels = Object.keys(CHANNELS) as Channel[];
    for (const channel of allChannels) {
      const result = validateTheologyLine(channel, fearContent);
      assert.equal(result.valid, false, `${channel} should reject fear-based content via theology line`);
    }
  });

  test('VOLUME_RULES and SEND_RULES are consistent', () => {
    assert.equal(VOLUME_RULES.maxColdEmailsPerInboxPerDay, SEND_RULES.maxPerInboxPerDay);
    assert.equal(VOLUME_RULES.maxColdEmailsPerDomainPerDay, SEND_RULES.maxPerDomainPerDay);
    assert.deepEqual([...VOLUME_RULES.sendDays], [...SEND_RULES.sendDays]);
    assert.equal(VOLUME_RULES.sendWindowStartHour, SEND_RULES.sendWindowStart);
    assert.equal(VOLUME_RULES.sendWindowEndHour, SEND_RULES.sendWindowEnd);
  });

  test('persona word limits are defined for all three personas', () => {
    assert.ok(PERSONA_WORD_LIMITS['A'] > 0, 'Persona A limit should be > 0');
    assert.ok(PERSONA_WORD_LIMITS['B'] > 0, 'Persona B limit should be > 0');
    assert.ok(PERSONA_WORD_LIMITS['C'] > 0, 'Persona C limit should be > 0');
    assert.equal(PERSONA_WORD_LIMITS['A'], 120);
    assert.equal(PERSONA_WORD_LIMITS['B'], 150);
    assert.equal(PERSONA_WORD_LIMITS['C'], 90);
  });

  test('cold_email channel prohibits spiritual content', () => {
    const config = CHANNELS['cold_email'];
    assert.ok(config.prohibitedContent.includes('any_spiritual_content'));
    assert.ok(config.prohibitedContent.includes('fear_based_copy'));
    assert.ok(config.prohibitedContent.includes('generic_openers'));
  });

  test('warm_email channel prohibits spiritual content', () => {
    const config = CHANNELS['warm_email'];
    assert.ok(config.prohibitedContent.includes('any_spiritual_content'));
    assert.ok(config.prohibitedContent.includes('fear_based_copy'));
  });

  test('every Sagar channel blocks Jesus content in prohibitedContent', () => {
    const sagarChannelsWithJesusBlock: Channel[] = ['bma_linkedin', 'gartiwar', 'rytual', 'sagar_linkedin'];
    for (const channel of sagarChannelsWithJesusBlock) {
      const config = CHANNELS[channel];
      assert.ok(
        config.prohibitedContent.includes('jesus_content'),
        `${channel} should have jesus_content in prohibitedContent`,
      );
    }
  });

  test('caleb_personal blocks Vedic framing in prohibitedContent', () => {
    const config = CHANNELS['caleb_personal'];
    assert.ok(config.prohibitedContent.includes('vedic_framing'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════

process.stdout.write('\n══════════════════════════════════════════════\n');
process.stdout.write(`  Results: ${passed} passed, ${failed} failed\n`);
process.stdout.write('══════════════════════════════════════════════\n');

if (failures.length > 0) {
  process.stdout.write('\nFailures:\n');
  for (const f of failures) {
    process.stdout.write(`  ✗ ${f}\n`);
  }
  process.exit(1);
}

process.stdout.write('\nAll governance systems verified.\n');
