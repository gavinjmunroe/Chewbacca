// Wraps photon-hq/imessage-kit (v2.x). Translates SDK shapes to IPC-safe
// DTOs, owns the singleton SDK + watcher, and surfaces a clean async API
// to the rest of the main process.
//
// Why a wrapper exists:
// - SDK Message objects contain Date instances and readonly arrays; we
//   normalize them to JSON-safe DTOs at the boundary so the renderer has
//   one stable shape regardless of SDK changes.
// - v2 returns reactions as flag-marked Message rows; we fold those into
//   their target message so the renderer renders one bubble + reactions.

import {
  IMessageSDK,
  IMessageError,
  type Message,
  type Attachment,
} from "@photon-ai/imessage-kit";
import { app } from "electron";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AttachmentDTO,
  ChatDTO,
  ChatQueryParams,
  MessageDTO,
  MessageQueryParams,
  PermissionsState,
  ReactionDTO,
  SendPayload,
  WatcherEvent,
} from "../shared/types";
import { lookupContact } from "./contacts";
import {
  closeDb as closeExtrasDb,
  getChatPreviews,
  getHandlesForChat,
  getMessagesForChat,
  resolveMessageText,
  type MessageExtras,
  type ChatPreviewRow,
  type ThreadMessageRow,
  type AttachmentDbRow,
} from "./chat-db-extras";
import {
  probeAutomationPermission,
  type AutomationStatus,
} from "./automation-probe";

const DEFAULT_DB = join(homedir(), "Library", "Messages", "chat.db");

let sdkInstance: IMessageSDK | null = null;
let watcherActive = false;
const watcherListeners = new Set<(e: WatcherEvent) => void>();

// ---- helpers ----------------------------------------------------------

function dateToIso(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date && Number.isFinite(d.getTime())
    ? d.toISOString()
    : null;
}

function attachmentToDTO(a: Attachment): AttachmentDTO {
  const mime = a.mimeType ?? "";
  const isImage = a.isImage || /^image\//.test(mime);
  const isVideo = /^video\//.test(mime);
  const isAudio = /^audio\//.test(mime);
  let fileUrl: string | null = null;
  if (a.path && existsSync(a.path)) {
    try {
      fileUrl = pathToFileURL(a.path).href;
    } catch {
      fileUrl = null;
    }
  }
  return {
    id: a.id,
    fileName: a.filename ?? (a.path ? basename(a.path) : null),
    localPath: a.path ?? null,
    mimeType: mime,
    uti: null,
    sizeBytes: a.size,
    transferStatus: a.path && existsSync(a.path) ? "complete" : "pending",
    isFromMe: false, // v2 doesn't expose this on the attachment row
    isSticker: false,
    isSensitiveContent: false,
    altText: null,
    createdAt: dateToIso(a.createdAt) ?? new Date().toISOString(),
    isImage,
    isVideo,
    isAudio,
    fileUrl,
  };
}

// Note: reaction folding now lives inline in getMessages() (uses
// ReactionMap.from + ThreadMessageRow directly). The SDK-based
// reactionFromMessage helper was removed when we replaced the SDK
// thread reader with chat-db-extras' getMessagesForChat.

