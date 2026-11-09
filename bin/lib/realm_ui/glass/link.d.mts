// Types for link.mjs, the page's line to Realm's engine on the glass, in our
// layer over Carlton Aikins' Realm renderer (github.com/31Carlton7/realm).
export type LinkSnap = {
  readonly phase: "steady" | "handover" | "down";
  readonly gen: number;
  readonly downAt: number;
  readonly bootId: string;
  readonly bootAt: number;
  readonly restarts: number;
};
export const REDIAL_MS: number;
export const GRACE_MS: number;
export function watchLink(o: {
  client: { onStatusChange(fn: (s: "connected" | "reconnecting") => void): () => void; retryNow(): void };
  info: () => Promise<unknown> | unknown;
  onChange?: (snap: LinkSnap) => void;
  timer?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  now?: () => number;
}): { snapshot(): LinkSnap; stop(): void };
export function staleBuild(mine: string, served: string): boolean;
export function entryOf(scripts: Iterable<string | null | undefined>): string;
