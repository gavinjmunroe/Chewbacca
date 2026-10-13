// An agent turn told by the screen, for Realm on the Chewbacca glass.
//
// Part of our layer over Carlton Aikins' Realm renderer
// (github.com/31Carlton7/realm), which runs untouched underneath. Caleb,
// 2026-10-11 8:29pm: "literal storytelling level UX like the lemma site, each
// part of your screen being intentional, not just a sequence of lines".
//
// Template: a HUD session, one turn, one object on screen at a time. Stance:
// Carlton's quiet instrument. The content is the agent's turn as itself: its
// file, its check, its diff. Growing a tile lands here, not on his transcript.
// Seven regions, each with one job (skills/hud/SKILL.md, "An agent turn told
// by the screen"):
//
//   ask        what he asked, which agent, how long ago. Never changes.
//   headline   one sentence: what is happening now, or what happened
//   beats      You asked, Reading, Changing, Proving, Your call, Done
//   proof      what proved it, or plainly that nothing did
//   figure     ONE object for the beat, swapped on one crossfade (Lemma's
//              pinned panel): files read, the file changing, the check
//              running, the command it wants, the hunks, what changed
//   call       the one decision waiting on him, with the press that answers it
//   doors      Transcript and Reply: his full workspace, one press away
//
// The beats come from beats.mjs, which reads his engine's session events.
// Type, colour and motion are his tokens; nothing moves at rest except the
// lit beat's dot while the agent works.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AGENT_META } from "@realm/contracts";
import { rpc } from "../src/rpc/client";
import {
  CommandView,
  FaultBody,
  FileView,
  Review,
  TestsView,
  useNow,
  type Session,
} from "./GlassLayer";
import type { LinkSnap } from "./link.mjs";
import {
  beat,
  beatLine,
  callKey,
  decision,
  emptyStory,
  figure,
  fromHistory,
  headline,
  proof,
  tell,
  SETTLE_HOLD_MS,
} from "./beats.mjs";
import { Turn as TurnOf, clock, cutByRestart, isRunning, match, settle as within, stopElsewhere } from "./turn.mjs";
import type { Agent, Fault } from "./turn.mjs";

type Stored = {
  seq: number;
  sessionId: string;
  event: { type: string; ts?: number; payload?: Record<string, unknown> };
};
type ChangedFile = {
  path: string;
  // One line of what a look found, when its result said it (beats.mjs foundLine).
  found?: string;
  additions?: number | null;
  deletions?: number | null;
};
type Change = { before: string[]; after: string[]; all: boolean };
// One shape per tool kind (beats.mjs REQUESTS). Every field of the input is
// in it, or the request is raw.
type Request =
  | { kind: "command"; lines: string[]; notes: string[] }
  | ({ kind: "edit"; path: string } & Change)
  | { kind: "edits"; path: string; edits: Change[] }
  | { kind: "write"; path: string; lines: string[] }
  | { kind: "raw" };
type PermissionView = { shown: string; exact: boolean; request: Request };
type StoryShape = {
  asked: string;
  reads: string[];
  found: Record<string, string>;
  edited: string[];
  permission: {
    requestId: string;
    toolName: string;
    command: string;
    question: boolean;
    view: PermissionView;
  } | null;
  stage: {
    running: boolean;
    settledAt: number;
  };
  // The turn as one typed value: the beat, the figure and the review are
  // read from it (turn.mjs).
  agent: Agent;
};
type Call = {
  kind: string;
  requestId?: string;
  line: string;
  detail?: string;
  verbs: { id: string; text: string; key?: string }[];
} | null;
// A focused control that owns its own keys: Return on it is that control,
// never the call's first press. Realm's own card holds the same rule ("A
// focused control wins", PermissionCard.tsx): the first build here turned
// Return on a focused Deny into Allow (review, 10/12).
const OWNS_KEYS =
  'button,a[href],input,textarea,select,[contenteditable],[role="button"],[role="option"],[role="menuitem"],[role="tab"],.cm-editor,.xterm';
// His main pane, which the story covers (GlassLayer.tsx MAIN).
const HIDDEN_UNDER_STORY = "#root .app > .main";
const OVERLAY =
  '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[aria-modal="true"]';

