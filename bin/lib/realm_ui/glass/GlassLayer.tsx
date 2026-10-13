// Realm on the Chewbacca glass: the layer of ours over Carlton Aikins' Realm
// renderer (github.com/31Carlton7/realm). His app runs underneath, untouched;
// this draws what makes it an OS surface instead of a window:
//
//   frame    his window chrome, never hidden: the rail, the session sidebar,
//            back and forward, search, New session, the side panel toggle.
//            Everything below draws inside his main pane, where his
//            transcript goes (skills/hud/SKILL.md, "His navigation stays")
//   bar      over his frame: All agents, Story and Transcript, New agent,
//            Close, each a labeled button in every mode
//   tiles    every agent as a tile in his main pane
//   grow     pressing a tile grows it into the story of its turn in one
//            continuous morph of light; Escape shrinks it back into its tile
//   story    the agent's turn told by the screen, one region per job
//            (Story.tsx); Transcript or Reply opens his full workspace, and
//            Escape there comes back to the story
//   stage    beside the conversation, only while there is something on it:
//            the file the agent is editing with the changed lines lit, the
//            command it is running (folded away after), the tests when they
//            run, and when the turn settles its diff as hunks to Keep or Reject
//   voice    the HUD talk key fills the focused agent's reply, opens his
//            palette or names a file with @; sending is always a press
//
// What it draws comes from one value per agent, turn.mjs's typed turn (asked,
// reading, changing, proved, needs-you, done, failed), never from loose
// flags; every failure is a named fault with the one thing to do; and the
// resting view is the same size at twenty agents as at three (Daniel Thomas's
// review, 2026-10-11: "oddly similar to rust's design philosophy").
//
// Template: a workspace surface on the HUD, the content as itself (the agent,
// its file, its terminal, its diff). Stance: Carlton's quiet instrument. Type,
// spacing, colour and motion are his tokens (theme/tokens.css) and his ladder
// (design.md, Motion). Data comes from his engine's contract (sessions.*,
// workspace.*) through his own rpc client.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { StoreApi } from "zustand";
import { AGENT_META } from "@realm/contracts";
import { Icon } from "@realm/ui";
import { rpc } from "../src/rpc/client";
import type { AppState } from "../src/state/store";
import { Spinner } from "../src/components/Spinner";
import { Story } from "./Story";
import { NO_PICK, SEED_EVENTS, barButtons, escapeOn, followHis, followRow, opening, tileKey, tilesReady, toSeed } from "./nav.mjs";
import { editRange, excerpt, lostFocus, reviewDecided, voiceIntent } from "./model.mjs";
import {
  atRest,
  emptyAgent,
  pace,
  fault,
  focusView,
  stageObject,
  match,
  restingView,
  reviewOf,
  settle,
  step,
} from "./turn.mjs";
import type {
  Agent,
  CommandBeat,
  Fault,
  FileBeat,
  Resting,
  Result,
  TestsBeat,
  Turn,
} from "./turn.mjs";

export type Session = {
  id: string;
  spaceId: string;
  agentKind: string;
  status: string;
  title: string;
  cwd: string;
  lastEventSeq?: number;
  providerSessionId?: string | null;
  updatedAt?: number;
  createdAt?: number;
};
type Stored = {
  seq: number;
  sessionId: string;
  event: { type: string; ts?: number; payload?: Record<string, unknown> };
};
type Truth = {
  state: "running" | "done" | "stopped" | "unreadable";
  lastAt: number | null;
  detail?: string;
};
// Turn, Agent, Fault and friends are turn.mjs's, typed in turn.d.mts, so a
// match() with a phase missing is a compile error here.
type Rect = { left: number; top: number; width: number; height: number };
// tiles: every agent. story: one agent's turn told by the screen. work: his
// full workspace, the transcript, one press from the story.
type Mode = "tiles" | "story" | "work";
type Hunk = {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: {
    kind: string;
    text: string;
    oldLine: number | null;
    newLine: number | null;
  }[];
};

// His `--dur-move` (320) for a thing travelling across the pane, and
// `--dur-slow` (240) for the shorter way back: exits are shorter (design.md).
const GROW_MS = 320;
const SHRINK_MS = 240;
// The page tells the server it still has the glass this often, so hud-listen
// can trust a report no older than FOCUS_FRESH_MS (45 s) in glass_routes.mjs.
const FOCUS_BEAT_MS = 20_000;
// The fewest milliseconds between two focus reports. Measured 2026-10-11,
// headless WebKit, seventeen fake agents taking turns: the tiles reordered on
// every turn and the old page posted /glass/focus 340 times a minute (170 in
// 30 s). hud-listen reads the report when he presses the talk key, and a
// press within a second of a reorder is rare; guessed, never measured with him.
const FOCUS_MIN_GAP_MS = 1_000;
// How often the tiles ask what their tabs are really doing (/glass/tabs),
// while the tiles are shown and some tile is working or waiting on him: a
// turn flips Working to Done within this long. Each ask stats and tails the
// transcripts, 49 ms for twelve cold (realm-tiles-truth-report.md). Guessed
// against his eye, never measured with him.
const TRUTH_BEAT_MS = 5_000;
// The same ask with every tile at rest. Measured 2026-10-11 on a scratch
// engine with three settled agents, headless WebKit, 60 s idle: at 5 s the
// page made 12 /glass/tabs asks a minute that all answered "nothing changed".
// A tab that starts a turn at rest was started by him in its own window, so
// he already knows; 30 s matches the session list's own refresh (below).
const TRUTH_REST_MS = 30_000;
// The session list is refetched this often while shown, for a session made
// outside this page that no event has named yet. Guessed; realm pushes every
// status change for sessions it knows, so this is only the fallback.
const SESSIONS_BEAT_MS = 30_000;
// How long an engine call may take before it is a timed-out fault on the
// glass with a Retry, never a silent blank. Measured 2026-10-11 at load 16:
// sessions.listAll on the live engine (17 sessions) p50 0.9 ms, max 18 ms;
// sessions.events (400) max 4.8 ms. 5 s is over 250 times the worst seen, and
// half server.mjs's ENGINE_HANDSHAKE_MS (10 s) for an engine still migrating.
const ENGINE_ANSWER_MS = 5_000;
// How long after his press a change of his focus still counts as his: one
// engine answer, the budget every engine call gets here, since his sidebar's
// open waits on revealSession.
const PRESS_MS = ENGINE_ANSWER_MS;
// His main pane, where his transcript goes: the tiles and the story draw
// over it, below his frame-top band, so his rail, sidebar, pane bar and
// window chrome stay on screen and pressable in every mode.
const MAIN = "#root .app > .main";
const OVERLAY =
  '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[aria-modal="true"]';

const glassToken = () =>
  String(
    (window as unknown as { realm?: { token?: string } }).realm?.token ?? "",
  );
const glassFetch = (path: string, init: RequestInit = {}) =>
  fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "X-Glass-Token": glassToken(),
      "Content-Type": "application/json",
    },
  });

const reduceMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const base = (path: string) => path.split("/").filter(Boolean).pop() ?? path;
const joinPath = (cwd: string, p: string) =>
  p.startsWith("/") ? p : `${cwd.replace(/\/$/, "")}/${p}`;
const relTo = (cwd: string, p: string) =>
  p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p;
const age = (ms?: number) => {
  if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
const dismissGlass = () =>
  (
    window as unknown as {
      webkit?: {
        messageHandlers?: { realmGlass?: { postMessage: (m: string) => void } };
      };
    }
  ).webkit?.messageHandlers?.realmGlass?.postMessage("dismiss");

/** The session his focused pane shows, read off his layout and items. */
function focusedSession(s: AppState): string | null {
  const st = s as unknown as {
    layout: unknown;
    focusedLeafId: string | null;
    items: { id: string; kind: string; refId: string }[];
  };
  let itemId: string | null = null;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object" || itemId) return;
    const n = node as {
      type?: string;
      id?: string;
      itemId?: string | null;
      children?: unknown[];
      a?: unknown;
      b?: unknown;
    };
    if (n.type === "leaf" && n.id === st.focusedLeafId)
      itemId = n.itemId ?? null;
    for (const child of [...(n.children ?? []), n.a, n.b]) walk(child);
  };
  walk(st.layout);
  const item = itemId ? (st.items ?? []).find((i) => i.id === itemId) : null;
  return item && item.kind === "session" ? item.refId : null;
}

