/**
 * @togari/transports/slack — Tenant context middleware
 *
 * Wraps every Slack-bound handler in `tenantStorage.run(...)` so the
 * downstream BigQuery resolver (`resolveDataset()` → `getCurrentTenant()`)
 * has a context to read. Without this middleware, anything that touches
 * BQ from a Slack handler throws "No tenant context available".
 *
 * Body-parsing strategy:
 *   - `/slack/events`         mounts `express.text({ type: '*\/*' })` → req.body is a JSON string.
 *   - `/slack/interactivity`  mounts `express.raw({ type: 'application/x-www-form-urlencoded' })`
 *                             → req.body is a Buffer of `payload=<URL-encoded JSON>`.
 *
 * This middleware accepts both shapes, extracts `team_id` (and the Slack user
 * id when available), maps team_id → tenantId, and calls `next()` inside
 * `tenantStorage.run(...)`. Parsing failures are swallowed deliberately —
 * Slack needs its 200 ack within 3 seconds, so we never throw or 4xx here.
 * Unknown / missing team_id falls back to the default tenant.
 */

import type { NextFunction, Request, Response } from 'express';
import { tenantStorage, type AuthedTenantContext } from '../../tenant/context';

// ── team_id → tenantId mapping ──────────────────────────────────────
// Single-tenant today (BMA). When we onboard a second workspace, add
// another entry here (or move the map to a per-tenant BQ table).
// Client workspaces that install Togari only for their reply cards
// (installations.ts) deliberately aren't mapped: the replybot never reads
// the tenant, and workspace-gate.ts keeps them away from everything that does.
const TEAM_TO_TENANT: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const bmaTeamId = process.env.SLACK_BMA_TEAM_ID;
  if (bmaTeamId) {
    map[bmaTeamId] = 'bma';
  }
  return map;
})();

const DEFAULT_TENANT_ID = process.env.SLACK_DEFAULT_TENANT_ID ?? 'bma';

// Default scope set for BMA Slack traffic. Mirrors the dev-anonymous
// admin scopes used elsewhere — the dataset resolver itself routes off
// tenantId, so scopes are advisory until /scope-checked tools land.
const DEFAULT_SCOPES = ['togari_data_lake'];

interface ExtractedSlackIds {
  teamId?: string;
  userId?: string;
}

/** Coerce req.body (string from express.text OR Buffer from express.raw) to a string. */
function bodyAsString(body: unknown): string | null {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  return null;
}

/**
 * Parse the Slack /events JSON envelope. Returns the top-level team_id
 * and (best effort) the user_id from the embedded event object.
 */
function tryParseEventsBody(raw: string): ExtractedSlackIds | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, any>;
    const teamId =
      (typeof parsed.team_id === 'string' && parsed.team_id) ||
      (typeof parsed.team?.id === 'string' && parsed.team.id) ||
      (typeof parsed.event?.team === 'string' && parsed.event.team) ||
      undefined;
    const userId =
      (typeof parsed.event?.user === 'string' && parsed.event.user) ||
      (typeof parsed.user_id === 'string' && parsed.user_id) ||
      undefined;
    if (!teamId && !userId) return null;
    return { teamId, userId };
  } catch {
    return null;
  }
}

/**
 * Parse the Slack /interactivity URL-encoded envelope. The real payload
 * is JSON-encoded inside the `payload` form field; team_id sits on
 * `payload.team.id` and the Slack user on `payload.user.id`.
 */
function tryParseInteractivityBody(raw: string): ExtractedSlackIds | null {
  try {
    const params = new URLSearchParams(raw);
    const payloadStr = params.get('payload');
    if (!payloadStr) return null;
    const parsed = JSON.parse(payloadStr) as Record<string, any>;
    const teamId =
      (typeof parsed.team?.id === 'string' && parsed.team.id) ||
      (typeof parsed.team_id === 'string' && parsed.team_id) ||
      undefined;
    const userId =
      (typeof parsed.user?.id === 'string' && parsed.user.id) ||
      undefined;
    if (!teamId && !userId) return null;
    return { teamId, userId };
  } catch {
    return null;
  }
}

export function slackTenantMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  let teamId: string | undefined;
  let userId: string | undefined;

  const raw = bodyAsString(req.body);
  if (raw && raw.length > 0) {
    // Slack URL verification challenges arrive as JSON on /events too,
    // so try events first; fall back to interactivity for /slack/interactivity.
    const events = tryParseEventsBody(raw);
    if (events) {
      teamId = events.teamId;
      userId = events.userId;
    } else {
      const interactive = tryParseInteractivityBody(raw);
      if (interactive) {
        teamId = interactive.teamId;
        userId = interactive.userId;
      }
    }
  }

  const tenantId =
    (teamId && TEAM_TO_TENANT[teamId]) || DEFAULT_TENANT_ID;

  const ctx: AuthedTenantContext = {
    tenantId,
    userId: userId || 'slack-bot',
    tier: 'enterprise',
    orgId: tenantId,
    scopes: DEFAULT_SCOPES,
    authSource: 'slack',
  };

  tenantStorage.run(ctx, () => next());
}
