// Types for turn.mjs, the typed agent turn of our layer over Carlton Aikins'
// Realm renderer (github.com/31Carlton7/realm). With these, a call to match()
// that misses a phase is a compile error, not only a throw at run time, the
// way a Rust match on an enum refuses a missing arm.

export type Phase =
  | "asked"
  | "reading"
  | "changing"
  | "proved"
  | "needs-you"
  | "done"
  | "failed";

export type FaultName =
  | "engine-down"
  | "timed-out"
  | "file-unreadable"
  | "diff-unreadable"
  | "git-refused"
  | "tab-unreadable"
  | "stalled"
  | "agent-error"
  | "signed-out"
  | "voice-dropped"
  | "engine-restarted";

export type Fault = {
  readonly name: FaultName;
  readonly what: string;
  readonly fix: string;
  readonly retry: boolean;
  readonly detail: string;
};
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fault: Fault };

export type FileBeat = {
  id: string;
  path: string;
  kind: string;
  done: boolean;
  error: boolean;
  edits?: { before: string; after: string }[];
  text?: string | null;
};
export type CommandBeat = {
  id: string;
  command: string;
  label: string;
  done: boolean;
  error: boolean;
  tail: string[];
};
export type TestsBeat = {
  id?: string;
  command: string;
  done: boolean;
  error: boolean;
  counts: { passed: number; failed: number } | null;
  failing?: string[];
};
export type Review = { root: string; files: { path: string; hunks: unknown[] }[] };

export type Turn =
  | { readonly phase: "asked"; ask: string; at: number; since?: number | null }
  | { readonly phase: "reading"; ask: string; what: string; command: CommandBeat | null; at: number; since?: number | null }
  | { readonly phase: "changing"; ask: string; file: FileBeat; at: number; since?: number | null }
  | { readonly phase: "proved"; ask: string; tests: TestsBeat; at: number; since?: number | null }
  | { readonly phase: "needs-you"; ask: string; question: string; resume: Turn; at: number; since?: number | null }
  | {
      readonly phase: "done";
      ask: string;
      said: string;
      tests: TestsBeat | null;
      review: Review | null;
      stopped: boolean;
      at: number;
      since?: number | null;
    }
  | { readonly phase: "failed"; ask: string; fault: Fault; at: number };

export type Arms<R> = { [P in Phase]: (turn: Extract<Turn, { phase: P }>) => R };

export type Agent = {
  readonly turn: Turn | null;
  readonly inflight: Readonly<Record<string, string>>;
  readonly said: string;
  readonly changes: {
    root: string;
    files: { path: string; additions: number | null; deletions: number | null }[];
    checkpointId: string;
    afterTree: string;
  } | null;
  readonly lastTests: TestsBeat | null;
  readonly folded: readonly string[];
  readonly earlier: number;
  readonly trail: readonly string[];
  readonly trailEarlier: number;
  readonly started: boolean;
  readonly refused: string | null;
  readonly usage: boolean;
  readonly ran: boolean;
};

export type Tile = {
  id: string;
  title: string;
  word: string;
  tone: "running" | "needs" | "done" | "failed";
  line: string;
  turn: Turn;
};
export type Resting = {
  tiles: Tile[];
  moreAgents: number;
  waiting: { id: string; title: string; question: string }[];
  moreWaiting: number;
};
type Truth = {
  state: "running" | "done" | "stopped" | "unreadable";
  lastAt: number | null;
  detail?: string;
  since?: number | null;
  where?: string | null;
};
type SessionLike = {
  id: string;
  title: string;
  status: string;
  providerSessionId?: string | null;
  updatedAt?: number;
};

export const PHASES: readonly Phase[];
export const NEXT: Readonly<Record<Phase, readonly Phase[]>>;
export const FAULTS: Readonly<Record<FaultName, { what: string; fix: string; retry: boolean }>>;
export const FOLD_CHARS: number;
export const FOLD_KEEP: number;
export const MAX_TILES: number;
export const WAIT_KEEP: number;

export const WAITING: string;
export function match<R>(turn: Turn, arms: Arms<R>): R;
export function fault(name: FaultName, detail?: string, fix?: string): Fault;
export function ok<T>(value: T): Result<T>;
export function err(name: FaultName, detail?: string, fix?: string): Result<never>;
export function settle<T>(promise: PromiseLike<T> | T, name: FaultName, ms: number): Promise<Result<T>>;
export function reviewOf<H>(root: string, files: { path: string; hunks: H[] }[]): { root: string; files: { path: string; hunks: H[] }[] } | null;
export function isRunning(turn: Turn): boolean;
export function word(turn: Turn): string;
export function tone(turn: Turn): Tile["tone"];
export function foldLine(turn: Turn): string;
export function beatLine(turn: Turn): string | null;
export function emptyAgent(): Agent;
export function step(agent: Agent, stored: unknown): Agent;
export function withReview(agent: Agent, review: Review | null): Agent;
export function turnFromTruth(truth: Truth, title?: string): Turn;
export function tileTurn(session: SessionLike, agent: Agent | undefined, truth: Truth | null | undefined, truthAsked: boolean): Turn | null;
export function restingView(
  sessions: SessionLike[],
  agents?: Record<string, Agent>,
  truths?: Record<string, Truth | null>,
  asked?: boolean,
  now?: number,
  max?: number,
): Resting;
export const FRESH_FAIL_MS: number;
export const SIGNED_OUT: RegExp;
export function errorFault(message: unknown, fix?: string, failure?: string): Fault;
export function pace(gapMs: number): { push(fn: () => void): void; cancel(): void };
export function atRest(resting: Resting): boolean;
export function focusView(agent: Agent | undefined): {
  turn: Turn | null;
  folded: readonly string[];
  earlier: number;
  trail: readonly string[];
  trailEarlier: number;
};
export function stageObject(turn: Turn | null): "command" | "file" | "tests" | "fault" | null;
export type Clock = { tone: "running" | "needs" | "done"; text: string; short: string | null };
export function carry(from: Turn | null, next: Turn): Turn;
export const USAGE_KINDS: readonly string[];
export function cutByRestart(agent: Agent, bootAt: number, kind?: string): Agent;
export function duration(ms: number): string;
export function clock(turn: Turn | null, now?: number): Clock | null;
export const STOP_ELSEWHERE: Readonly<Record<string, string>>;
export function stopElsewhere(where: string | null | undefined): string;
export const Turn: {
  asked(ask: string, at?: number, since?: number | null): Turn;
  reading(ask: string, what: string, at?: number, command?: CommandBeat | null): Turn;
  changing(ask: string, file: FileBeat, at?: number): Turn;
  proved(ask: string, tests: TestsBeat, at?: number): Turn;
  needsYou(ask: string, question: string, resume: Turn, at?: number): Turn;
  done(ask: string, data?: { said?: string; tests?: TestsBeat | null; review?: Review | null; stopped?: boolean }, at?: number): Turn;
  failed(ask: string, fault: Fault, at?: number): Turn;
};
