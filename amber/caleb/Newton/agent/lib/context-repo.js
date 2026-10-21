/**
 * Context-repo wiki client.
 *
 * Each tenant has a personal GitHub repo that functions as an LLM-maintained
 * wiki (Karpathy LLM-Wiki pattern). This module is the programmatic interface
 * amber-agent uses to:
 *
 *   1. Drop new raw sources into `raw/<kind>/…`
 *   2. Read + update wiki pages under `wiki/…`
 *   3. Append entries to `log.md` (timeline of wiki evolution)
 *   4. Discover pages via `index.md`
 *
 * Everything is committed via the per-tenant GITHUB_PAT pulled from the
 * amber-id secrets store. There is no shared write key: if a tenant has not
 * populated their GITHUB_PAT secret, their wiki is effectively read-only.
 *
 * Tenants declare their repo via `tenant.contextRepo` (e.g.
 * "calebnewtonusc/caleb-context"). Resolution rules:
 *
 *   - If `tenant.contextRepo` is set, use it.
 *   - Else, fall back to process.env.AMBER_DEFAULT_CONTEXT_REPO (dev only).
 *   - Else, return { success:false, error:"no-context-repo" } and the caller
 *     is expected to degrade gracefully (skip writes, don't crash).
 *
 * All write ops go through GitHub Contents API (PUT /repos/:owner/:repo/
 * contents/:path), which handles file-create and file-update symmetrically
 * as long as we pass the current SHA on updates.
 */

import { getSecret } from "./secrets.js";

const GH_API = "https://api.github.com";
const DEFAULT_BRANCH = "main";

// ---------- low-level helpers ----------

function tenantRepoOf(tenant) {
  if (!tenant) return null;
  return (
    tenant.contextRepo ||
    tenant.context_repo ||
    process.env.AMBER_DEFAULT_CONTEXT_REPO ||
    null
  );
}

async function authHeaders(tenant) {
  const token = await getSecret(tenant, "GITHUB_PAT", {
    fallbackEnv: "GITHUB_TOKEN",
  });
  if (!token) {
    return null;
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function encodePath(p) {
  return p
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * Reject paths that try to escape the repo root. The GitHub Contents
 * API itself collapses `..` segments server-side, but the agent
 * receives many paths from LLM tool output, so a traversal attempt
 * indicates a confused (or coerced) caller and we want to fail loud
 * rather than quietly read a file the user didn't mean to ask for.
 *
 * Rules:
 *   - Disallow absolute paths (leading "/" or Windows-style "C:\")
 *   - Disallow ".." segments anywhere in the path
 *   - Disallow URL schemes ("http://", "file://") embedded in the path
 *   - Disallow embedded NUL or control bytes
 *   - Disallow leading "./" — should be expressed without it
 *   - Disallow `.git/` access — those bytes are config, not content
 */
export function safeRepoPath(p) {
  if (typeof p !== "string" || p.length === 0) {
    return { ok: false, reason: "empty-path" };
  }
  if (p.length > 512) return { ok: false, reason: "path-too-long" };
  if (/[\x00-\x1f]/.test(p)) return { ok: false, reason: "control-char" };
  if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)) {
    return { ok: false, reason: "absolute-path" };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) {
    return { ok: false, reason: "url-scheme" };
  }
  const segments = p.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      return { ok: false, reason: "traversal-segment" };
    }
    if (seg === ".git") return { ok: false, reason: "git-internals" };
  }
  return { ok: true };
}

/**
 * Read a file from the tenant's context repo.
 * Returns { success, content, sha, path } or { success:false, error, status }.
 * If the file does not exist (404), returns { success:false, status:404 }.
 */
