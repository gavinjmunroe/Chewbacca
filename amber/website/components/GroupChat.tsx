"use client";

/**
 * THE TEAM'S CONVERSATION, SHAPED LIKE TEAMS.
 *
 * Teams does one thing differently from Slack and it is the thing worth
 * copying: a reply lives UNDER the message it answers, inside a visible
 * container, collapsed to a count until somebody opens it. You can see at a
 * glance that a message started an argument without the argument taking over
 * the channel, and opening it does not navigate anywhere -- the rest of the
 * conversation stays exactly where it was on screen.
 *
 * The previous version put threads in a slide-over panel, which is Slack's
 * answer. It works, and it was wrong here for a specific reason: this panel
 * is already a column inside a page, so a panel over a panel meant two levels
 * of "go back" in a space the width of a phone.
 *
 * WHAT A MESSAGE IS. A post addressed to this group. WHAT A REPLY IS. An
 * answer to that post. Both already existed -- this is a different reading of
 * the same two tables, not a second messaging system, because a company with
 * two places a decision might be always has it in the other one.
 *
 * SENDING IS OPTIMISTIC, AND THAT IS A CORRECTNESS FIX RATHER THAN A FLOURISH.
 * The old composer cleared the box, posted, refetched, and re-rendered. When
 * any step of that failed quietly -- a refused scope, a dropped response --
 * the message simply was not there, and the person had no way to tell whether
 * it had been sent, lost, or was still going. Now the message appears
 * instantly, marked as sending; it either confirms, or turns into a failed
 * row with the text still in it and a Retry button. A message can no longer
 * vanish without saying so.
 *
 * NOT LIVE. It polls every fifteen seconds while this is the screen you are
 * on, and stops when it is not. Two people typing at each other will notice.
 * The seam for a websocket is the `useEffect` marked below, and saying so is
 * better than a screen that looks live and is not.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  CornerUpLeft,
  Loader2,
  MessageSquare,
  Pin,
  RotateCcw,
  SendHorizonal,
  Smile,
  Trash2,
} from "lucide-react";
import { AmberError } from "@/lib/amber";
import { mutate, useCached } from "@/lib/cache";
import { useScreenVisible } from "@/lib/screen";
import {
  answer as postAnswer,
  getAnswers,
  getFeed,
  pinPost,
  post as createPost,
  react,
  removePost,
  type Answer,
  type Post,
  type PostReaction,
} from "@/lib/knowledge";
import { Avatar, Badge } from "@/components/ui";

/** The six the server's CHECK constraint allows. */
const EMOJI = ["👍", "🎉", "❤️", "👀", "😄", "🤔"];

/**
 * How long a gap breaks a run of messages from one person.
 *
 * Five minutes: long enough that "ok" and "actually wait" stay together,
 * short enough that coming back after lunch gets a fresh header with a time
 * on it, which is what somebody scrolling back is looking for.
 */
const RUN_GAP_MS = 5 * 60 * 1000;

const POLL_MS = 15_000;

/** A message that exists on screen but not yet on the server. */
type Pending = {
  tempId: string;
  body: string;
  parentId: string | null;
  state: "sending" | "failed";
};