function useShown(): { shown: boolean; opens: number } {
  // Inside Kyber the page is kept loaded off the glass between openings, so
  // only Kyber can say it is shown: it calls window.__realmGlassShown(true|
  // false) as it attaches and detaches the page (AppPane.swift). Until then
  // it is hidden, or a page warmed at launch would claim the talk key while
  // nothing is on the glass. Hidden visibility always counts as not shown.
  // A browser outside Kyber (the headless checks) uses visibility alone.
  const inKyber = Boolean(
    (
      window as unknown as {
        webkit?: { messageHandlers?: { realmGlass?: unknown } };
      }
    ).webkit?.messageHandlers?.realmGlass,
  );
  const [shown, setShown] = useState(
    () => !inKyber && document.visibilityState === "visible",
  );
  // Counts every time Kyber says the page is shown, even when it already
  // was: a surface drawn again over a page that never left still opens on
  // the tiles (10/12 3:38pm, it reopened on the story of the last agent).
  const [opens, setOpens] = useState(0);
  useEffect(() => {
    const w = window as unknown as { __realmGlassShown?: (v: boolean) => void };
    // What Kyber last said, so a page attached a frame before its window
    // became visible still turns shown once it does.
    let kyberSays = false;
    w.__realmGlassShown = (v) => {
      kyberSays = Boolean(v);
      setShown(kyberSays && document.visibilityState !== "hidden");
      if (kyberSays) setOpens((n) => n + 1);
    };
    const vis = () => {
      if (document.visibilityState === "hidden") setShown(false);
      else setShown(inKyber ? kyberSays : true);
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      delete w.__realmGlassShown;
    };
  }, [inKyber]);
  return { shown, opens };
}

/** What the renderer it was built from offers a host (install.tsx). Caleb's
 *  fork of Realm (github.com/calebnewtonusc/realm, branch chewbacca) has
 *  each; Carlton's own checkout has none, and the layer works around that. */
export type Host = {
  /** Pause his looping decoration while his app is hidden under ours. */
  setQuiet?: (quiet: boolean) => void;
  /** Each composer names its session (data-session-id). */
  namedComposers: boolean;
};

