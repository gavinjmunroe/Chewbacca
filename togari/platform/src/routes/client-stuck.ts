/**
 * GET /dash/<token>/stuck.json: the same follow-up queue the daily outcome
 * check DMs Caleb, as JSON, so `chewbacca gtme done` can read it.
 *
 * 2026-10-16: `gtme done --client Zeutara` printed "nobody is waiting on us"
 * while the next morning's digest listed 26 investors needing follow-through.
 * The check never read this queue. Read-only, and it reuses the dashboard's
 * DASHBOARD_TOKENS so no new secret exists.
 *
 * findStuck reads every waiting thread from Clay, so it runs in the
 * background like the dashboard refresh and the route serves the last result.
 * A result too old to trust, or none yet, is a 503, never an empty list.
 */
import type { Request, Response } from "express";
import {
  clayWorkspace,
  getReplybotClient,
} from "../agents/replybot/client-config";
import { findStuck, type Stuck } from "../replies/outcome-check";
import { createLogger } from "../observability/logger";
import { clientForToken } from "./client-dashboard";

const logger = createLogger("ClientStuck");

// 2026-10-17: computing it inside the request ran 228s and Railway's edge
// answered 502 "Application failed to respond". Refresh every 30 minutes;
// guessed, never measured against Clay's rate limits.
const REFRESH_MS = 30 * 60_000;
// Four missed refreshes: past this the answer is "unknown", not "clean".
const MAX_AGE_MS = 2 * 3_600_000;
// How long a request waits on a refresh it started before saying "computing".
const WAIT_MS = 20_000;

interface Cached {
  at: number;
  items: Stuck[];
}

const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<Cached>>();

function liveClient(clientId: string): boolean {
  const client = getReplybotClient(clientId);
  return Boolean(client && clayWorkspace(client));
}

export function refreshStuck(clientId: string): Promise<Cached> {
  const running = inflight.get(clientId);
  if (running) return running;
  const job = findStuck(clientId)
    .then((items) => {
      const entry = { at: Date.now(), items };
      cache.set(clientId, entry);
      return entry;
    })
    .finally(() => inflight.delete(clientId));
  inflight.set(clientId, job);
  return job;
}

/** Test seam: forget every cached result. */
export function resetStuckCache(): void {
  cache.clear();
  inflight.clear();
}

export function startStuckRefresh(): void {
  const tick = () => {
    let ids: string[] = [];
    try {
      ids = [
        ...new Set(
          Object.values(JSON.parse(process.env.DASHBOARD_TOKENS || "{}")).map(
            String,
          ),
        ),
      ].filter(liveClient);
    } catch {
      ids = [];
    }
    for (const id of ids) {
      refreshStuck(id).catch((error) =>
        logger.warn("client_stuck.refresh_failed", {
          clientId: id,
          error: String(error),
        }),
      );
    }
  };
  tick();
  setInterval(tick, REFRESH_MS).unref();
}

export function handleStuck(req: Request, res: Response): Promise<void> {
  // Express passes `next` third, so the clock is never a route parameter.
  return respondStuck(req, res, Date.now());
}

export async function respondStuck(
  req: Request,
  res: Response,
  now: number,
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
  const clientId = clientForToken(String(req.params.token || ""));
  if (!clientId) {
    res.status(404).json({ error: "not found" });
    return;
  }
  // findStuck returns [] for a client with no Clay workspace, which a caller
  // would read as "nobody waiting". Say it could not be checked instead.
  if (!liveClient(clientId)) {
    res.status(503).json({ error: "no Clay workspace for this client" });
    return;
  }
  let entry = cache.get(clientId);
  if (!entry || now - entry.at > MAX_AGE_MS) {
    const job = refreshStuck(clientId);
    job.catch((error) =>
      logger.warn("client_stuck.failed", { clientId, error: String(error) }),
    );
    let timer: NodeJS.Timeout | undefined;
    const fresh = await Promise.race([
      job.catch(() => undefined),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), WAIT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    if (!fresh) {
      res.status(503).json({
        error: "follow-up queue is being computed, try again shortly",
      });
      return;
    }
    entry = fresh;
  }
  res.setHeader("X-Stuck-As-Of", new Date(entry.at).toISOString());
  res.json(
    entry.items.map((s) => ({
      email: s.email,
      company: s.company,
      hours: s.hours,
      reason: s.reason ?? null,
    })),
  );
}
