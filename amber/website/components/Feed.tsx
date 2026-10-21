"use client";

/**
 * THE FEED — what is happening, what nobody has answered yet, and the cheap
 * gestures that make an asynchronous channel readable.
 *
 * WHY THIS IS NOT A CHAT. Chat optimizes for the person who is present, which
 * means everything said in it is lost to everybody who was not. What a company
 * needs from its internal channel is the opposite: a question asked once,
 * answered once, and findable by the fourth person who has it.
 *
 * WHAT CHANGED, AND WHY IT IS NOT DECORATION. This had two verbs — post and
 * reply — and that is not enough to run a company's channel. If replying is
 * the only way to respond, people who agree say nothing (so the author cannot
 * tell consensus from silence), and the ones who do respond fill the thread
 * with "+1" that buries the reply worth reading. Every product that works at
 * this fixed it with a one-click acknowledgment. So: reactions, mentions,
 * pinning, files on a message, and threads that read as threads.
 *
 * THE COMPOSER IS COLLAPSED UNTIL IT IS CLICKED. A box with four controls
 * showing permanently is four decisions in front of somebody who wanted to
 * type a sentence. It opens into the full thing the moment they mean it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  CornerDownRight,
  FileText,
  MessageSquare,
  Paperclip,
  Pin,
  Plus,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { AmberError } from "@/lib/amber";
import {
  EVERYONE,
  POST_KIND_LABEL,
  REACTIONS,
  REACTION_MEANING,
  acceptAnswer,
  ago,
  answer as postAnswer,
  getAnswers,
  getFeed,
  initials,
  pinPost,
  post as createPost,
  react,
  removePost,
  whoReacted,
  type Answer,
  type AudienceInput,
  type Post,
  type PostKind,
} from "@/lib/knowledge";
import { Alert, Avatar, Badge, Button, Empty, Spinner } from "@/components/ui";
import { drop, useCached } from "@/lib/cache";
import { cn } from "@/lib/cn";
import {
  AudienceBadge,
  AudiencePicker,
  useAudienceOptions,
} from "@/components/AudiencePicker";

type Group = { id: string; name: string };

const FILTERS: { key: PostKind | "all" | "open"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Unanswered" },
  { key: "question", label: "Questions" },
  { key: "update", label: "Updates" },
  { key: "intro", label: "Intros" },
];

/** What each kind is FOR, so the picker is a decision rather than a guess. */
const KIND_HINT: Record<string, string> = {
  update: "Something happened, or is about to. It scrolls away.",
  question: "Stays up, in its own filter, until somebody answers it.",
  intro: "Who you are and what people should come to you for.",
};

