/**
 * Direct-mode REST endpoints — bypass Claude, query BigQuery directly.
 *
 * Routes:
 *   POST /api/data-pulls           — create a data pull (with optional Stripe checkout)
 *   GET  /api/data-pulls/:pull_id  — get status of a data pull
 *   GET  /api/data-pulls           — list data pulls for a client
 */

import { Router, Request, Response } from 'express';
import {
  createDataPullRecord,
  getDataPullRequest,
  listDataPullRequests,
  processDataPull,
  createDataPullCheckout,
} from '../agents/opportunity-notifications/data-pull-pipeline';
import { calculateDataPullCost } from '../agents/opportunity-notifications/types';
import { createAuthMiddleware } from '@togari/admin';

export function createDirectApiRouter(): Router {
  const router = Router();

  // JWT auth on all /api routes
  const authDomain   = process.env.AUTH0_DOMAIN || '';
  const authAudience = process.env.AUTH0_AUDIENCE || '';
  const authMiddleware = createAuthMiddleware(authDomain, authAudience);
  router.use(...authMiddleware);

  // Attach client_id from JWT to every request
  router.use((req, _res, next) => {
    const auth = (req as Request & { auth?: { sub?: string } }).auth;
    (req as Request & { clientId?: string }).clientId = auth?.sub || process.env.TENANT_ID || 'unknown';
    next();
  });

  // ─── POST /api/data-pulls ─────────────────────────────────────────────────
  // Create a data pull request. Returns a Stripe checkout URL unless
  // skip_payment=true (dev/internal use).

  router.post('/data-pulls', async (req: Request, res: Response) => {
    try {
      const clientId = (req as Request & { clientId?: string }).clientId || 'unknown';
      const { query, count, skip_payment } = req.body as {
        query?: string;
        count?: number;
        skip_payment?: boolean;
      };

      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: true, message: 'Missing required field: query (string)' });
        return;
      }
      if (!count || typeof count !== 'number' || count < 1 || count > 10_000) {
        res.status(400).json({ error: true, message: 'count must be a number between 1 and 10,000' });
        return;
      }

      const costUsd = calculateDataPullCost(count);
      const request = await createDataPullRecord(clientId, query, count, null);

      let checkoutUrl: string | null = null;
      if (!skip_payment) {
        checkoutUrl = await createDataPullCheckout(
          request.pull_id,
          req.body.email || `${clientId}@togari.com`,
          count,
        );
      } else {
        // Internal: process immediately without payment
        processDataPull(request).catch(err => {
          process.stderr.write(`Data pull processing error: ${err instanceof Error ? err.message : err}\n`);
        });
      }

      res.status(201).json({
        pull_id: request.pull_id,
        status: skip_payment ? 'processing' : 'pending_payment',
        estimated_cost_usd: costUsd,
        stripe_checkout_url: checkoutUrl,
        query,
        count,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`POST /api/data-pulls error: ${message}\n`);
      res.status(500).json({ error: true, message: 'Internal server error' });
    }
  });

  // ─── GET /api/data-pulls/:pull_id ─────────────────────────────────────────

  router.get('/data-pulls/:pull_id', async (req: Request, res: Response) => {
    try {
      const request = await getDataPullRequest(req.params.pull_id);
      if (!request) {
        res.status(404).json({ error: true, message: 'Data pull not found' });
        return;
      }
      res.json(request);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`GET /api/data-pulls/:id error: ${message}\n`);
      res.status(500).json({ error: true, message: 'Internal server error' });
    }
  });

  // ─── GET /api/data-pulls ──────────────────────────────────────────────────

  router.get('/data-pulls', async (req: Request, res: Response) => {
    try {
      const clientId = (req as Request & { clientId?: string }).clientId
        || String(req.query.client_id || 'unknown');
      const pulls = await listDataPullRequests(clientId);
      res.json({ data: pulls, total: pulls.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`GET /api/data-pulls error: ${message}\n`);
      res.status(500).json({ error: true, message: 'Internal server error' });
    }
  });

  return router;
}
