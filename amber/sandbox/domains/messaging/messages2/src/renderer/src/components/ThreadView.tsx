import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Phone, Video, Info } from "lucide-react";
import type { ChatDTO, MessageDTO } from "@shared/types";
import { Avatar } from "./Avatar";
import { MessageBubble } from "./MessageBubble";
import { ComposeBar } from "./ComposeBar";
import {
  cn,
  formatThreadTimestamp,
  prettyHandle,
  shouldGroup,
} from "@/lib/utils";

interface ThreadViewProps {
  chat: ChatDTO | null;
  messages: MessageDTO[];
  loading: boolean;
  loadingOlder: boolean;
  hasMoreOlder: boolean;
  sendError: string | null;
  watcherError: string | null;
  onSend: (text: string, attachments?: string[]) => Promise<boolean>;
  onRetrySend: (optimisticId: string) => Promise<boolean>;
  onDismissFailedSend: (optimisticId: string) => void;
  onLoadOlder: () => Promise<number>;
  onPickAttachments: () => Promise<string[]>;
  onDismissWatcherError: () => void;
}

export function ThreadView({
  chat,
  messages,
  loading,
  loadingOlder,
  hasMoreOlder,
  sendError,
  watcherError,
  onSend,
  onRetrySend,
  onDismissFailedSend,
  onLoadOlder,
  onPickAttachments,
  onDismissWatcherError,
}: ThreadViewProps): JSX.Element {
  if (!chat) return <EmptyState />;

  return (
    <main className="flex h-full flex-1 flex-col bg-black">
      <ThreadHeader chat={chat} />
      {watcherError && (
        <div className="mx-4 mt-2 flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
          <span>
            Live updates paused: {watcherError}. Reconnecting automatically…
          </span>
          <button
            onClick={onDismissWatcherError}
            className="text-amber-200/80 hover:text-amber-100"
          >
            Dismiss
          </button>
        </div>
      )}
      <ThreadBody
        chat={chat}
        messages={messages}
        loading={loading}
        loadingOlder={loadingOlder}
        hasMoreOlder={hasMoreOlder}
        onLoadOlder={onLoadOlder}
        onRetry={onRetrySend}
        onDismiss={onDismissFailedSend}
      />
      {sendError && (
        <div className="mx-4 mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {sendError}
        </div>
      )}
      <ComposeBar
        chat={chat}
        onSend={onSend}
        onPickAttachments={onPickAttachments}
      />
    </main>
  );
}

function ThreadHeader({ chat }: { chat: ChatDTO }): JSX.Element {
  const displayName =
    chat.name || chat.contactDisplayName || prettyHandle(chat.identifier);
  return (
    <header className="titlebar-drag flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/[0.05] bg-black/60 px-5 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <Avatar
          name={chat.contactDisplayName || chat.name}
          identifier={chat.identifier}
          photoUrl={chat.contactPhotoUrl}
          size="sm"
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">
            {displayName}
          </div>
          {chat.kind === "group" && (
            <div className="text-[11px] text-zinc-500">Group conversation</div>
          )}
        </div>
      </div>
      <div className="no-drag flex items-center gap-1.5">
        <HeaderIconButton icon={Phone} title="Audio (coming soon)" />
        <HeaderIconButton icon={Video} title="FaceTime (coming soon)" />
        <HeaderIconButton icon={Info} title="Details (coming soon)" />
      </div>
    </header>
  );
}

