// Realm on the Chewbacca glass: the layer of ours over Carlton Aikins' Realm
// renderer (github.com/31Carlton7/realm). His app runs underneath, untouched;
// this draws what makes it an OS surface instead of a window:
//
//   tiles    every agent as a tile floating on the desktop, nothing else
//   grow     pressing a tile grows it into his full workspace in one
//            continuous morph of light; Escape shrinks it back into its tile
//   stage    beside the conversation, only while there is something on it:
//            the file the agent is editing with the changed lines lit, the
//            command it is running (folded away after), the tests when they
//            run, and when the turn settles its diff as hunks to Keep or Reject
//   voice    the HUD talk key fills the focused agent's reply, opens his
//            palette or names a file with @; sending is always a press
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
import {
  emptyStage,
  excerpt,
  litRange,
  nowLine,
  reduce,
  tileOrder,
  tileState,
  tileTime,
  visible,
  voiceIntent,
  COMMAND_LINGER_MS,
} from "./model.mjs";

type Session = {
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
type Truth = { state: "running" | "done" | "stopped"; lastAt: number | null };
type Rect = { left: number; top: number; width: number; height: number };
type Mode = "tiles" | "work";
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

// The most tiles drawn at once. Nine is a 3 x 3 field that fits the realm
// surface's 1180 points with his card padding; past that a session is a row
// in his sidebar, one press into the workspace. Guessed, never measured.
const MAX_TILES = 9;
// His `--dur-move` (320) for a thing travelling across the pane, and
// `--dur-slow` (240) for the shorter way back: exits are shorter (design.md).
const GROW_MS = 320;
const SHRINK_MS = 240;
// The page tells the server it still has the glass this often, so hud-listen
// can trust a report no older than FOCUS_FRESH_MS (45 s) in glass_routes.mjs.
const FOCUS_BEAT_MS = 20_000;
// How often the tiles ask what their tabs are really doing (/glass/tabs),
// while the tiles are shown. A turn flips Working to Done within this long.
// Each ask stats and tails nine transcripts, a few ms. Guessed, not measured
// against his eye.
const TRUTH_BEAT_MS = 5_000;
const OVERLAY =
  '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[aria-modal="true"]';
const FAILED_LINE = /FAIL|not ok|Error|\bfailed\b/;

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
  const inKyber = Boolean((window as unknown as { webkit?: { messageHandlers?: { realmGlass?: unknown } } }).webkit?.messageHandlers?.realmGlass);
  const [shown, setShown] = useState(() => !inKyber && document.visibilityState === "visible");
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
  const [last, setLast] = useState<Record<string, Stored>>({});
  const [truths, setTruths] = useState<Record<string, Truth | null>>({});
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
  // change for a session it has not seen, and every 30 s while shown.
  const load = useCallback(() => {
    rpc()
      .call("sessions.listAll", { profileId: null })
      .then((list) => {
        const next: Record<string, Session> = {};
        for (const s of list as unknown as Session[]) next[s.id] = s;
        setSessions(next);
      })
      .catch(() => {});
  }, []);
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
      setLast((prev) => ({ ...prev, [stored.sessionId]: stored }));
    });
    return () => {
      offStatus();
      offEvent();
    };
  }, [booted, load]);
  useEffect(() => {
    if (!booted || !shown) return;
    const t = window.setInterval(load, 30_000);
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
  useEffect(() => {
    if (!booted || !shown || mode !== "tiles" || !providerIds) return;
    let live = true;
    const ask = () =>
      glassFetch(`/glass/tabs?ids=${encodeURIComponent(providerIds)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          if (live && body?.tabs) setTruths(body.tabs as Record<string, Truth | null>);
        })
        .catch(() => {});
    ask();
    const t = window.setInterval(ask, TRUTH_BEAT_MS);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [booted, shown, mode, providerIds]);

  const tiles = useMemo(
    () =>
      tileOrder(
        Object.values(sessions),
        truths as Record<string, Truth>,
        MAX_TILES,
      ) as Session[],
    [sessions, truths],
  );

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
  const target = mode === "work" ? focus : (tiles[picked]?.id ?? null);
  const targetTitle = (target && sessions[target]?.title) || "";
  useEffect(() => {
    const report = () =>
      glassFetch("/glass/focus", {
        method: "POST",
        body: JSON.stringify({
          shown,
          mode,
          sessionId: target,
          title: targetTitle,
        }),
      }).catch(() => {});
    void report();
    if (!shown) return;
    const t = window.setInterval(report, FOCUS_BEAT_MS);
    return () => window.clearInterval(t);
  }, [shown, mode, target, targetTitle]);

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
    (id: string) => {
      const s = sessions[id];
      if (!s || morphing.current) return;
      setFocus(id);
      void store
        .getState()
        .revealSession(id, s.spaceId)
        .catch(() => false);
      const from = rectOf(tileRefs.current.get(id)) ?? {
        left: window.innerWidth / 2 - 130,
        top: window.innerHeight / 2 - 70,
        width: 260,
        height: 140,
      };
      if (reduceMotion()) {
        setMode("work");
        return;
      }
      morphing.current = true;
      setLeaving(true);
      setLight({ rect: from, to: null, ms: GROW_MS, out: false });
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setMode("work");
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
        if (modeRef.current !== "work") return false;
        if (document.querySelector(OVERLAY)) return false;
        const f = document.activeElement;
        if (f && f.closest?.(".cm-editor,.xterm")) return false;
        (f as HTMLElement | null)?.blur?.();
        shrink();
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
          if (!reader) throw new Error("no stream");
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
                /* a partial line from a dropped stream */
              }
            }
          }
        } catch {
          /* the server restarted, or this page is going away */
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
        modeRef.current === "work" ? focusRef.current : tiles[picked]?.id;
      if (!who) return;
      if (modeRef.current !== "work") grow(who);
      fillWhenThere(".composer-input", insert, true);
    };
    window.addEventListener("realm-glass-voice", onVoice);
    return () => window.removeEventListener("realm-glass-voice", onVoice);
  }, [store, tiles, picked, grow]);

  const focused = focus ? sessions[focus] : null;
  return createPortal(
    <div className="glass-layer" data-mode={mode}>
      {(mode === "tiles" || leaving) && (
        <TileField
          leaving={mode !== "tiles"}
          tiles={tiles}
          truths={truths}
          last={last}
          picked={picked}
          tileRefs={tileRefs.current}
          onPick={setPicked}
          onGrow={grow}
        />
      )}
      {mode === "work" && focused && <Stage session={focused} />}
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
  if (!el) {
    if (tries > 0)
      window.setTimeout(
        () => fillWhenThere(selector, text, append, tries - 1),
        25,
      );
    return;
  }
  el.focus();
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
  return <div className="glass-light" style={style} aria-hidden="true" />;
}

function TileField(props: {
  leaving: boolean;
  tiles: Session[];
  truths: Record<string, Truth | null>;
  last: Record<string, Stored>;
  picked: number;
  tileRefs: Map<string, HTMLElement>;
  onPick: (i: number) => void;
  onGrow: (id: string) => void;
}) {
  const { leaving, tiles, truths, last, picked, tileRefs, onPick, onGrow } =
    props;
  // A press on the empty glass takes the surface down, as a click off it
  // does; Escape is the keyboard's way to the same place.
  const onGround = (e: { target: unknown; currentTarget: unknown }) => {
    if (e.target === e.currentTarget) dismissGlass();
  };
  return (
    <div
      className="glass-field"
      data-leaving={leaving || undefined}
      onMouseDown={onGround}
    >
      {!tiles.length ? (
        <p className="glass-quiet">No agents yet. Command K starts one.</p>
      ) : (
        <div className="glass-tiles" role="list" aria-label="Agents">
          {tiles.map((s, i) => {
            const truth = s.providerSessionId
              ? (truths[s.providerSessionId] ?? undefined)
              : undefined;
            const st = tileState(s, false, truth);
            const now = nowLine(last[s.id]);
            const meta = AGENT_META[s.agentKind as keyof typeof AGENT_META];
            return (
              <button
                key={s.id}
                role="listitem"
                type="button"
                className="glass-tile"
                data-tone={st.tone}
                data-picked={i === picked || undefined}
                ref={(el) => {
                  if (el) tileRefs.set(s.id, el);
                  else tileRefs.delete(s.id);
                }}
                onMouseEnter={() => onPick(i)}
                onFocus={() => onPick(i)}
                onClick={() => onGrow(s.id)}
                aria-label={`${s.title}, ${st.word}`}
              >
                <span className="glass-tile-head">
                  <Icon name={meta?.icon ?? "sparkles"} size={16} colored />
                  <span className="glass-tile-state">
                    {st.tone === "running" ? (
                      <Spinner size={11} />
                    ) : (
                      <span className="glass-dot" />
                    )}
                    {st.word}
                  </span>
                  <span className="glass-tile-age">{age(tileTime(s, truth))}</span>
                </span>
                <span className="glass-tile-title">
                  {s.title || "Untitled"}
                </span>
                {now && <span className="glass-tile-now">{now}</span>}
                <span className="glass-tile-meta">
                  {meta?.label ?? s.agentKind} · {base(s.cwd)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type FileCall = {
  path: string;
  kind: string;
  done: boolean;
  error: boolean;
  edits?: { before: string; after: string }[];
  text?: string;
};
type CommandCall = {
  command: string;
  label: string;
  done: boolean;
  error: boolean;
  output: string;
  endedAt?: number;
};
type TestsCall = {
  command: string;
  done: boolean;
  error: boolean;
  output: string;
  counts?: { passed: number; failed: number } | null;
};
type Changes = { root: string; files: { path: string }[] };
type StageShape = {
  running: boolean;
  file: FileCall | null;
  command: CommandCall | null;
  tests: TestsCall | null;
  changes: Changes | null;
};

/** The column beside the conversation. Each part is on screen only while
 *  the agent is doing that thing; with nothing on it, it is not drawn. */
function Stage({ session }: { session: Session }) {
  const [stage, setStage] = useState(emptyStage);
  // A settled turn whose diff is already gone from disk (kept, committed or
  // put back) has no review to show, and the column must not hold its room.
  const [reviewEmpty, setReviewEmpty] = useState(true);
  const [, setTick] = useState(0);
  const lastSeq = useRef(0);

  // The newest turn of this session, then live events.
  useEffect(() => {
    let alive = true;
    setStage(emptyStage());
    lastSeq.current = 0;
    rpc()
      .call("sessions.events", {
        id: session.id,
        afterSeq: Math.max(0, (session.lastEventSeq ?? 0) - 400),
        limit: 400,
      })
      .then((events) => {
        if (!alive) return;
        const list = events as unknown as Stored[];
        let start = 0;
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].event.type === "user_message") {
            start = i;
            break;
          }
        }
        let s = emptyStage();
        for (const ev of list.slice(start)) s = reduce(s, ev);
        lastSeq.current = list.length ? list[list.length - 1].seq : 0;
        // A settled turn read from history shows its review, never a command
        // that finished long ago.
        if (!s.running) s = { ...s, command: null, file: null, tests: null };
        setStage(s);
      })
      .catch(() => {});
    const off = rpc().on("session.event", (ev) => {
      const stored = ev as unknown as Stored;
      if (stored.sessionId !== session.id || stored.seq <= lastSeq.current)
        return;
      lastSeq.current = stored.seq;
      setStage((s) => reduce(s, stored));
    });
    return () => {
      alive = false;
      off();
    };
  }, [session.id]);

  const st = stage as unknown as StageShape;
  // A finished command folds away after COMMAND_LINGER_MS: one re-render then.
  const ended = st.command?.done ? (st.command.endedAt ?? 0) : 0;
  useEffect(() => {
    if (!ended) return;
    const left = COMMAND_LINGER_MS - (Date.now() - ended);
    if (left <= 0) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), left + 20);
    return () => window.clearTimeout(t);
  }, [ended]);

  // The review is drawn only once its hunks have loaded and there are some:
  // until then, and when they are all gone, it takes no room.
  useEffect(() => setReviewEmpty(true), [st.changes]);
  const raw = visible(stage, Date.now()) as string[];
  const parts = raw.filter((p) => !(p === "review" && reviewEmpty));
  useEffect(() => {
    const root = document.documentElement;
    if (parts.length) root.setAttribute("data-glass-stage", "");
    else root.removeAttribute("data-glass-stage");
  }, [parts.length]);
  useEffect(() => () => document.documentElement.removeAttribute("data-glass-stage"), []);
  if (!raw.length) return null;
  return (
    <aside className="glass-stage" aria-label="What the agent is doing" hidden={!parts.length}>
      {parts.includes("file") && st.file && <FileView key={`f:${st.file.path}`} call={st.file} cwd={session.cwd} />}
      {parts.includes("command") && st.command && <CommandView call={st.command} />}
      {parts.includes("tests") && st.tests && <TestsView call={st.tests} />}
      {raw.includes("review") && st.changes && <Review changes={st.changes} onEmpty={setReviewEmpty} />}
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

function FileView({ call, cwd }: { call: FileCall; cwd: string }) {
  const abs = joinPath(cwd, call.path);
  const [text, setText] = useState<string | null>(
    call.kind === "write" ? (call.text ?? "") : null,
  );
  useEffect(() => {
    if (call.kind === "write") {
      setText(call.text ?? "");
      return;
    }
    let alive = true;
    glassFetch(`/glass/file?path=${encodeURIComponent(abs)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j) setText(String(j.text ?? ""));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [abs, call.done, call.kind, call.text]);
  const needle =
    call.kind === "write"
      ? null
      : call.done
        ? call.edits?.[0]?.after
        : call.edits?.[0]?.before;
  const range =
    text === null
      ? null
      : call.kind === "write"
        ? { start: 1, end: Math.min(28, text.split("\n").length) }
        : litRange(text, needle ?? "");
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
                data-lit={lit ? (call.done ? "after" : "before") : undefined}
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

function CommandView({ call }: { call: CommandCall }) {
  const tail = call.output
    .split("\n")
    .filter((l) => l.trim())
    .slice(-10);
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
        {tail.map((l, i) => (
          <span key={i} className="glass-line">
            {l}
          </span>
        ))}
      </pre>
    </Card>
  );
}

function TestsView({ call }: { call: TestsCall }) {
  const c = call.counts;
  const failedLines = call.output
    .split("\n")
    .filter((l) => FAILED_LINE.test(l))
    .slice(0, 6);
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
          failedLines.map((l, i) => (
            <span key={i} className="glass-line" data-tone="bad">
              {l}
            </span>
          ))}
      </pre>
    </Card>
  );
}

type FileHunks = {
  path: string;
  hunks: Hunk[];
  state: Record<number, "kept">;
  staged: boolean;
  note: string;
};

/** The settled turn's diff as hunks. Keep leaves a hunk on disk as the agent
 *  wrote it; Reject puts it back (realm-ui's /glass/reject, `git apply -R`
 *  of exactly that hunk). Each button says what it changes before the press,
 *  and a file whose hunks are all kept offers Stage, which is git add. */
function Review({ changes, onEmpty }: { changes: Changes; onEmpty: (empty: boolean) => void }) {
  const [files, setFiles] = useState<FileHunks[]>([]);
  const fetchOne = useCallback(
    (path: string) =>
      rpc()
        .call("workspace.fileDiff", { cwd: changes.root, path, staged: false })
        .then((d) => (d as unknown as { hunks: Hunk[] }).hunks)
        .catch(() => [] as Hunk[]),
    [changes.root],
  );
  useEffect(() => {
    let alive = true;
    Promise.all(
      changes.files
        .slice(0, 12)
        .map(async (f) => ({
          path: f.path,
          hunks: await fetchOne(f.path),
          state: {},
          staged: false,
          note: "",
        })),
    )
      .then((list) => {
        if (!alive) return;
        const shown = list.filter((f) => f.hunks.length);
        setFiles(shown);
        onEmpty(shown.length === 0);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [changes, fetchOne]);
  const update = (path: string, fn: (f: FileHunks) => FileHunks) =>
    setFiles((all) => all.map((f) => (f.path === path ? fn(f) : f)));
  const keep = (path: string, i: number) =>
    update(path, (f) => ({ ...f, state: { ...f.state, [i]: "kept" } }));
  const reject = async (path: string, hunk: Hunk) => {
    const res = await glassFetch("/glass/reject", {
      method: "POST",
      body: JSON.stringify({ cwd: changes.root, path, hunk }),
    }).catch(() => null);
    const body = (res ? await res.json().catch(() => ({})) : {}) as {
      error?: string;
    };
    if (!res || !res.ok) {
      update(path, (f) => ({
        ...f,
        note: body.error ?? "That didn't go back.",
      }));
      return;
    }
    const hunks = await fetchOne(path);
    update(path, (f) => {
      // The hunks left keep their Keep by content, since their indexes moved.
      const kept = new Set(
        Object.keys(f.state).map((k) =>
          JSON.stringify(f.hunks[Number(k)]?.lines),
        ),
      );
      const state: FileHunks["state"] = {};
      hunks.forEach((h, j) => {
        if (kept.has(JSON.stringify(h.lines))) state[j] = "kept";
      });
      return {
        ...f,
        hunks,
        state,
        note: hunks.length ? "" : "Put back as it was.",
      };
    });
  };
  const stage = async (path: string) => {
    const ok = await rpc()
      .call("workspace.stage", { cwd: changes.root, paths: [path] })
      .then(() => true)
      .catch(() => false);
    update(path, (f) =>
      ok ? { ...f, staged: true } : { ...f, note: "That didn't stage." },
    );
  };
  if (!files.length) return null;
  return (
    <Card kind="review">
      <header className="glass-card-head">
        <span className="glass-verb">Changes</span>
        <span className="glass-path">
          {files.length} {files.length === 1 ? "file" : "files"}
        </span>
      </header>
      {files.map((f) => {
        const decided =
          f.hunks.length > 0 && f.hunks.every((_, i) => f.state[i]);
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
            {f.note && <p className="glass-note">{f.note}</p>}
            {f.hunks.map((h, i) => {
              const adds = h.lines.filter((l) => l.kind === "add").length;
              const dels = h.lines.filter((l) => l.kind === "del").length;
              const kept = f.state[i] === "kept";
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
                          <span
                            key={j}
                            className="glass-line"
                            data-diff={l.kind}
                          >
                            <span className="glass-ln">
                              {l.newLine ?? l.oldLine ?? ""}
                            </span>
                            <span className="glass-sign">
                              {l.kind === "add"
                                ? "+"
                                : l.kind === "del"
                                  ? "-"
                                  : " "}
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
