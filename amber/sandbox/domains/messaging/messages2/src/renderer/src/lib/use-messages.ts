// Central app state for Messages2. Owns the chat list, the currently
// open thread, search, and the live watcher subscription. Components
// read what they need; mutations all flow through here so we can keep
// optimistic updates honest when the watcher echoes them back.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatDTO,
  MessageDTO,
  PermissionsState,
  SendPayload,
  WatcherEvent,
} from "@shared/types";

interface FailedSend {
  optimisticId: string;
  text: string;
  attachments?: string[];
}

interface State {
  permissions: PermissionsState | null;
  permissionsChecked: boolean;
  chats: ChatDTO[];
  chatsLoading: boolean;
  selectedChatId: string | null;
  messages: MessageDTO[];
  messagesLoading: boolean;
  loadingOlder: boolean; // pagination: fetching older messages right now
  hasMoreOlder: boolean; // pagination: false once we've hit the start of history
  search: string;
  sendError: string | null;
  watcherError: string | null; // surfaced as a thin top banner
  failedSends: Record<string, FailedSend>; // keyed by optimistic id
}

const initial: State = {
  permissions: null,
  permissionsChecked: false,
  chats: [],
  chatsLoading: true,
  selectedChatId: null,
  messages: [],
  messagesLoading: false,
  loadingOlder: false,
  hasMoreOlder: true,
  search: "",
  sendError: null,
  watcherError: null,
  failedSends: {},
};