export async function readWikiFile(tenant, path, ref = DEFAULT_BRANCH) {
  const repo = tenantRepoOf(tenant);
  if (!repo) return { success: false, error: "no-context-repo" };
  const safe = safeRepoPath(path);
  if (!safe.ok) return { success: false, error: `unsafe-path:${safe.reason}` };
  const headers = await authHeaders(tenant);
  if (!headers) return { success: false, error: "no-github-pat" };

  const url = `${GH_API}/repos/${repo}/contents/${encodePath(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (res.status === 404) return { success: false, status: 404 };
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { success: false, status: res.status, error: body.slice(0, 300) };
    }
    const data = await res.json();
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    return { success: true, content, sha: data.sha, path: data.path };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Write (create-or-update) a file in the tenant's context repo.
 * If sha is null, attempts to resolve it by reading the existing file first —
 * which is what you want in almost every case so that concurrent writes
 * don't clobber each other.
 *
 * opts.skipShaLookup = true skips the extra GET when you know the file does
 *   not yet exist (first-time scaffolding).
 */
export async function writeWikiFile(
  tenant,
  path,
  content,
  message,
  { sha = null, skipShaLookup = false, branch = DEFAULT_BRANCH } = {},
) {
  const repo = tenantRepoOf(tenant);
  if (!repo) return { success: false, error: "no-context-repo" };
  const safe = safeRepoPath(path);
  if (!safe.ok) return { success: false, error: `unsafe-path:${safe.reason}` };
  const headers = await authHeaders(tenant);
  if (!headers) return { success: false, error: "no-github-pat" };

  // Look up the current SHA unless caller told us to skip it.
  let resolvedSha = sha;
  if (!resolvedSha && !skipShaLookup) {
    const existing = await readWikiFile(tenant, path, branch);
    if (existing.success) resolvedSha = existing.sha;
    // 404 is expected for new files; other errors don't block us either — we
    // just try to create, and GitHub will 422 if we're wrong about the SHA.
  }

  const body = {
    message: message || `update ${path}`,
    content: Buffer.from(content, "utf-8").toString("base64"),
    branch,
  };
  if (resolvedSha) body.sha = resolvedSha;

  const url = `${GH_API}/repos/${repo}/contents/${encodePath(path)}`;
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return {
        success: false,
        status: res.status,
        error: errBody.slice(0, 500),
      };
    }
    const data = await res.json();
    return {
      success: true,
      sha: data.content?.sha,
      commitSha: data.commit?.sha,
      path: data.content?.path,
      url: data.content?.html_url,
      commitUrl: data.commit?.html_url,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Append a chunk of markdown to an existing file, creating it if missing.
 * Primarily used for `log.md` so new entries don't overwrite the history.
 */
export async function appendWikiFile(tenant, path, chunk, message) {
  const existing = await readWikiFile(tenant, path);
  let newContent;
  let sha = null;
  if (existing.success) {
    const needsSep = !existing.content.endsWith("\n");
    newContent = existing.content + (needsSep ? "\n\n" : "\n") + chunk;
    sha = existing.sha;
  } else {
    newContent = chunk;
  }
  return writeWikiFile(tenant, path, newContent, message, {
    sha,
    skipShaLookup: true,
  });
}

// ---------- high-level operations ----------

/**
 * Drop a new source into the raw/ tree. Returns the committed path so the
 * caller can reference it in log.md + any wiki pages that synthesize it.
 *
 * kind  - "conversations" | "checkins" | "articles" | "ingest"
 * slug  - short filename stem; auto-dated if it doesn't already start YYYY-MM-DD
 * body  - the raw markdown content of the source
 */
export async function ingestSource(
  tenant,
  { kind, slug, body, frontmatter = null, commitMessage = null },
) {
  if (!kind || !slug || !body) {
    return { success: false, error: "kind, slug, and body are required" };
  }
  const dateStr = new Date().toISOString().slice(0, 10);
  const stem = /^\d{4}-\d{2}-\d{2}/.test(slug) ? slug : `${dateStr}-${slug}`;
  const safeStem = stem.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
  const path = `raw/${kind}/${safeStem}.md`;

  let content = "";
  if (frontmatter && typeof frontmatter === "object") {
    content += "---\n";
    for (const [k, v] of Object.entries(frontmatter)) {
      content += `${k}: ${typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v)}\n`;
    }
    content += "---\n\n";
  }
  content += body.endsWith("\n") ? body : body + "\n";

  const msg = commitMessage || `ingest(${kind}): ${safeStem}`;
  const result = await writeWikiFile(tenant, path, content, msg, {
    skipShaLookup: true,
  });
  if (result.success) {
    // Fire-and-forget log entry. Failure here shouldn't fail the ingest.
    const logLine = `## [${dateStr}] ingest | ${kind}/${safeStem}\n\nFiled to \`${path}\`.\n`;
    await appendWikiFile(
      tenant,
      "log.md",
      logLine,
      `log: ingest ${kind}/${safeStem}`,
    ).catch((e) => console.warn("[context-repo] log append failed:", e.message));
  }
  return { ...result, rawPath: path };
}

/**
 * Update (or create) a wiki page. If the page exists and mergeStrategy is
 * "replace", the content is overwritten. If "append", the new chunk is
 * appended below a horizontal rule + timestamp. Default is "replace" because
 * most page updates are full rewrites of the rolling synthesis.
 */
export async function updateWikiPage(
  tenant,
  {
    page,                    // e.g. "wiki/dimensions/emotional.md"
    content,                 // full page content (if replace) or chunk (if append)
    commitMessage = null,
    mergeStrategy = "replace",
    dimension = null,        // optional; improves the commit prefix
  },
) {
  if (!page || !content) {
    return { success: false, error: "page and content are required" };
  }
  const dimPrefix = dimension ? `(${dimension})` : "";
  const msg =
    commitMessage ||
    (mergeStrategy === "append"
      ? `append${dimPrefix}: ${page}`
      : `update${dimPrefix}: ${page}`);

  if (mergeStrategy === "append") {
    const stamp = new Date().toISOString();
    const chunk = `\n\n---\n\n_Updated ${stamp}_\n\n${content}`;
    return appendWikiFile(tenant, page, chunk, msg);
  }

  // Replace: preserves the existing sha so we don't 409 each other.
  return writeWikiFile(tenant, page, content, msg);
}

/**
 * Log a query + its answer so explorations compound instead of vanishing
 * into chat history. If answerPath is supplied (e.g. the caller already
 * filed a reflections page), it's linked from the log entry.
 */
export async function logQuery(
  tenant,
  { question, answerPath = null, summary = "" },
) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const header = `## [${dateStr}] query | ${question.slice(0, 100)}`;
  const body =
    (summary ? `${summary}\n\n` : "") +
    (answerPath ? `Filed to [\`${answerPath}\`](${answerPath}).\n` : "");
  return appendWikiFile(
    tenant,
    "log.md",
    `${header}\n\n${body}`,
    `log: query ${question.slice(0, 60)}`,
  );
}

// ---------- util: scaffold a brand-new repo ----------

/**
 * Check whether the tenant's context repo has the core wiki scaffolding.
 * Returns { scaffolded: bool, missing: string[] }.
 */
export async function checkScaffolding(tenant) {
  const required = [
    "CLAUDE.md",
    "index.md",
    "log.md",
    "wiki/dimensions/financial.md",
    "wiki/dimensions/intellectual.md",
    "wiki/dimensions/social.md",
    "wiki/dimensions/spiritual.md",
    "wiki/dimensions/emotional.md",
    "wiki/dimensions/physical.md",
  ];
  const missing = [];
  for (const p of required) {
    const r = await readWikiFile(tenant, p);
    if (!r.success) missing.push(p);
  }
  return { scaffolded: missing.length === 0, missing };
}
