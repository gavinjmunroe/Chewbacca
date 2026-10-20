/**
 * POST /replybot/:clientId/webhook auth.
 *
 * Anything this route accepts becomes a Slack card with a live Send button,
 * and for a Clay client that button hands the payload's draft_body to the
 * client's send webhook. So the cases that matter most are the ones where the
 * client's secret is missing: production must refuse (503) rather than skip
 * auth, while local dev keeps skipping so it can be exercised without one.
 */

import crypto from 'crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { processSmartleadWebhook, logger } = vi.hoisted(() => ({
  processSmartleadWebhook: vi.fn(() => Promise.resolve()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../smartlead-responder/index', () => ({ processSmartleadWebhook }));
vi.mock('../../../observability/logger', () => ({ createLogger: () => logger }));

// Every live client authenticates by static key, so the HMAC path has no real
// client to run through. Add one that differs from serif only in auth mode.
vi.mock('../client-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client-config')>();
  return {
    ...actual,
    getReplybotClient: (clientId: string) =>
      clientId === 'hmac_test'
        ? {
            ...actual.getReplybotClient('serif')!,
            clientId: 'hmac_test',
            webhookSecretEnv: 'REPLYBOT_HMAC_TEST_WEBHOOK_SECRET',
            webhookAuth: 'smartlead-hmac' as const,
          }
        : actual.getReplybotClient(clientId),
  };
});

import { replybotWebhookHandler } from '../webhook';

const SECRET = 'test-replybot-secret';
const BODY = JSON.stringify({
  lead_id: 'lead-1',
  campaign_id: 'camp-1',
  draft_body: 'Attacker-chosen text',
});

function invoke(clientId: string, headers: Record<string, string> = {}, body = BODY) {
  const req: any = { params: { clientId }, headers, body: Buffer.from(body) };
  const res: any = {
    statusCode: 0,
    payload: undefined as unknown,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      this.headersSent = true;
      return this;
    },
  };
  replybotWebhookHandler(req, res);
  return res as { statusCode: number; payload: any };
}

function sign(body: string, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

beforeEach(() => {
  processSmartleadWebhook.mockClear();
  for (const fn of Object.values(logger)) fn.mockClear();
  // Pin both secrets explicitly so a developer's own shell env can't decide
  // which branch a case takes.
  vi.stubEnv('REPLYBOT_SERIF_WEBHOOK_SECRET', undefined);
  vi.stubEnv('REPLYBOT_HMAC_TEST_WEBHOOK_SECRET', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('replybot webhook — secret unset', () => {
  it('fails closed in production: 503, error log names the var, nothing processed', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const res = invoke('serif');

    expect(res.statusCode).toBe(503);
    expect(res.payload).toEqual({ error: 'Webhook auth not configured for this client' });
    expect(processSmartleadWebhook).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message, , meta] = logger.error.mock.calls[0] as unknown as [string, unknown, any];
    expect(message).toContain('REPLYBOT_SERIF_WEBHOOK_SECRET');
    expect(meta).toMatchObject({
      clientId: 'serif',
      missingEnv: 'REPLYBOT_SERIF_WEBHOOK_SECRET',
    });
  });

  it('fails closed in production for HMAC clients too', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const res = invoke('hmac_test', { 'x-smartlead-signature': sign(BODY) });

    expect(res.statusCode).toBe(503);
    expect(processSmartleadWebhook).not.toHaveBeenCalled();
  });

  it('serif_test inherits serif\'s secret, so it fails closed with it', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(invoke('serif_test').statusCode).toBe(503);
    expect(processSmartleadWebhook).not.toHaveBeenCalled();
  });

  it('still skips auth outside production (dev mode)', () => {
    vi.stubEnv('NODE_ENV', 'development');

    const res = invoke('serif');

    expect(res.statusCode).toBe(200);
    expect(processSmartleadWebhook).toHaveBeenCalledWith(JSON.parse(BODY), 'serif');
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('skipping webhook auth (dev mode)'),
      expect.objectContaining({ clientId: 'serif' }),
    );
  });

  it('retired clients still answer 410 before auth, in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('REPLYBOT_HHH_WEBHOOK_SECRET', undefined);

    const res = invoke('hhh');

    expect(res.statusCode).toBe(410);
    expect(res.payload).toEqual({ error: 'Client retired' });
    expect(processSmartleadWebhook).not.toHaveBeenCalled();
  });

  it('unknown clients still answer 404', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(invoke('nobody').statusCode).toBe(404);
    expect(processSmartleadWebhook).not.toHaveBeenCalled();
  });
});

describe('replybot webhook — client with no webhook', () => {
  // Zeutara's replies arrive only on POST /replies, so it names no secret.
  // Its route must stay shut with nothing set, which is what lets a new
  // reply-loop client skip the variable entirely.
  it.each(['production', 'development'])('refuses with 404 in %s, nothing processed', (env) => {
    vi.stubEnv('NODE_ENV', env);

    for (const clientId of ['zeutara', 'zeutara_test']) {
      const res = invoke(clientId, { 'x-replybot-key': 'anything' });
      expect(res.statusCode).toBe(404);
      expect(res.payload).toEqual({ error: 'No webhook for this client' });
    }
    expect(processSmartleadWebhook).not.toHaveBeenCalled();
  });
});

describe('replybot webhook — secret set, production', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
  });

  describe('static-key', () => {
    beforeEach(() => {
      vi.stubEnv('REPLYBOT_SERIF_WEBHOOK_SECRET', SECRET);
    });

    it('accepts the right X-Replybot-Key and processes the payload', () => {
      const res = invoke('serif', { 'x-replybot-key': SECRET });

      expect(res.statusCode).toBe(200);
      expect(res.payload).toEqual({ status: 'ok' });
      expect(processSmartleadWebhook).toHaveBeenCalledWith(JSON.parse(BODY), 'serif');
    });

    it('rejects a wrong key with 401', () => {
      const res = invoke('serif', { 'x-replybot-key': 'wrong' });

      expect(res.statusCode).toBe(401);
      expect(res.payload).toEqual({ error: 'Invalid key' });
      expect(processSmartleadWebhook).not.toHaveBeenCalled();
    });

    it('rejects a missing key with 401', () => {
      const res = invoke('serif');

      expect(res.statusCode).toBe(401);
      expect(res.payload).toEqual({ error: 'Invalid key' });
      expect(processSmartleadWebhook).not.toHaveBeenCalled();
    });
  });

  describe('smartlead-hmac', () => {
    beforeEach(() => {
      vi.stubEnv('REPLYBOT_HMAC_TEST_WEBHOOK_SECRET', SECRET);
    });

    it('accepts a valid signature over the raw body and processes the payload', () => {
      const res = invoke('hmac_test', { 'x-smartlead-signature': sign(BODY) });

      expect(res.statusCode).toBe(200);
      expect(processSmartleadWebhook).toHaveBeenCalledWith(JSON.parse(BODY), 'hmac_test');
    });

    it('rejects a signature made with the wrong secret with 401', () => {
      const res = invoke('hmac_test', { 'x-smartlead-signature': sign(BODY, 'other') });

      expect(res.statusCode).toBe(401);
      expect(res.payload).toEqual({ error: 'Invalid signature' });
      expect(processSmartleadWebhook).not.toHaveBeenCalled();
    });

    it('rejects a missing signature with 401', () => {
      const res = invoke('hmac_test');

      expect(res.statusCode).toBe(401);
      expect(res.payload).toEqual({ error: 'Missing signature' });
      expect(processSmartleadWebhook).not.toHaveBeenCalled();
    });
  });
});
