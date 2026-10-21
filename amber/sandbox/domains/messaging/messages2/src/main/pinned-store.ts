// Apple's Messages.app stores pinned-chat state in NSUbiquitousKeyValueStore,
// not in chat.db, so we can't read it via imessage-kit. We persist pinned
// chatIds in a small JSON file under userData. Cheap, durable, no schema.

import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const FILE = () => join(app.getPath("userData"), "pinned-chats.json");

let cache: Set<string> | null = null;

function load(): Set<string> {
  if (cache) return cache;
  const path = FILE();
  if (!existsSync(path)) {
    cache = new Set();
    return cache;
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const arr = JSON.parse(raw) as string[];
    cache = new Set(Array.isArray(arr) ? arr : []);
  } catch {
    cache = new Set();
  }
  return cache;
}

function persist(): void {
  if (!cache) return;
  const path = FILE();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify([...cache], null, 2), "utf-8");
}

export function getPinned(): string[] {
  return [...load()];
}

export function isPinned(chatId: string): boolean {
  return load().has(chatId);
}

export function togglePin(chatId: string): boolean {
  const set = load();
  if (set.has(chatId)) {
    set.delete(chatId);
  } else {
    set.add(chatId);
  }
  persist();
  return set.has(chatId);
}
