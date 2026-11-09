// Data sources sit behind one small interface, so a customer's clients and
// their data come from wherever that customer keeps them, with no client list
// in this repo. Two exist today:
//
//   togari: BMA's Togari, over HTTPS (GET /api/v1/portal/live, read only).
//           Clients, briefs, the replies Togari read and what it did, follow
//           ups and decks. Every call names one client; the server binds every
//           query to it.
//   clay:   campaign numbers, pushed by Chewbacca's sync agent into the
//           StatsHub (lib/freshness.js) and refreshed on demand.

const READS = new Set(["list_replies", "get_investor", "followups", "decks", "summary"]);

// Togari answers in 1 to 3 s on a warm instance (BigQuery behind it); 15 s
// covers a cold start. Guessed from the Slack assistant's timings, never
// measured from Railway to Railway.
const TOGARI_TIMEOUT_MS = 15 * 1000;

// Clients change when a new one is onboarded, which is a deploy of Togari, so
// a minute of caching costs nothing and saves a round trip per question.
const CLIENTS_TTL_MS = 60 * 1000;

export function togariSource({ baseUrl, apiKey, fetchImpl = fetch, now = () => Date.now() }) {
  if (!baseUrl || !apiKey) throw new Error("togari source needs TOGARI_BASE_URL and TOGARI_API_KEY");
  const root = String(baseUrl).replace(/\/$/, "");
  let clientsCache = null;

  async function get(path, params = {}) {
    const url = new URL(`${root}/api/v1/portal/live/${path}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TOGARI_TIMEOUT_MS);
    try {
      const r = await fetchImpl(url, { headers: { "x-togari-key": apiKey, accept: "application/json" }, signal: ctl.signal });
      if (!r.ok) throw new Error(`togari ${path.split("/").pop()} answered ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  return {
    id: "togari",
    async clients() {
      if (clientsCache && now() - clientsCache.at < CLIENTS_TTL_MS) return clientsCache.list;
      const body = await get("clients");
      const list = Array.isArray(body?.clients) ? body.clients : [];
      clientsCache = { at: now(), list };
      return list;
    },
    async client(clientId) {
      return (await this.clients()).find((c) => c.clientId === clientId) || null;
    },
    /** One read for one client. Refuses names outside the read set before any call. */
    async read(clientId, name, input = {}) {
      if (!READS.has(name)) throw new Error(`not a Togari read: ${name}`);
      if (!/^[a-z0-9_]{1,40}$/.test(clientId)) throw new Error("bad client id");
      const body = await get(`${encodeURIComponent(clientId)}/${name}`, input);
      if (body?.clientId !== clientId) throw new Error("togari answered for a different client");
      return { data: body.data, as_of: body.as_of, source: "togari" };
    },
  };
}

export { READS as TOGARI_READS };
