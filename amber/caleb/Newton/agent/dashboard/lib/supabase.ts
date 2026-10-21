/**
 * Supabase client for the Amber dashboard.
 * Reads from the same tables as the agent: contacts, conversations,
 * interactions, health_profiles, health_checkins, user_sessions.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

function headers() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

export async function sbQuery<T = Record<string, unknown>>(
  table: string,
  filter = "",
  options: { limit?: number; order?: string } = {},
): Promise<T[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return [];
  const { limit = 100, order = "" } = options;
  let url = `${SUPABASE_URL}/rest/v1/${table}?${filter}&limit=${limit}`;
  if (order) url += `&order=${order}`;
  const res = await fetch(url, { headers: headers(), cache: "no-store" });
  if (!res.ok) return [];
  return (await res.json()) as T[];
}

export async function sbGet<T = Record<string, unknown>>(
  table: string,
  filter: string,
): Promise<T | null> {
  const rows = await sbQuery<T>(table, filter, { limit: 1 });
  return rows.length > 0 ? rows[0] : null;
}

export async function sbUpsert(
  table: string,
  row: Record<string, unknown>,
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      ...headers(),
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(row),
  });
}
