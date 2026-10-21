// Exposes a strictly typed subset of main-process capabilities to the
// renderer through Electron's contextBridge. Nothing else from Node, fs,
// or imessage-kit is reachable from the renderer.

import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import {
  IPC,
  type AutomationStatus,
  type ChatDTO,
  type ChatQueryParams,
  type MessageDTO,
  type MessageQueryParams,
  type PermissionsState,
  type SendPayload,
  type WatcherEvent,
} from "../shared/types";
import type { IpcRendererEvent } from "electron";

const messagesAPI = {
  permissions: (): Promise<PermissionsState> =>
    ipcRenderer.invoke(IPC.permissions),
  listChats: (params?: ChatQueryParams): Promise<ChatDTO[]> =>
    ipcRenderer.invoke(IPC.listChats, params ?? {}),
  getMessages: (params: MessageQueryParams): Promise<MessageDTO[]> =>
    ipcRenderer.invoke(IPC.getMessages, params),
  send: (
    payload: SendPayload,
  ): Promise<
    | { ok: true }
    | { ok: false; error: string; automationStatus?: AutomationStatus }
  > => ipcRenderer.invoke(IPC.send, payload),
  probeAutomation: (): Promise<AutomationStatus> =>
    ipcRenderer.invoke(IPC.probeAutomation),
  convertHeic: (sourcePath: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.convertHeic, sourcePath),
  convertAudio: (sourcePath: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.convertAudio, sourcePath),
  savePastedImage: (bytes: ArrayBuffer, mimeType: string): Promise<string> =>
    ipcRenderer.invoke(IPC.savePastedImage, { bytes, mimeType }),
  startWatching: (): Promise<{ ok: true }> =>
    ipcRenderer.invoke(IPC.startWatching),
  stopWatching: (): Promise<{ ok: true }> =>
    ipcRenderer.invoke(IPC.stopWatching),
  togglePin: (chatId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.togglePin, chatId),
  getPinnedIds: (): Promise<string[]> => ipcRenderer.invoke(IPC.getPinnedIds),
  pickAttachment: (): Promise<{ paths: string[] }> =>
    ipcRenderer.invoke(IPC.pickAttachment),
  pickPhotos: (): Promise<{ paths: string[] }> =>
    ipcRenderer.invoke(IPC.pickPhotos),
  pickFiles: (): Promise<{ paths: string[] }> =>
    ipcRenderer.invoke(IPC.pickFiles),
  setBadge: (count: number): Promise<{ ok: true }> =>
    ipcRenderer.invoke(IPC.setBadge, count),
  onWatcherEvent: (cb: (event: WatcherEvent) => void): (() => void) => {
    const listener = (_: IpcRendererEvent, event: WatcherEvent): void =>
      cb(event);
    ipcRenderer.on(IPC.watcherEvent, listener);
    return () => ipcRenderer.removeListener(IPC.watcherEvent, listener);
  },
  // Pushed by main when a background chat-list refresh completes — used to
  // upgrade the renderer from cached previews to fresh ones without the
  // user noticing a re-fetch hop.
  onChatsUpdated: (cb: (chats: ChatDTO[]) => void): (() => void) => {
    const listener = (_: IpcRendererEvent, chats: ChatDTO[]): void => cb(chats);
    ipcRenderer.on(IPC.chatsUpdated, listener);
    return () => ipcRenderer.removeListener(IPC.chatsUpdated, listener);
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("messages", messagesAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  (window as unknown as { electron: typeof electronAPI }).electron =
    electronAPI;
  (window as unknown as { messages: typeof messagesAPI }).messages =
    messagesAPI;
}

export type MessagesAPI = typeof messagesAPI;
