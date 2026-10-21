// Shared types between main and renderer. Mirrors imessage-kit v3 shapes,
// kept JSON-serializable for IPC transit (Date -> ISO string).

export type Service = "iMessage" | "SMS" | "RCS" | null;
export type ChatKind = "dm" | "group" | "unknown";
export type MessageKind =
  | "text"
  | "memberAdded"
  | "memberRemoved"
  | "nameChanged"
  | "groupAction"
  | "unknown";
export type TransferStatus =
  | "pending"
  | "transferring"
  | "complete"
  | "failed"
  | "unknown";
export type ReactionKind =
  | "love"
  | "like"
  | "dislike"
  | "laugh"
  | "emphasize"
  | "question"
  | "emoji"
  | "sticker"
  | "pollVote";

export interface AttachmentDTO {
  id: string;
  fileName: string | null;
  localPath: string | null;
  mimeType: string;
  uti: string | null;
  sizeBytes: number;
  transferStatus: TransferStatus;
  isFromMe: boolean;
  isSticker: boolean;
  isSensitiveContent: boolean;
  altText: string | null;
  createdAt: string;
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
  fileUrl: string | null; // file:// URL for renderer <img>/<video> tags
}

export interface ReactionDTO {
  kind: ReactionKind;
  targetMessageId: string | null;
  emoji: string | null;
  isRemoved: boolean;
  // Folded in from the carrier message:
  isFromMe: boolean;
  participant: string | null;
  createdAt: string;
}

export interface MessageDTO {
  rowId: number;
  id: string;
  text: string | null;
  participant: string | null;
  chatId: string | null;
  chatKind: ChatKind;
  service: Service;
  kind: MessageKind;
  isFromMe: boolean;
  isRead: boolean;
  isSent: boolean;
  isDelivered: boolean;
  isAudioMessage: boolean;
  isPlayed: boolean;
  hasError: boolean;
  errorCode: number;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  editedAt: string | null;
  retractedAt: string | null;
  replyToMessageId: string | null;
  threadRootMessageId: string | null;
  affectedParticipant: string | null;
  newGroupName: string | null;
  sendEffect: string | null;
  appBundleId: string | null;
  reactions: ReactionDTO[];
  attachments: AttachmentDTO[];
  hasAttachments: boolean;
  // Contact-resolved sender info (populated by main process)
  senderDisplayName: string | null;
  senderPhotoUrl: string | null;
}

export interface ChatDTO {
  chatId: string;
  name: string | null;
  identifier: string | null; // best-guess phone/email for DMs
  kind: ChatKind;
  service: Service;
  account: string | null;
  isArchived: boolean;
  isFiltered: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  lastReadAt: string | null;
  lastMessagePreview: string | null;
  lastMessageFromMe: boolean;
  // Pinned state lives in app local storage, not chat.db
  isPinned: boolean;
  // Contact-resolved display info (populated by main process from AddressBook)
  contactDisplayName: string | null;
  contactPhotoUrl: string | null;
}

export interface SendPayload {
  to: string;
  text?: string;
  attachments?: string[];
}

export interface PermissionsState {
  canReadDatabase: boolean;
  canSendMessages: boolean;
  databasePath: string;
  errorMessage?: string;
}

export interface MessageQueryParams {
  chatId?: string;
  participant?: string;
  limit?: number;
  offset?: number;
  before?: string;
  since?: string;
  search?: string;
  excludeReactions?: boolean;
  isFromMe?: boolean;
  hasAttachments?: boolean;
}

export interface ChatQueryParams {
  search?: string;
  hasUnread?: boolean;
  kind?: "dm" | "group";
  isArchived?: boolean;
  sortBy?: "recent" | "name";
  limit?: number;
  offset?: number;
}

// Watcher events pushed from main → renderer over IPC
export type WatcherEvent =
  | { type: "incoming"; message: MessageDTO }
  | { type: "fromMe"; message: MessageDTO }
  | { type: "error"; error: string };

// IPC channel names — single source of truth for both sides
export const IPC = {
  permissions: "imsg:permissions",
  listChats: "imsg:listChats",
  getMessages: "imsg:getMessages",
  send: "imsg:send",
  startWatching: "imsg:startWatching",
  stopWatching: "imsg:stopWatching",
  togglePin: "imsg:togglePin",
  getPinnedIds: "imsg:getPinnedIds",
  pickAttachment: "imsg:pickAttachment",
  pickPhotos: "imsg:pickPhotos",
  pickFiles: "imsg:pickFiles",
  setBadge: "imsg:setBadge",
  probeAutomation: "imsg:probeAutomation",
  convertHeic: "imsg:convertHeic",
  convertAudio: "imsg:convertAudio",
  savePastedImage: "imsg:savePastedImage",
  // Renderer-bound event channels
  watcherEvent: "imsg:watcherEvent",
  chatsUpdated: "imsg:chatsUpdated",
} as const;

export type AutomationStatus =
  | "granted"
  | "denied"
  | "unknown"
  | "messages-not-running";