export function GlassLayer({
  store,
  host = { namedComposers: false },
}: {
  store: StoreApi<AppState>;
  host?: Host;
}) {
  const { shown, opens } = useShown();
  const [mode, setMode] = useState<Mode>("tiles");
  const [focus, setFocus] = useState<string | null>(null);
  // Nothing is picked until he picks: Return and the talk key reach only a
  // tile he chose (nav.mjs NO_PICK).
  // Held as the agent's id, never a slot: the tiles reorder on every tab
  // poll and live event, and a slot would hand Return or the talk key to
  // whichever agent moved into it (review of the 10/12 fix).
  const [pickedId, setPickedId] = useState<string | null>(null);
  // Every agent drawn as a tile, not only the first MAX_TILES: his "Show
  // all" under the tiles. Back to nine on every opening.
  const [everyone, setEveryone] = useState(false);
  const [sessions, setSessions] = useState<Record<string, Session>>({});
  // One typed agent per session (turn.mjs), stepped from realm's events.
  // Each holds its current turn and a few one-line folds, never history.
  const [agents, setAgents] = useState<Record<string, Agent>>({});
  const [truths, setTruths] = useState<Record<string, Truth | null>>({});
  const [truthAsked, setTruthAsked] = useState(false);
  // A failure that belongs to no one agent: the engine, the talk key.
  const [engineFault, setEngineFault] = useState<Fault | null>(null);
  const [voiceFault, setVoiceFault] = useState<Fault | null>(null);
  // Whether the session list has ever come back. Until it has, an empty
  // field means "not known yet", never "No agents yet".
  const [listed, setListed] = useState(false);
  const [light, setLight] = useState<{
    rect: Rect;
    to: Rect | null;
    ms: number;
    out: boolean;
  } | null>(null);
  // The tiles stay drawn while they fade under the growing light, so no
  // frame of the morph is empty (hud/CLAUDE.md motion rule 10).
  const [leaving, setLeaving] = useState(false);
  const tileRefs = useRef(new Map<string, HTMLElement>());
  const morphing = useRef(false);
  // Which morph is running. A press that lands mid-morph (All agents,
  // Escape, his Home) ends it and wins; the morph's own frames and timers
  // see a newer generation and do nothing. Before 10/12 such a press was
  // dropped: headless WebKit, Home 200 ms after a tile grew, stayed put.
  const morphGen = useRef(0);
  const modeRef = useRef<Mode>("tiles");
  modeRef.current = mode;
  const focusRef = useRef<string | null>(null);
  focusRef.current = focus;

  const booted = useSyncExternalStore(
    store.subscribe,
    () => store.getState().booted,
  );
  // Whether one of his rail pages (Code review, Library...) is up over his
  // main pane. The bar's Story and Transcript close it, so neither reads as
  // showing while his page is what's on screen.
  const pageUp = useSyncExternalStore(store.subscribe, () =>
    Boolean((store.getState() as unknown as { pageOverlay?: unknown }).pageOverlay),
  );
  const closePage = useCallback(
    () => (store.getState() as unknown as { closePageOverlay?: () => void }).closePageOverlay?.(),
    [store],
  );

  // Sessions, from his engine's contract. Refetched on boot, on a status
  // change for a session it has not seen, and every SESSIONS_BEAT_MS while
  // shown. A failure is the engine-down fault on the glass, not "No agents".
  const load = useCallback(() => {
    void (
      settle(
        rpc().call("sessions.listAll", { profileId: null }),
        "engine-down",
        ENGINE_ANSWER_MS,
      )
    ).then((r) => {
      if (!r.ok) {
        setEngineFault(r.fault);
        return;
      }
      const next: Record<string, Session> = {};
      for (const s of r.value as Session[]) next[s.id] = s;
      setSessions(next);
      setListed(true);
      setEngineFault(null);
    });
  }, []);
  // His store boots only once the engine answers. A page that hasn't
  // booted by ENGINE_ANSWER_MS is the engine being down, said so; before this
  // the glass read "No agents yet" with the engine stopped (2026-10-11,
  // headless WebKit, scratch engine stopped).
  useEffect(() => {
    if (booted) return;
    const t = window.setTimeout(
      () => setEngineFault(fault("engine-down", "the page never reached the engine")),
      ENGINE_ANSWER_MS,
    );
    return () => window.clearTimeout(t);
  }, [booted]);
  useEffect(() => {
    if (!booted) return;
    load();
    const offStatus = rpc().on("session.status", ({ sessionId, status }) => {
      setSessions((prev) => {
        const s = prev[sessionId];
        if (!s) {
          load();
          return prev;
        }
        return s.status === status
          ? prev
          : { ...prev, [sessionId]: { ...s, status, updatedAt: Date.now() } };
      });
    });
    const offEvent = rpc().on("session.event", (ev) => {
      const stored = ev as unknown as Stored;
      setAgents((prev) => {
        const was = prev[stored.sessionId] ?? (emptyAgent());
        const now = step(was, stored);
        return now === prev[stored.sessionId] ? prev : { ...prev, [stored.sessionId]: now };
      });
    });
    return () => {
      offStatus();
      offEvent();
    };
  }, [booted, load]);
  useEffect(() => {
    if (!booted || !shown) return;
    const t = window.setInterval(load, SESSIONS_BEAT_MS);
    return () => window.clearInterval(t);
  }, [booted, shown, load]);

  // Opening "show my agents" lands on the tiles, every time, with nothing
  // focused and nothing picked (nav.mjs opening()).
  useEffect(() => {
    if (!shown) return;
    const first = opening();
    setMode(first.mode);
    setFocus(first.focus);
    setPickedId(null);
    setEveryone(false);
    setLight(null);
    morphing.current = false;
  }, [shown, opens]);
  useEffect(() => {
    document.documentElement.setAttribute("data-glass", mode);
    // His app is drawn only in the workspace; under the tiles and the story
    // it is hidden, and its loops have no one to run for.
    host.setQuiet?.(mode !== "work");
  }, [mode, host]);

  // Realm's own sessions say only "ended" or "idle" in the list; their last
  // events say whether the turn died, and why. Read once per event seq.
  const seeded = useRef(new Set<string>());
  useEffect(() => {
    if (!booted) return;
    const want = toSeed(Object.values(sessions), agents, seeded.current);
    for (const s of want) {
      // Marked while in flight so a re-render doesn't ask twice; unmarked on
      // a failed read so the next list asks again.
      const key = `${s.id}:${s.lastEventSeq}`;
      seeded.current.add(key);
      void (
        settle(
          rpc().call("sessions.events", {
            id: s.id,
            afterSeq: Math.max(0, (s.lastEventSeq ?? 0) - SEED_EVENTS),
            limit: SEED_EVENTS,
          }),
          "engine-down",
          ENGINE_ANSWER_MS,
        )
      ).then((r) => {
        // A failed read leaves the tile on realm's word until the next try.
        if (!r.ok) {
          seeded.current.delete(key);
          return;
        }
        let a = emptyAgent();
        for (const ev of r.value as Stored[]) a = step(a, ev);
        if (a.turn)
          // Never over anything a live event already stepped.
          setAgents((prev) => (prev[s.id] ? prev : { ...prev, [s.id]: a }));
      });
    }
  }, [booted, sessions, agents]);

  // What each session's Claude Code tab is really doing, keyed by the CLI's
  // session id. Asked for every session, not just the drawn nine, since the
  // answer decides which nine are drawn.
  const providerIds = useMemo(
    () =>
      Object.values(sessions)
        .map((s) => s.providerSessionId)
        .filter((id): id is string => Boolean(id))
        .sort()
        .join(","),
    [sessions],
  );
  // Whether any tile is working or waiting on him decides how often to ask
  // (TRUTH_BEAT_MS, else TRUTH_REST_MS). Computed from the last answer.
  const resting = useMemo(
    () =>
      restingView(Object.values(sessions), agents, truths, truthAsked, Date.now(), everyone ? Infinity : undefined),
    [sessions, agents, truths, truthAsked, everyone],
  );
  const busy = !atRest(resting);
  // Read through refs so a tile changing tone never restarts the ask: on
  // 2026-10-11, with seventeen agents taking turns, depending on it directly
  // made 679 asks a minute (headless WebKit, scratch engine).
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    if (!booted || !shown || mode !== "tiles" || !providerIds) return;
    let live = true;
    let timer = 0;
    const ids = providerIds.split(",");
    const again = () => {
      if (live) timer = window.setTimeout(ask, busyRef.current ? TRUTH_BEAT_MS : TRUTH_REST_MS);
    };
    const ask = () =>
      void (
        settle(
          glassFetch(`/glass/tabs?ids=${encodeURIComponent(providerIds)}`).then(
            async (r) => {
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              return (await r.json()) as { tabs?: Record<string, Truth | null> };
            },
          ),
          "tab-unreadable",
          ENGINE_ANSWER_MS,
        )
      ).then((r) => {
        if (!live) return;
        setTruthAsked(true);
        again();
        if (r.ok && r.value.tabs) {
          // An id the server didn't answer for (not a Claude Code id: a
          // Codex session, realm's own fake) has no transcript here, so
          // realm's status speaks for it. Left out, its tile never drew:
          // twenty fake agents read "No agents yet" (2026-10-11).
          setTruths({ ...Object.fromEntries(ids.map((id) => [id, null])), ...r.value.tabs });
          return;
        }
        // The ask itself failed: every imported tile is unknown, said so.
        const detail = r.ok ? "no tabs in the answer" : r.fault.detail;
        setTruths(
          Object.fromEntries(
            ids.map((id) => [id, { state: "unreadable", lastAt: null, detail }]),
          ),
        );
      });
    ask();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [booted, shown, mode, providerIds]);

  const tiles = resting.tiles;
  const picked = pickedId ? tiles.findIndex((t) => t.id === pickedId) : NO_PICK;
  const pick = useCallback(
    (i: number) => setPickedId(i >= 0 ? (resting.tiles[i]?.id ?? null) : null),
    [resting],
  );

  // His frame is on screen in every mode now, so a press of his (a sidebar
  // row, his palette, his New session, a rail page) moves the glass to
  // where that press shows: a known agent's story, a new session's
  // transcript, his page in the workspace (nav.mjs followHis). Only a
  // change of his focus counts, never a focus that sat there.
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  // When he last pressed or typed in his frame. A focus change within
  // PRESS_MS of one is his; any other (his boot restoring the last layout,
  // a session ending) moves nothing.
  const pressedAt = useRef(0);
  useEffect(() => {
    // A pointer press, or a key that can pick something (Return in his
    // palette, a ⌘ or ⌃ chord like ⌘N). Typing in his composer never
    // counts, or every keystroke would hold the gate open (review, 10/12).
    const mark = (e: Event) => {
      const t = e.target as Element | null;
      if (!t?.closest?.("#root")) return;
      if (e instanceof KeyboardEvent && !(e.key === "Enter" || e.metaKey || e.ctrlKey)) return;
      pressedAt.current = Date.now();
    };
    document.addEventListener("pointerdown", mark, true);
    document.addEventListener("keydown", mark, true);
    return () => {
      document.removeEventListener("pointerdown", mark, true);
      document.removeEventListener("keydown", mark, true);
    };
  }, []);
  useEffect(() => {
    const pageOf = (s: AppState) =>
      Boolean((s as unknown as { pageOverlay?: unknown }).pageOverlay);
    let before = focusedSession(store.getState());
    let pageBefore = pageOf(store.getState());
    // Until his app has booted, every focus change is his boot restoring
    // the last layout, never a press: it is only recorded as the baseline.
    let bootedSeen = Boolean(store.getState().booted);
    // A press moved the glass: whatever morph was running ends, so its
    // frames can't fly a light into a tile while the story shows.
    const take = (next: { mode: Mode; focus: string | null; keep: boolean }) => {
      if (!next.keep && next.focus === focusRef.current && next.mode === modeRef.current) return;
      morphGen.current += 1;
      morphing.current = false;
      setLight(null);
      setLeaving(false);
      if (!next.keep) setFocus(next.focus);
      setMode(next.mode);
    };
    const consider = (s: AppState) => {
      const after = focusedSession(s);
      const page = pageOf(s);
      if (!bootedSeen) {
        bootedSeen = Boolean(s.booted);
        before = after;
        pageBefore = page;
        return;
      }
      const next = followHis({
        mode: modeRef.current,
        before,
        after,
        known: Boolean(after && sessionsRef.current[after]),
        page,
        pageBefore,
        pressed: Date.now() - pressedAt.current < PRESS_MS,
      });
      before = after;
      pageBefore = page;
      // Never dropped while a morph runs: a press during the 320 ms grow
      // was lost in the first build (the 4:50pm run, story to sidebar row).
      if (next) take(next);
    };
    // A press on the session row his app already shows changes nothing in
    // his store, so it is read off the row itself (nav.mjs followRow).
    const onRow = (e: MouseEvent) => {
      const t = e.target as Element | null;
      const row = t?.closest?.('.sidebar .sb-row[data-actions="1"]');
      if (!row || !t?.closest?.(".item-row") || e.metaKey) return;
      const rowActive = row.hasAttribute("data-active");
      if (!rowActive) return;
      const focused = focusedSession(store.getState());
      const next = followRow({
        mode: modeRef.current,
        rowActive,
        focused,
        known: Boolean(focused && sessionsRef.current[focused]),
        current: focusRef.current,
      });
      if (next) take(next);
    };
    document.addEventListener("click", onRow, true);
    const off = store.subscribe(consider);
    return () => {
      off();
      document.removeEventListener("click", onRow, true);
    };
  }, [store]);

  // Tell the server who has the glass, for hud-listen's voice path.
  const target = mode === "tiles" ? (tiles[picked]?.id ?? null) : focus;
  const targetTitle = (target && sessions[target]?.title) || "";
  const focusPace = useMemo(() => pace(FOCUS_MIN_GAP_MS), []);
  useEffect(() => () => focusPace.cancel(), [focusPace]);
  useEffect(() => {
    // A refused report means the talk key can't reach this page: said so.
    const report = () =>
      glassFetch("/glass/focus", {
        method: "POST",
        body: JSON.stringify({
          shown,
          mode,
          sessionId: target,
          title: targetTitle,
        }),
      }).then(
        (r) =>
          setVoiceFault(r.ok ? null : (fault("voice-dropped", `HTTP ${r.status}`))),
        (e) => setVoiceFault(fault("voice-dropped", String(e?.message ?? e))),
      );
    focusPace.push(() => void report());
    if (!shown) return;
    const t = window.setInterval(() => focusPace.push(() => void report()), FOCUS_BEAT_MS);
    return () => window.clearInterval(t);
  }, [shown, mode, target, targetTitle, focusPace]);

  // The morph lands on his main pane, where the story and his transcript
  // draw, never on the whole glass (his sidebar and rail stay put).
  const workRect = (): Rect =>
    rectOf(document.querySelector(MAIN)) ?? {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  const rectOf = (el: Element | null | undefined): Rect | null => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  };

  // One morph per change: a lit outline leaves the tile and lands on the
  // workspace (hud/CLAUDE.md, the light morph), his app comes up under it,
  // then the light goes out. Under Reduce Motion nothing travels.
  const grow = useCallback(
    (id: string, land: Mode = "story") => {
      const s = sessions[id];
      if (!s) return;
      // A tile pressed while the shrink still flies: the press wins.
      if (morphing.current) morphGen.current += 1;
      setFocus(id);
      void (
        settle(
          store.getState().revealSession(id, s.spaceId),
          "engine-down",
          ENGINE_ANSWER_MS,
        )
      ).then((r) => {
        if (!r.ok) setEngineFault(r.fault);
        // false is his store saying the session has no pane item of its own,
        // which every imported tab says and which still opens (10/12).
      });
      const from = rectOf(tileRefs.current.get(id)) ?? {
        left: window.innerWidth / 2 - 130,
        top: window.innerHeight / 2 - 70,
        width: 260,
        height: 140,
      };
      if (reduceMotion()) {
        setMode(land);
        return;
      }
      morphing.current = true;
      const gen = ++morphGen.current;
      const live = () => morphGen.current === gen;
      setLeaving(true);
      setLight({ rect: from, to: null, ms: GROW_MS, out: false });
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!live()) return;
          setMode(land);
          setLight({ rect: from, to: workRect(), ms: GROW_MS, out: false });
          window.setTimeout(
            () => live() && setLight((l) => (l ? { ...l, out: true } : l)),
            GROW_MS,
          );
          window.setTimeout(() => live() && setLeaving(false), GROW_MS);
          window.setTimeout(() => {
            if (!live()) return;
            setLight(null);
            morphing.current = false;
          }, GROW_MS + 160);
        }),
      );
    },
    [sessions, store],
  );

  const shrink = useCallback(() => {
    const id = focusRef.current;
    // Back on the tiles, the agent he came from is the picked one.
    if (id) setPickedId(id);
    if (morphing.current || reduceMotion()) {
      // Mid-morph, his press wins: the morph ends where it is.
      morphGen.current += 1;
      morphing.current = false;
      setLight(null);
      setLeaving(false);
      setMode("tiles");
      return;
    }
    morphing.current = true;
    const gen = ++morphGen.current;
    const live = () => morphGen.current === gen;
    const from = workRect();
    setLight({ rect: from, to: null, ms: SHRINK_MS, out: false });
    setMode("tiles");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!live()) return;
        const to = rectOf(id ? tileRefs.current.get(id) : null) ?? from;
        setLight({ rect: from, to, ms: SHRINK_MS, out: false });
        window.setTimeout(
          () => live() && setLight((l) => (l ? { ...l, out: true } : l)),
          SHRINK_MS,
        );
        window.setTimeout(() => {
          if (!live()) return;
          setLight(null);
          morphing.current = false;
        }, SHRINK_MS + 160);
      }),
    );
  }, [tiles]);

  // His rail's Home is "Back to your sessions" (Rail.tsx). On the glass his
  // sessions are the tiles, so Home goes there, and closes a rail page he
  // had open, as his goHome does. Only that one button; the rest of his
  // rail is his.
  useEffect(() => {
    const onPress = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest?.('.app-rail .rail-btn[aria-label="Home"]')) return;
      e.preventDefault();
      e.stopPropagation();
      (store.getState() as unknown as { closePageOverlay?: () => void }).closePageOverlay?.();
      if (modeRef.current !== "tiles") shrink();
    };
    document.addEventListener("click", onPress, true);
    return () => document.removeEventListener("click", onPress, true);
  }, [store, shrink]);

  // Where his main pane is, as four CSS variables the tiles, the story and
  // the notice are placed by (glass.css, .glass-pane). Measured, never
  // guessed: his sidebar is resizable and folds.
  useEffect(() => {
    const root = document.documentElement;
    let el: Element | null = null;
    const put = () => {
      el = document.querySelector(MAIN);
      const r = el?.getBoundingClientRect();
      if (!r || r.width < 2) return;
      root.style.setProperty("--glass-main-x", `${Math.round(r.left)}px`);
      root.style.setProperty("--glass-main-y", `${Math.round(r.top)}px`);
      root.style.setProperty("--glass-main-w", `${Math.round(r.width)}px`);
      root.style.setProperty("--glass-main-h", `${Math.round(r.height)}px`);
    };
    const ro = new ResizeObserver(put);
    const watch = () => {
      const next = document.querySelector(MAIN);
      if (!next || next === el) return;
      ro.disconnect();
      ro.observe(next);
      const app = document.querySelector("#root .app");
      if (app) ro.observe(app);
      put();
    };
    watch();
    put();
    // His Main remounts across first run and boot; look again on each
    // store change that could swap it. One querySelector, and a measure
    // (a layout read) only when the element changed: his store fires on
    // every streamed event.
    const off = store.subscribe(watch);
    window.addEventListener("resize", put);
    return () => {
      off();
      ro.disconnect();
      window.removeEventListener("resize", put);
    };
  }, [store, booted]);

  // Escape: bridge.js asks us first (window.__realmGlass.onEscape). In the
  // workspace it shrinks back to the tiles unless his page has a use for the
  // key (a dialog, menu or list is open, or the editor or a terminal has it).
  useEffect(() => {
    const w = window as unknown as {
      __realmGlass?: { onEscape: () => boolean };
    };
    w.__realmGlass = {
      onEscape: () => {
        const f = document.activeElement;
        const where = escapeOn({
          mode: modeRef.current,
          overlay: Boolean(document.querySelector(OVERLAY)),
          typing: Boolean(f && f !== document.body && f.closest?.('input,textarea,select,[contenteditable=""],[contenteditable="true"]')),
          editor: Boolean(f && f.closest?.(".cm-editor,.xterm")),
        });
        if (where === "his") return false;
        (f as HTMLElement | null)?.blur?.();
        // The transcript steps back to the story; the story to the tiles.
        if (where === "story") setMode("story");
        else shrink();
        return true;
      },
    };
    return () => {
      delete w.__realmGlass;
    };
  }, [shrink]);

  // Keys never reach his main pane while ours covers it. His app keeps
  // focus there (his permission card focuses its Allow), and on the 10/12
  // evening rehearsal a Return on the story answered Allow through his
  // hidden card: past our 400 ms guard and our whole-request-in-view gate.
  // Stopped at the window, before it reaches his card; our own listeners
  // are on the window too and still hear it. Escape is bridge.js's.
  //
  // His pane is `inert` while covered, so nothing in it can hold focus or be
  // clicked: stopping his React handlers alone left the browser's own Return
  // on his focused Allow button, which clicks it (review of this change,
  // 10/12). `hold` is the second line: Return and Space aimed at the pane
  // are cancelled outright, down and up, and nothing else reaches him.
  useEffect(() => {
    if (mode === "work") return;
    const cover = () => {
      const el = document.querySelector<HTMLElement>(MAIN);
      if (el && !el.inert) el.inert = true;
    };
    cover();
    // His Main remounts across boot and layout changes.
    const off = store.subscribe(cover);
    const hold = (e: KeyboardEvent) => {
      const t = e.target as Element | null;
      if (e.key === "Escape" || !t?.closest?.(MAIN)) return;
      if (e.key === "Enter" || e.key === " ") e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", hold, true);
    window.addEventListener("keyup", hold, true);
    return () => {
      off();
      window.removeEventListener("keydown", hold, true);
      window.removeEventListener("keyup", hold, true);
      const el = document.querySelector<HTMLElement>(MAIN);
      if (el) el.inert = false;
    };
  }, [mode, store]);

  // Arrows walk the tiles, Return grows one, 1 to 9 open one, while nothing
  // of his is open. A field under the tiles (his main pane) isn't his
  // typing: he can't see it.
  useEffect(() => {
    if (mode !== "tiles") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector(OVERLAY)) return;
      // Only keys with no control of his focused: on the body, a tile, or
      // his covered pane. A focused row in his sidebar or rail keeps its own
      // keys (this listener is on the capture phase, before his).
      const t = document.activeElement;
      if (t && t !== document.body && !t.classList.contains("glass-tile") && !t.closest?.(MAIN)) return;
      const k = tileKey(picked, tiles.length, e.key);
      if (!k.handled) return;
      e.preventDefault();
      pick(k.picked);
      const tile = tiles[k.picked];
      if (k.open && tile) grow(tile.id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mode, tiles, picked, grow, pick]);

  // Voice from the HUD talk key, through realm-ui's /glass/events.
  useEffect(() => {
    if (!booted) return;
    let stop = false;
    let ctrl: AbortController | null = null;
    const listen = async () => {
      while (!stop) {
        ctrl = new AbortController();
        try {
          const res = await glassFetch("/glass/events", {
            signal: ctrl.signal,
          });
          const reader = res.body?.getReader();
          if (!res.ok || !reader) throw new Error(`HTTP ${res.status}`);
          setVoiceFault(null);
          const dec = new TextDecoder();
          let buf = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let nl;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, nl);
              buf = buf.slice(nl + 1);
              try {
                const msg = JSON.parse(line) as { type: string; text?: string };
                if (msg.type === "voice" && msg.text)
                  window.dispatchEvent(
                    new CustomEvent("realm-glass-voice", { detail: msg.text }),
                  );
              } catch {
                // Expected: the last line of a dropped stream arrives cut.
              }
            }
          }
        } catch (e) {
          // The server restarted, or this page is going away. Said on the
          // glass until the next connect clears it.
          if (!stop)
            setVoiceFault(
              fault("voice-dropped", String((e as Error)?.message ?? e)),
            );
        }
        if (!stop) await new Promise((r) => setTimeout(r, 2000));
      }
    };
    void listen();
    return () => {
      stop = true;
      ctrl?.abort();
    };
  }, [booted]);

  useEffect(() => {
    const onVoice = (e: Event) => {
      const said = String((e as CustomEvent).detail ?? "");
      const intent = voiceIntent(said) as {
        kind: string;
        query?: string;
        name?: string;
        text?: string;
      };
      const st = store.getState();
      if (intent.kind === "palette" || intent.kind === "find") {
        st.setPaletteOpen(true, intent.kind === "find" ? "grep" : "all");
        fillWhenThere(
          '.palette input, [role="dialog"] input',
          intent.query ?? "",
        );
        return;
      }
      const insert =
        intent.kind === "mention" ? `@${intent.name}` : (intent.text ?? said);
      const who =
        modeRef.current === "tiles" ? tiles[picked]?.id : focusRef.current;
      if (!who) return;
      // The reply lives in his composer, in the transcript.
      if (modeRef.current === "tiles") grow(who, "work");
      else if (modeRef.current === "story") setMode("work");
      fillWhenThere(composerOf(who, host), insert, true);
    };
    window.addEventListener("realm-glass-voice", onVoice);
    return () => window.removeEventListener("realm-glass-voice", onVoice);
  }, [store, tiles, picked, grow, host]);

  // New agent: his own new-space sheet (name, folder, agent) over his
  // workspace, with "Choose folder" answered on the glass (FolderPick.tsx).
  // His store opens the new session in his focused pane, which the
  // subscription above follows; the first turn then plays as the story.
  // Closing the sheet without making one goes back to the tiles.
  const newFrom = useRef<{ before: string | null; sheet: boolean } | null>(
    null,
  );
  const startNew = useCallback(() => {
    const st = store.getState() as unknown as {
      openSheet: (sheet: { kind: string }) => void;
    };
    newFrom.current = { before: focusRef.current, sheet: false };
    setMode("work");
    st.openSheet({ kind: "new-space" });
  }, [store]);
  useEffect(
    () =>
      store.subscribe((s) => {
        const pending = newFrom.current;
        if (!pending) return;
        const open = Boolean((s as unknown as { sheet?: unknown }).sheet);
        if (open) {
          pending.sheet = true;
          return;
        }
        if (!pending.sheet) return;
        // His sheet closes BEFORE he opens the session it made, so whether
        // one was made is only known once his engine has answered the open;
        // ENGINE_ANSWER_MS is the budget every engine call gets here.
        pending.sheet = false;
        window.setTimeout(() => {
          if (newFrom.current !== pending) return;
          if (focusRef.current === pending.before) {
            newFrom.current = null;
            setMode("tiles");
          }
        }, ENGINE_ANSWER_MS);
      }),
    [store],
  );
  const newRunning =
    newFrom.current !== null &&
    focus !== null &&
    focus !== newFrom.current.before &&
    sessions[focus]?.status === "running";
  useEffect(() => {
    if (!newRunning) return;
    newFrom.current = null;
    setMode("story");
  }, [newRunning]);

  const focused = focus ? sessions[focus] : null;
  // The agent on the glass went away (deleted, or gone from his list on a
  // refresh): back to the tiles, never a blank glass only Escape leaves.
  const haveSessions = Object.keys(sessions).length > 0;
  // A session his store just made (New agent) isn't in this list yet, so a
  // focus the list doesn't know is asked about once before it counts as
  // gone: the morning rehearsal, 2026-10-11, fell back to the tiles the
  // moment Create opened the new agent.
  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    const next = lostFocus({
      mode,
      focus,
      known: Boolean(focused),
      haveSessions,
      morphing: morphing.current,
      asked: askedFor.current,
    });
    if (next === "ask") {
      askedFor.current = focus;
      load();
    } else if (next === "tiles") setMode("tiles");
  }, [mode, focus, focused, haveSessions, sessions, load]);
  // Transcript and Reply on the story: his workspace, already mounted, so
  // this is a crossfade and never a load. Reply puts the caret in his
  // composer.
  const openTranscript = useCallback(
    (reply: boolean) => {
      setMode("work");
      if (reply && focusRef.current)
        fillWhenThere(composerOf(focusRef.current, host), "", true);
    },
    [host],
  );
  // The engine outranks the talk key: with no engine nothing else works.
  const notice = engineFault ?? voiceFault;
  // In the workspace the notice sits over the top of his main pane, under
  // his pane bar, with its one fix; his boot shine reads the same flag.
  useEffect(() => {
    const root = document.documentElement;
    if (notice) root.setAttribute("data-glass-notice", "");
    else root.removeAttribute("data-glass-notice");
  }, [notice]);
  const seed = useCallback(
    (id: string, agent: Agent) =>
      setAgents((prev) => (prev[id]?.turn ? prev : { ...prev, [id]: agent })),
    [],
  );
  const ready = tilesReady({
    listed,
    // Only an engine that can't list counts; a pane it couldn't open doesn't
    // hide the tiles.
    faulted: Boolean(engineFault),
    needTruth: Boolean(providerIds),
    truthAsked,
  });
  // Back to every agent from the story or the workspace: the nav's first
  // button, and what Escape does from the story.
  const toAll = useCallback(() => {
    if (modeRef.current === "tiles") return;
    shrink();
  }, [shrink]);
  return createPortal(
    <div className="glass-layer" data-mode={mode}>
      <Nav
        mode={mode}
        resting={resting}
        sessions={sessions}
        ready={ready}
        focus={focus}
        onAll={toAll}
        page={pageUp}
        onStory={() => {
          closePage();
          if (focusRef.current) setMode("story");
        }}
        onTranscript={() => {
          closePage();
          openTranscript(false);
        }}
        onNew={startNew}
      />
      <div className="glass-pane" data-mode={mode}>
      {notice && (
        <Notice
          fault={notice}
          onRetry={
            notice !== engineFault ? undefined : booted ? load : () => window.location.reload()
          }
        />
      )}
      {(mode === "tiles" || leaving) && (
        <TileField
          leaving={mode !== "tiles"}
          resting={resting}
          sessions={sessions}
          known={ready}
          picked={picked}
          tileRefs={tileRefs.current}
          onPick={pick}
          onGrow={grow}
          onNew={startNew}
          everyone={everyone}
          onEveryone={setEveryone}
        />
      )}
      {mode === "story" && focused && (
        <Story
          key={focused.id}
          session={focused}
          onTranscript={openTranscript}
          onNew={startNew}
          settledOutsideAt={(() => {
            const pid = focused.providerSessionId;
            const tr = pid ? truths[pid] : null;
            return tr && (tr.state === "done" || tr.state === "stopped") ? (tr.lastAt ?? 0) : 0;
          })()}
        />
      )}
      </div>
      {mode === "work" && focused && (
        <Stage session={focused} agent={agents[focused.id]} onSeed={seed} />
      )}
      {light && <Light light={light} />}
    </div>,
    document.body,
  );
}

