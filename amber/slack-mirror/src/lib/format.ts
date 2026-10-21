import type { SlackMessage } from "@/lib/slack";

// Plain-text serialization used by the copy buttons. Kept framework-free so it
// can run on the client without pulling in the server Slack module.

function fileLines(msg: SlackMessage): string {
  if (!msg.files.length) return "";
  const lines = msg.files.map((f) => `  [file] ${f.name}`);
  return "\n" + lines.join("\n");
}

export function messageToText(msg: SlackMessage): string {
  return `${msg.userName} (${msg.tsLabel}):\n${msg.text}${fileLines(msg)}`;
}

// A parent message plus its thread replies, replies indented under it.
export function threadToText(msg: SlackMessage): string {
  let out = messageToText(msg);
  if (msg.replies.length) {
    out += "\n";
    for (const r of msg.replies) {
      const block = messageToText(r)
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n");
      out += `\n${block}`;
    }
  }
  return out;
}

export function feedToText(messages: SlackMessage[]): string {
  return messages.map(threadToText).join("\n\n" + "-".repeat(40) + "\n\n");
}

// Deterministic accent color per author for avatar bubbles.
const AVATAR_COLORS = [
  "bg-indigo-500/20 text-indigo-300",
  "bg-emerald-500/20 text-emerald-300",
  "bg-rose-500/20 text-rose-300",
  "bg-amber-500/20 text-amber-300",
  "bg-sky-500/20 text-sky-300",
  "bg-violet-500/20 text-violet-300",
  "bg-teal-500/20 text-teal-300",
];

export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
