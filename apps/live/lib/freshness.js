// Clay campaign numbers, kept fresh without a person.
//
// Clay's public API has no campaign endpoints (developers.clay.com/openapi.json,
// read 2026-10-10: search, tables, routines, workflows, credits, me), and the
// reads that do return campaign analytics run on a signed-in Clay session. So
// the numbers come from Chewbacca's sync agent on a machine signed in to Clay
// (apps/live/agent/live-stats-sync). It long-polls this hub for work, reads
// Clay when a page asks for something older than the bound, and posts the
// result back. The page never waits on it past a timeout and never invents a
// number: a late or failed refresh shows the cached value with its real age.

// Ten minutes: a week of Zeutara sends moves in waves a day or more apart
// (campaigns created 10/3, 10/6, 10/7), so ten-minute-old counts answer every
// question asked between waves. Guessed, never measured against how often
// Jonah asks.
export const STATS_MAX_AGE_MS = 10 * 60 * 1000;

// How long a question waits for a refresh before rendering what it has. The
// agent's full read of Zeutara, 25 campaigns and 50 Clay reads for both
// windows, took 22.8 s on 2026-10-10 (agent/live-stats-sync --once); 35 s
// covers that with margin.
export const REFRESH_WAIT_MS = 35 * 1000;

// The agent long-polls every 25 s, so 90 s without a poll means it is not
// running (Mac asleep, signed out), and waiting for it would only stall.
export const AGENT_GONE_MS = 90 * 1000;

export class StatsHub {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.snaps = new Map(); // `${client}|${window}` -> { as_of, rows, workspace }
    this.wantedSet = new Set();
    this.pollers = [];
    this.waiters = [];
    this.agentSeenAt = 0;
    this.errors = new Map(); // client -> { at, message }
  }

  key(clientId, window) {
    return `${clientId}|${window}`;
  }

  get(clientId, window) {
    return this.snaps.get(this.key(clientId, window)) || null;
  }

  ageMs(snap) {
    return snap ? Math.max(0, this.now() - Date.parse(snap.as_of)) : null;
  }

  agentOnline() {
    return this.now() - this.agentSeenAt <= AGENT_GONE_MS;
  }

  /** The agent posts a fresh read. Rows replace the snapshot whole. */
  put(clientId, window, { as_of, rows, workspace }) {
    if (!["7d", "all"].includes(window)) throw new RangeError(`unknown window ${window}`);
    if (!Array.isArray(rows)) throw new TypeError("rows must be an array");
    if (Number.isNaN(Date.parse(as_of))) throw new TypeError("as_of must be a timestamp");
    const prev = this.get(clientId, window);
    if (prev && Date.parse(prev.as_of) > Date.parse(as_of)) return prev; // an older read lost a race
    const snap = { as_of, rows, workspace: workspace || null };
    this.snaps.set(this.key(clientId, window), snap);
    this.errors.delete(clientId);
    this.wantedSet.delete(clientId);
    this.agentSeenAt = this.now();
    this.waiters = this.waiters.filter((w) => {
      if (w.clientId === clientId && w.window === window && Date.parse(as_of) > w.after) {
        w.resolve(snap);
        return false;
      }
      return true;
    });
    return snap;
  }

  /** The agent reports a read it could not do. Waiters stop waiting. */
  fail(clientId, message) {
    this.errors.set(clientId, { at: new Date(this.now()).toISOString(), message: String(message).slice(0, 200) });
    this.wantedSet.delete(clientId);
    this.agentSeenAt = this.now();
    this.waiters = this.waiters.filter((w) => {
      if (w.clientId === clientId) {
        w.resolve(null);
        return false;
      }
      return true;
    });
  }

  request(clientId) {
    this.wantedSet.add(clientId);
    const pollers = this.pollers;
    this.pollers = [];
    for (const p of pollers) p.resolve([...this.wantedSet]);
  }

  /** Agent long poll: resolves with the clients that need a read, or [] on timeout. */
  wanted(waitMs, setTimer = setTimeout, clearTimer = clearTimeout) {
    this.agentSeenAt = this.now();
    if (this.wantedSet.size) return Promise.resolve([...this.wantedSet]);
    return new Promise((resolve) => {
      const entry = { resolve: (v) => { clearTimer(timer); resolve(v); } };
      const timer = setTimer(() => {
        this.pollers = this.pollers.filter((p) => p !== entry);
        this.agentSeenAt = this.now();
        resolve([]);
      }, waitMs);
      this.pollers.push(entry);
    });
  }

  waitFresh(clientId, window, after, timeoutMs, setTimer = setTimeout, clearTimer = clearTimeout) {
    return new Promise((resolve) => {
      const w = { clientId, window, after, resolve: (v) => { clearTimer(timer); resolve(v); } };
      const timer = setTimer(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        resolve(null);
      }, timeoutMs);
      this.waiters.push(w);
    });
  }

  /**
   * The snapshot a question should render, refreshed first when it is older
   * than the bound. Never throws and never waits past waitMs.
   * Returns { snap, fresh, age_ms, reason } where reason explains a stale one.
   */
  async read(clientId, window, { maxAgeMs = STATS_MAX_AGE_MS, waitMs = REFRESH_WAIT_MS, timers } = {}) {
    const snap = this.get(clientId, window);
    const age = this.ageMs(snap);
    if (snap && age <= maxAgeMs) return { snap, fresh: true, age_ms: age, reason: null };
    const asked = this.now();
    this.request(clientId);
    if (!this.agentOnline()) return this.stale(clientId, snap, "offline");
    const got = await this.waitFresh(clientId, window, snap ? Date.parse(snap.as_of) : -Infinity, waitMs, ...(timers || []));
    if (got) return { snap: got, fresh: true, age_ms: this.ageMs(got), reason: null };
    const err = this.errors.get(clientId);
    return this.stale(clientId, this.get(clientId, window), err && Date.parse(err.at) >= asked ? "failed" : "timeout");
  }

  stale(clientId, snap, reason) {
    const err = this.errors.get(clientId);
    return { snap, fresh: false, age_ms: this.ageMs(snap), reason, error: err ? err.message : null };
  }
}

/** Plain words for a stale answer, shown under the block it applies to. */
export function staleNote(result) {
  if (!result || result.fresh) return null;
  const age = result.age_ms == null ? null : ageWords(result.age_ms);
  const why = {
    offline: "The Clay connection is offline right now",
    timeout: "Clay did not answer in time",
    failed: "Clay refused the refresh",
  }[result.reason] || "These could not be refreshed";
  return age ? `${why}, so these numbers are from ${age} ago.` : `${why}, and no earlier numbers are on file yet.`;
}

export function ageWords(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `${d} days`;
}