function messageToDTO(m: Message, extras?: MessageExtras): MessageDTO {
  // Resolve sender via Contacts (incoming msgs only — own msgs have no sender).
  const contact = !m.isFromMe ? lookupContact(m.sender) : null;
  return {
    rowId: -1, // v2 doesn't expose row id
    id: m.guid,
    text: m.text,
    participant: m.isFromMe ? null : m.sender,
    chatId: m.chatId,
    chatKind: m.isGroupChat ? "group" : "dm",
    service: (m.service as MessageDTO["service"]) ?? null,
    kind: m.text === null && m.attachments.length === 0 ? "unknown" : "text",
    isFromMe: m.isFromMe,
    isRead: m.isRead,
    isSent: true,
    isDelivered: extras ? extras.isDelivered : m.isFromMe, // optimistic if we don't know
    isAudioMessage: false,
    isPlayed: false,
    hasError: false,
    errorCode: 0,
    createdAt: dateToIso(m.date) ?? new Date().toISOString(),
    deliveredAt: extras ? dateToIso(extras.dateDelivered) : null,
    readAt: extras ? dateToIso(extras.dateRead) : null,
    editedAt: extras ? dateToIso(extras.dateEdited) : null,
    retractedAt: extras ? dateToIso(extras.dateRetracted) : null,
    replyToMessageId: extras?.replyToGuid ?? null,
    threadRootMessageId: extras?.threadRootGuid ?? null,
    affectedParticipant: null,
    newGroupName: null,
    sendEffect: null,
    appBundleId: null,
    reactions: [],
    attachments: m.attachments.map(attachmentToDTO),
    hasAttachments: m.attachments.length > 0,
    senderDisplayName: contact?.displayName ?? null,
    senderPhotoUrl: contact?.photoFileUrl ?? null,
  };
}

// ---- public API -------------------------------------------------------

export async function ensureSDK(): Promise<IMessageSDK> {
  if (sdkInstance) return sdkInstance;
  sdkInstance = new IMessageSDK({
    debug: !app.isPackaged,
    maxConcurrent: 5,
    scriptTimeout: 30_000,
  });
  return sdkInstance;
}

export async function destroySDK(): Promise<void> {
  if (!sdkInstance) return;
  if (watcherActive) await stopWatching();
  await sdkInstance.close();
  sdkInstance = null;
  closeExtrasDb();
}

export async function checkPermissions(): Promise<PermissionsState> {
  const dbPath = DEFAULT_DB;
  const result: PermissionsState = {
    canReadDatabase: false,
    canSendMessages: false,
    databasePath: dbPath,
  };
  if (!existsSync(dbPath)) {
    result.errorMessage = `chat.db not found at ${dbPath}. Are you on macOS?`;
    return result;
  }
  try {
    statSync(dbPath);
  } catch (err) {
    result.errorMessage = `Cannot stat chat.db: ${(err as Error).message}`;
    return result;
  }
  try {
    const sdk = await ensureSDK();
    await sdk.listChats({ limit: 1 });
    result.canReadDatabase = true;
  } catch (err) {
    if (err instanceof IMessageError && err.code === "DATABASE") {
      result.errorMessage =
        "Full Disk Access required. Open System Settings → Privacy & Security → Full Disk Access and enable Messages2.";
    } else {
      result.errorMessage = (err as Error).message;
    }
    return result;
  }
  result.canSendMessages = true;
  return result;
}

// Tiny last-4-digits formatter used when a group has unresolved handles
// — better than "+15550100003" cluttering a name pill.
function prettyHandleShort(handle: string): string {
  if (handle.includes("@")) return handle.split("@")[0];
  const digits = handle.replace(/[^\d]/g, "");
  return digits.length >= 4 ? `…${digits.slice(-4)}` : handle;
}