export default function Feed({
  groups,
  isAdmin,
  meId,
  compact,
  onlyGroup,
}: {
  groups: Group[];
  isAdmin: boolean;
  meId: string | null;
  compact?: boolean;
  onlyGroup?: { id: string; name: string } | null;
}) {
  const [filter, setFilter] = useState<PostKind | "all" | "open">("all");

  /*
   * CACHED, BECAUSE A TAB CLICK UNMOUNTS THIS WHOLE COMPONENT.
   *
   * The console renders tabs as `{tab === "feed" ? <Feed/> : null}`, so
   * switching away destroys this and switching back builds it again from
   * nothing: spinner, round trip, content. Every single click. Reading
   * through the cache means a remount paints the posts it already had on the
   * first frame and refreshes behind them.
   */
  const kind = filter === "all" || filter === "open" ? undefined : filter;
  const key = `feed:${onlyGroup?.id ?? "all"}:${kind ?? "any"}`;
  const { data, loading, error: loadError, revalidate } =
    useCached(key, () => getFeed({ kind, groupId: onlyGroup?.id }));

  const load = revalidate;
  const error =
    loadError instanceof AmberError ? loadError.message : loadError ? "Could not load the feed." : null;

  const posts = useMemo(() => {
    const all = data?.posts ?? [];
    return filter === "open" ? all.filter((p) => p.answers === 0 && p.kind === "question") : all;
  }, [data, filter]);

  const pinned = posts.filter((p) => p.pinned_at);
  const rest = posts.filter((p) => !p.pinned_at);

  return (
    <div className="space-y-4">
      <Composer
        groups={onlyGroup ? [] : groups}
        fixedGroup={onlyGroup ?? null}
        meId={meId}
        onPosted={load}
      />

      <Alert>{error}</Alert>

      {onlyGroup ? null : (
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full border px-3 py-1 text-[12px] font-medium transition-all",
                filter === f.key
                  ? "border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] text-[var(--ds-ink)]"
                  : "border-[var(--ds-line)] bg-[var(--ds-card)] text-[var(--ds-muted)] hover:border-[var(--ds-line-strong)] hover:text-[var(--ds-ink)]",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid place-items-center py-12">
          <Spinner />
        </div>
      ) : posts.length === 0 ? (
        <Empty
          title={filter === "open" ? "Nothing unanswered" : "Nothing here yet"}
          note={
            onlyGroup
              ? `Be the first to post to ${onlyGroup.name}. A group with no messages is a group nobody checks.`
              : "A company feed is only useful once somebody starts it. Post an update, or ask the question you were about to ask in a meeting."
          }
        />
      ) : (
        <div className="space-y-3">
          {pinned.length > 0 ? (
            <>
              <SectionLabel icon={<Pin className="h-3 w-3" />}>Pinned</SectionLabel>
              {pinned.map((p) => (
                <PostCard key={p.id} post={p} isAdmin={isAdmin} meId={meId} onChanged={load} compact={compact} />
              ))}
              {rest.length > 0 ? <SectionLabel>Recent</SectionLabel> : null}
            </>
          ) : null}

          {rest.map((p) => (
            <PostCard key={p.id} post={p} isAdmin={isAdmin} meId={meId} onChanged={load} compact={compact} />
          ))}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 pt-1 text-[11px] font-medium uppercase tracking-wide text-[var(--ds-faint)]">
      {icon}
      {children}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── the composer */

function Composer({
  groups,
  fixedGroup,
  meId,
  onPosted,
}: {
  groups: Group[];
  fixedGroup?: { id: string; name: string } | null;
  meId: string | null;
  onPosted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PostKind>("update");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [audience, setAudience] = useState<AudienceInput>(
    fixedGroup ? { everyone: true, groups: [fixedGroup.id], people: [] } : EVERYONE,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useAudienceOptions(groups);
  const area = useRef<HTMLTextAreaElement>(null);

  const me = options.people.find((p) => p.id === meId);

  function reset() {
    setTitle("");
    setBody("");
    setMentions([]);
    setShowMentions(false);
    setKind("update");
    setAudience(fixedGroup ? { everyone: true, groups: [fixedGroup.id], people: [] } : { ...EVERYONE });
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await createPost({
        kind,
        title: title.trim() || null,
        body: body.trim(),
        /*
         * `|| null`, NOT `?? null`. An empty string is not a missing value in
         * JavaScript and is not a nullable uuid in SQL, and this is the seam
         * where those two facts meet — it used to send group_id: "" and 500
         * every single post.
         */
        groupId: fixedGroup?.id || audience.groups[0] || null,
        audience,
        mentions,
        });
      reset();
      setOpen(false);
      // The list this came from is now wrong. Showing somebody the feed
      // without the thing they just posted is worse than a spinner.
      drop("feed");
      onPosted();
    } catch (e) {
      setError(e instanceof AmberError ? e.message : "Could not post that.");
    } finally {
      setBusy(false);
    }
  }

  const ready = body.trim().length > 0 && (kind !== "question" || title.trim().length > 0);

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          setTimeout(() => area.current?.focus(), 0);
        }}
        className="flex w-full items-center gap-3 rounded-2xl border border-[var(--ds-line)] bg-[var(--ds-card)] px-4 py-3 text-left shadow-[var(--ds-shadow-sm)] transition-all hover:border-[var(--ds-line-strong)] hover:shadow-[var(--ds-shadow)]"
      >
        <Avatar name={me?.name ?? null} size={32} />
        <span className="flex-1 text-[14px] text-[var(--ds-dim)]">
          {fixedGroup ? `Post to ${fixedGroup.name}…` : "Share something with the team…"}
        </span>
        <span className="hidden items-center gap-1 text-[12px] text-[var(--ds-faint)] sm:flex">
          <MessageSquare className="h-3.5 w-3.5" />
          Ask a question
        </span>
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--ds-accent-ring)] bg-[var(--ds-card)] shadow-[var(--ds-shadow-lg)]">
      <div className="flex gap-1 border-b border-[var(--ds-line)] px-3 pt-3">
        {(["update", "question", "intro"] as PostKind[]).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={cn(
              "rounded-t-lg px-3 py-2 text-[13px] font-medium transition-all",
              kind === k
                ? "border-b-2 border-[var(--ds-accent)] text-[var(--ds-ink)]"
                : "border-b-2 border-transparent text-[var(--ds-muted)] hover:text-[var(--ds-ink)]",
            )}
          >
            {POST_KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="space-y-3 p-4">
        <Alert>{error}</Alert>
        <p className="text-[12px] text-[var(--ds-dim)]">{KIND_HINT[kind]}</p>

        {kind === "question" ? (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="The question, in one line — this is what the next person searches for"
            className="w-full rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] px-3 py-2 text-[15px] font-medium text-[var(--ds-ink)] outline-none placeholder:text-[var(--ds-faint)] focus:border-[var(--ds-accent)]"
          />
        ) : null}

        <div className="flex gap-3">
          <Avatar name={me?.name ?? null} size={32} className="mt-1 shrink-0" />
          <textarea
            ref={area}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={kind === "question" ? 4 : 3}
            placeholder={
              kind === "question"
                ? "What you have already tried, and what you need."
                : kind === "intro"
                  ? "Who you are, what you work on, and what people should come to you for."
                  : "What happened, or what is about to."
            }
            className="w-full resize-y rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] px-3 py-2 text-[15px] leading-relaxed text-[var(--ds-ink)] outline-none placeholder:text-[var(--ds-faint)] focus:border-[var(--ds-accent)]"
          />
        </div>

        {/*
          MENTIONS ARE A PICKER, NOT @-PARSING OF THE TEXT.
          Typing a name is not a reference to a person — two people share a
          first name and the one you meant is whichever the parser guessed.
          Picking is unambiguous, and it is also what lets a mention keep
          meaning somebody after they edit the sentence.
        */}
        {showMentions ? (
          <div className="rounded-xl border border-[var(--ds-line)] bg-[var(--ds-hover)] p-3">
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--ds-faint)]">
              Notify by name
            </div>
            <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
              {options.people
                .filter((p) => p.id !== meId)
                .map((p) => {
                  const on = mentions.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() =>
                        setMentions(on ? mentions.filter((x) => x !== p.id) : [...mentions, p.id])
                      }
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[12px] transition-all",
                        on
                          ? "border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] text-[var(--ds-ink)]"
                          : "border-[var(--ds-line)] bg-[var(--ds-card)] text-[var(--ds-muted)] hover:text-[var(--ds-ink)]",
                      )}
                    >
                      @{p.name}
                    </button>
                  );
                })}
              {options.people.length <= 1 ? (
                <span className="text-[12px] text-[var(--ds-faint)]">
                  Nobody else is here yet.
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-[var(--ds-muted)]">
              They get a badge. It does not widen who can see this — somebody outside the audience
              below is simply never shown it.
            </p>
          </div>
        ) : null}

        {fixedGroup ? null : (
          <AudiencePicker
            value={audience}
            onChange={setAudience}
            groups={options.groups}
            people={options.people}
            label="Who sees this"
            compact
          />
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ds-line)] pt-3">
          <Button
            tone={showMentions ? "quiet" : "ghost"}
            size="sm"
            onClick={() => setShowMentions((v) => !v)}
          >
            <AtSign className="h-3.5 w-3.5" />
            {mentions.length > 0 ? `${mentions.length} notified` : "Notify"}
          </Button>
          <span className="flex-1" />
          <Button
            tone="ghost"
            size="sm"
            onClick={() => {
              reset();
              setOpen(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
          <Button tone="primary" size="sm" busy={busy} disabled={!ready} onClick={send}>
            <Send className="h-3.5 w-3.5" />
            {kind === "question" ? "Ask" : "Post"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── a post card */

function PostCard({
  post,
  isAdmin,
  meId,
  onChanged,
  compact,
}: {
  post: Post;
  isAdmin: boolean;
  meId: string | null;
  onChanged: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [reactions, setReactions] = useState(post.reactions ?? []);
  const [picker, setPicker] = useState(false);

  const isQuestion = post.kind === "question";
  const mine = meId && String(post.author_id ?? "") === String(meId);

  const load = useCallback(() => {
    if (!open) return;
    getAnswers(post.id).then((r) => setAnswers(r.answers)).catch(() => {});
  }, [open, post.id]);

  useEffect(load, [load]);
  useEffect(() => setReactions(post.reactions ?? []), [post.reactions]);

  /*
   * REACTIONS UPDATE LOCALLY FIRST. A reaction is a gesture, and a gesture
   * that waits 300ms for a round trip before anything moves reads as broken.
   * The server is authoritative and the next load corrects any drift.
   */
  async function toggle(emoji: string) {
    setPicker(false);
    setReactions((prev) => {
      const found = prev.find((r) => r.emoji === emoji);
      if (!found) return [...prev, { emoji, count: 1, mine: true }];
      const next = found.mine
        ? { ...found, count: found.count - 1, mine: false }
        : { ...found, count: found.count + 1, mine: true };
      return prev.map((r) => (r.emoji === emoji ? next : r)).filter((r) => r.count > 0);
    });
    await react(post.id, emoji).catch(() => onChanged());
  }

  const replyCount = post.answers ?? 0;

  return (
    <article
      className={cn(
        "rounded-2xl border bg-[var(--ds-card)] shadow-[var(--ds-shadow-sm)] transition-shadow hover:shadow-[var(--ds-shadow)]",
        post.mentions_me
          ? "border-[var(--ds-accent)] shadow-[0_0_0_1px_var(--ds-accent-ring)]"
          : "border-[var(--ds-line)]",
      )}
    >
      {post.pinned_at || post.mentions_me ? (
        <div className="flex items-center gap-1.5 border-b border-[var(--ds-line)] px-5 py-2 text-[11px] font-medium text-[var(--ds-accent-ink)]">
          {post.pinned_at ? (
            <>
              <Pin className="h-3 w-3" /> Pinned
            </>
          ) : (
            <>
              <AtSign className="h-3 w-3" /> You were asked about this
            </>
          )}
        </div>
      ) : null}

      <div className="px-5 py-4">
        <header className="flex items-start gap-3">
          <Avatar name={post.author_name} size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[14px] font-semibold text-[var(--ds-ink)]">
                {post.author_name ?? "Someone"}
              </span>
              {post.author_title ? (
                <span className="text-[12px] text-[var(--ds-dim)]">{post.author_title}</span>
              ) : null}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--ds-dim)]">
              <span>{ago(post.created_at)}</span>
              {post.edited_at ? <span>· edited</span> : null}
              <AudienceBadge visibility={post.visibility} audience={post.audience} />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {isQuestion ? (
              <Badge tone={replyCount === 0 ? "accent" : "neutral"}>
                {replyCount === 0 ? "Unanswered" : `${replyCount} answered`}
              </Badge>
            ) : (
              <Badge>{POST_KIND_LABEL[post.kind]}</Badge>
            )}
            {isAdmin ? (
              <button
                title={post.pinned_at ? "Unpin" : "Pin for everyone"}
                className="rounded-md p-1 text-[var(--ds-faint)] hover:bg-[var(--ds-hover)] hover:text-[var(--ds-ink)]"
                onClick={async () => {
                  await pinPost(post.id, !post.pinned_at).catch(() => null);
                  onChanged();
                }}
              >
                <Pin className={cn("h-3.5 w-3.5", post.pinned_at && "text-[var(--ds-accent)]")} />
              </button>
            ) : null}
            {isAdmin || mine ? (
              <button
                title="Remove"
                className="rounded-md p-1 text-[var(--ds-faint)] hover:bg-[var(--ds-danger-soft)] hover:text-[var(--ds-danger)]"
                onClick={async () => {
                  await removePost(post.id).catch(() => null);
                  onChanged();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </header>

        {post.title ? (
          <h3 className="mt-3 text-[17px] font-semibold leading-snug text-[var(--ds-ink)]">
            {post.title}
          </h3>
        ) : null}

        <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--ds-ink)]">
          {post.body}
        </p>

        {post.files_list && post.files_list.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {post.files_list.map((f) => (
              <span
                key={f.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ds-line)] bg-[var(--ds-hover)] px-2.5 py-1.5 text-[12px] text-[var(--ds-ink)]"
              >
                <FileText className="h-3.5 w-3.5 text-[var(--ds-dim)]" />
                {f.title || f.filename}
              </span>
            ))}
          </div>
        ) : null}

        {/* ---------------------------------------------------- reactions */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {reactions.map((r) => (
            <ReactionChip key={r.emoji} postId={post.id} reaction={r} onToggle={() => toggle(r.emoji)} />
          ))}

          <div className="relative">
            <button
              onClick={() => setPicker((v) => !v)}
              className="inline-flex items-center gap-0.5 rounded-full border border-[var(--ds-line)] bg-[var(--ds-card)] px-2 py-1 text-[12px] text-[var(--ds-muted)] transition-all hover:border-[var(--ds-line-strong)] hover:text-[var(--ds-ink)]"
              title="React"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <Plus className="h-3 w-3" />
            </button>
            {picker ? (
              <>
                {/* Click-away without a portal: one invisible full-screen layer. */}
                <button
                  className="fixed inset-0 z-10 cursor-default"
                  aria-label="Close"
                  onClick={() => setPicker(false)}
                />
                <div className="absolute bottom-full left-0 z-20 mb-1 flex gap-0.5 rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] p-1 shadow-[var(--ds-shadow-lg)]">
                  {REACTIONS.map((e) => (
                    <button
                      key={e}
                      title={REACTION_MEANING[e]}
                      onClick={() => toggle(e)}
                      className="rounded-lg px-1.5 py-1 text-[17px] transition-transform hover:scale-125 hover:bg-[var(--ds-hover)]"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          <button
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] font-medium text-[var(--ds-muted)] transition-all hover:bg-[var(--ds-hover)] hover:text-[var(--ds-ink)]"
          >
            <CornerDownRight className="h-3.5 w-3.5" />
            {replyCount === 0
              ? isQuestion
                ? "Answer this"
                : "Reply"
              : `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
          </button>

          {/*
            WHO REPLIED, not just how many. "3 replies" says nothing about
            whether it is worth opening; the names say whether the person who
            knows the answer is already in it.
          */}
          {!open && post.answer_names && post.answer_names.length > 0 ? (
            <span className="text-[12px] text-[var(--ds-faint)]">
              {post.answer_names.slice(0, 2).join(", ")}
              {post.answer_names.length > 2 ? ` +${post.answer_names.length - 2}` : ""}
              {post.last_reply_at ? ` · ${ago(post.last_reply_at)}` : ""}
            </span>
          ) : null}
        </div>
      </div>

      {/* ------------------------------------------------------- the thread */}
      {open ? (
        <div className="border-t border-[var(--ds-line)] bg-[var(--ds-hover)] px-5 py-4">
          <div className="space-y-3">
            {answers.map((a) => (
              <Reply
                key={a.id}
                answer={a}
                canAccept={Boolean(mine) && isQuestion && !a.accepted_at}
                onAccept={async () => {
                  await acceptAnswer(post.id, a.id).catch(() => null);
                  load();
                  onChanged();
                }}
              />
            ))}

            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter would need a textarea — a reply
                  // that needs paragraphs is a post.
                  if (e.key === "Enter" && draft.trim() && !busy) {
                    e.preventDefault();
                    (async () => {
                      setBusy(true);
                      try {
                        await postAnswer(post.id, draft.trim());
                        setDraft("");
                        load();
                        onChanged();
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }
                }}
                placeholder={isQuestion ? "Answer it…" : "Reply…"}
                className="flex-1 rounded-full border border-[var(--ds-line)] bg-[var(--ds-card)] px-4 py-2 text-[14px] text-[var(--ds-ink)] outline-none placeholder:text-[var(--ds-faint)] focus:border-[var(--ds-accent)]"
              />
              <Button
                tone="primary"
                size="sm"
                busy={busy}
                disabled={!draft.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await postAnswer(post.id, draft.trim());
                    setDraft("");
                    load();
                    onChanged();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
            {compact ? null : (
              <p className="text-[11px] text-[var(--ds-faint)]">
                Replies inherit who can see the post. Somebody outside its audience never sees
                either.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function Reply({
  answer,
  canAccept,
  onAccept,
}: {
  answer: Answer;
  canAccept: boolean;
  onAccept: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3.5 py-3",
        answer.accepted_at
          ? "border-[var(--ds-accent)] bg-[var(--ds-accent-soft)]"
          : "border-[var(--ds-line)] bg-[var(--ds-card)]",
      )}
    >
      <div className="flex items-center gap-2">
        <Avatar name={answer.author_name} size={22} />
        <span className="text-[13px] font-medium text-[var(--ds-ink)]">
          {answer.author_name ?? "Someone"}
        </span>
        {answer.author_title ? (
          <span className="text-[12px] text-[var(--ds-dim)]">{answer.author_title}</span>
        ) : null}
        <span className="text-[12px] text-[var(--ds-faint)]">{ago(answer.created_at)}</span>
        {answer.accepted_at ? <Badge tone="accent">Accepted</Badge> : null}
        <span className="flex-1" />
        {canAccept ? (
          <button
            onClick={onAccept}
            className="text-[12px] font-medium text-[var(--ds-accent-ink)] hover:underline"
          >
            This answered it
          </button>
        ) : null}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap pl-[30px] text-[14px] leading-relaxed text-[var(--ds-ink)]">
        {answer.body}
      </p>
    </div>
  );
}

/**
 * One reaction, with who. The names load on hover rather than with the feed —
 * a page of twenty posts should not fetch twenty name lists nobody looks at.
 */
function ReactionChip({
  postId,
  reaction,
  onToggle,
}: {
  postId: string;
  reaction: { emoji: string; count: number; mine: boolean };
  onToggle: () => void;
}) {
  const [names, setNames] = useState<string[] | null>(null);

  const label = useMemo(() => {
    if (!names) return REACTION_MEANING[reaction.emoji] ?? "";
    if (names.length === 0) return "";
    if (names.length <= 3) return names.join(", ");
    return `${names.slice(0, 3).join(", ")} and ${names.length - 3} others`;
  }, [names, reaction.emoji]);

  return (
    <button
      title={label}
      onClick={onToggle}
      onMouseEnter={() => {
        if (names) return;
        whoReacted(postId)
          .then((r) => setNames(r.reactions.find((x) => x.emoji === reaction.emoji)?.names ?? []))
          .catch(() => setNames([]));
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[12px] transition-all",
        reaction.mine
          ? "border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] text-[var(--ds-ink)]"
          : "border-[var(--ds-line)] bg-[var(--ds-card)] text-[var(--ds-muted)] hover:border-[var(--ds-line-strong)]",
      )}
    >
      <span className="text-[13px] leading-none">{reaction.emoji}</span>
      <span className="tnum font-medium">{reaction.count}</span>
    </button>
  );
}