/** His composer for one session. Carlton's checkout doesn't say which
 *  session a composer belongs to, so there it's the first one in the window,
 *  which is the wrong one when two sessions sit side by side. */
function composerOf(session: string, host: Host): string {
  return host.namedComposers
    ? `.composer-input[data-session-id="${CSS.escape(session)}"]`
    : ".composer-input";
}

/** Put text into the first element matching `selector` once it exists,
 *  through the editing path so his React state sees an ordinary edit. */
function fillWhenThere(
  selector: string,
  text: string,
  append = false,
  tries = 40,
) {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    selector,
  );
  // An element still under a hidden #root (the mode that shows it hasn't
  // committed yet) can't take focus, and text typed into it is lost: wait
  // for it to be drawn.
  const drawn =
    el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  if (!el || !drawn) {
    if (tries > 0)
      window.setTimeout(
        () => fillWhenThere(selector, text, append, tries - 1),
        25,
      );
    return;
  }
  el.focus();
  // Nothing to add: the caret goes to the end of whatever draft is there.
  if (append && !text) {
    const end = el.value.length;
    el.setSelectionRange(end, end);
    return;
  }
  if (append) {
    const end = el.value.length;
    el.setSelectionRange(end, end);
    const lead = el.value && !/\s$/.test(el.value) ? " " : "";
    document.execCommand("insertText", false, lead + text);
  } else {
    el.select();
    document.execCommand("insertText", false, text);
  }
}