export default function GroupChat({
  groupId,
  groupName,
  meId,
  meName,
  isAdmin,
}: {
  groupId: string;
  groupName: string;
  meId: string | null;
  meName?: string | null;
  isAdmin: boolean;
}) {
  const key = `feed:${groupId}:any`;
  const { data, loading, error: loadError, revalidate } = useCached(key, () =>
    getFeed({ groupId }),
  );

  const onScreen = useScreenVisible();
  const [pending, setPending] = useState<Pending[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Which threads are open. Teams keeps this per message, not globally. */
  const [openThreads, setOpenThreads] = useState<Set<string>>(new Set());

  const messages = useMemo(() => {
    // Oldest first: a conversation is read downward, and the API returns
    // newest first because that is what a feed wants.
    const all = [...(data?.posts ?? [])];
    all.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return all;
  }, [data]);

  const pinned = useMemo(() => messages.filter((m) => m.pinned_at), [messages]);

  /* ── polling, only while this is the screen you are looking at ───────── */
  useEffect(() => {
    if (!onScreen) return;
    // ↓ the seam. A websocket replaces this interval and nothing else.
    const tick = () => {
      if (document.visibilityState === "visible") void revalidate();
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [revalidate, onScreen]);

  useEffect(() => {
    if (onScreen) void revalidate();
  }, [onScreen, revalidate]);

  const reload = useCallback(async () => {
    await revalidate();
  }, [revalidate]);

  /** Patch one message in the cached list, for a write we already know landed. */
  const patch = useCallback(
    (id: string, fn: (p: Post) => Post) => {
      mutate<{ posts: Post[]; count: number; mentions: number }>(key, (prev) =>
        prev ? { ...prev, posts: prev.posts.map((p) => (p.id === id ? fn(p) : p)) } : prev,
      );
    },
    [key],
  );

  const forget = useCallback(
    (id: string) => {
      mutate<{ posts: Post[]; count: number; mentions: number }>(key, (prev) =>
        prev ? { ...prev, posts: prev.posts.filter((p) => p.id !== id) } : prev,
      );
    },
    [key],
  );

  /**
   * Send, showing it immediately.
   *
   * The pending row is removed only once the refetch has returned, so there
   * is never a frame where the message has left the pending list and not yet
   * arrived in the real one -- which would read as the message flickering out
   * of existence and is exactly the thing being fixed.
   */
  /**
   * Send, and show the real message as soon as the server hands it back.
   *
   * The POST returns the created post, so the list can be corrected from
   * that directly -- no second round trip, and this API takes well over a
   * second per request. The old version posted and then refetched, which is
   * why "Sending…" sat on screen for three seconds and read as broken.
   */
  const send = useCallback(
    async (body: string, parentId: string | null) => {
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setPending((p) => [...p, { tempId, body, parentId, state: "sending" }]);
      setActionError(null);
      try {
        if (parentId) {
          await postAnswer(parentId, body);
          /*
           * A reply does not come back in a shape the channel list holds, so
           * the only thing to correct here is the parent's reply count --
           * which is what the collapsed thread bar shows, and the thing that
           * looked frozen before.
           */
          mutate<{ posts: Post[]; count: number; mentions: number }>(key, (prev) =>
            prev
              ? {
                  ...prev,
                  posts: prev.posts.map((p) =>
                    p.id === parentId
                      ? { ...p, answers: p.answers + 1, last_reply_at: new Date().toISOString() }
                      : p,
                  ),
                }
              : prev,
          );
        } else {
          /*
           * THE AUDIENCE AS WELL AS THE GROUP.
           *
           * group_id says where a post is filed; org_audiences says who it is
           * addressed to, and the rest of the console reads the second --
           * the audience badge, the reach count, the audience picker. A post
           * with only the column set looked unaddressed everywhere except
           * the chat it was typed into. `everyone: true` because a group
           * channel is company-visible work filed under a team, not
           * restricted to it; restricting is what the audience picker on the
           * main feed is for.
           */
          const r = await createPost({
            body,
            groupId,
            kind: "update",
            audience: { everyone: true, groups: [groupId], people: [] },
          });
          /*
           * THE SENDER'S OWN NAME, FILLED IN HERE AS WELL AS ON THE SERVER.
           *
           * The API now returns author_name, but an API running an older
           * build does not -- and the result is somebody watching their own
           * message appear under "Someone". The browser already knows who it
           * is; falling back to that costs nothing and makes the screen right
           * regardless of which version is deployed.
           */
          const landed: Post = {
            ...r.post,
            author_name: r.post.author_name ?? meName ?? null,
            author_id: r.post.author_id ?? meId,
          };
          mutate<{ posts: Post[]; count: number; mentions: number }>(key, (prev) =>
            prev ? { ...prev, posts: [landed, ...prev.posts] } : prev,
          );
        }
        setPending((p) => p.filter((x) => x.tempId !== tempId));
        return true;
      } catch (e) {
        setPending((p) =>
          p.map((x) => (x.tempId === tempId ? { ...x, state: "failed" as const } : x)),
        );
        setActionError(
          e instanceof AmberError
            ? e.message
            : "That message did not send. It is still here — retry it below.",
        );
        return false;
      }
    },
    [groupId, key, meName, meId],
  );

  const retry = useCallback(
    async (tempId: string) => {
      const row = pending.find((p) => p.tempId === tempId);
      if (!row) return;
      setPending((p) => p.filter((x) => x.tempId !== tempId));
      await send(row.body, row.parentId);
    },
    [pending, send],
  );

  const toggleThread = useCallback((id: string) => {
    setOpenThreads((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const error =
    actionError ??
    (loadError instanceof AmberError
      ? loadError.message
      : loadError
        ? "Could not load the conversation."
        : null);

  /** Pending messages that belong to the channel rather than to a thread. */
  const channelPending = pending.filter((p) => p.parentId === null);

  return (
    <div className="flex h-[600px] flex-col">
      {error ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-[var(--ds-danger-soft)] bg-[var(--ds-danger-soft)] px-4 py-2">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ds-danger)]" />
          <p className="text-[12px] leading-snug text-[var(--ds-danger)]">{error}</p>
        </div>
      ) : null}

      {pinned.length > 0 ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--ds-line)] bg-[var(--ds-sunk)] px-4 py-2">
          <Pin className="h-3 w-3 shrink-0 text-[var(--ds-accent)]" />
          <span className="truncate text-[12px] text-[var(--ds-muted)]">
            {pinned[pinned.length - 1].body}
          </span>
          {pinned.length > 1 ? <Badge>+{pinned.length - 1}</Badge> : null}
        </div>
      ) : null}

      <MessageList
        messages={messages}
        pending={channelPending}
        loading={loading}
        groupName={groupName}
        meId={meId}
        meName={meName ?? null}
        isAdmin={isAdmin}
        openThreads={openThreads}
        allPending={pending}
        onToggleThread={toggleThread}
        onChanged={reload}
        onPatch={patch}
        onForget={forget}
        onError={setActionError}
        onSend={send}
        onRetry={retry}
      />

      <Composer
        placeholder={`Message ${groupName}`}
        onSend={(text) => send(text, null)}
      />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── message list */

function MessageList({
  messages,
  pending,
  loading,
  groupName,
  meId,
  meName,
  isAdmin,
  openThreads,
  allPending,
  onToggleThread,
  onChanged,
  onPatch,
  onForget,
  onError,
  onSend,
  onRetry,
}: {
  messages: Post[];
  pending: Pending[];
  loading: boolean;
  groupName: string;
  meId: string | null;
  meName: string | null;
  isAdmin: boolean;
  openThreads: Set<string>;
  allPending: Pending[];
  onToggleThread: (id: string) => void;
  onChanged: () => Promise<unknown> | void;
  onPatch: (id: string, fn: (p: Post) => Post) => void;
  onForget: (id: string) => void;
  onError: (m: string | null) => void;
  onSend: (body: string, parentId: string | null) => Promise<boolean>;
  onRetry: (tempId: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastCount = useRef(0);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    // Measured BEFORE anything is written, so a message arriving while you
    // read Tuesday's does not drag you to the bottom.
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };

  const total = messages.length + pending.length;
  useEffect(() => {
    const el = scroller.current;
    if (!el || total === 0) return;
    const first = lastCount.current === 0;
    if (first || (total > lastCount.current && atBottom.current)) {
      el.scrollTo({ top: el.scrollHeight, behavior: first ? "auto" : "smooth" });
    }
    lastCount.current = total;
  }, [total]);

  /** Runs: consecutive messages from one person inside the gap, same day. */
  const runs = useMemo(() => {
    const out: { key: string; day: string; items: Post[] }[] = [];
    for (const m of messages) {
      const day = new Date(m.created_at).toDateString();
      const prev = out[out.length - 1];
      const prevItem = prev?.items[prev.items.length - 1];
      const sameRun =
        prev &&
        prev.day === day &&
        prevItem &&
        prevItem.author_id === m.author_id &&
        // A message with replies ends its run: the thread below it needs the
        // message above it to be visibly its own thing.
        prevItem.answers === 0 &&
        new Date(m.created_at).getTime() - new Date(prevItem.created_at).getTime() < RUN_GAP_MS;
      if (sameRun) prev.items.push(m);
      else out.push({ key: m.id, day, items: [m] });
    }
    return out;
  }, [messages]);

  if (loading && messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--ds-dim)]">
        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        Loading the conversation…
      </div>
    );
  }

  if (messages.length === 0 && pending.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <span className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-[var(--ds-hover)] text-[var(--ds-dim)]">
          <MessageSquare className="h-4 w-4" />
        </span>
        <p className="text-[14px] font-medium text-[var(--ds-ink)]">
          Nothing said in {groupName} yet
        </p>
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-[var(--ds-muted)]">
          Say the thing you were about to say in a meeting. Replies sit under the message
          they answer, so one long argument does not bury the rest of the channel.
        </p>
      </div>
    );
  }

  let lastDay = "";
  return (
    <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-2">
      {runs.map((run) => {
        const showDay = run.day !== lastDay;
        lastDay = run.day;
        return (
          <div key={run.key}>
            {showDay ? <DayDivider day={run.day} /> : null}
            {run.items.map((m, i) => (
              <Message
                key={m.id}
                post={m}
                head={i === 0}
                mine={!!meId && m.author_id === meId}
                meId={meId}
                isAdmin={isAdmin}
                threadOpen={openThreads.has(m.id)}
                pending={allPending.filter((p) => p.parentId === m.id)}
                onToggleThread={() => onToggleThread(m.id)}
                onChanged={onChanged}
                onPatch={onPatch}
                onForget={onForget}
                onError={onError}
                onSend={onSend}
                onRetry={onRetry}
              />
            ))}
          </div>
        );
      })}

      {pending.map((p) => (
        <PendingRow key={p.tempId} row={p} name={meName} onRetry={() => onRetry(p.tempId)} />
      ))}
    </div>
  );
}

function DayDivider({ day }: { day: string }) {
  const d = new Date(day);
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  const label =
    day === today
      ? "Today"
      : day === yesterday
        ? "Yesterday"
        : d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  return (
    <div className="my-3 flex items-center gap-3">
      <span className="h-px flex-1 bg-[var(--ds-line)]" />
      <span className="text-[11px] font-medium text-[var(--ds-faint)]">{label}</span>
      <span className="h-px flex-1 bg-[var(--ds-line)]" />
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────── message */

function Message({
  post,
  head,
  mine,
  meId,
  isAdmin,
  threadOpen,
  pending,
  onToggleThread,
  onChanged,
  onPatch,
  onForget,
  onError,
  onSend,
  onRetry,
}: {
  post: Post;
  head: boolean;
  mine: boolean;
  meId: string | null;
  isAdmin: boolean;
  threadOpen: boolean;
  pending: Pending[];
  onToggleThread: () => void;
  onChanged: () => Promise<unknown> | void;
  onPatch: (id: string, fn: (p: Post) => Post) => void;
  onForget: (id: string) => void;
  onError: (m: string | null) => void;
  onSend: (body: string, parentId: string | null) => Promise<boolean>;
  onRetry: (tempId: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasThread = post.answers > 0 || pending.length > 0 || threadOpen;

  /**
   * React, on screen immediately.
   *
   * The server call still happens and still decides; what changed is that
   * the chip no longer waits a second and a half for a POST and another for
   * a refetch before moving. A reaction is the cheapest gesture in the
   * product and it was the slowest thing in it.
   *
   * The arithmetic here is the same arithmetic the server does -- the
   * endpoint is a toggle, so sending the same emoji twice takes it back --
   * and if we get it wrong the poll corrects it within fifteen seconds.
   */
  async function toggleReaction(emoji: string) {
    setPicking(false);
    const before = post.reactions ?? [];
    onPatch(post.id, (p) => ({ ...p, reactions: toggleIn(p.reactions, emoji) }));
    try {
      await react(post.id, emoji);
    } catch {
      onPatch(post.id, (p) => ({ ...p, reactions: before }));
      onError("Could not react to that.");
    }
  }

  return (
    /*
      NO BOX.
      
      A message with replies used to get a bordered card around it, so a
      channel became a column of framed rectangles and the eye spent its time
      on the frames. Teams draws the border; it does not need it, and neither
      does this -- the indented rail under a thread already says "these belong
      to that", which is the only thing the box was communicating.
      
      What is left is a hover tint and the rail. Quieter, and the conversation
      is the thing you see.
    */
    <div
      className={`group/msg relative rounded-lg transition-colors ${
        post.pinned_at ? "bg-[var(--ds-accent-soft)]" : "hover:bg-[var(--ds-hover)]"
      } ${post.mentions_me ? "ring-1 ring-[var(--ds-accent-ring)]" : ""}`}
    >
      <div className="flex gap-2.5 px-2 py-1.5">
        <div className="w-8 shrink-0">
          {head ? (
            <Avatar name={post.author_name ?? post.source ?? null} size={32} />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          {head ? (
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-semibold text-[var(--ds-ink)]">
                {post.author_name ??
                  (post.source ? post.source.replace(/^key:/, "") : "Someone")}
              </span>
              {post.author_id === null && post.source ? <Badge>app</Badge> : null}
              <span className="text-[11px] text-[var(--ds-faint)]">
                {clock(post.created_at)}
              </span>
            </div>
          ) : null}

          {post.title ? (
            <p className="text-[13px] font-semibold text-[var(--ds-ink)]">{post.title}</p>
          ) : null}

          <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-[var(--ds-ink)]">
            {post.body}
          </p>

          {post.files_list?.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {post.files_list.map((f) => (
                <Badge key={f.id}>{f.title || f.filename}</Badge>
              ))}
            </div>
          ) : null}

          {post.reactions?.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {post.reactions.map((r) => (
                <button
                  key={r.emoji}
                  disabled={busy}
                  onClick={() => toggleReaction(r.emoji)}
                  className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors ${
                    r.mine
                      ? "border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] text-[var(--ds-accent-ink)]"
                      : "border-[var(--ds-line)] bg-[var(--ds-card)] text-[var(--ds-muted)] hover:border-[var(--ds-line-strong)]"
                  }`}
                >
                  <span>{r.emoji}</span>
                  <span className="tnum">{r.count}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/*
        THE THREAD, UNDER ITS MESSAGE.

        Collapsed to a count with faces, which is the one line that says
        whether this is a discussion or somebody thinking out loud. Opening it
        expands in place: nothing navigates, nothing slides over, and the rest
        of the channel does not move except to make room.
      */}
      {post.answers > 0 || pending.length > 0 ? (
        <Thread
          post={post}
          open={threadOpen}
          pending={pending}
          meId={meId}
          onToggle={onToggleThread}
          onSend={onSend}
          onRetry={onRetry}
        />
      ) : null}

      {/* A reply box the first time, so starting a thread is one click. */}
      {post.answers === 0 && pending.length === 0 && threadOpen ? (
        <div className="border-t border-[var(--ds-line)] px-2 py-2 pl-[42px]">
          <Composer
            compact
            autoFocus
            placeholder="Reply…"
            onSend={(text) => onSend(text, post.id)}
          />
        </div>
      ) : null}

      {/* ── the hover toolbar ── */}
      <div className="absolute -top-3 right-2 z-10 hidden rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] shadow-[var(--ds-shadow-sm)] group-hover/msg:flex">
        <button
          title="React"
          onClick={() => setPicking((v) => !v)}
          className="grid h-7 w-7 place-items-center text-[var(--ds-muted)] hover:text-[var(--ds-ink)]"
        >
          <Smile className="h-3.5 w-3.5" />
        </button>
        <button
          title="Reply"
          onClick={onToggleThread}
          className="flex h-7 items-center gap-1 px-2 text-[11px] font-medium text-[var(--ds-muted)] hover:text-[var(--ds-ink)]"
        >
          <CornerUpLeft className="h-3.5 w-3.5" />
          Reply
        </button>
        {isAdmin ? (
          <button
            title={post.pinned_at ? "Unpin" : "Pin to the top"}
            onClick={async () => {
              const was = post.pinned_at ?? null;
              // Flipped on screen first. Pinning appeared to do nothing
              // because the only feedback was a strip at the top that took
              // three seconds to redraw.
              onPatch(post.id, (p) => ({
                ...p,
                pinned_at: was ? null : new Date().toISOString(),
              }));
              try {
                await pinPost(post.id, !was);
              } catch {
                onPatch(post.id, (p) => ({ ...p, pinned_at: was }));
                onError("Could not pin that.");
              }
            }}
            className={`grid h-7 w-7 place-items-center hover:text-[var(--ds-ink)] ${
              post.pinned_at ? "text-[var(--ds-accent)]" : "text-[var(--ds-muted)]"
            }`}
          >
            <Pin className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {mine || isAdmin ? (
          <button
            title="Delete"
            onClick={async () => {
              onForget(post.id);
              try {
                await removePost(post.id);
              } catch {
                /*
                 * A refetch, only here. Patching cannot put a row back --
                 * it maps over what is present and this one is not -- and a
                 * failed delete is rare enough that paying a round trip to
                 * be certainly correct is the right trade. The optimistic
                 * path is the one that had to be fast.
                 */
                onError("Could not delete that. Putting it back…");
                await onChanged();
              }
            }}
            className="grid h-7 w-7 place-items-center text-[var(--ds-muted)] hover:text-[var(--ds-danger)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {picking ? (
        <div className="absolute -top-10 right-2 z-20 flex gap-0.5 rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] p-1 shadow-[var(--ds-shadow-lg)]">
          {EMOJI.map((e) => (
            <button
              key={e}
              onClick={() => toggleReaction(e)}
              className="grid h-7 w-7 place-items-center rounded hover:bg-[var(--ds-hover)]"
            >
              {e}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── thread */

function Thread({
  post,
  open,
  pending,
  meId,
  onToggle,
  onSend,
  onRetry,
}: {
  post: Post;
  open: boolean;
  pending: Pending[];
  meId: string | null;
  onToggle: () => void;
  onSend: (body: string, parentId: string | null) => Promise<boolean>;
  onRetry: (tempId: string) => void;
}) {
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getAnswers(post.id)
      .then((r) => setAnswers(r.answers))
      .catch(() => setAnswers([]))
      .finally(() => setLoading(false));
  }, [post.id]);

  /*
   * Replies are fetched when the thread is OPENED, not with the channel.
   * Loading every thread up front would be one request per message on a
   * screen that already has one; a closed thread only needs its count, which
   * the feed already carries.
   */
  useEffect(() => {
    if (open && answers === null) load();
  }, [open, answers, load]);

  /* A reply that just landed makes the fetched list stale. */
  useEffect(() => {
    if (open && answers !== null && post.answers !== answers.length) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.answers]);

  const faces = post.answer_names ?? [];

  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 pl-[42px] text-left transition-colors hover:bg-[var(--ds-hover)]"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[var(--ds-accent)] transition-transform ${
            open ? "" : "-rotate-90"
          }`}
        />
        <span className="flex -space-x-1.5">
          {faces.slice(0, 3).map((n, i) => (
            <Avatar key={`${n}-${i}`} name={n} size={18} />
          ))}
        </span>
        <span className="text-[12px] font-medium text-[var(--ds-accent)]">
          {post.answers} {post.answers === 1 ? "reply" : "replies"}
        </span>
        {post.last_reply_at && !open ? (
          <span className="text-[11px] text-[var(--ds-faint)]">
            last {clock(post.last_reply_at)}
          </span>
        ) : null}
      </button>

      {/*
        A SMOOTH OPEN, done with a grid row rather than a height animation.
        
        Animating height means knowing the height, which means measuring the
        content, which means a resize observer and a jump the first time
        anything inside changes. `grid-template-rows: 0fr -> 1fr` animates to
        the content's natural height with no measurement at all, and collapses
        back the same way. The inner div needs the overflow hidden or the
        replies spill out of a row that is zero high.
      */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
        {/* The rail is what makes a reply read as a reply from across the
            room, before any of the text is legible. */}
        <div className="ml-[22px] border-l-2 border-[var(--ds-line)] pl-3 pr-2">
          {loading && answers === null ? (
            <p className="flex items-center gap-2 py-2 text-[12px] text-[var(--ds-dim)]">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading replies…
            </p>
          ) : (
            <div className="space-y-2 py-2">
              {(answers ?? []).map((a) => (
                <Reply
                  key={a.id}
                  answer={a}
                  mine={a.author_id === meId}
                  onReact={async (emoji) => {
                    /*
                     * The same toggle the channel uses, applied to the
                     * fetched list rather than the cache: replies are loaded
                     * per thread, so there is no cached array to patch, and
                     * holding them in local state is what makes the chip move
                     * before the request finishes.
                     */
                    setAnswers((prev) =>
                      (prev ?? []).map((x) =>
                        x.id === a.id ? { ...x, reactions: toggleIn(x.reactions, emoji) } : x,
                      ),
                    );
                    try {
                      await react(a.id, emoji);
                    } catch {
                      setAnswers((prev) =>
                        (prev ?? []).map((x) =>
                          x.id === a.id ? { ...x, reactions: a.reactions ?? [] } : x,
                        ),
                      );
                    }
                  }}
                />
              ))}

              {pending.map((p) => (
                <PendingRow
                  key={p.tempId}
                  row={p}
                  name={null}
                  small
                  onRetry={() => onRetry(p.tempId)}
                />
              ))}
            </div>
          )}

          <div className="pb-2">
            <Composer compact placeholder="Reply…" onSend={(t) => onSend(t, post.id)} />
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}


/**
 * One reply, with the same gestures a message has.
 *
 * Pulled out rather than inlined because it now has hover state of its own,
 * and a component with state inside a map is a component that needs a name.
 */
function Reply({
  answer,
  mine,
  onReact,
}: {
  answer: Answer;
  mine: boolean;
  onReact: (emoji: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="group/reply relative -mx-1 flex gap-2 rounded-md px-1 py-0.5 hover:bg-[var(--ds-hover)]">
      <Avatar name={answer.author_name} size={24} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[12.5px] font-semibold text-[var(--ds-ink)]">
            {answer.author_name ?? "Someone"}
          </span>
          {mine ? <span className="text-[11px] text-[var(--ds-faint)]">you</span> : null}
          <span className="text-[11px] text-[var(--ds-faint)]">{clock(answer.created_at)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[var(--ds-ink)]">
          {answer.body}
        </p>

        {answer.reactions?.length ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {answer.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => onReact(r.emoji)}
                className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors ${
                  r.mine
                    ? "border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] text-[var(--ds-accent-ink)]"
                    : "border-[var(--ds-line)] bg-[var(--ds-card)] text-[var(--ds-muted)] hover:border-[var(--ds-line-strong)]"
                }`}
              >
                <span>{r.emoji}</span>
                <span className="tnum">{r.count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <button
        title="React"
        onClick={() => setPicking((v) => !v)}
        className="absolute right-1 top-0.5 grid h-6 w-6 place-items-center rounded-md border border-[var(--ds-line)] bg-[var(--ds-card)] text-[var(--ds-muted)] opacity-0 shadow-[var(--ds-shadow-sm)] transition-opacity hover:text-[var(--ds-ink)] group-hover/reply:opacity-100"
      >
        <Smile className="h-3 w-3" />
      </button>

      {picking ? (
        <div className="absolute right-1 top-7 z-20 flex gap-0.5 rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] p-1 shadow-[var(--ds-shadow-lg)]">
          {EMOJI.map((e) => (
            <button
              key={e}
              onClick={() => {
                setPicking(false);
                onReact(e);
              }}
              className="grid h-6 w-6 place-items-center rounded hover:bg-[var(--ds-hover)]"
            >
              {e}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The toggle arithmetic, in one place.
 *
 * It is the same rule the server applies -- the endpoint is a toggle, so
 * sending an emoji you already sent takes it back -- and it is used by both
 * the channel and the thread, which is why it is a function rather than
 * written twice slightly differently.
 */
function toggleIn(list: PostReaction[] | undefined, emoji: string): PostReaction[] {
  const current = list ?? [];
  const have = current.find((r) => r.emoji === emoji);
  if (!have) return [...current, { emoji, count: 1, mine: true }];
  if (have.mine) {
    return current
      .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r))
      .filter((r) => r.count > 0);
  }
  return current.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r));
}

/* ───────────────────────────────────────────────────────────── pending row */

/**
 * A message that is on screen and not yet on the server.
 *
 * It looks like a real message at reduced opacity rather than like a
 * placeholder, because it IS the message -- what is uncertain is only whether
 * it has landed. A failure keeps the text and offers Retry, so the one thing
 * that must never happen (typed words disappearing) cannot.
 */
function PendingRow({
  row,
  name,
  small,
  onRetry,
}: {
  row: Pending;
  name: string | null;
  small?: boolean;
  onRetry: () => void;
}) {
  const failed = row.state === "failed";
  return (
    <div className={`flex gap-2.5 px-2 py-1.5 ${small ? "" : "pl-2"}`}>
      <div className={small ? "w-6 shrink-0" : "w-8 shrink-0"}>
        <Avatar name={name} size={small ? 24 : 32} />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`whitespace-pre-wrap break-words text-[13.5px] leading-relaxed ${
            failed ? "text-[var(--ds-muted)]" : "text-[var(--ds-ink)] opacity-60"
          }`}
        >
          {row.body}
        </p>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px]">
          {failed ? (
            <>
              <AlertCircle className="h-3 w-3 text-[var(--ds-danger)]" />
              <span className="text-[var(--ds-danger)]">Not sent</span>
              <button
                onClick={onRetry}
                className="inline-flex items-center gap-1 rounded px-1 font-medium text-[var(--ds-accent)] hover:bg-[var(--ds-accent-soft)]"
              >
                <RotateCcw className="h-3 w-3" />
                Retry
              </button>
            </>
          ) : (
            <>
              <Loader2 className="h-3 w-3 animate-spin text-[var(--ds-faint)]" />
              <span className="text-[var(--ds-faint)]">Sending…</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────── composer */

/**
 * ONE SURFACE. NOT A BOX INSIDE A BOX.
 *
 * The previous version nested a styled textarea inside a styled container, so
 * a focused composer drew two rounded rectangles a couple of pixels apart.
 * Every piece of chrome a browser or a utility class might put on a textarea
 * is explicitly removed here -- appearance, border, ring, radius, padding --
 * because the bug was something inherited rather than something written, and
 * the fix has to hold regardless of which.
 */
function Composer({
  placeholder,
  onSend,
  compact,
  autoFocus,
}: {
  placeholder: string;
  onSend: (text: string) => Promise<boolean> | void;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [body]);

  useEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);

  function submit() {
    const text = body.trim();
    if (!text) return;
    /*
     * Cleared immediately, and NOT restored on failure -- the optimistic row
     * in the list owns the text now, and putting it back in the box as well
     * would show the same sentence twice with no way to tell which one is
     * real.
     */
    setBody("");
    void onSend(text);
    area.current?.focus();
  }

  return (
    <div className={compact ? "" : "shrink-0 border-t border-[var(--ds-line)] px-3 py-2.5"}>
      <div
        className={`flex items-end gap-2 rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] transition-shadow focus-within:border-[var(--ds-accent)] focus-within:shadow-[0_0_0_3px_var(--ds-accent-soft)] ${
          compact ? "px-2.5 py-1.5" : "px-3 py-2"
        }`}
      >
        <textarea
          ref={area}
          rows={1}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          className="m-0 max-h-[150px] min-h-[20px] flex-1 resize-none appearance-none rounded-none border-0 bg-transparent p-0 text-[13.5px] leading-relaxed text-[var(--ds-ink)] shadow-none outline-none ring-0 placeholder:text-[var(--ds-faint)] focus:border-0 focus:outline-none focus:ring-0"
        />
        <button
          onClick={submit}
          disabled={!body.trim()}
          title="Send"
          className={`shrink-0 grid place-items-center rounded-lg bg-[var(--ds-accent)] text-white transition-opacity disabled:opacity-25 ${
            compact ? "h-6 w-6" : "mb-0.5 h-7 w-7"
          }`}
        >
          <SendHorizonal className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
        </button>
      </div>
      {compact ? null : (
        <p className="mt-1 px-1 text-[11px] text-[var(--ds-faint)]">
          <kbd className="font-sans font-medium">Enter</kbd> to send ·{" "}
          <kbd className="font-sans font-medium">Shift</kbd>+
          <kbd className="font-sans font-medium">Enter</kbd> for a new line
        </p>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── helper */

function clock(iso: string) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(
        undefined,
        { hour: "numeric", minute: "2-digit" },
      )}`;
}