export function useMessagesApp(): {
  state: State;
  selectChat: (chatId: string | null) => void;
  setSearch: (q: string) => void;
  refreshChats: () => Promise<void>;
  refreshMessages: () => Promise<void>;
  loadOlderMessages: () => Promise<number>;
  send: (text: string, attachments?: string[]) => Promise<boolean>;
  retrySend: (optimisticId: string) => Promise<boolean>;
  dismissFailedSend: (optimisticId: string) => void;
  togglePin: (chatId: string) => Promise<void>;
  retryPermissions: () => Promise<void>;
  pickAttachments: () => Promise<string[]>;
  dismissWatcherError: () => void;
  selectedChat: ChatDTO | null;
} {
  const [state, setState] = useState<State>(initial);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Permissions on mount.
  const checkPerms = useCallback(async () => {
    const perms = await window.messages.permissions();
    setState((s) => ({ ...s, permissions: perms, permissionsChecked: true }));
    if (perms.canReadDatabase) {
      await loadChats();
      await window.messages.startWatching().catch(() => undefined);
    }
  }, []);

  const loadChats = useCallback(async () => {
    setState((s) => ({ ...s, chatsLoading: true }));
    const chats = await window.messages.listChats({ limit: 200 });
    setState((s) => ({ ...s, chats, chatsLoading: false }));
  }, []);

  const INITIAL_PAGE = 100;
  const PAGE_SIZE = 100;

  const loadMessages = useCallback(async (chatId: string) => {
    setState((s) => ({ ...s, messagesLoading: true, hasMoreOlder: true }));
    const messages = await window.messages.getMessages({
      chatId,
      limit: INITIAL_PAGE,
    });
    setState((s) =>
      s.selectedChatId === chatId
        ? {
            ...s,
            messages,
            messagesLoading: false,
            // If we got fewer than we asked for, there's nothing older.
            hasMoreOlder: messages.length >= INITIAL_PAGE,
          }
        : s,
    );
  }, []);

  // Pagination: when ThreadBody detects the user scrolled near the top,
  // it calls this to fetch the next page of older messages and prepend
  // them. Uses the oldest currently-loaded message's timestamp as a
  // `before:` cursor. Returns the count loaded so the caller can adjust
  // scroll position to preserve the user's visual context.
  const loadOlderMessages = useCallback(async (): Promise<number> => {
    const cur = stateRef.current;
    if (!cur.selectedChatId) return 0;
    if (cur.loadingOlder || !cur.hasMoreOlder) return 0;
    const oldest = cur.messages[0];
    if (!oldest) return 0;
    setState((s) => ({ ...s, loadingOlder: true }));
    const older = await window.messages.getMessages({
      chatId: cur.selectedChatId,
      limit: PAGE_SIZE,
      before: oldest.createdAt,
    });
    let added = 0;
    setState((s) => {
      if (s.selectedChatId !== cur.selectedChatId) {
        return { ...s, loadingOlder: false };
      }
      // De-dup any rows that overlap with what we already have.
      const existing = new Set(s.messages.map((m) => m.id));
      const dedup = older.filter((m) => !existing.has(m.id));
      added = dedup.length;
      return {
        ...s,
        messages: [...dedup, ...s.messages],
        loadingOlder: false,
        hasMoreOlder: dedup.length >= PAGE_SIZE,
      };
    });
    return added;
  }, []);

  // Permissions check + initial load on mount
  useEffect(() => {
    checkPerms().catch((err) => {
      setState((s) => ({
        ...s,
        permissions: {
          canReadDatabase: false,
          canSendMessages: false,
          databasePath: "",
          errorMessage: (err as Error).message,
        },
        permissionsChecked: true,
      }));
    });
    return () => {
      window.messages.stopWatching().catch(() => undefined);
    };
  }, [checkPerms]);

  // Watcher event handler. Folds incoming + from-me messages into the
  // currently open thread and refreshes the chat list preview line.
  useEffect(() => {
    const off = window.messages.onWatcherEvent((event: WatcherEvent) => {
      if (event.type === "error") {
        console.warn("[watcher]", event.error);
        setState((s) => ({ ...s, watcherError: event.error }));
        return;
      }
      // Any successful watcher event means the connection healed itself.
      if (stateRef.current.watcherError) {
        setState((s) => ({ ...s, watcherError: null }));
      }
      const msg = event.message;
      const cur = stateRef.current;

      // If the message belongs to the open thread, append (or replace dup).
      if (msg.chatId && msg.chatId === cur.selectedChatId) {
        setState((s) => {
          // Real-row dedup by GUID.
          const guidMatch = s.messages.some((m) => m.id === msg.id);
          if (guidMatch) {
            return {
              ...s,
              messages: s.messages.map((m) => (m.id === msg.id ? msg : m)),
            };
          }
          // Optimistic-row replacement: a from-me message whose text matches
          // a pending optimistic in this chat should REPLACE that optimistic,
          // not append a duplicate. Otherwise the user sees two bubbles —
          // the stuck "Sending…" placeholder and the real one beside it.
          if (msg.isFromMe) {
            const optimisticIdx = s.messages.findIndex(
              (m) =>
                m.id.startsWith("optimistic-") &&
                (m.text ?? "") === (msg.text ?? "") &&
                m.chatId === msg.chatId,
            );
            if (optimisticIdx !== -1) {
              const next = [...s.messages];
              next[optimisticIdx] = msg;
              return { ...s, messages: next };
            }
          }
          return { ...s, messages: [...s.messages, msg] };
        });
      }

      // Always update the chat list preview. We update inline rather than
      // refetching, since refetching every keystroke would be expensive on
      // big DBs. A lightweight refresh debouncer below covers drift.
      setState((s) => {
        const idx = s.chats.findIndex((c) => c.chatId === msg.chatId);
        if (idx === -1) return s;
        const target = s.chats[idx];
        const updated: ChatDTO = {
          ...target,
          lastMessageAt: msg.createdAt,
          lastMessagePreview:
            msg.text ?? msg.attachments[0]?.fileName ?? "📎 Attachment",
          lastMessageFromMe: msg.isFromMe,
          unreadCount:
            !msg.isFromMe && msg.chatId !== cur.selectedChatId
              ? target.unreadCount + 1
              : target.unreadCount,
        };
        const next = [...s.chats];
        next.splice(idx, 1);
        // Pinned items stay above non-pinned; resort just our two buckets.
        const pinned = next.filter((c) => c.isPinned);
        const others = next.filter((c) => !c.isPinned);
        if (updated.isPinned) pinned.unshift(updated);
        else others.unshift(updated);
        return { ...s, chats: [...pinned, ...others] };
      });
    });
    return off;
  }, []);

  // Cache-then-fresh upgrade. When the IPC handler serves a cached chat
  // list on cold start, it kicks off a background DB refresh and pushes
  // the fresh list via this event when ready. We merge it without
  // resetting selection or scroll position.
  useEffect(() => {
    const off = window.messages.onChatsUpdated((chats) => {
      setState((s) => ({ ...s, chats, chatsLoading: false }));
    });
    return off;
  }, []);

  // Lightweight periodic chat-list refresh. The watcher gives us per-message
  // updates, but unread counts can drift when the user reads messages
  // elsewhere; resync every 30s. The query is now cheap (one SQL roundtrip).
  useEffect(() => {
    const t = setInterval(() => {
      if (stateRef.current.permissions?.canReadDatabase) {
        loadChats().catch(() => undefined);
      }
    }, 30_000);
    return () => clearInterval(t);
  }, [loadChats]);

  // Window focus → mark the currently open chat as read (locally). Matches
  // how Messages.app drops the unread indicator when you tab back to it.
  useEffect(() => {
    function onFocus(): void {
      const cur = stateRef.current;
      if (!cur.selectedChatId) return;
      setState((s) => ({
        ...s,
        chats: s.chats.map((c) =>
          c.chatId === cur.selectedChatId ? { ...c, unreadCount: 0 } : c,
        ),
      }));
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Update Dock badge with total unread (from real Messages.app behavior).
  useEffect(() => {
    const total = state.chats.reduce((acc, c) => acc + c.unreadCount, 0);
    window.messages.setBadge(total).catch(() => undefined);
  }, [state.chats]);

  // Public actions

  const selectChat = useCallback(
    (chatId: string | null) => {
      setState((s) => ({
        ...s,
        selectedChatId: chatId,
        messages: chatId === s.selectedChatId ? s.messages : [],
        // Mark as read locally — the SDK doesn't provide a write path for
        // the unread flag, but our local count drives the badge correctly.
        chats: s.chats.map((c) =>
          c.chatId === chatId ? { ...c, unreadCount: 0 } : c,
        ),
      }));
      if (chatId) loadMessages(chatId).catch(() => undefined);
    },
    [loadMessages],
  );

  const setSearch = useCallback((q: string) => {
    setState((s) => ({ ...s, search: q }));
  }, []);

  const send = useCallback(
    async (text: string, attachments?: string[]): Promise<boolean> => {
      const cur = stateRef.current;
      if (!cur.selectedChatId) return false;
      const target = cur.chats.find((c) => c.chatId === cur.selectedChatId);
      if (!target) return false;

      // Optimistic message — replaced when the watcher echoes the real row.
      const optimistic: MessageDTO = {
        rowId: -1,
        id: `optimistic-${Date.now()}`,
        text: text || null,
        participant: null,
        chatId: target.chatId,
        chatKind: target.kind,
        service: target.service,
        kind: "text",
        isFromMe: true,
        isRead: false,
        isSent: false,
        isDelivered: false,
        isAudioMessage: false,
        isPlayed: false,
        hasError: false,
        errorCode: 0,
        createdAt: new Date().toISOString(),
        deliveredAt: null,
        readAt: null,
        editedAt: null,
        retractedAt: null,
        replyToMessageId: null,
        threadRootMessageId: null,
        affectedParticipant: null,
        newGroupName: null,
        sendEffect: null,
        appBundleId: null,
        reactions: [],
        attachments: [],
        hasAttachments: !!attachments?.length,
        senderDisplayName: null,
        senderPhotoUrl: null,
      };
      setState((s) => ({
        ...s,
        messages: [...s.messages, optimistic],
        sendError: null,
      }));

      // Group chats need the group chatId, DMs route by handle (more reliable).
      const to =
        target.kind === "group"
          ? target.chatId
          : (target.identifier ?? target.chatId);

      const payload: SendPayload = { to, text: text || undefined, attachments };
      const result = await window.messages.send(payload);
      if (!result.ok) {
        setState((s) => ({
          ...s,
          sendError: result.error,
          messages: s.messages.map((m) =>
            m.id === optimistic.id ? { ...m, hasError: true } : m,
          ),
          failedSends: {
            ...s.failedSends,
            [optimistic.id]: {
              optimisticId: optimistic.id,
              text,
              attachments,
            },
          },
        }));
        return false;
      }
      // Success: flip the optimistic from "Sending…" to "Sent" immediately.
      // The watcher will replace it with the real chat.db row within ~1s
      // (see onWatcherEvent handler below) and that's when the status
      // upgrades to "Delivered" → "Read".
      setState((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === optimistic.id ? { ...m, isSent: true } : m,
        ),
      }));
      return true;
    },
    [],
  );

  const retrySend = useCallback(
    async (optimisticId: string): Promise<boolean> => {
      const cur = stateRef.current;
      const failed = cur.failedSends[optimisticId];
      if (!failed) return false;
      // Clear failed state, then re-issue. The user will see the bubble
      // flip back to "Sending…" while the AppleScript runs.
      setState((s) => {
        const next = { ...s.failedSends };
        delete next[optimisticId];
        return {
          ...s,
          failedSends: next,
          sendError: null,
          messages: s.messages.map((m) =>
            m.id === optimisticId ? { ...m, hasError: false } : m,
          ),
        };
      });
      return send(failed.text, failed.attachments);
    },
    [send],
  );

  const dismissFailedSend = useCallback((optimisticId: string) => {
    setState((s) => {
      const next = { ...s.failedSends };
      delete next[optimisticId];
      return {
        ...s,
        failedSends: next,
        messages: s.messages.filter((m) => m.id !== optimisticId),
      };
    });
  }, []);

  const dismissWatcherError = useCallback(() => {
    setState((s) => ({ ...s, watcherError: null }));
  }, []);

  const togglePin = useCallback(async (chatId: string) => {
    const newPinned = await window.messages.togglePin(chatId);
    setState((s) => {
      const updated = s.chats.map((c) =>
        c.chatId === chatId ? { ...c, isPinned: newPinned } : c,
      );
      // Resort: pinned first, then by recent
      updated.sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        const at = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
        const bt = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
        return bt - at;
      });
      return { ...s, chats: updated };
    });
  }, []);

  const retryPermissions = useCallback(async () => {
    setState((s) => ({ ...s, permissionsChecked: false }));
    await checkPerms();
  }, [checkPerms]);

  const pickAttachments = useCallback(async (): Promise<string[]> => {
    const result = await window.messages.pickAttachment();
    return result.paths;
  }, []);

  const refreshChats = loadChats;
  const refreshMessages = useCallback(async () => {
    if (state.selectedChatId) await loadMessages(state.selectedChatId);
  }, [loadMessages, state.selectedChatId]);

  const selectedChat = useMemo(
    () => state.chats.find((c) => c.chatId === state.selectedChatId) ?? null,
    [state.chats, state.selectedChatId],
  );

  return {
    state,
    selectChat,
    setSearch,
    refreshChats,
    refreshMessages,
    loadOlderMessages,
    send,
    retrySend,
    dismissFailedSend,
    togglePin,
    retryPermissions,
    pickAttachments,
    dismissWatcherError,
    selectedChat,
  };
}
