// Disk cache for the sidebar's chat preview list. Reads on cold start
// give the renderer something to render in <100ms, while a fresh DB
// query runs in the background and pushes updated previews when ready.
//
// We deliberately cache ONLY the preview shape — the most recent text,
// timestamp, unread count per chat — never the full thread. Full thread
// load happens on demand when the user clicks a chat (see getMessages).

import { app } from "electron";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { ChatDTO } from "../shared/types";

function cachePath(): string {
  return join(app.getPath("userData"), "chat-previews.json");
}

interface CacheEnvelope {
  version: 1;
  savedAt: string;
  chats: ChatDTO[];
}

export function loadCachedPreviews(): ChatDTO[] | null {
  const path = cachePath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const env = JSON.parse(raw) as CacheEnvelope;
    if (env.version !== 1 || !Array.isArray(env.chats)) return null;
    return env.chats;
  } catch (err) {
    console.error("[chat-cache] read failed:", (err as Error).message);
    return null;
  }
}

// Atomic write: write to a sibling temp file, then rename. A crash mid-
// write leaves the previous cache intact instead of corrupting it.
export function saveCachedPreviews(chats: ChatDTO[]): void {
  const path = cachePath();
  const tmp = path + ".tmp";
  const env: CacheEnvelope = {
    version: 1,
    savedAt: new Date().toISOString(),
    chats,
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(env), "utf-8");
    renameSync(tmp, path);
  } catch (err) {
    console.error("[chat-cache] write failed:", (err as Error).message);
  }
}
