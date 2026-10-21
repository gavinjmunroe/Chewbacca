import { callMedhaId, type MedhaIdResult } from './medhaId';

// Amber → Clay. The mirror of the ingest API key, which powers Clay → Amber.
//
//   Clay → Amber   Clay's HTTP API action POSTs contacts to /v1/ingest/contacts with a
//                  personal Amber API key. The key is minted in the API-key sheet.
//   Amber → Clay   these calls. The user pastes the URL of a Clay table's "Import from
//                  Webhook" source, and Amber POSTs contacts to it.
//
// THE WEBHOOK URL IS A CREDENTIAL: anyone holding it can write rows into that Clay
// table. The server never returns it in full — `webhookUrl` below is always a masked
// form, suitable for recognising which destination is set and nothing else. There is
// deliberately no way to read the real value back out.

export type ClayDestination = {
  configured: boolean;
  /** Masked, e.g. "https://api.clay.com/…abc123". Never the usable URL. */
  webhookUrl?: string | null;
  label?: string | null;
  lastPushAt?: string | null;
  lastPushCount?: number;
  /**
   * How the rows are sent. 'object' (the default) posts one flat row per request,
   * which is what Clay's webhook source documents: "key-value pairs in the body of a
   * POST request". 'array' batches many rows per request, which some sources accept
   * and which is far fewer requests for a large push.
   */
  mode?: 'object' | 'array';
  /** Whether Clay's optional webhook auth token is configured. Never the token. */
  hasAuthToken?: boolean;
};

export type ClayPushResult = {
  ok: boolean;
  pushed: number;
  total: number;
  skippedForLimit: number;
  /**
   * `index`, not `batchStart` — the server sends the row index it stopped at. This type
   * said `batchStart`, which meant every read of it was silently `undefined`: a type
   * that compiles and is wrong, which is worse than one that fails.
   */
  failures: { index: number; status: number; error: string }[];
  mode?: 'object' | 'array';
};

export type ClayDryRun = {
  ok: boolean;
  dryRun: true;
  wouldPush: number;
  skippedForLimit: number;
  /** One row in the exact shape Clay will receive, for checking the column mapping. */
  sample: Record<string, string | null> | null;
  destination: string | null;
};

export function getClayDestination(): Promise<MedhaIdResult<ClayDestination>> {
  return callMedhaId<ClayDestination>({
    path: '/v1/me/clay/destination',
    method: 'GET',
    requireAuth: true,
    tag: 'GET clay destination',
  });
}

/**
 * Save the Clay webhook URL.
 *
 * The server validates it hard before storing (https, a real clay.com host, no
 * embedded credentials) because it is a URL the SERVER will then make requests to —
 * an unvalidated one is an SSRF. A rejection comes back as a readable message, so
 * surface `error.message` rather than a generic failure.
 */
export function setClayDestination(
  webhookUrl: string,
  opts: { label?: string; mode?: 'object' | 'array'; authToken?: string } = {},
): Promise<MedhaIdResult<{ ok: boolean; configured: boolean; webhookUrl: string | null }>> {
  return callMedhaId<{ ok: boolean; configured: boolean; webhookUrl: string | null }>({
    path: '/v1/me/clay/destination',
    method: 'PUT',
    requireAuth: true,
    body: {
      webhookUrl,
      ...(opts.label ? { label: opts.label } : {}),
      ...(opts.mode ? { mode: opts.mode } : {}),
      // Clay's webhook source has an optional "Add auth token". If it is turned on,
      // an unauthenticated POST starts failing with a 401 and the push looks broken
      // for no visible reason, so the token has to come along.
      ...(opts.authToken ? { authToken: opts.authToken } : {}),
    },
    tag: 'PUT clay destination',
  });
}

export function clearClayDestination(): Promise<MedhaIdResult<{ ok: boolean }>> {
  return callMedhaId<{ ok: boolean }>({
    path: '/v1/me/clay/destination',
    method: 'DELETE',
    requireAuth: true,
    tag: 'DELETE clay destination',
  });
}

/**
 * Push contacts to Clay.
 *
 * Pass `dryRun` to see what WOULD be sent — how many rows, and one sample row — without
 * writing anything into the table. Worth doing the first time a destination is set up:
 * a mis-mapped column is much cheaper to notice before a thousand rows land.
 */
export function pushContactsToClay(
  opts: { contactIds?: string[]; limit?: number; dryRun?: boolean } = {},
): Promise<MedhaIdResult<ClayPushResult | ClayDryRun>> {
  return callMedhaId<ClayPushResult | ClayDryRun>({
    path: '/v1/me/clay/push',
    method: 'POST',
    requireAuth: true,
    body: opts,
    tag: 'POST clay push',
  });
}