function Light({
  light,
}: {
  light: { rect: Rect; to: Rect | null; ms: number; out: boolean };
}) {
  const r = light.to ?? light.rect;
  const style: CSSProperties = {
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    transitionDuration: light.to
      ? `${light.ms}ms, ${light.ms}ms, ${light.ms}ms, ${light.ms}ms, 150ms`
      : "0ms",
    opacity: light.out ? 0 : 1,
  };
  return (
    <div className="glass-light" data-region="light" style={style} aria-hidden="true" />
  );
}

/** The one fault that belongs to no single agent (the engine, the talk key):
 *  what happened, what the system said, and the one thing to do. Owns the
 *  notice region, the strip along the top; nothing else draws there. */
function Notice({ fault, onRetry }: { fault: Fault; onRetry?: () => void }) {
  return (
    <div className="glass-notice" data-region="notice" role="alert">
      <FaultBody fault={fault} onRetry={fault.retry ? onRetry : undefined} />
    </div>
  );
}

/** The glass bar, over his frame, in every mode: All agents (the tiles),
 *  Story and Transcript for the open agent, New agent, Close. Each is a
 *  labeled button, never only a key. Switching to another agent is his
 *  sidebar, right under it; this bar never lists agents a second time.
 *  Owns the nav region. On 10/12 3:38pm the only ways out were Escape and
 *  a small x; at 4:10pm, with his rail and sidebar still hidden: "we need
 *  buttons to get through a UX". */
