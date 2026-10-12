// Realm on the Chewbacca glass: the layer of ours over Carlton Aikins' Realm
// renderer (github.com/31Carlton7/realm). His app runs underneath, untouched;
// this draws what makes it an OS surface instead of a window:
//
//   tiles    every agent as a tile floating on the desktop, nothing else
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
import { editRange, excerpt, voiceIntent } from "./model.mjs";
import {
  atRest,
  emptyAgent,
  pace,
  fault,
  focusView,
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

function useShown(): boolean {
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
  useEffect(() => {
    const w = window as unknown as { __realmGlassShown?: (v: boolean) => void };
    // What Kyber last said, so a page attached a frame before its window
    // became visible still turns shown once it does.
    let kyberSays = false;
    w.__realmGlassShown = (v) => {
      kyberSays = Boolean(v);
      setShown(kyberSays && document.visibilityState !== "hidden");
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
  return shown;
}

export function GlassLayer({ store }: { store: StoreApi<AppState> }) {
  const shown = useShown();
  const [mode, setMode] = useState<Mode>("tiles");
  const [focus, setFocus] = useState<string | null>(null);
  const [picked, setPicked] = useState(0);
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
  const modeRef = useRef<Mode>("tiles");
  modeRef.current = mode;
  const focusRef = useRef<string | null>(null);
  focusRef.current = focus;

  const booted = useSyncExternalStore(
    store.subscribe,
    () => store.getState().booted,
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

  // Opening "show my agents" lands on the tiles, every time.
  useEffect(() => {
    if (!shown) return;
    setMode("tiles");
    setLight(null);
    morphing.current = false;
  }, [shown]);
  useEffect(() => {
    document.documentElement.setAttribute("data-glass", mode);
  }, [mode]);

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
      restingView(Object.values(sessions), agents, truths, truthAsked),
    [sessions, agents, truths, truthAsked],
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

  // His palette, his sidebar or a click in his panes can move focus to
  // another session while the workspace is up; the stage follows it.
  useEffect(
    () =>
      store.subscribe((s) => {
        if (modeRef.current !== "work") return;
        const id = focusedSession(s);
        if (id && id !== focusRef.current) setFocus(id);
      }),
    [store],
  );

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

  const workRect = (): Rect => ({
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  });
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
      if (!s || morphing.current) return;
      setFocus(id);
      void (
        settle(
          store.getState().revealSession(id, s.spaceId),
          "engine-down",
          ENGINE_ANSWER_MS,
        )
      ).then((r) => {
        if (!r.ok) setEngineFault(r.fault);
        else if (r.value === false)
          setEngineFault(fault("engine-down", "it couldn't open that session"));
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
      setLeaving(true);
      setLight({ rect: from, to: null, ms: GROW_MS, out: false });
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setMode(land);
          setLight({ rect: from, to: workRect(), ms: GROW_MS, out: false });
          window.setTimeout(
            () => setLight((l) => (l ? { ...l, out: true } : l)),
            GROW_MS,
          );
          window.setTimeout(() => setLeaving(false), GROW_MS);
          window.setTimeout(() => {
            setLight(null);
            morphing.current = false;
          }, GROW_MS + 160);
        }),
      );
    },
    [sessions, store],
  );

  const shrink = useCallback(() => {
    if (morphing.current) return;
    const id = focusRef.current;
    const i = tiles.findIndex((t) => t.id === id);
    if (i >= 0) setPicked(i);
    if (reduceMotion()) {
      setMode("tiles");
      return;
    }
    morphing.current = true;
    const from = workRect();
    setLight({ rect: from, to: null, ms: SHRINK_MS, out: false });
    setMode("tiles");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const to = rectOf(id ? tileRefs.current.get(id) : null) ?? from;
        setLight({ rect: from, to, ms: SHRINK_MS, out: false });
        window.setTimeout(
          () => setLight((l) => (l ? { ...l, out: true } : l)),
          SHRINK_MS,
        );
        window.setTimeout(() => {
          setLight(null);
          morphing.current = false;
        }, SHRINK_MS + 160);
      }),
    );
  }, [tiles]);

  // Escape: bridge.js asks us first (window.__realmGlass.onEscape). In the
  // workspace it shrinks back to the tiles unless his page has a use for the
  // key (a dialog, menu or list is open, or the editor or a terminal has it).
  useEffect(() => {
    const w = window as unknown as {
      __realmGlass?: { onEscape: () => boolean };
    };
    w.__realmGlass = {
      onEscape: () => {
        if (modeRef.current === "tiles") return false;
        if (document.querySelector(OVERLAY)) return false;
        const f = document.activeElement;
        if (f && f.closest?.(".cm-editor,.xterm")) return false;
        (f as HTMLElement | null)?.blur?.();
        // The transcript steps back to the story; the story to the tiles.
        if (modeRef.current === "work") setMode("story");
        else shrink();
        return true;
      },
    };
    return () => {
      delete w.__realmGlass;
    };
  }, [shrink]);

  // Arrows walk the tiles and Return grows one, while nothing of his is open.
  useEffect(() => {
    if (mode !== "tiles") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector(OVERLAY)) return;
      const t = document.activeElement;
      if (
        t &&
        t !== document.body &&
        !t.classList.contains("glass-tile") &&
        t.closest?.("input,textarea,[contenteditable]")
      )
        return;
      const cols = 3;
      const n = tiles.length;
      if (!n) return;
      const move = (
        {
          ArrowRight: 1,
          ArrowLeft: -1,
          ArrowDown: cols,
          ArrowUp: -cols,
        } as Record<string, number>
      )[e.key];
      if (move) {
        e.preventDefault();
        setPicked((p) => Math.min(n - 1, Math.max(0, p + move)));
      } else if (e.key === "Enter" && tiles[picked]) {
        e.preventDefault();
        grow(tiles[picked].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, tiles, picked, grow]);

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
      fillWhenThere(".composer-input", insert, true);
    };
    window.addEventListener("realm-glass-voice", onVoice);
    return () => window.removeEventListener("realm-glass-voice", onVoice);
  }, [store, tiles, picked, grow]);

  const focused = focus ? sessions[focus] : null;
  // The agent on the glass went away (deleted, or gone from his list on a
  // refresh): back to the tiles, never a blank glass only Escape leaves.
  const haveSessions = Object.keys(sessions).length > 0;
  useEffect(() => {
    if (mode !== "tiles" && focus && haveSessions && !focused && !morphing.current) setMode("tiles");
  }, [mode, focus, focused, haveSessions]);
  // Transcript and Reply on the story: his workspace, already mounted, so
  // this is a crossfade and never a load. Reply puts the caret in his
  // composer.
  const openTranscript = useCallback((reply: boolean) => {
    setMode("work");
    if (reply) fillWhenThere(".composer-input", "", true);
  }, []);
  // The engine outranks the talk key: with no engine nothing else works.
  const notice = engineFault ?? voiceFault;
  // In the workspace the notice sits in the column beside his app, so his
  // app makes room for it as it does for the stage.
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
  return createPortal(
    <div className="glass-layer" data-mode={mode}>
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
          known={listed && !engineFault}
          picked={picked}
          tileRefs={tileRefs.current}
          onPick={setPicked}
          onGrow={grow}
        />
      )}
      {mode === "story" && focused && (
        <Story
          key={focused.id}
          session={focused}
          onTranscript={openTranscript}
        />
      )}
      {mode === "work" && focused && (
        <Stage session={focused} agent={agents[focused.id]} onSeed={seed} />
      )}
      {light && <Light light={light} />}
    </div>,
    document.body,
  );
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
}) {
  const { leaving, resting, sessions, known, picked, tileRefs, onPick, onGrow } =
    props;
  const tiles = resting.tiles;
  // A press on the empty glass takes the surface down, as a click off it
  // does; Escape is the keyboard's way to the same place.
  const onGround = (e: { target: unknown; currentTarget: unknown }) => {
    if (e.target === e.currentTarget) dismissGlass();
  };
  return (
    <div
      className="glass-field"
      data-region="field"
      data-leaving={leaving || undefined}
      onMouseDown={onGround}
    >
      {!tiles.length ? (
        // Until the list has come back there is nothing true to say here;
        // with the engine down the notice says why.
        known && !Object.keys(sessions).length ? (
          <p className="glass-quiet">No agents yet. Command K starts one.</p>
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
      {resting.moreAgents > 0 && (
        <p className="glass-more">
          {resting.moreAgents} more{" "}
          {resting.moreAgents === 1 ? "agent" : "agents"} in the sidebar
          {resting.moreWaiting > 0 && `, ${resting.moreWaiting} waiting on you`}
        </p>
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
 *  only, one card for the beat it is on, the beats before it one line each;
 *  with nothing on it, it is not drawn. Owns the stage region. */
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

  const view = focusView(agent);
  const turn = view.turn;
  const card: ReactNode =
    history && !turn ? (
      <Card kind="fault">
        <FaultBody fault={history} onRetry={() => setAttempt((n) => n + 1)} />
      </Card>
    ) : !turn ? null : (
      match<ReactNode>(turn, {
        asked: () => null,
        reading: (t) =>
          t.command ? <CommandView call={t.command} /> : null,
        changing: (t) => (
          <FileView key={`f:${t.file.path}`} call={t.file} cwd={session.cwd} />
        ),
        proved: (t) => (
          <TestsView call={t.tests} />
        ),
        "needs-you": (t) => (
          <Card kind="needs">
            <header className="glass-card-head">
              <span className="glass-verb">Needs you</span>
              <span className="glass-path">{t.question}</span>
            </header>
          </Card>
        ),
        done: (t) => (
          <>
            {t.tests && <TestsView call={t.tests} />}
            {agent?.changes && agent.changes.files.length > 0 && (
              <Review
                key={agent.changes.root + agent.changes.files.map((f) => f.path).join()}
                changes={agent.changes}
              />
            )}
          </>
        ),
        failed: (t) => (
          <Card kind="fault">
            <FaultBody fault={t.fault} />
          </Card>
        ),
      })
    );
  const trail = turn ? view.trail : [];
  const drawn = Boolean(card) || trail.length > 0;
  useEffect(() => {
    const root = document.documentElement;
    if (drawn) root.setAttribute("data-glass-stage", "");
    else root.removeAttribute("data-glass-stage");
  }, [drawn]);
  useEffect(() => () => document.documentElement.removeAttribute("data-glass-stage"), []);
  if (!drawn) return null;
  return (
    <aside className="glass-stage" data-region="stage" aria-label="What the agent is doing">
      {trail.length > 0 && (
        <ol className="glass-trail" aria-label="Earlier in this turn">
          {view.trailEarlier > 0 && (
            <li className="glass-trail-more">{view.trailEarlier} earlier</li>
          )}
          {[...trail].reverse().map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      )}
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
  // Every hunk put back, and nothing past the ones read: no decision left.
  const empty = files !== null && !broke && past === 0 && files.every((f) => !f.hunks.length && !f.fault);
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
  if (!shown.length && !past) return null;
  return (
    <Card kind="review">
      {past > 0 && (
        <p className="glass-note">
          {past} more {past === 1 ? "file's" : "files'"} changes aren't shown here. The transcript has them.
        </p>
      )}
      <header className="glass-card-head">
        <span className="glass-verb">Changes</span>
        <span className="glass-path">
          {shown.length} {shown.length === 1 ? "file" : "files"}
        </span>
      </header>
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
                    </>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </Card>
  );
}
