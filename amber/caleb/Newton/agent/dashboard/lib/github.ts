// All agent data lives in calebnewtonusc/claude-context
export const CONTEXT_REPO = "calebnewtonusc/claude-context";
export const CONTACTS_DIR = "amber-contacts";
export const CONVERSATIONS_DIR = "amber-conversations";
export const HEALTH_FILE = "health/caleb.json";

const BASE = "https://api.github.com";

function headers() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function ghGet(
  repo: string,
  path: string,
): Promise<{ content: string; sha: string } | null> {
  const res = await fetch(`${BASE}/repos/${repo}/contents/${path}`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json();
  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return { content, sha: data.sha };
}

export async function ghPut(
  repo: string,
  path: string,
  content: string,
  message: string,
  sha?: string,
): Promise<void> {
  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(content).toString("base64"),
  };
  if (sha) body.sha = sha;
  const res = await fetch(`${BASE}/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub PUT ${res.status}: ${err}`);
  }
}

export async function ghListDir(
  repo: string,
  path: string,
): Promise<Array<{ name: string; path: string; sha: string }>> {
  const res = await fetch(`${BASE}/repos/${repo}/contents/${path}`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// ── Contact helpers ────────────────────────────────────────────────────────

export function normalizeHandle(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

export function contactFilePath(handle: string): string {
  const safe = handle.replace(/[^a-zA-Z0-9+@._-]/g, "_");
  return `${CONTACTS_DIR}/${safe}.json`;
}

export function conversationFilePath(chatKey: string): string {
  const safe = chatKey.replace(/[^a-zA-Z0-9+@._-]/g, "_");
  return `${CONVERSATIONS_DIR}/${safe}.json`;
}

// ── Context file helpers ───────────────────────────────────────────────────

// Context files restructured April 2026
export const CONTEXT_FILES = [
  { label: "Caleb", path: ".claude/context/CALEB.md" },
  { label: "Now", path: ".claude/context/NOW.md" },
  { label: "People", path: ".claude/context/PEOPLE.md" },
  { label: "System", path: ".claude/context/SYSTEM.md" },
  { label: "Stack", path: ".claude/context/STACK.md" },
  {
    label: "Stories",
    path: ".claude/context/PERSONAL_STORIES_AND_EXPERIENCES.md",
  },
];