// Convert a single chat preview row from chat.db into the ChatDTO the
// renderer consumes. Contacts are looked up lazily — `getContacts()`
// returns a cached Map, so this is O(1) per row.
function previewToDTO(row: ChatPreviewRow): ChatDTO {
  // For DMs, chat_identifier is the bare phone/email. For groups it's
  // a chat-style GUID; we still surface it as the "identifier" so the
  // existing renderer logic stays consistent.
  const identifier = row.chatIdentifier;
  const contact = !row.isGroup ? lookupContact(identifier) : null;

  let preview: string | null = null;
  if (row.lastMessageText) {
    preview = row.lastMessageText;
  } else if (row.lastMessageHasAttachments) {
    preview = "📎 Attachment";
  }

  // For unnamed groups, derive a display name from the participants'
  // contact names instead of showing the raw "chat881273..." guid.
  // First N resolved names + "+M others" if the list is long.
  let derivedGroupName: string | null = null;
  if (row.isGroup && (!row.displayName || row.displayName.trim() === "")) {
    const handles = getHandlesForChat(row.chatId);
    const names = handles
      .map((h) => lookupContact(h)?.displayName ?? prettyHandleShort(h))
      .filter((n): n is string => !!n);
    if (names.length > 0) {
      const MAX = 3;
      if (names.length <= MAX) {
        derivedGroupName = names.join(", ");
      } else {
        derivedGroupName = `${names.slice(0, MAX).join(", ")} +${names.length - MAX}`;
      }
    }
  }

  return {
    chatId: row.chatId,
    name: row.displayName || derivedGroupName,
    identifier,
    kind: row.isGroup ? "group" : "dm",
    service: (row.serviceName as ChatDTO["service"]) ?? null,
    account: null,
    isArchived: false,
    isFiltered: false,
    unreadCount: row.unreadCount,
    lastMessageAt: row.lastMessageDate?.toISOString() ?? null,
    lastReadAt: null,
    lastMessagePreview: preview,
    lastMessageFromMe: row.lastMessageIsFromMe,
    isPinned: false, // overlaid by IPC handler
    contactDisplayName: contact?.displayName ?? null,
    contactPhotoUrl: contact?.photoFileUrl ?? null,
  };
}