function Nav(props: {
  mode: Mode;
  resting: Resting;
  sessions: Record<string, Session>;
  ready: boolean;
  focus: string | null;
  page: boolean;
  onAll: () => void;
  onStory: () => void;
  onTranscript: () => void;
  onNew: () => void;
}) {
  const { mode, resting, sessions, ready, focus, page, onAll, onStory, onTranscript, onNew } = props;
  const total = Object.keys(sessions).length || resting.tiles.length + resting.moreAgents;
  const focused = focus ? sessions[focus] : null;
  // The views show only for an agent the glass knows: a session his New
  // session just made isn't listed yet, and has no story to switch to.
  const open = Boolean(focused) && barButtons(mode, Boolean(focused)).includes("Story");
  const meta = focused ? AGENT_META[focused.agentKind as keyof typeof AGENT_META] : null;
  return (
    <nav className="glass-nav" data-region="nav" data-shape="bar" aria-label="Agents">
      <button
        type="button"
        className="glass-nav-all"
        onClick={onAll}
        aria-current={mode === "tiles" ? "page" : undefined}
      >
        {mode !== "tiles" && <Icon name="chevronLeft" size={16} />}
        All agents
        {ready && total > 0 && <span className="glass-nav-count">{total}</span>}
      </button>
      {open && focused ? (
        <>
          <span className="glass-nav-here" title={focused.title ?? ""}>
            <Icon name={meta?.icon ?? "sparkles"} size={14} colored />
            <span className="glass-nav-here-title">{focused.title || "Untitled"}</span>
          </span>
          <span className="glass-nav-views" role="group" aria-label="View">
            <button type="button" className="glass-nav-view" aria-pressed={!page && mode === "story"} onClick={onStory}>
              Story
            </button>
            <button type="button" className="glass-nav-view" aria-pressed={!page && mode === "work"} onClick={onTranscript}>
              Transcript
            </button>
          </span>
        </>
      ) : (
        <span className="glass-nav-hint">
          {mode === "tiles" ? "Pick a tile or press its number, or any session in the sidebar" : ""}
        </span>
      )}
      <button type="button" className="glass-nav-new" onClick={onNew}>
        <Icon name="add" size={16} />
        New agent
      </button>
      <button type="button" className="glass-nav-close" onClick={dismissGlass} aria-label="Close the glass (Escape)">
        <span>Close</span>
        <kbd>esc</kbd>
      </button>
    </nav>
  );
}

export function FaultBody({ fault, onRetry }: { fault: Fault; onRetry?: () => void }) {
  return (
    <>
      <span className="glass-fault-what">{fault.what}</span>
      {fault.detail && <span className="glass-fault-detail">{fault.detail}</span>}
      <span className="glass-fault-fix">{fault.fix}</span>
      {onRetry && (
        <button type="button" className="glass-word" onClick={onRetry}>
          Retry
        </button>
      )}
    </>
  );
}

