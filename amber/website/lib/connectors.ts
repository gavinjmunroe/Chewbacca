/**
 * CONNECTORS AND COMPANY KEYS, FROM THE BROWSER.
 *
 * The catalogue arrives from the API rather than being duplicated here, for
 * the same reason it lives in code on that side: a list of what we can
 * actually do that is maintained in two places is a list that lies in one of
 * them, and the page would be the one lying.
 */

import { call, tokenNow } from "./amber";

const t = () => tokenNow() ?? undefined;

/*
 * The catalogue type lives beside the catalogue, in lib/connector-catalog.
 * Re-exported here so there is still one name for the shape and nothing that
 * already imports it from this module has to move.
 */
import type { CatalogEntry } from "./connector-catalog";
export type { CatalogEntry, ConnectorAuth } from "./connector-catalog";

export type AddedConnector = {
  id: string;
  provider: string;
  label: string | null;
  status: "added" | "connected" | "error" | "paused";
  config: Record<string, unknown>;
  group_id: string | null;
  group_name: string | null;
  connected_by: string | null;
  connected_by_name: string | null;
  created_at: string;
};

export type OrgApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  last4: string;
  scopes: ("read" | "write" | "admin")[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_by_name: string | null;
};

export const getConnectors = () =>
  call<{ catalog: CatalogEntry[]; added: AddedConnector[] }>("/v1/org/connectors", {}, t());

export const addConnector = (body: {
  provider: string;
  label?: string | null;
  groupId?: string | null;
}) =>
  call<{ connector: AddedConnector }>(
    "/v1/org/connectors",
    { method: "POST", body: JSON.stringify(body) },
    t(),
  );

export const removeConnector = (id: string) =>
  call<{ ok: true }>(`/v1/org/connectors/${id}`, { method: "DELETE" }, t());

export const updateConnector = (
  id: string,
  body: { label?: string | null; status?: AddedConnector["status"] },
) =>
  call<{ connector: AddedConnector }>(
    `/v1/org/connectors/${id}`,
    { method: "PATCH", body: JSON.stringify(body) },
    t(),
  );

/* ----------------------------------------------------------------- keys */

export const getApiKeys = () => call<{ keys: OrgApiKey[] }>("/v1/org/api-keys", {}, t());

/**
 * Mint a key.
 *
 * `secret` in the response is the ONLY time the raw value exists outside the
 * caller's machine. It is not stored, not logged, and cannot be fetched again
 * — a lost key is replaced, not recovered — so whatever calls this has to put
 * it in front of a person immediately.
 */
export const createApiKey = (body: { name: string; scopes: string[] }) =>
  call<{ key: OrgApiKey; secret: string; shownOnce: true }>(
    "/v1/org/api-keys",
    { method: "POST", body: JSON.stringify(body) },
    t(),
  );

export const revokeApiKey = (id: string) =>
  call<{ ok: true }>(`/v1/org/api-keys/${id}`, { method: "DELETE" }, t());