export async function listChats(
  params: ChatQueryParams = {},
): Promise<ChatDTO[]> {
  // Single SQL query against chat.db: returns every chat + its most recent
  // message preview + unread count, ordered by recency. Replaces the old
  // N+1 SDK pattern that was making one round-trip per chat.
  let rows = getChatPreviews();

  // Apply optional renderer-side filters in-memory (cheap on the result
  // set; the SQL already drops archived chats).
  if (params.kind) {
    rows = rows.filter((r) => (r.isGroup ? "group" : "dm") === params.kind);
  }
  if (params.hasUnread) {
    rows = rows.filter((r) => r.unreadCount > 0);
  }
  if (params.search) {
    const q = params.search.toLowerCase();
    rows = rows.filter((r) =>
      [r.displayName, r.chatIdentifier, r.lastMessageText]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }
  if (params.limit && rows.length > params.limit) {
    rows = rows.slice(0, params.limit);
  }

  return rows.map(previewToDTO);
}

// Build a renderer DTO straight from a chat.db row + its attachments,
// bypassing the SDK's Message shape entirely. This is the path that
// actually loads thread history when the user clicks a chat.
function threadRowToDTO(
  row: ThreadMessageRow,
  attachments: AttachmentDbRow[],
): MessageDTO {
  const text = resolveMessageText(row);
  const contact = !row.isFromMe ? lookupContact(row.handle) : null;
  const reaction = ReactionMap.from(row.associatedMessageType);

  // Reactions are filtered out by the caller (we don't render them as
  // separate bubbles). They're folded into the message they target.
  // This helper still runs even for reactions because we need the row
  // shape; caller decides whether to drop or fold.
  void reaction;

  // Service detection: SMS / RCS / iMessage stored as a string in
  // message.service; default to iMessage when null (most rows).
  const svc: MessageDTO["service"] =
    row.service === "SMS" ? "SMS" : row.service === "RCS" ? "RCS" : "iMessage";

  return {
    rowId: row.rowId,
    id: row.guid,
    text,
    participant: row.isFromMe ? null : row.handle,
    chatId: row.chatGuid,
    chatKind: row.isGroup ? "group" : "dm",
    service: svc,
    kind: text === null && attachments.length === 0 ? "unknown" : "text",
    isFromMe: row.isFromMe,
    isRead: row.isRead,
    isSent: row.isSent,
    isDelivered: row.isDelivered,
    isAudioMessage: false,
    isPlayed: false,
    hasError: false,
    errorCode: 0,
    createdAt: row.date?.toISOString() ?? new Date().toISOString(),
    deliveredAt: row.dateDelivered?.toISOString() ?? null,
    readAt: row.dateRead?.toISOString() ?? null,
    editedAt: row.dateEdited?.toISOString() ?? null,
    retractedAt: row.dateRetracted?.toISOString() ?? null,
    replyToMessageId: row.threadOriginatorGuid,
    threadRootMessageId: row.threadOriginatorGuid,
    affectedParticipant: null,
    newGroupName: null,
    sendEffect: null,
    appBundleId: null,
    reactions: [],
    attachments: attachments.map((a) => attachmentDbRowToDTO(a, row.isFromMe)),
    hasAttachments: row.cacheHasAttachments,
    senderDisplayName: contact?.displayName ?? null,
    senderPhotoUrl: contact?.photoFileUrl ?? null,
  };
}

function attachmentDbRowToDTO(a: AttachmentDbRow, isFromMe: boolean) {
  const mime = a.mimeType ?? "";
  const isImage = /^image\//.test(mime);
  const isVideo = /^video\//.test(mime);
  const isAudio = /^audio\//.test(mime);
  let fileUrl: string | null = null;
  let resolvedPath = a.filename ?? null;
  if (resolvedPath?.startsWith("~/")) {
    resolvedPath = join(homedir(), resolvedPath.slice(1));
  }
  if (resolvedPath && existsSync(resolvedPath)) {
    try {
      fileUrl = pathToFileURL(resolvedPath).href;
    } catch {
      fileUrl = null;
    }
  }
  // Apple's transfer_state: 0 waiting, 1 accepted, 2 preparing, 3 transferring,
  // 4 finalizing, 5 finished. Map to our DTO's normalized states.
  const transferStatus: "complete" | "transferring" | "pending" | "failed" =
    a.transferState === 5 || (fileUrl && a.transferState === 0)
      ? "complete"
      : a.transferState >= 1 && a.transferState <= 4
        ? "transferring"
        : fileUrl
          ? "complete"
          : "pending";
  return {
    id: a.guid,
    fileName: a.filename ? basename(a.filename) : null,
    localPath: resolvedPath,
    mimeType: mime,
    uti: null,
    sizeBytes: a.totalBytes,
    transferStatus,
    isFromMe,
    isSticker: false,
    isSensitiveContent: false,
    altText: null,
    createdAt: new Date().toISOString(),
    isImage,
    isVideo,
    isAudio,
    fileUrl,
  };
}

// Reaction-kind map (same range as photon's SDK + our shared/types).
const ReactionMap = {
  from(assocType: number): {
    isReaction: boolean;
    kind: string;
    isRemoval: boolean;
  } {
    if (!assocType)
      return { isReaction: false, kind: "like", isRemoval: false };
    const isAdd = assocType >= 2000 && assocType <= 2005;
    const isRemove = assocType >= 3000 && assocType <= 3005;
    if (!isAdd && !isRemove)
      return { isReaction: false, kind: "like", isRemoval: false };
    const base = isAdd ? assocType - 2000 : assocType - 3000;
    const kinds = ["love", "like", "dislike", "laugh", "emphasize", "question"];
    return {
      isReaction: true,
      kind: kinds[base] ?? "like",
      isRemoval: isRemove,
    };
  },
};

export async function getMessages(
  params: MessageQueryParams,
): Promise<MessageDTO[]> {
  if (!params.chatId) return [];

  // Direct chat.db read — bypasses SDK's chat-id format matching which
  // broke for our `chat.guid`-formatted IDs. ~10x faster too. Passes
  // `before` through as a mac-timestamp cursor for pagination.
  const { messages: rows, attachmentsByMessageRow } = getMessagesForChat(
    params.chatId,
    params.limit ?? 300,
    params.before ?? null,
  );

  // Two-pass fold: separate reactions from primary messages, then attach.
  const reactionsByTarget = new Map<string, ReactionDTO[]>();
  const primary: MessageDTO[] = [];

  for (const row of rows) {
    const rinfo = ReactionMap.from(row.associatedMessageType);
    if (rinfo.isReaction && row.associatedMessageGuid) {
      const list = reactionsByTarget.get(row.associatedMessageGuid) ?? [];
      list.push({
        kind: rinfo.kind as ReactionDTO["kind"],
        targetMessageId: row.associatedMessageGuid,
        emoji: null,
        isRemoved: rinfo.isRemoval,
        isFromMe: row.isFromMe,
        participant: row.handle,
        createdAt: row.date?.toISOString() ?? new Date().toISOString(),
      });
      reactionsByTarget.set(row.associatedMessageGuid, list);
      continue;
    }
    const attachments = attachmentsByMessageRow.get(row.rowId) ?? [];
    primary.push(threadRowToDTO(row, attachments));
  }

  for (const dto of primary) {
    const folded = reactionsByTarget.get(dto.id);
    if (folded) {
      const latestPerKey = new Map<string, ReactionDTO>();
      for (const r of folded) {
        const key = `${r.participant ?? "me"}:${r.kind}`;
        const prev = latestPerKey.get(key);
        if (!prev || new Date(r.createdAt) > new Date(prev.createdAt)) {
          latestPerKey.set(key, r);
        }
      }
      dto.reactions = [...latestPerKey.values()].filter((r) => !r.isRemoved);
    }
  }

  // chat.db returns newest-first via our DESC order. Render oldest → newest.
  return primary.reverse();
}

export async function send(req: SendPayload): Promise<void> {
  const sdk = await ensureSDK();
  // v2 split attachments into images vs files; we bucket by extension.
  const images: string[] = [];
  const files: string[] = [];
  for (const path of req.attachments ?? []) {
    if (/\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/i.test(path)) {
      images.push(path);
    } else {
      files.push(path);
    }
  }
  const content =
    images.length || files.length
      ? {
          text: req.text,
          images: images.length ? images : undefined,
          files: files.length ? files : undefined,
        }
      : (req.text ?? "");
  await sdk.send(req.to, content);
}

// Auto-restart the watcher when it dies. The SDK's watcher can silently
// stop after a chat.db lock contention or a transient SQLite error; we
// surface those to the renderer via WatcherEvent('error') AND attempt
// reconnect with exponential backoff.
let reconnectDelayMs = 1000;
const MAX_RECONNECT_DELAY = 30_000;

export async function startWatching(): Promise<void> {
  if (watcherActive) return;
  const sdk = await ensureSDK();
  await sdk.startWatching({
    onMessage: (msg) => {
      const event: WatcherEvent = {
        type: msg.isFromMe ? "fromMe" : "incoming",
        message: messageToDTO(msg),
      };
      watcherListeners.forEach((l) => l(event));
    },
    onError: (err) => {
      const event: WatcherEvent = {
        type: "error",
        error: err instanceof Error ? err.message : String(err),
      };
      watcherListeners.forEach((l) => l(event));
      // Mark inactive and schedule a self-heal reconnect.
      watcherActive = false;
      setTimeout(() => {
        startWatching()
          .then(() => {
            reconnectDelayMs = 1000; // reset on success
          })
          .catch(() => {
            reconnectDelayMs = Math.min(
              reconnectDelayMs * 2,
              MAX_RECONNECT_DELAY,
            );
          });
      }, reconnectDelayMs);
    },
  });
  watcherActive = true;
  reconnectDelayMs = 1000;
}

export async function stopWatching(): Promise<void> {
  if (!watcherActive || !sdkInstance) return;
  sdkInstance.stopWatching();
  watcherActive = false;
}

export async function probeAutomation(): Promise<AutomationStatus> {
  return probeAutomationPermission();
}

export function onWatcherEvent(
  listener: (e: WatcherEvent) => void,
): () => void {
  watcherListeners.add(listener);
  return () => {
    watcherListeners.delete(listener);
  };
}
