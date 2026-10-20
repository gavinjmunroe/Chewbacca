/**
 * @togari/core/identity — tenant-scoped user directory over togari_data_lake.users
 *
 * Every query against the users table:
 *   - is parameterized (no string interpolation),
 *   - filters by tenant_id (defense-in-depth against cross-tenant leaks),
 *   - is read-only (reads go through BigQueryClient.executeQuery which blocks
 *     anything that isn't SELECT/WITH).
 *
 * Seeding / DDL is handled out-of-band by `src/scripts/bootstrap-1.5a.ts`.
 */

import { BigQueryClient } from '../../bigquery/client';
import { resolveDatasetFor } from '../../services/dataset-resolver';

const PROJECT_ID = 'midyear-glazing-485303-u3';

function usersTable(tenantId: string): string {
  return `\`${PROJECT_ID}.${resolveDatasetFor(tenantId)}.users\``;
}

export const DEFAULT_TENANT_ID = 'bma';

export interface UserRow {
  user_id: string;
  tenant_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  slack_user_id: string | null;
  slack_display_name: string | null;
  preferred_transport: string | null;
  timezone: string | null;
}

function getBqClient(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64 || null,
  );
}

function rowToUser(row: Record<string, unknown>): UserRow {
  return {
    user_id: String(row.user_id ?? ''),
    tenant_id: String(row.tenant_id ?? ''),
    email: String(row.email ?? ''),
    first_name: (row.first_name as string | null) ?? null,
    last_name: (row.last_name as string | null) ?? null,
    slack_user_id: (row.slack_user_id as string | null) ?? null,
    slack_display_name: (row.slack_display_name as string | null) ?? null,
    preferred_transport: (row.preferred_transport as string | null) ?? null,
    timezone: (row.timezone as string | null) ?? null,
  };
}

/**
 * Return every user in the directory for the given tenant. Small dataset
 * (7 rows today; tens even at scale), so we load the whole table once and
 * perform fuzzy matching in memory. Avoids a round-trip per candidate name
 * and lets us apply deterministic Unicode-safe matching logic.
 */
export async function listUsers(tenantId: string = DEFAULT_TENANT_ID): Promise<UserRow[]> {
  const bq = getBqClient();
  const result = await bq.executeQuery(
    `SELECT user_id, tenant_id, email, first_name, last_name,
            slack_user_id, slack_display_name, preferred_transport, timezone
     FROM ${usersTable(tenantId)}
     WHERE tenant_id = @tenantId`,
    { tenantId },
  );
  return result.rows.map(rowToUser);
}

export async function findUserBySlackId(
  slackUserId: string,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<UserRow | null> {
  if (!slackUserId) return null;
  const bq = getBqClient();
  const result = await bq.executeQuery(
    `SELECT user_id, tenant_id, email, first_name, last_name,
            slack_user_id, slack_display_name, preferred_transport, timezone
     FROM ${usersTable(tenantId)}
     WHERE tenant_id = @tenantId AND slack_user_id = @slackUserId
     LIMIT 1`,
    { tenantId, slackUserId },
  );
  return result.rows.length > 0 ? rowToUser(result.rows[0]) : null;
}

export function usersTableFqn(tenantId: string = DEFAULT_TENANT_ID): string {
  return usersTable(tenantId);
}