function HeaderIconButton({
  icon: Icon,
  title,
}: {
  icon: typeof Phone;
  title: string;
}): JSX.Element {
  return (
    <button
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.07] hover:text-white"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

// Persisted across thread switches so jumping back to a chat lands
// where the user left off (matches Messages.app behavior).
const scrollMemory = new Map<string, number>();

function ThreadBody({
  chat,
  messages,
  loading,
  loadingOlder,
  hasMoreOlder,
  onLoadOlder,
  onRetry,
  onDismiss,
}: {
  chat: ChatDTO;
  messages: MessageDTO[];
  loading: boolean;
  loadingOlder: boolean;
  hasMoreOlder: boolean;
  onLoadOlder: () => Promise<number>;
  onRetry?: (optimisticId: string) => void;
  onDismiss?: (optimisticId: string) => void;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Save scroll position whenever the user scrolls. Also fires the
  // infinite-scroll-up loader when the user gets within 200px of the
  // top — captures scrollHeight before the load so we can adjust
  // scrollTop afterward and preserve the user's visual context.
  const loadingOlderRef = useRef(false);
  loadingOlderRef.current = loadingOlder;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf: number | null = null;
    const onScroll = (): void => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        scrollMemory.set(chat.chatId, el.scrollTop);
        raf = null;
      });
      // Pagination trigger: near the top, not already loading, more available.
      if (
        el.scrollTop < 200 &&
        !loadingOlderRef.current &&
        hasMoreOlder &&
        messages.length > 0
      ) {
        const heightBefore = el.scrollHeight;
        loadingOlderRef.current = true;
        void onLoadOlder().then((added) => {
          if (!added) return;
          // Run AFTER the prepended messages have laid out so we can
          // measure the new scrollHeight and offset the user back to
          // where they were reading.
          requestAnimationFrame(() => {
            if (!scrollRef.current) return;
            const delta = scrollRef.current.scrollHeight - heightBefore;
            scrollRef.current.scrollTop = el.scrollTop + delta;
          });
        });
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [chat.chatId, hasMoreOlder, messages.length, onLoadOlder]);

  // Scroll discipline:
  //   - First time we see a chat → land at the bottom (Messages.app default).
  //     We MUST do this after the messages have actually rendered, otherwise
  //     scrollHeight is still the empty-state height and "bottom" is the top.
  //   - Returning to a chat we've seen before → restore the user's last
  //     scroll position from scrollMemory.
  //   - Same chat, new message arrived, and the user was near the bottom →
  //     keep them pinned to the bottom.
  //   - Same chat, user is scrolled up reading history → don't yank them.
  const lastChatId = useRef<string | null>(null);
  const initialScrollDoneFor = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const chatChanged = lastChatId.current !== chat.chatId;
    if (chatChanged) {
      lastChatId.current = chat.chatId;
      initialScrollDoneFor.current = null; // reset; we'll set it when messages land
    }

    // Initial scroll for this chat: only fire once messages exist in the DOM.
    if (initialScrollDoneFor.current !== chat.chatId && messages.length > 0) {
      const remembered = scrollMemory.get(chat.chatId);
      // requestAnimationFrame ensures the browser has laid out the message
      // bubbles before we read scrollHeight — otherwise we'd anchor to the
      // empty-state height and land at the visible top.
      requestAnimationFrame(() => {
        if (!scrollRef.current) return;
        scrollRef.current.scrollTop =
          remembered ?? scrollRef.current.scrollHeight;
        initialScrollDoneFor.current = chat.chatId;
      });
      return;
    }

    // Same-chat new-message case: auto-stick if we were near the bottom.
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 200) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, chat.chatId]);

  // Build a render plan: insert date/time separators when gap > 1h, mark
  // first/last in each sender group for proper bubble tail rendering.
  const plan = useMemo(() => {
    type Item =
      | { kind: "separator"; key: string; label: string }
      | {
          kind: "message";
          key: string;
          message: MessageDTO;
          showSender: boolean;
          isLast: boolean;
        };
    const items: Item[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const prev = messages[i - 1];
      const next = messages[i + 1];
      // Time separator
      const hourGap =
        !prev ||
        new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() >
          60 * 60 * 1000;
      if (hourGap) {
        items.push({
          kind: "separator",
          key: `sep-${m.id}`,
          label: formatThreadTimestamp(m.createdAt),
        });
      }
      const showSender =
        !prev ||
        prev.isFromMe !== m.isFromMe ||
        prev.participant !== m.participant ||
        !shouldGroup(prev.createdAt, m.createdAt);
      const isLast =
        !next ||
        next.isFromMe !== m.isFromMe ||
        next.participant !== m.participant ||
        !shouldGroup(m.createdAt, next.createdAt);
      items.push({
        kind: "message",
        key: m.id,
        message: m,
        showSender,
        isLast,
      });
    }
    return items;
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto py-2"
      style={{ scrollBehavior: "smooth" }}
    >
      {loading && messages.length === 0 ? (
        <ThreadSkeleton />
      ) : messages.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <Avatar
              name={chat.contactDisplayName || chat.name}
              identifier={chat.identifier}
              photoUrl={chat.contactPhotoUrl}
              size="lg"
              className="mx-auto"
            />
            <div className="mt-4 text-sm font-medium text-zinc-300">
              {chat.name ||
                chat.contactDisplayName ||
                prettyHandle(chat.identifier)}
            </div>
            <div className="text-xs text-zinc-500">
              No messages yet — send the first one.
            </div>
          </div>
        </div>
      ) : (
        <div className={cn("flex flex-col gap-0.5 pb-3")}>
          {loadingOlder && (
            <div className="flex justify-center py-2 text-[11px] text-zinc-500">
              Loading older messages…
            </div>
          )}
          {!hasMoreOlder && messages.length > 0 && (
            <div className="flex justify-center py-2 text-[11px] text-zinc-600">
              Beginning of conversation
            </div>
          )}
          {plan.map((item) => {
            if (item.kind === "separator") {
              return (
                <div key={item.key} className="my-3 flex justify-center">
                  <div className="text-[11px] font-medium text-zinc-500">
                    {item.label}
                  </div>
                </div>
              );
            }
            return (
              <MessageBubble
                key={item.key}
                message={item.message}
                showSender={item.showSender}
                isLast={item.isLast}
                isGroupChat={chat.kind === "group"}
                onRetry={onRetry}
                onDismiss={onDismiss}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ThreadSkeleton(): JSX.Element {
  return (
    <div className="space-y-3 px-4 py-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={cn("flex", i % 2 === 0 ? "justify-start" : "justify-end")}
        >
          <div
            className={cn(
              "h-8 w-48 animate-pulse rounded-bubble",
              i % 2 === 0 ? "bg-zinc-800/60" : "bg-blue-900/40",
            )}
          />
        </div>
      ))}
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <main className="flex h-full flex-1 items-center justify-center bg-gradient-to-br from-black via-black to-blue-950/20">
      <div className="titlebar-drag absolute inset-x-0 top-0 h-14" />
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-imessage-blue to-blue-700 shadow-2xl shadow-blue-500/30">
          <svg
            className="h-10 w-10 text-white"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2C6.48 2 2 6.04 2 11c0 2.79 1.5 5.27 3.85 6.93L5 21l3.78-1.5C9.85 19.83 10.91 20 12 20c5.52 0 10-4.04 10-9S17.52 2 12 2z" />
          </svg>
        </div>
        <div className="text-sm font-medium text-zinc-400">
          Select a conversation
        </div>
        <div className="mt-1 text-xs text-zinc-600">
          Or start a new one from the sidebar.
        </div>
      </div>
    </main>
  );
}
