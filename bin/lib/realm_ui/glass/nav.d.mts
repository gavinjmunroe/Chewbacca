// Types for nav.mjs, so GlassLayer.tsx's calls are checked. Part of our layer over
// Carlton Aikins' Realm renderer (github.com/31Carlton7/realm).
export const NO_PICK: -1;
export const COLS: number;
export const SEED_MAX: number;
export const SEED_EVENTS: number;
export function opening(): { readonly mode: "tiles"; readonly focus: null; readonly picked: -1 };
export function tileKey(
  picked: number,
  n: number,
  key: string,
  cols?: number,
): { picked: number; open: boolean; handled: boolean };
export function tilesReady(state: {
  listed: boolean;
  faulted: boolean;
  needTruth: boolean;
  truthAsked: boolean;
}): boolean;
type Seedable = { id: string; providerSessionId?: string | null; lastEventSeq?: number; updatedAt?: number };
export function toSeed<S extends Seedable>(
  sessions: S[],
  agents?: Record<string, { turn: unknown } | undefined>,
  seeded?: Set<string>,
  max?: number,
): S[];
export function followHis(state: {
  mode: "tiles" | "story" | "work";
  before: string | null;
  after: string | null;
  known: boolean;
  page: boolean;
  pageBefore: boolean;
  pressed: boolean;
}): null | { mode: "tiles" | "story" | "work"; focus: string | null; keep: boolean };
export function barButtons(mode: "tiles" | "story" | "work", focused: boolean): string[];
export function followRow(state: {
  mode: "tiles" | "story" | "work";
  rowActive: boolean;
  focused: string | null;
  known: boolean;
  current: string | null;
}): null | { mode: "tiles" | "story" | "work"; focus: string | null; keep: boolean };