// A pasted screenshot is stored as Claude Code's own marker, "[Image:
// original 2048x2048, displayed at ...]"; it reads as the image it was.
const askedText = (text: string) =>
  text.replace(/\[Image: [^\]]*\]/g, "(an image)").replace(/\s+/g, " ").trim();
const base = (path: string) => path.split("/").filter(Boolean).pop() ?? path;
const dirOf = (path: string, cwd: string) => {
  const rel = path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
  return rel.split("/").slice(0, -1).join("/");
};
const ago = (ms?: number) => {
  if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// Turns the person kept, by session and checkpoint. Kept outside the
// component because Story unmounts on every trip to the transcript and back,
// and a Keep that came back as a question would be a lie about what he did.
const KEPT = new Set<string>();
// History pages read back to find where a long turn began: 400 events a
// page, the same window Stage reads, up to 10 pages (4,000 events). Guessed.
const HISTORY_PAGE = 400;
const HISTORY_PAGES = 10;
// How long the whole history read may take before it is the engine-down
// fault with a Retry, never a story that silently reads as quiet. Measured
// 2026-10-11 at load 16: one 400-event page from the live engine took at
// most 4.8 ms, so ten pages are well under a second; 5 s matches
// GlassLayer.tsx's ENGINE_ANSWER_MS.
const HISTORY_ANSWER_MS = 5_000;

/** The events of the newest turn: pages back until the turn's ask is in
 *  hand, so a turn longer than one page still knows what was asked and what
 *  it edited. */
async function turnEvents(id: string, lastEventSeq: number): Promise<Stored[]> {
  let after = Math.max(0, lastEventSeq - HISTORY_PAGE);
  let list = (await rpc().call("sessions.events", { id, afterSeq: after, limit: HISTORY_PAGE })) as unknown as Stored[];
  for (let page = 1; page < HISTORY_PAGES && after > 0; page++) {
    if (list.some((e) => e.event.type === "user_message")) break;
    after = Math.max(0, after - HISTORY_PAGE);
    const earlier = (await rpc().call("sessions.events", { id, afterSeq: after, limit: HISTORY_PAGE })) as unknown as Stored[];
    const first = list[0]?.seq ?? Infinity;
    list = [...earlier.filter((e) => e.seq < first), ...list];
  }
  return list;
}

export function Story({
  session,
  onTranscript,
  onNew,
  settledOutsideAt = 0,
  outside = null,
  link = null,
  shown = true,
}: {
  session: Session;
  onTranscript: (reply: boolean) => void;
  onNew: () => void;
  /** A turn running outside realm's engine, in its Claude Code tab: when its
   *  prompt went in and which app runs it (tab_truth.mjs), or null. */
  outside?: { since: number | null; where: string | null } | null;
  /** The page's line to the engine (link.mjs): a reconnect re-reads the
   *  turn, and the engine's boot time tells a turn its restart cut off. */
  link?: Pick<LinkSnap, "gen" | "bootAt"> | null;
  /** On the glass now: the clock only ticks while someone can see it. */
  shown?: boolean;
  /** When the tab's own transcript says its turn ended (an imported Claude
   *  Code tab realm stopped following), or 0. Newer than realm's last word on
   *  the turn, it outranks realm's copy (turn.mjs tileTurn, the same rule). */
  settledOutsideAt?: number;
}) {
  const [story, setStory] = useState(emptyStory);
  const [loadFault, setLoadFault] = useState<Fault | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [wantsInView, setWantsInView] = useState(false);
  const figureRef = useRef<HTMLDivElement | null>(null);
  const [reviewEmpty, setReviewEmpty] = useState(false);
  const [, setTick] = useState(0);
  const lastSeq = useRef(0);
  // When this page saw the turn settle live. The hold for a late diff counts
  // from here, so a slow delivery can't skip it; a turn read from history has
  // none and counts from the engine's own timestamp.
  const settleSeen = useRef(0);

  // The newest turn of this session from his engine, then its live events.
  // Live events that land while the history is still loading wait in a
  // buffer and are replayed after it, so none is lost to the history's
  // answer (a permission_request lost there would leave the agent waiting
  // with no Allow on the glass).
  // The session it was last read for: a re-read of the same one (Retry, or
  // a reconnect) keeps the story on screen until the fresh read lands, so a
  // realm-ui handover never blanks it.
  const readFor = useRef("");
  const gen = link?.gen ?? 0;
  useEffect(() => {
    let alive = true;
    let ready = false;
    const buffer: Stored[] = [];
    if (readFor.current !== session.id) {
      readFor.current = session.id;
      setStory(emptyStory());
      setLoaded(false);
      setReviewEmpty(false);
      lastSeq.current = 0;
      settleSeen.current = 0;
    }
    const noteLive = (stored: Stored) => {
      if (stored.event.type === "user_message") {
        setReviewEmpty(false);
        settleSeen.current = 0;
      }
      const status = (stored.event.payload as { status?: string } | undefined)?.status;
      if (stored.event.type === "status" && status !== "running" && status !== "waiting_permission")
        settleSeen.current = Date.now();
    };
    const settle = (list: Stored[]) => {
      if (!alive) return;
      let s = fromHistory(list);
      lastSeq.current = list.at(-1)?.seq ?? 0;
      settleSeen.current = 0;
      for (const stored of buffer.sort((a, b) => a.seq - b.seq)) {
        if (stored.seq <= lastSeq.current) continue;
        lastSeq.current = stored.seq;
        noteLive(stored);
        s = tell(s, stored);
      }
      buffer.length = 0;
      ready = true;
      setStory(s);
      setLoaded(true);
    };
    setLoadFault(null);
    void within(turnEvents(session.id, session.lastEventSeq ?? 0), "engine-down", HISTORY_ANSWER_MS).then((r) => {
      if (r.ok) return settle(r.value);
      // Live events still tell the turn from here; the fault says the
      // history before them couldn't be read.
      if (alive) setLoadFault(r.fault);
      settle([]);
    });
    const off = rpc().on("session.event", (ev) => {
      const stored = ev as unknown as Stored;
      if (stored.sessionId !== session.id) return;
      if (!ready) {
        buffer.push(stored);
        return;
      }
      if (stored.seq <= lastSeq.current) return;
      lastSeq.current = stored.seq;
      noteLive(stored);
      setStory((s: unknown) => tell(s, stored));
    });
    return () => {
      alive = false;
      off();
    };
  }, [session.id, attempt, gen]);

  // The turn as it stands under the engine answering now: one its restart
  // cut off is told as that, never "Starting on it" forever (turn.mjs
  // cutByRestart). Every read below goes through this.
  const bootAt = link?.bootAt ?? 0;
  const told0 = story as unknown as StoryShape;
  const cut = bootAt ? cutByRestart(told0.agent, bootAt, session.agentKind) : told0.agent;
  const shownStory = useMemo(
    () => (cut === told0.agent ? story : { ...(story as object), agent: cut }),
    [story, cut, told0.agent],
  );
  const st = shownStory as unknown as StoryShape;
  // A turn is named by its checkpoint and the tree it left; a diff without
  // a checkpoint can't be told from the next one, so its Keep is never kept.
  const turn = st.agent.turn;
  // The turn whose object the figure draws: while it waits on him for a
  // request still on its way, the beat it paused (beats.mjs figure()).
  const shownTurn = turn?.phase === "needs-you" ? turn.resume : turn;
  const changes = st.agent.changes;
  const keptKey =
    changes?.checkpointId && changes.afterTree
      ? `${session.id}:${changes.checkpointId}:${changes.afterTree}`
      : "";
  const [keptHere, setKeptHere] = useState("");
  const kept = Boolean(keptKey) && (KEPT.has(keptKey) || keptHere === keptKey);
  // A diff whose hunks are all gone already (kept, committed or put back
  // elsewhere) has no decision left in it.
  const settledKept = kept || reviewEmpty;
  const settledAt = st.stage.settledAt;
  const settledFor = !settledAt
    ? Infinity
    : Date.now() - (settleSeen.current || settledAt);
  const told = beat(shownStory, { kept: settledKept, settledFor }) as string;
  // Realm's copy of an imported tab can stop mid-turn; the tab itself
  // finished. Told as Done, never "Starting on it" for a 5h-old tab (10/12).
  const b =
    turn && isRunning(turn) && settledOutsideAt > (turn.at || 0) ? "done" : told;
  // One re-render when the hold for a late diff runs out.
  useEffect(() => {
    if (!settledAt) return;
    const left = SETTLE_HOLD_MS - (Date.now() - (settleSeen.current || settledAt));
    if (left <= 0) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), left + 20);
    return () => window.clearTimeout(t);
  }, [settledAt]);

  const meta = AGENT_META[session.agentKind as keyof typeof AGENT_META];
  const who = meta?.label ?? "";
  const line = useMemo(() => headline(shownStory, b, { who }), [shownStory, b, who]);
  const beats = beatLine(b, shownStory);
  const proved = proof(shownStory);
  const call = decision(shownStory, { kept: settledKept, who }) as Call;
  const fig = figure(shownStory, b);
  // How long it has been at it. Realm's own turn counts from its ask; a tab
  // running in its own app counts from the prompt its transcript holds;
  // anything else has no clock, never a guessed one.
  const running = Boolean(turn && isRunning(turn)) && b !== "done";
  const clockTurn = st.agent.ran
    ? turn
    : outside?.since
      ? TurnOf.asked("", outside.since)
      : null;
  const now = useNow(shown && Boolean(clockTurn && isRunning(clockTurn)) && running);
  const ticking = clockTurn ? clock(clockTurn, now) : null;

  // Allow is pressable only while the whole request is on screen: none of it
  // below a fold or past the figure's edge.
  const requestId = call?.kind === "permission" ? (call.requestId ?? "") : "";
  useEffect(() => {
    setWantsInView(false);
    if (!requestId || fig !== "permission") return;
    // The whole card, head and body: the path of an edit sits in the head,
    // and Allow on a request whose path is out of view is a request not
    // shown in full (security review of the typed views, 10/12).
    const el = figureRef.current?.querySelector('[data-kind="wants"]');
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => setWantsInView(entries.some((e) => e.intersectionRatio >= 0.999)),
      { threshold: [0, 0.999, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [requestId, fig]);

  const answer = useCallback(
    (id: string) => {
      if (!call) return;
      if (id === "keep") {
        if (!keptKey) return;
        KEPT.add(keptKey);
        return setKeptHere(keptKey);
      }
      if (id === "answer") return onTranscript(false);
      if (id === "reply") return onTranscript(true);
      if (id === "new") return onNew();
      // Only the request still on the glass is answered: one that was
      // answered or settled meanwhile is gone from the story already.
      const pending = (story as unknown as StoryShape).permission;
      if (
        call.kind === "permission" &&
        (id === "allow" || id === "allow_always" || id === "deny") &&
        pending?.requestId === call.requestId &&
        pending !== null &&
        (id === "deny" || (pending.view.exact && wantsInView))
      ) {
        // His engine records the answer as a permission_response, which takes
        // the call off the glass. If the engine refuses, his own card in the
        // transcript is the way through.
        void rpc()
          .call("sessions.respondPermission", {
            id: session.id,
            requestId: call.requestId ?? "",
            decision: id,
          })
          .catch(() => onTranscript(false));
      }
    },
    [call, onTranscript, onNew, session.id, story, keptKey, wantsInView],
  );

  // The call's keys, as its buttons' hints say (beats.mjs callKey): Return
  // is the first press, Shift+Return Always allow, Cmd+Delete Deny, 1 to 9
  // the presses in order. Never while he types or one of his menus or
  // sheets is open, never on a held key, never in the first KEY_GUARD_MS of
  // a call, and Allow by key waits on the same whole-request-in-view gate as
  // its button.
  const callId = call ? `${call.kind}:${call.requestId ?? ""}:${call.line}` : "";
  const callShown = useRef(0);
  useEffect(() => {
    callShown.current = Date.now();
  }, [callId]);
  useEffect(() => {
    if (!call || loadFault) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      // His composer keeps focus under the story (his app focuses it on
      // open), where he can't see it or type in it: only a field he can see,
      // outside his main pane, is his typing. The first build skipped every
      // key for that hidden composer (headless WebKit, 10/12 evening).
      const t = document.activeElement;
      if (t && t !== document.body && t.closest?.(OWNS_KEYS) && !t.closest?.(HIDDEN_UNDER_STORY)) return;
      if (document.querySelector(OVERLAY)) return;
      const id = callKey(call, {
        key: e.key,
        shift: e.shiftKey,
        meta: e.metaKey,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        repeat: e.repeat,
        sinceShown: Date.now() - callShown.current,
      });
      if (!id) return;
      if ((id === "allow" || id === "allow_always") && !wantsInView) return;
      e.preventDefault();
      e.stopPropagation();
      answer(id);
    };
    // Capture: GlassLayer stops keys bound for his hidden pane at the
    // window, and this must still hear them.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [call, loadFault, answer, wantsInView]);

  // Stop, one press while his engine runs the turn (Claude.app, Realm and
  // Cursor each keep one beside the running status; steal list 11). Only a
  // turn his engine runs: an imported tab runs in its own terminal, where
  // realm's interrupt can't reach it.
  const [stopFault, setStopFault] = useState<Fault | null>(null);
  const stoppable = session.status === "running";
  // A failed Stop says so only while there's still a turn to stop.
  useEffect(() => {
    if (!stoppable) setStopFault(null);
  }, [stoppable]);
  const stop = useCallback(() => {
    void within(rpc().call("sessions.interrupt", { id: session.id }), "engine-down", HISTORY_ANSWER_MS).then((r) =>
      setStopFault(r.ok ? null : r.fault),
    );
  }, [session.id]);

  return (
    <section
      className="story"
      data-region="story"
      data-beat={b}
      data-working={(turn && isRunning(turn)) || undefined}
      data-loading={!loaded || undefined}
      data-figureless={fig === "none" || undefined}
      aria-label={`${session.title}: ${line}`}
    >
      <header className="story-ask" data-region="ask">
        <span className="story-label">{st.asked ? "You asked" : "Ready"}</span>
        <p className="story-asked">{askedText(st.asked) || session.title || "Untitled"}</p>
        <span className="story-meta">
          {meta?.label ?? session.agentKind} · {base(session.cwd)}
          {session.updatedAt ? ` · ${ago(session.updatedAt)}` : ""}
        </span>
      </header>

      <div className="story-tell" data-region="tell">
        <h1 className="story-headline" key={line} aria-live="polite">
          {loaded ? line : session.title || "Untitled"}
        </h1>
        {beats.length > 0 && (
        <ol className="story-beats" aria-label="Where the turn is">
          {beats.map((x: { id: string; word: string; state: string }) => (
            <li key={x.id} data-state={x.state}>
              <span className="story-beat-dot" aria-hidden="true" />
              {x.word}
            </li>
          ))}
        </ol>
        )}
        {proved && (
          <p className="story-proof" data-tone={proved.tone}>
            {proved.text}
          </p>
        )}
        {ticking && (
          <p className="story-clock" data-clock={ticking.tone}>
            {ticking.text}
          </p>
        )}
      </div>

      {(loadFault || call) && (
        <div
          className="story-call"
          data-region="call"
          data-kind={loadFault ? "fault" : call?.kind}
          key={loadFault ? "fault" : `${call?.kind}:${call?.requestId ?? ""}`}
        >
          {loadFault ? (
            <p className="glass-fault">
              <FaultBody fault={loadFault} onRetry={() => setAttempt((n) => n + 1)} />
            </p>
          ) : call ? (
          <>
          <p className="story-call-line">{call.line}</p>
          {call.detail && <p className="story-call-detail">{call.detail}</p>}
          <div className="story-call-verbs">
            {call.verbs.map((v) => (
              <button
                key={v.id}
                type="button"
                className="glass-word"
                data-tone={v.id === "deny" ? "bad" : undefined}
                onClick={() => answer(v.id)}
                data-verb={v.id}
                disabled={(v.id === "allow" || v.id === "allow_always") && !wantsInView}
                title={
                  v.id === "keep"
                    ? "Leaves every change as the agent wrote it. Nothing is written."
                    : (v.id === "allow" || v.id === "allow_always") && !wantsInView
                      ? "Bring the whole request into view first."
                      : v.id === "allow_always"
                        ? `Allows this and the same again in this session without asking.`
                        : undefined
                }
              >
                {v.text}
                {v.key && <kbd className="glass-key">{v.key}</kbd>}
              </button>
            ))}
          </div>
          </>
          ) : null}
        </div>
      )}

      {fig !== "none" && (
        <div
          className="story-figure"
          data-region="figure"
          key={fig}
          data-figure={fig}
          ref={figureRef}
        >
          {fig === "reads" && (
            <FileList
              label="Opened"
              files={st.reads.map((path) => ({ path, found: st.found[path] }))}
              cwd={session.cwd}
              litLast
            />
          )}
          {(fig === "file" || fig === "command" || fig === "tests") &&
            shownTurn &&
            match<ReactNode>(shownTurn, {
              asked: () => null,
              reading: (t) => (t.command ? <CommandView call={t.command} /> : null),
              changing: (t) => (
                <FileView key={`f:${t.file.path}`} call={t.file} cwd={session.cwd} />
              ),
              proved: (t) => <TestsView call={t.tests} />,
              "needs-you": () => null,
              done: () => null,
              failed: () => null,
            })}
          {fig === "permission" && st.permission && (
            <Wants view={st.permission.view} tool={st.permission.toolName} />
          )}
          {fig === "review" && changes && (
            <Review changes={changes} onEmpty={setReviewEmpty} />
          )}
          {fig === "changed" && (
            <FileList
              label="Changed"
              files={
                changes?.files?.length
                  ? changes.files
                  : st.edited.map((path) => ({ path }))
              }
              cwd={changes?.root ?? session.cwd}
            />
          )}
        </div>
      )}

      <nav className="story-doors" data-region="doors" aria-label="The transcript">
        {stopFault && (
          <span className="glass-fault-what" role="alert">
            {stopFault.what}
          </span>
        )}
        {stoppable && (
          <button type="button" className="glass-button" data-tone="bad" onClick={stop}>
            Stop
          </button>
        )}
        {!stoppable && outside && (
          // Realm's Stop reaches only turns its engine runs; this one runs in
          // its tab's own app. One line on where to stop it instead of a
          // button that can't (steal list 11, 10/12 "still rough").
          <span className="story-elsewhere" role="note">
            {stopElsewhere(outside.where)}
          </span>
        )}
        <button
          type="button"
          className="glass-button"
          onClick={() => onTranscript(false)}
        >
          Open transcript
        </button>
        <button
          type="button"
          className="glass-button"
          data-primary
          onClick={() => onTranscript(true)}
        >
          Reply
        </button>
      </nav>
    </section>
  );
}

function FileList({
  label,
  files,
  cwd,
  litLast = false,
}: {
  label: string;
  files: ChangedFile[];
  cwd: string;
  litLast?: boolean;
}) {
  return (
    <section className="story-list" aria-label={label}>
      <span className="story-label">{label}</span>
      <ul>
        {files.map((f, i) => {
          const dir = dirOf(f.path, cwd);
          return (
            <li
              key={f.path}
              data-lit={(litLast && i === files.length - 1) || undefined}
            >
              <span className="story-file">{base(f.path)}</span>
              {dir && <span className="glass-dir">{dir}</span>}
              {f.found && <span className="story-found">{f.found}</span>}
              {f.additions != null && (
                <span className="story-count">
                  <span data-tone="good">+{f.additions}</span>{" "}
                  <span data-tone="bad">-{f.deletions ?? 0}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The whole request, drawn as the thing it is: a command as the command,
 *  an edit as the file and its lines out and in, a write as the file and
 *  what goes in it. One view per kind, and the record below must name every
 *  kind (TypeScript refuses a missing one), so a new kind can't fall through
 *  to a partial drawing. Anything the typed views can't draw whole is the
 *  raw agents.py line: the real tool name and the input as JSON, newlines
 *  escaped. Wrapped, never scrolled sideways, and Allow waits until all of
 *  .story-wants is in view, so none of it sits out of sight. */
const REQUEST_VIEWS: {
  [K in Request["kind"]]: (r: Extract<Request, { kind: K }>, view: PermissionView, tool: string) => ReactNode;
} = {
  command: (r) => (
    <>
      <header className="glass-card-head">
        {/* One word: the headline already says "It wants to run npm", and
            the needs-you story was 45 words with "Wants to run" here. */}
        <span className="glass-verb">Command</span>
        {r.lines.length > 1 && <span className="glass-path">{r.lines.length} lines</span>}
      </header>
      <pre className="glass-code glass-term story-wants">
        {r.lines.map((l, i) => (
          <span key={i} className="glass-line">
            {r.lines.length > 1 && <span className="glass-ln">{i + 1}</span>}
            <span className="glass-prompt">{i === 0 ? "$ " : "  "}</span>
            {l || " "}
          </span>
        ))}
        {r.notes.map((n) => (
          <span key={n} className="glass-line glass-request-note">
            {n}
          </span>
        ))}
      </pre>
    </>
  ),
  edit: (r) => (
    <>
      <RequestHead verb="Wants to change" path={r.path} />
      <pre className="glass-code story-wants">
        <ChangeLines change={r} />
      </pre>
    </>
  ),
  edits: (r) => (
    <>
      <RequestHead verb={`Wants ${r.edits.length} changes in`} path={r.path} />
      <pre className="glass-code story-wants">
        {r.edits.map((c, i) => (
          <ChangeLines key={i} change={c} label={`Change ${i + 1}`} />
        ))}
      </pre>
    </>
  ),
  write: (r) => (
    <>
      <RequestHead verb="Wants to write" path={r.path} />
      <pre className="glass-code story-wants">
        {r.lines.map((l, i) => (
          <span key={i} className="glass-line" data-diff="add">
            <span className="glass-ln">{i + 1}</span>
            <span className="glass-sign">+</span>
            {l || " "}
          </span>
        ))}
      </pre>
    </>
  ),
  raw: (_r, view, tool) => (
    <>
      <header className="glass-card-head">
        <span className="glass-verb">Wants to use</span>
        <span className="glass-path">{tool}</span>
      </header>
      <pre className="glass-code glass-term story-wants">{view.shown}</pre>
    </>
  ),
};

function RequestHead({ verb, path }: { verb: string; path: string }) {
  // Verbatim: cut at the last slash, never rebuilt from its parts, so a
  // doubled or trailing slash or a run of spaces reads as it will run.
  const cut = path.lastIndexOf("/") + 1;
  return (
    <header className="glass-card-head">
      <span className="glass-verb">{verb}</span>
      {/* The whole path, wrapped: a file path cut with an ellipsis would be
          a request not shown in full. */}
      <span className="glass-path glass-path-whole">
        {cut > 0 && <span className="glass-dir">{path.slice(0, cut)}</span>}
        {path.slice(cut)}
      </span>
    </header>
  );
}

function ChangeLines({ change, label }: { change: Change; label?: string }) {
  return (
    <>
      {(label || change.all) && (
        <span className="glass-line glass-request-note">
          {[label, change.all ? "every match in the file" : ""].filter(Boolean).join(", ")}
        </span>
      )}
      {change.before.map((l, i) => (
        <span key={`o${i}`} className="glass-line" data-diff="del">
          <span className="glass-sign">-</span>
          {l || " "}
        </span>
      ))}
      {change.after.map((l, i) => (
        <span key={`n${i}`} className="glass-line" data-diff="add">
          <span className="glass-sign">+</span>
          {l || " "}
        </span>
      ))}
    </>
  );
}

function Wants({ view, tool }: { view: PermissionView; tool: string }) {
  const raw: Request = { kind: "raw" };
  const r = view.request && Object.hasOwn(REQUEST_VIEWS, view.request.kind) ? view.request : raw;
  const draw = REQUEST_VIEWS[r.kind] as (r: Request, view: PermissionView, tool: string) => ReactNode;
  return (
    <section className="glass-card" data-kind="wants" data-request={r.kind}>
      {draw(r, view, tool)}
    </section>
  );
}