function TileField(props: {
  leaving: boolean;
  resting: Resting;
  sessions: Record<string, Session>;
  known: boolean;
  picked: number;
  tileRefs: Map<string, HTMLElement>;
  onPick: (i: number) => void;
  onGrow: (id: string) => void;
  onNew: () => void;
  everyone: boolean;
  onEveryone: (all: boolean) => void;
}) {
  const {
    everyone,
    onEveryone,
    leaving,
    resting,
    sessions,
    known,
    picked,
    tileRefs,
    onPick,
    onGrow,
    onNew,
  } = props;
  // With no agents yet the field is the door to the first one. With agents,
  // New agent is the nav bar's (Nav), one press from every state, so the
  // field doesn't say it twice. Without a door at all the glass could only
  // reopen old agents (the morning rehearsal, 2026-10-11).
  const door = (
    <button
      type="button"
      className="glass-tile glass-tile-new"
      onClick={onNew}
      aria-label="New agent: pick a repo, then ask"
    >
      <span className="glass-tile-head">
        <Icon name="add" size={16} />
        <span className="glass-tile-state">New agent</span>
      </span>
      <span className="glass-tile-title">Pick a repo, then ask</span>
    </button>
  );
  const tiles = resting.tiles;
  return (
    <div
      className="glass-field"
      data-region="field"
      data-leaving={leaving || undefined}
    >
      {!tiles.length || !known ? (
        // Until the list has come back there is nothing true to say here;
        // with the engine down the notice says why.
        known && !Object.keys(sessions).length ? (
          <div className="glass-tiles" role="list" aria-label="Agents">
            {door}
          </div>
        ) : !known ? (
          <p className="glass-quiet">Reading your agents</p>
        ) : null
      ) : (
        <div className="glass-tiles" role="list" aria-label="Agents">
          {tiles.map((tile, i) => {
            const s = sessions[tile.id];
            const meta = AGENT_META[s?.agentKind as keyof typeof AGENT_META];
            return (
              <button
                key={tile.id}
                role="listitem"
                type="button"
                className="glass-tile"
                data-tone={tile.tone}
                data-picked={i === picked || undefined}
                ref={(el) => {
                  if (el) tileRefs.set(tile.id, el);
                  else tileRefs.delete(tile.id);
                }}
                onMouseEnter={() => onPick(i)}
                onFocus={() => onPick(i)}
                onClick={() => onGrow(tile.id)}
                aria-label={`${tile.title}, ${tile.word}`}
              >
                <span className="glass-tile-head">
                  <Icon name={meta?.icon ?? "sparkles"} size={16} colored />
                  <span className="glass-tile-state">
                    {tile.tone === "running" ? (
                      <Spinner size={11} />
                    ) : (
                      <span className="glass-dot" />
                    )}
                    {tile.word}
                  </span>
                  <span className="glass-tile-age">
                    {age(tile.turn.at || s?.updatedAt)}
                  </span>
                  {i < 9 && (
                    <kbd className="glass-key glass-tile-key" aria-hidden="true">
                      {i + 1}
                    </kbd>
                  )}
                </span>
                <span className="glass-tile-title">{tile.title}</span>
                {tile.line && tile.line !== tile.title && (
                  <span className="glass-tile-now">{tile.line}</span>
                )}
                <span className="glass-tile-meta">
                  {meta?.label ?? s?.agentKind} · {base(s?.cwd ?? "")}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {known && (resting.moreAgents > 0 || everyone) && (
        // A count with no way in was the 10/12 tiles' last line ("8 more
        // agents, all in the sidebar", behind his Show more). Now a press.
        <button
          type="button"
          className="glass-button glass-more"
          onClick={() => onEveryone(!everyone)}
          aria-expanded={everyone}
        >
          {everyone
            ? "Show the first nine"
            : `Show all ${tiles.length + resting.moreAgents} agents`}
        </button>
      )}
    </div>
  );
}

type Changes = {
  root: string;
  files: { path: string; additions?: number | null; deletions?: number | null }[];
};
type Hunked = {
  path: string;
  hunks: Hunk[];
  kept: Set<number>;
  staged: boolean;
  fault: Fault | null;
};

/** The column beside the conversation. It draws from the agent's typed turn
 *  only: the one live object of the beat it is on, or the fault that stopped
 *  it; with nothing on it, it is not drawn and his app takes the width back.
 *  Owns the stage region. */
function Stage({
  session,
  agent,
  onSeed,
}: {
  session: Session;
  agent: Agent | undefined;
  onSeed: (id: string, agent: Agent) => void;
}) {
  const [history, setHistory] = useState<Fault | null>(null);
  const [attempt, setAttempt] = useState(0);

  // The newest turn of this session from history, when no live event has
  // built one yet. Live events step the same agent in GlassLayer.
  const hasTurn = Boolean(agent?.turn);
  useEffect(() => {
    if (hasTurn) return;
    let alive = true;
    void (
      settle(
        rpc().call("sessions.events", {
          id: session.id,
          afterSeq: Math.max(0, (session.lastEventSeq ?? 0) - 400),
          limit: 400,
        }),
        "engine-down",
        ENGINE_ANSWER_MS,
      )
    ).then((r) => {
      if (!alive) return;
      if (!r.ok) {
        setHistory(r.fault);
        return;
      }
      setHistory(null);
      let a = emptyAgent();
      for (const ev of r.value as Stored[]) a = step(a, ev);
      if (a.turn) onSeed(session.id, a);
    });
    return () => {
      alive = false;
    };
  }, [session.id, session.lastEventSeq, hasTurn, attempt, onSeed]);

  const turn = focusView(agent).turn;
  // Only the live object his transcript lists as a row, or the fault that
  // stopped the turn (stageObject in turn.mjs says why nothing else).
  const card: ReactNode =
    history && !turn ? (
      <Card kind="fault">
        <FaultBody fault={history} onRetry={() => setAttempt((n) => n + 1)} />
      </Card>
    ) : !turn || !stageObject(turn) ? null : (
      match<ReactNode>(turn, {
        asked: () => null,
        reading: (t) => (t.command ? <CommandView call={t.command} /> : null),
        changing: (t) => (
          <FileView key={`f:${t.file.path}`} call={t.file} cwd={session.cwd} />
        ),
        proved: (t) => <TestsView call={t.tests} />,
        "needs-you": () => null,
        done: () => null,
        failed: (t) => (
          <Card kind="fault">
            <FaultBody fault={t.fault} />
          </Card>
        ),
      })
    );
  const drawn = Boolean(card);
  useEffect(() => {
    const root = document.documentElement;
    if (drawn) root.setAttribute("data-glass-stage", "");
    else root.removeAttribute("data-glass-stage");
  }, [drawn]);
  useEffect(() => () => document.documentElement.removeAttribute("data-glass-stage"), []);
  if (!drawn) return null;
  return (
    <aside className="glass-stage" data-region="stage" aria-label="What the agent is doing">
      {card}
    </aside>
  );
}

function Card({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <section className="glass-card" data-kind={kind}>
      {children}
    </section>
  );
}

export function FileView({ call, cwd }: { call: FileBeat; cwd: string }) {
  const abs = joinPath(cwd, call.path);
  const [text, setText] = useState<string | null>(
    call.kind === "write" ? (call.text ?? "") : null,
  );
  const [broke, setBroke] = useState<Fault | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (call.kind === "write") {
      setText(call.text ?? "");
      return;
    }
    let alive = true;
    void (
      settle(
        glassFetch(`/glass/file?path=${encodeURIComponent(abs)}`).then(async (r) => {
          const body = (await r.json().catch(() => ({}))) /* Expected: an error body may not be JSON; the status still says what failed. */ as { text?: string; error?: string };
          if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
          return String(body.text ?? "");
        }),
        "file-unreadable",
        ENGINE_ANSWER_MS,
      )
    ).then((r) => {
      if (!alive) return;
      if (r.ok) {
        setText(r.value);
        setBroke(null);
      } else setBroke(r.fault);
    });
    return () => {
      alive = false;
    };
  }, [abs, call.done, call.kind, call.text, attempt]);
  const found =
    text === null || call.kind === "write"
      ? null
      : editRange(text, call.edits?.[0], call.done);
  const range =
    text === null
      ? null
      : call.kind === "write"
        ? { start: 1, end: Math.min(28, text.split("\n").length) }
        : found?.range ?? null;
  const landed = call.kind === "write" ? call.done : (found?.landed ?? call.done);
  const view = text === null ? null : excerpt(text, range);
  const verb =
    call.kind === "write"
      ? call.done
        ? "Wrote"
        : "Writing"
      : call.error
        ? "Edit failed"
        : call.done
          ? "Edited"
          : "Editing";
  const dir = relTo(cwd, abs).split("/").slice(0, -1).join("/");
  return (
    <Card kind="file">
      <header className="glass-card-head">
        <span className="glass-verb" data-live={!call.done || undefined}>
          {verb}
        </span>
        <span className="glass-path" title={abs}>
          {dir && <span className="glass-dir">{dir}/</span>}
          {base(abs)}
        </span>
      </header>
      {broke && (
        <p className="glass-fault">
          <FaultBody fault={broke} onRetry={() => setAttempt((n) => n + 1)} />
        </p>
      )}
      {view && (
        <pre
          className="glass-code"
          aria-label={`${base(abs)}, lines ${view.first} to ${view.first + view.lines.length - 1}`}
        >
          {view.lines.map((line: string, i: number) => {
            const n = view.first + i;
            const lit = range && n >= range.start && n <= range.end;
            return (
              <span
                key={n}
                className="glass-line"
                data-lit={lit ? (landed ? "after" : "before") : undefined}
              >
                <span className="glass-ln">{n}</span>
                {line || " "}
              </span>
            );
          })}
        </pre>
      )}
    </Card>
  );
}

export function CommandView({ call }: { call: CommandBeat }) {
  return (
    <Card kind="command">
      <header className="glass-card-head">
        <span className="glass-verb" data-live={!call.done || undefined}>
          {!call.done ? <Spinner size={11} /> : null}
          {!call.done ? "Running" : call.error ? "Failed" : "Ran"}
        </span>
        {call.label && <span className="glass-path">{call.label}</span>}
      </header>
      <pre className="glass-code glass-term">
        <span className="glass-line glass-prompt">$ {call.command}</span>
        {call.tail.map((l, i) => (
          <span key={i} className="glass-line">
            {l}
          </span>
        ))}
      </pre>
    </Card>
  );
}

export function TestsView({ call }: { call: TestsBeat }) {
  const c = call.counts;
  return (
    <Card kind="tests">
      <header className="glass-card-head">
        <span className="glass-verb" data-live={!call.done || undefined}>
          {!call.done ? <Spinner size={11} /> : null}
          {!call.done ? "Testing" : "Tests"}
        </span>
        {call.done && c && (
          <span className="glass-counts">
            <span data-tone="good">{c.passed} passed</span>
            {c.failed > 0 && <span data-tone="bad">{c.failed} failed</span>}
          </span>
        )}
        {call.done && !c && (
          <span className="glass-counts">
            <span data-tone={call.error ? "bad" : "good"}>
              {call.error ? "Failed" : "Passed"}
            </span>
          </span>
        )}
      </header>
      <pre className="glass-code glass-term">
        <span className="glass-line glass-prompt">$ {call.command}</span>
        {call.done &&
          (call.failing ?? []).map((l, i) => (
            <span key={i} className="glass-line" data-tone="bad">
              {l}
            </span>
          ))}
      </pre>
    </Card>
  );
}

const fetchHunks = (root: string, path: string) =>
  (
    settle(
      rpc().call("workspace.fileDiff", { cwd: root, path, staged: false }),
      "diff-unreadable",
      ENGINE_ANSWER_MS,
    )
  ).then((r) =>
    r.ok
      ? ({ ok: true, value: (r.value as { hunks: Hunk[] }).hunks ?? [] } as Result<Hunk[]>)
      : (r as Result<Hunk[]>),
  );

/** The settled turn's diff as hunks. Keep leaves a hunk on disk as the agent
 *  wrote it; Reject puts it back (realm-ui's /glass/reject, `git apply -R`
 *  of exactly that hunk). Each button says what it changes before the press,
 *  and a file whose hunks are all kept offers Stage, which is git add.
 *  The Keep and Reject buttons hang only on hunks turn.mjs's reviewOf kept,
 *  so a button with no hunk behind it can't be drawn. A diff that couldn't
 *  be read is a fault with Retry, never an empty card, and never reported
 *  empty to the story: a failed read must not skip his call. */
// The most files whose diffs the review reads at once. Twelve keeps one
// turn's review to a few screens of hunks; guessed, never measured.
const REVIEW_FILES = 12;

export function Review({
  changes,
  onEmpty,
}: {
  changes: Changes;
  onEmpty?: (empty: boolean) => void;
}) {
  const [files, setFiles] = useState<Hunked[] | null>(null);
  const [broke, setBroke] = useState<Fault | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Files past the ones read here. Their changes may still be on disk, so
  // the review is never reported empty while any are left.
  const past = Math.max(0, changes.files.length - REVIEW_FILES);
  useEffect(() => {
    let alive = true;
    void Promise.all(
      changes.files
        .slice(0, REVIEW_FILES)
        .map(async (f) => ({ path: f.path, r: await fetchHunks(changes.root, f.path) })),
    ).then((list) => {
      if (!alive) return;
      const bad = list.find((x) => !x.r.ok);
      if (bad && !bad.r.ok) {
        setBroke(bad.r.fault);
        onEmpty?.(false);
        return;
      }
      setBroke(null);
      const review = reviewOf(
        changes.root,
        list.map((x) => ({ path: x.path, hunks: x.r.ok ? x.r.value : [] })),
      );
      setFiles(
        (review?.files ?? []).map((f) => ({ ...f, kept: new Set<number>(), staged: false, fault: null })),
      );
    });
    return () => {
      alive = false;
    };
  }, [changes, attempt]);
  const update = (path: string, fn: (f: Hunked) => Hunked) =>
    setFiles((all) => (all ?? []).map((f) => (f.path === path ? fn(f) : f)));
  const keep = (path: string, i: number) =>
    update(path, (f) => ({ ...f, kept: new Set(f.kept).add(i) }));
  const reject = async (path: string, hunk: Hunk) => {
    const res = (await settle(
      glassFetch("/glass/reject", {
        method: "POST",
        body: JSON.stringify({ cwd: changes.root, path, hunk }),
      }).then(async (r) => {
        const body = (await r.json().catch(() => ({}))) /* Expected: an error body may not be JSON; the status still says what failed. */ as { error?: string };
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        return true;
      }),
      "git-refused",
      ENGINE_ANSWER_MS,
    )) as Result<boolean>;
    if (!res.ok) {
      update(path, (f) => ({ ...f, fault: res.fault }));
      return;
    }
    const again = await fetchHunks(changes.root, path);
    if (!again.ok) {
      update(path, (f) => ({ ...f, fault: again.fault }));
      return;
    }
    const left = (reviewOf(changes.root, [{ path, hunks: again.value }]) as {
      files: { hunks: Hunk[] }[];
    } | null)?.files[0]?.hunks ?? [];
    update(path, (f) => {
      // The hunks left keep their Keep by content, since their indexes moved.
      const keptLines = new Set([...f.kept].map((k) => JSON.stringify(f.hunks[k]?.lines)));
      const kept = new Set<number>();
      left.forEach((h, j) => {
        if (keptLines.has(JSON.stringify(h.lines))) kept.add(j);
      });
      return { ...f, hunks: left, kept, fault: null };
    });
  };
  const stage = async (path: string) => {
    const r = (await settle(
      rpc().call("workspace.stage", { cwd: changes.root, paths: [path] }),
      "git-refused",
      ENGINE_ANSWER_MS,
    )) as Result<unknown>;
    update(path, (f) => (r.ok ? { ...f, staged: true, fault: null } : { ...f, fault: r.fault }));
  };
  // Every hunk put back or kept and staged, and nothing past the ones read:
  // no decision left (model.mjs reviewDecided).
  const empty = files !== null && !broke && reviewDecided(files, past);
  useEffect(() => {
    if (files !== null && !broke) onEmpty?.(empty);
  }, [empty, files, broke, onEmpty]);
  if (broke)
    return (
      <Card kind="fault">
        <FaultBody fault={broke} onRetry={() => setAttempt((n) => n + 1)} />
      </Card>
    );
  const shown = (files ?? []).filter((f) => f.hunks.length || f.fault);
  // The hunks still waiting on Keep or Reject, counted over every file, and
  // the first of them for Next change (Cursor's review bar: "3 of 7",
  // Review next; steal list 12).
  const left = shown.reduce((n, f) => n + f.hunks.filter((_, i) => !f.kept.has(i)).length, 0);
  const next = (from: HTMLElement) => {
    const el = from.closest(".glass-card")?.querySelector<HTMLElement>('.glass-review-body .glass-hunk:not([data-state="kept"])');
    el?.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
    el?.querySelector<HTMLElement>(".glass-hunk-actions .glass-word")?.focus({ preventScroll: true });
  };
  if (!shown.length && !past) return null;
  return (
    <Card kind="review">
      {past > 0 && (
        <p className="glass-note">
          {past} more {past === 1 ? "file's" : "files'"} changes aren't shown here. The transcript has them.
        </p>
      )}
      <header className="glass-card-head glass-review-bar">
        <span className="glass-verb">Changes</span>
        <span className="glass-path">
          {shown.length} {shown.length === 1 ? "file" : "files"}
          {", "}
          {left ? `${left} ${left === 1 ? "change" : "changes"} to decide` : "all decided"}
        </span>
        {left > 0 && (
          <button type="button" className="glass-word glass-review-next" onClick={(e) => next(e.currentTarget)}>
            Next change
          </button>
        )}
      </header>
      {/* The bar stays put above this, and only the hunks scroll: each
          hunk's Keep and Reject ride sticky at the top of this box. With
          the bar inside the same scroller they slid under it (10/12
          evening, 1246 review walk). */}
      <div className="glass-review-body">
      {shown.map((f) => {
        const decided = f.hunks.length > 0 && f.hunks.every((_, i) => f.kept.has(i));
        const dir = f.path.split("/").slice(0, -1).join("/");
        return (
          <div className="glass-file" key={f.path}>
            <div className="glass-file-head">
              <span className="glass-path">
                {dir && <span className="glass-dir">{dir}/</span>}
                {base(f.path)}
              </span>
              {decided && !f.staged && (
                <button
                  type="button"
                  className="glass-word"
                  onClick={() => void stage(f.path)}
                  title={`git add ${f.path}`}
                >
                  Stage {base(f.path)}
                </button>
              )}
              {f.staged && <span className="glass-note">Staged</span>}
            </div>
            {f.fault && (
              <p className="glass-fault">
                <FaultBody fault={f.fault} />
              </p>
            )}
            {!f.hunks.length && !f.fault && <p className="glass-note">Put back as it was.</p>}
            {f.hunks.map((h, i) => {
              const adds = h.lines.filter((l) => l.kind === "add").length;
              const dels = h.lines.filter((l) => l.kind === "del").length;
              const kept = f.kept.has(i);
              return (
                <div
                  className="glass-hunk"
                  key={`${h.oldStart}:${h.newStart}:${i}`}
                  data-state={kept ? "kept" : undefined}
                >
                  {kept ? (
                    <p className="glass-note">
                      Kept {adds} added, {dels} removed at line {h.newStart}
                    </p>
                  ) : (
                    <>
                      <div className="glass-hunk-actions">
                        <button
                          type="button"
                          className="glass-word"
                          onClick={() => keep(f.path, i)}
                          title="Leaves these lines as the agent wrote them. Nothing is written."
                        >
                          Keep
                        </button>
                        <button
                          type="button"
                          className="glass-word"
                          data-tone="bad"
                          onClick={() => void reject(f.path, h)}
                        >
                          Reject: puts back {adds} added and {dels} removed in{" "}
                          {base(f.path)}
                        </button>
                      </div>
                      <pre className="glass-code">
                        {h.lines.slice(0, 40).map((l, j) => (
                          <span key={j} className="glass-line" data-diff={l.kind}>
                            <span className="glass-ln">{l.newLine ?? l.oldLine ?? ""}</span>
                            <span className="glass-sign">
                              {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
                            </span>
                            {l.text || " "}
                          </span>
                        ))}
                      </pre>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      </div>
    </Card>
  );
}
