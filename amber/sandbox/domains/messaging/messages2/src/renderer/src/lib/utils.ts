import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Friendly contact name from a phone number or email. We don't tap Contacts.app
// (that would need a separate native bridge); instead, we format phone numbers
// and trim emails so they render cleanly in the UI.
export function prettyHandle(handle: string | null | undefined): string {
  if (!handle) return "Unknown";
  // Email
  if (handle.includes("@")) return handle;
  // Phone
  const digits = handle.replace(/[^\d]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return handle;
}

// Two-letter avatar initials. "John Doe" → "JD", "+15551234567" → phone icon use case.
export function initials(
  name: string | null | undefined,
  fallback: string | null = null,
): string {
  const source = name || fallback || "";
  if (!source) return "?";
  if (source.includes("@")) return source[0].toUpperCase();
  const digits = source.replace(/[^\d]/g, "");
  if (digits.length >= 7) return "#";
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}

// Stable color hash for avatars. Same handle → same color across sessions.
export function avatarColor(seed: string): string {
  // Apple-ish saturated palette
  const palette = [
    "from-blue-500 to-blue-700",
    "from-purple-500 to-purple-700",
    "from-pink-500 to-pink-700",
    "from-orange-500 to-orange-700",
    "from-emerald-500 to-emerald-700",
    "from-cyan-500 to-cyan-700",
    "from-rose-500 to-rose-700",
    "from-indigo-500 to-indigo-700",
    "from-amber-500 to-amber-700",
    "from-teal-500 to-teal-700",
    "from-fuchsia-500 to-fuchsia-700",
    "from-violet-500 to-violet-700",
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return palette[Math.abs(h) % palette.length];
}

// Messages.app timestamp formatting.
//   today        → "9:42 AM"
//   yesterday    → "Yesterday"
//   this week    → "Wednesday"
//   this year    → "May 10"
//   older        → "5/10/24"
export function formatChatListTimestamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return "Yesterday";
  }
  const diffDays = Math.floor(
    (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 7) {
    return d.toLocaleDateString([], { weekday: "long" });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString([], {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  });
}

// Long-form timestamp shown above message groups in the thread view.
//   today              → "Today 9:42 AM"
//   yesterday          → "Yesterday 9:42 AM"
//   this year          → "Tuesday, May 10, 9:42 AM"
//   prior years        → "Tuesday, May 10, 2024, 9:42 AM"
export function formatThreadTimestamp(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return `Today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return `Yesterday ${time}`;
  }
  if (d.getFullYear() === now.getFullYear()) {
    return (
      d.toLocaleDateString([], {
        weekday: "long",
        month: "long",
        day: "numeric",
      }) + `, ${time}`
    );
  }
  return (
    d.toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }) + `, ${time}`
  );
}

// Decide if two consecutive messages should appear in the same bubble group:
// same sender AND within five minutes.
export function shouldGroup(prevIso: string, currIso: string): boolean {
  const prev = new Date(prevIso).getTime();
  const curr = new Date(currIso).getTime();
  if (!Number.isFinite(prev) || !Number.isFinite(curr)) return false;
  return Math.abs(curr - prev) < 5 * 60 * 1000;
}

export function bytesToHuman(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// Map reaction kind → glyph (matches Apple Tapback set).
export function reactionGlyph(kind: string, emoji: string | null): string {
  if (emoji) return emoji;
  switch (kind) {
    case "love":
      return "❤️";
    case "like":
      return "👍";
    case "dislike":
      return "👎";
    case "laugh":
      return "😂";
    case "emphasize":
      return "‼️";
    case "question":
      return "❓";
    case "sticker":
      return "🏷️";
    case "pollVote":
      return "📊";
    default:
      return "•";
  }
}
