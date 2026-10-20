/**
 * @togari/agents/replybot — Per-client inbound reply webhook
 *
 * POST /replybot/:clientId/webhook — same raw-body HMAC pattern as the
 * original /smartlead/webhook (which remains BMA's path), but keyed by
 * replybot client: the client id selects the HMAC secret, Slack channel,
 * voice, and sender identity from the replybot client registry.
 *
 * Route must be registered with express.raw({ type: 'application/json' })
 * BEFORE the global express.json() so the HMAC is computed over the exact
 * bytes Smartlead signed.
 */

import crypto from 'crypto';
import type { Request, Response } from 'express';
import { createLogger } from '../../observability/logger';
import { getReplybotClient } from './client-config';
import { processSmartleadWebhook } from '../smartlead-responder/index';

const logger = createLogger('ReplybotWebhook');

/** timingSafeEqual that tolerates length mismatches (returns false). */
function timingSafeStringEqual(a: string, b: string): boolean {
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false; // length mismatch
  }
}

export function replybotWebhookHandler(req: Request, res: Response): void {
  try {
    const clientId = String(req.params.clientId ?? '');
    const client = getReplybotClient(clientId);
    if (!client) {
      logger.warn('Replybot webhook for unknown client', { clientId });
      res.status(404).json({ error: 'Unknown client' });
      return;
    }

    // Offboarded clients reject before auth is even considered. Order
    // matters: outside production an unset secret still means "skip auth
    // (dev mode)" below, so pulling a retired client's secret from the
    // environment would open their endpoint there. 410 rather than 404 (or
    // production's 503 for a missing secret) so a Clay column still firing
    // is diagnosable from the status code alone.
    if (client.retired) {
      logger.warn('Replybot webhook for retired client — rejecting', {
        clientId: client.clientId,
        displayName: client.displayName,
      });
      res.status(410).json({ error: 'Client retired' });
      return;
    }

    // A client fed only by POST /replies has no webhook at all. Refused before
    // auth is considered, so the route is closed without a secret existing,
    // and no NODE_ENV can open it.
    if (!client.webhookSecretEnv) {
      logger.warn('Replybot webhook for a client with no webhook — rejecting', {
        clientId: client.clientId,
      });
      res.status(404).json({ error: 'No webhook for this client' });
      return;
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? '');
    const rawString = rawBody.toString('utf8');

    // Verify the request with the client's own secret, in the client's auth mode
    const secret = process.env[client.webhookSecretEnv];
    const authMode = client.webhookAuth ?? 'smartlead-hmac';

    if (!secret) {
      // Production fails closed. Anything accepted here becomes a Slack card
      // with a live Send button, and for a Clay client that button hands the
      // payload's draft to the client's send webhook — so an open endpoint
      // lets anyone put words in a prospect's inbox. The secret is easiest to
      // forget for clients whose replies arrive via POST /replies and never
      // touch this route.
      if (process.env.NODE_ENV === 'production') {
        logger.error(
          `${client.webhookSecretEnv} not set — rejecting replybot webhook. Set it in Railway.`,
          undefined,
          { clientId: client.clientId, missingEnv: client.webhookSecretEnv },
        );
        res.status(503).json({ error: 'Webhook auth not configured for this client' });
        return;
      }
      logger.warn(
        `${client.webhookSecretEnv} not set — skipping webhook auth (dev mode)`,
        { clientId: client.clientId },
      );
    } else if (authMode === 'static-key') {
      // Constant key in X-Replybot-Key — for callers that can set headers
      // but can't compute an HMAC (e.g. a Clay HTTP API enrichment column).
      const provided = req.headers['x-replybot-key'] as string | undefined;
      if (!provided || !timingSafeStringEqual(provided, secret)) {
        logger.warn('Replybot webhook key verification failed', {
          clientId: client.clientId,
          hasKey: !!provided,
        });
        res.status(401).json({ error: 'Invalid key' });
        return;
      }
    } else {
      const signature = req.headers['x-smartlead-signature'] as string | undefined;
      if (!signature) {
        logger.warn('Missing X-Smartlead-Signature header — rejecting request', {
          clientId: client.clientId,
        });
        res.status(401).json({ error: 'Missing signature' });
        return;
      }
      const hmac = crypto.createHmac('sha256', secret).update(rawString).digest('hex');
      if (!timingSafeStringEqual(hmac, signature)) {
        logger.warn('Replybot webhook signature verification failed', {
          clientId: client.clientId,
        });
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    // Return 200 immediately before processing
    res.status(200).json({ status: 'ok' });

    // Parse and process asynchronously
    let body: unknown;
    try {
      body = JSON.parse(rawString);
    } catch {
      logger.error('Failed to parse replybot webhook body as JSON', undefined, {
        clientId: client.clientId,
      });
      return;
    }

    processSmartleadWebhook(body, client.clientId).catch((err) => {
      logger.error(
        'Async replybot webhook processing failed',
        err instanceof Error ? err : new Error(String(err)),
        { clientId: client.clientId },
      );
    });
  } catch (err) {
    logger.error(
      'Replybot webhook handler error',
      err instanceof Error ? err : new Error(String(err)),
    );
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal error' });
    }
  }
}
