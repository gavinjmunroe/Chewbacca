/**
 * github/tools.js — Anthropic tool schemas + dispatcher for the GitHub
 * surface.
 *
 * Tool naming: github_<verb>_<noun>. Each handler returns either a plain
 * result object on success or a NOT_CONNECTED payload (via client.js'
 * buildNotConnected) when the tenant has no OAuth token.
 *
 * No confirmation gates here — destructive operations (create/delete
 * repo, merge PR, delete file, cancel workflow) execute directly when
 * called. The runtime's tier-NONE pass-through is what enables that;
 * see OAUTH_INTEGRATION_PLAYBOOK item 9.
 */

import {
  githubFetch,
  githubFetchPaginated,
  resolveRepoName,
  buildNotConnected,
  resolveGithubAuth,
} from "./client.js";

// ─── Tool schemas ────────────────────────────────────────────────────────────

export const GITHUB_TOOLS = [
  // Repos ─────────────────────────────────────────────────────────────
  {
    name: "github_list_repos",
    description:
      "List the connected user's GitHub repos (public + private). Use to find what projects exist or to search by name.",
    input_schema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Optional name substring to filter by",
        },
        visibility: { type: "string", enum: ["all", "public", "private"] },
        sort: {
          type: "string",
          enum: ["created", "updated", "pushed", "full_name"],
        },
        limit: {
          type: "number",
          description: "Max results (default 30, hard cap 200)",
        },
      },
    },
  },
  {
    name: "github_get_repo",
    description:
      "Get metadata for a single GitHub repo (description, default branch, stars, issues, last push).",
    input_schema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description:
            'Full "owner/repo" or short name resolved against the connected user.',
        },
      },
      required: ["repo"],
    },
  },
  {
    name: "github_create_repo",
    description:
      "Create a new GitHub repo under the connected user. Use auto_init=true to start with a README.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        private: { type: "boolean", description: "Defaults to true." },
        auto_init: {
          type: "boolean",
          description: "Initialize with README. Defaults to true.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "github_search_repos",
    description:
      "Search public repos across GitHub by query string. Supports GitHub's search qualifiers (language:, stars:>100, user:, etc).",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        sort: { type: "string", enum: ["stars", "forks", "updated"] },
        order: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },

  // Files / contents ──────────────────────────────────────────────────
  {
    name: "github_read_file",
    description:
      "Read a file's contents from a repo. If file_path points to a directory, returns the directory listing instead.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        file_path: {
          type: "string",
          description: 'Defaults to "README.md" if omitted.',
        },
        ref: {
          type: "string",
          description:
            "Branch / tag / commit SHA. Defaults to the repo default branch.",
        },
      },
      required: ["repo"],
    },
  },
  {
    name: "github_write_file",
    description:
      "Create or update a file in a repo. Auto-fetches the current SHA so existing files are updated, not duplicated.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        file_path: { type: "string" },
        content: {
          type: "string",
          description: "Raw text content (NOT base64 — the tool encodes).",
        },
        message: {
          type: "string",
          description: "Commit message. Defaults to `Update <file_path>`.",
        },
        branch: {
          type: "string",
          description: "Defaults to the repo default branch.",
        },
      },
      required: ["repo", "file_path", "content"],
    },
  },
  {
    name: "github_delete_file",
    description: "Delete a file from a repo.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        file_path: { type: "string" },
        message: { type: "string" },
        branch: { type: "string" },
      },
      required: ["repo", "file_path"],
    },
  },

  // Branches ──────────────────────────────────────────────────────────
  {
    name: "github_list_branches",
    description: "List branches on a repo.",
    input_schema: {
      type: "object",
      properties: { repo: { type: "string" } },
      required: ["repo"],
    },
  },
  {
    name: "github_create_branch",
    description:
      "Create a new branch on a repo. By default branches off the repo's default branch.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        name: { type: "string", description: "New branch name." },
        from_branch: {
          type: "string",
          description: "Source branch. Defaults to the repo default.",
        },
      },
      required: ["repo", "name"],
    },
  },
  {
    name: "github_delete_branch",
    description: "Delete a branch on a repo.",
    input_schema: {
      type: "object",
      properties: { repo: { type: "string" }, name: { type: "string" } },
      required: ["repo", "name"],
    },
  },

  // Issues ────────────────────────────────────────────────────────────
  {
    name: "github_list_issues",
    description: "List issues on a repo.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        state: { type: "string", enum: ["open", "closed", "all"] },
        labels: { type: "string", description: "Comma-separated label names." },
        assignee: { type: "string" },
        limit: { type: "number" },
      },
      required: ["repo"],
    },
  },
  {
    name: "github_get_issue",
    description: "Get a single issue by number.",
    input_schema: {
      type: "object",
      properties: { repo: { type: "string" }, number: { type: "number" } },
      required: ["repo", "number"],
    },
  },
  {
    name: "github_create_issue",
    description: "Open a new issue on a repo.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        assignees: { type: "array", items: { type: "string" } },
      },
      required: ["repo", "title"],
    },
  },
  {
    name: "github_comment_issue",
    description: "Add a comment to an issue or pull request.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        number: { type: "number" },
        body: { type: "string" },
      },
      required: ["repo", "number", "body"],
    },
  },
  {
    name: "github_close_issue",
    description: "Close an issue.",
    input_schema: {
      type: "object",
      properties: { repo: { type: "string" }, number: { type: "number" } },
      required: ["repo", "number"],
    },
  },
  {
    name: "github_reopen_issue",
    description: "Reopen a previously closed issue.",
    input_schema: {
      type: "object",
      properties: { repo: { type: "string" }, number: { type: "number" } },
      required: ["repo", "number"],
    },
  },

  // Pull requests ─────────────────────────────────────────────────────
  {
    name: "github_list_prs",
    description: "List pull requests on a repo.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        state: { type: "string", enum: ["open", "closed", "all"] },
        limit: { type: "number" },
      },
      required: ["repo"],
    },
  },
  {
    name: "github_get_pr",
    description:
      "Get a single pull request by number including diff stats (additions, deletions, changed files).",
    input_schema: {
      type: "object",
      properties: { repo: { type: "string" }, number: { type: "number" } },
      required: ["repo", "number"],
    },
  },
  {
    name: "github_create_pr",
    description: "Open a new pull request.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        head: { type: "string", description: "Source branch (the changes)." },
        base: {
          type: "string",
          description: "Target branch. Defaults to the repo default.",
        },
        draft: { type: "boolean" },
      },
      required: ["repo", "title", "head"],
    },
  },
  {
    name: "github_merge_pr",
    description: "Merge a pull request.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        number: { type: "number" },
        method: { type: "string", enum: ["merge", "squash", "rebase"] },
        commit_title: { type: "string" },
        commit_message: { type: "string" },
      },
      required: ["repo", "number"],
    },
  },

  // Gists ─────────────────────────────────────────────────────────────
  {
    name: "github_list_gists",
    description: "List the connected user's gists.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
  {
    name: "github_create_gist",
    description: "Create a new gist.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string" },
        public: { type: "boolean" },
        files: {
          type: "object",
          description:
            'Map of filename to { content: "..." }. e.g. { "note.md": { "content": "# hi" } }',
        },
      },
      required: ["files"],
    },
  },
  {
    name: "github_update_gist",
    description: "Update an existing gist's description or files.",
    input_schema: {
      type: "object",
      properties: {
        gist_id: { type: "string" },
        description: { type: "string" },
        files: { type: "object" },
      },
      required: ["gist_id"],
    },
  },

  // Workflows (GitHub Actions) ────────────────────────────────────────
  {
    name: "github_list_workflow_runs",
    description: "List recent GitHub Actions workflow runs for a repo.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        workflow: {
          type: "string",
          description: "Workflow file name (e.g. ci.yml) or numeric id.",
        },
        branch: { type: "string" },
        status: {
          type: "string",
          enum: [
            "queued",
            "in_progress",
            "completed",
            "success",
            "failure",
            "cancelled",
          ],
        },
        limit: { type: "number" },
      },
      required: ["repo"],
    },
  },
  {
    name: "github_dispatch_workflow",
    description: "Trigger a workflow_dispatch event on a workflow.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        workflow: { type: "string" },
        ref: {
          type: "string",
          description: "Branch / tag to run on. Defaults to the repo default.",
        },
        inputs: { type: "object", description: "Workflow input map." },
      },
      required: ["repo", "workflow"],
    },
  },
  {
    name: "github_cancel_workflow_run",
    description: "Cancel an in-progress workflow run.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        run_id: { type: "number" },
      },
      required: ["repo", "run_id"],
    },
  },

  // Search ────────────────────────────────────────────────────────────
  {
    name: "github_search_code",
    description:
      "Search code across the connected user's accessible repos. Use GitHub code search qualifiers (repo:, language:, path:).",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "github_search_issues",
    description:
      "Search issues + PRs across GitHub. Supports qualifiers (is:open, author:, label:, repo:).",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },

  // User / orgs ───────────────────────────────────────────────────────
  {
    name: "github_get_user",
    description: "Get the connected user's GitHub profile.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "github_list_orgs",
    description: "List orgs the connected user belongs to.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "github_list_org_members",
    description: "List members of a GitHub org. Requires the read:org scope.",
    input_schema: {
      type: "object",
      properties: { org: { type: "string" }, limit: { type: "number" } },
      required: ["org"],
    },
  },

  // Notifications ─────────────────────────────────────────────────────
  {
    name: "github_list_notifications",
    description: "List notifications for the connected user.",
    input_schema: {
      type: "object",
      properties: {
        all: { type: "boolean", description: "Include read notifications." },
        participating: {
          type: "boolean",
          description: "Only ones the user is participating in.",
        },
        since: { type: "string", description: "ISO timestamp filter." },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "github_mark_notifications_read",
    description:
      "Mark notifications as read. Without thread_id this marks ALL notifications read.",
    input_schema: {
      type: "object",
      properties: {
        thread_id: {
          type: "string",
          description: "Optional single thread to mark read.",
        },
      },
    },
  },
];

export const GITHUB_TOOL_NAMES = new Set(GITHUB_TOOLS.map((t) => t.name));

// ─── Helpers ────────────────────────────────────────────────────────────────

const HARD_LIMIT = 200;

function clampLimit(n, fallback = 30) {
  const v = Number.isFinite(n) ? Number(n) : fallback;
  return Math.max(1, Math.min(HARD_LIMIT, v));
}

function trimRepo(r) {
  return {
    name: r.full_name,
    description: r.description,
    private: r.private,
    fork: r.fork,
    default_branch: r.default_branch,
    language: r.language,
    stars: r.stargazers_count,
    forks: r.forks_count,
    open_issues: r.open_issues_count,
    updated: r.updated_at,
    pushed: r.pushed_at,
    url: r.html_url,
  };
}

function trimIssue(i) {
  return {
    number: i.number,
    title: i.title,
    state: i.state,
    user: i.user?.login,
    assignees: (i.assignees || []).map((a) => a.login),
    labels: (i.labels || []).map((l) => l.name || l),
    comments: i.comments,
    created: i.created_at,
    updated: i.updated_at,
    body: i.body,
    url: i.html_url,
    is_pr: !!i.pull_request,
  };
}

function trimPr(p) {
  return {
    number: p.number,
    title: p.title,
    state: p.state,
    draft: p.draft,
    user: p.user?.login,
    head: p.head?.ref,
    base: p.base?.ref,
    mergeable: p.mergeable,
    merged: p.merged,
    additions: p.additions,
    deletions: p.deletions,
    changed_files: p.changed_files,
    created: p.created_at,
    updated: p.updated_at,
    body: p.body,
    url: p.html_url,
  };
}

async function getDefaultBranch(tenant, fullName) {
  try {
    const res = await githubFetch(tenant, `/repos/${fullName}`);
    return res.data?.default_branch || "main";
  } catch {
    return "main";
  }
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export async function executeGithubTool(toolName, input, tenant = null) {
  try {
    return await execute(toolName, input || {}, tenant);
  } catch (err) {
    if (err.code === "github_not_connected") {
      return err.notConnected;
    }
    return {
      error: err.code || "github_tool_error",
      message: err.message,
      details: err.githubError || null,
    };
  }
}

async function execute(toolName, input, tenant) {
  switch (toolName) {
    // Repos ──────────────────────────────────────
    case "github_list_repos": {
      const visibility = input.visibility || "all";
      const sort = input.sort || "updated";
      const limit = clampLimit(input.limit, 30);
      const repos = await githubFetchPaginated(
        tenant,
        `/user/repos?visibility=${visibility}&sort=${sort}&affiliation=owner,collaborator,organization_member`,
        { maxPages: Math.ceil(limit / 100) || 1 },
      );
      let filtered = repos;
      if (input.search) {
        const q = String(input.search).toLowerCase();
        filtered = repos.filter(
          (r) =>
            r.full_name?.toLowerCase().includes(q) ||
            (r.description || "").toLowerCase().includes(q),
        );
      }
      return { repos: filtered.slice(0, limit).map(trimRepo) };
    }

    case "github_get_repo": {
      const fullName = await resolveRepoName(tenant, input.repo);
      const res = await githubFetch(tenant, `/repos/${fullName}`);
      return { repo: trimRepo(res.data) };
    }

    case "github_create_repo": {
      const res = await githubFetch(tenant, `/user/repos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: input.name,
          description: input.description,
          private: input.private !== false,
          auto_init: input.auto_init !== false,
        }),
      });
      return { repo: trimRepo(res.data) };
    }

    case "github_search_repos": {
      const limit = clampLimit(input.limit, 20);
      const params = new URLSearchParams({ q: input.query });
      if (input.sort) params.set("sort", input.sort);
      if (input.order) params.set("order", input.order);
      params.set("per_page", String(limit));
      const res = await githubFetch(tenant, `/search/repositories?${params}`);
      return {
        total: res.data?.total_count,
        repos: (res.data?.items || []).map(trimRepo),
      };
    }

    // Files ──────────────────────────────────────
    case "github_read_file": {
      const fullName = await resolveRepoName(tenant, input.repo);
      const filePath = input.file_path || "README.md";
      const refQuery = input.ref ? `?ref=${encodeURIComponent(input.ref)}` : "";
      const res = await githubFetch(
        tenant,
        `/repos/${fullName}/contents/${encodeURIComponent(filePath).replace(/%2F/g, "/")}${refQuery}`,
      );
      if (Array.isArray(res.data)) {
        return {
          repo: fullName,
          path: filePath,
          type: "dir",
          entries: res.data.map((e) => ({
            name: e.name,
            type: e.type,
            path: e.path,
            size: e.size,
          })),
        };
      }
      const content = res.data?.content
        ? Buffer.from(res.data.content, "base64").toString("utf-8")
        : "";
      return {
        repo: fullName,
        path: res.data?.path || filePath,
        sha: res.data?.sha,
        size: res.data?.size,
        content,
      };
    }

    case "github_write_file": {
      const fullName = await resolveRepoName(tenant, input.repo);
      // Pre-fetch SHA so existing files are updated, not duplicated.
      let sha = null;
      try {
        const existing = await githubFetch(
          tenant,
          `/repos/${fullName}/contents/${encodeURIComponent(input.file_path).replace(/%2F/g, "/")}${input.branch ? `?ref=${encodeURIComponent(input.branch)}` : ""}`,
        );
        sha = existing.data?.sha || null;
      } catch (err) {
        if (err.status !== 404) throw err;
      }
      const body = {
        message: input.message || `Update ${input.file_path}`,
        content: Buffer.from(input.content, "utf-8").toString("base64"),
      };
      if (sha) body.sha = sha;
      if (input.branch) body.branch = input.branch;
      const res = await githubFetch(
        tenant,
        `/repos/${fullName}/contents/${encodeURIComponent(input.file_path).replace(/%2F/g, "/")}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      return {
        repo: fullName,
        path: input.file_path,
        sha: res.data?.content?.sha,
        commit: res.data?.commit?.html_url,
      };
    }

    case "github_delete_file": {
      const fullName = await resolveRepoName(tenant, input.repo);
      const existing = await githubFetch(
        tenant,
        `/repos/${fullName}/contents/${encodeURIComponent(input.file_path).replace(/%2F/g, "/")}${input.branch ? `?ref=${encodeURIComponent(input.branch)}` : ""}`,
      );
      const body = {
        message: input.message || `Delete ${input.file_path}`,
        sha: existing.data?.sha,
      };
      if (input.branch) body.branch = input.branch;
      await githubFetch(
        tenant,
        `/repos/${fullName}/contents/${encodeURIComponent(input.file_path).replace(/%2F/g, "/")}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      return { repo: fullName, path: input.file_path, deleted: true };
    }

    // Branches ───────────────────────────────────
    case "github_list_branches": {
      const fullName = await resolveRepoName(tenant, input.repo);
      const branches = await githubFetchPaginated(
        tenant,
        `/repos/${fullName}/branches`,
      );
      return {
        repo: fullName,
        branches: branches.map((b) => ({
          name: b.name,
          sha: b.commit?.sha,
          protected: b.protected,
        })),
      };
    }

    case "github_create_branch": {
      const fullName = await resolveRepoName(tenant, input.repo);
      const fromBranch =
        input.from_branch || (await getDefaultBranch(tenant, fullName));
      const fromRef = await githubFetch(
        tenant,
        `/repos/${fullName}/git/ref/heads/${encodeURIComponent(fromBranch)}`,
      );
      const sha = fromRef.data?.object?.sha;
      const res = await githubFetch(tenant, `/repos/${fullName}/git/refs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: `refs/heads/${input.name}`,
          sha,
        }),
      });
      return { repo: fullName, branch: input.name, sha: res.data?.object?.sha };
    }

    case "github_delete_branch": {
      const fullName = await resolveRepoName(tenant, input.repo);
      await githubFetch(
        tenant,
        `/repos/${fullName}/git/refs/heads/${encodeURIComponent(input.name)}`,
        { method: "DELETE" },
      );
      return { repo: fullName, branch: input.name, deleted: true };
    }

    // Issues ─────────────────────────────────────
    case "github_list_issues": {
      const fullName = await resolveRepoName(tenant, input.repo);
      const params = new URLSearchParams({
        state: input.state || "open",
      });
      if (input.labels) params.set("labels", input.labels);
      if (input.assignee) params.set("assignee", input.assignee);
      const limit = clampLimit(input.limit, 30);
      const issues = await githubFetchPaginated(
        tenant,
        `/repos/${fullName}/issues?${params}`,
        { maxPages: Math.ceil(limit / 100) || 1 },
      );
      return {
        repo: fullName,
        issues: issues.slice(0, limit).map(trimIssue),
      };
    }

    case "github_get_issue": {
      const fullName = await resolveRepoName(tenant, input.repo);
      const res = await githubFetch(
        tenant,
        `/repos/${fullName}/issues/${input.number}`,
      );
      return { repo: fullName, issue: trimIssue(res.data) };
    }

    case "github_create_issue": {
      const fullName = await resolveRepoName(tenant, input.repo);
      const res = await githubFetch(tenant, `/repos/${fullName}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: input.title,
          body: input.body,
          labels: input.labels,
          assignees: input.assignees,
        }),
      });
      return { repo: fullName, issue: trimIssue(res.data) };
    }

    case "github_comment_issue": {
      const fullName = await resolveRepoName(tenant, input.repo);
      const res = await githubFetch(
        tenant,
        `/repos/${fullName}/issues/${input.number}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: input.body }),
        },
      );
      return {
        repo: fullName,
        number: input.number,
        comment_url: res.data?.html_url,
      };
    }

    case "github_close_issue": {
      const fullName = await resolveRepoName(tenant, input.repo);
      const res = await githubFetch(
        tenant,
        `/repos/${fullName}/issues/${input.number}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "closed" }),
        },
      );
      return { repo: fullName, issue: trimIssue(res.data) };
    }

    case "github_reopen_issue": {
      const fullName = await resolveRepoName(tenant, input.repo);
      const res = await githubFetch(
        tenant,
        `/repos/${fullName}/issues/${input.number}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "open" }),
        },
      );
      return { repo: fullName, issue: trimIssue(res.data) };
    }

    // Pull requests ──────────────────────────────
    case "github_list_prs": {
      const fullName = await resolveRepoName(tenant, input.repo);
      const params = new URLSearchParams({ state: input.state || "open" });
      const limit = clampLimit(input.limit, 30);
      const prs = await githubFetchPaginated(
        tenant,
        `/repos/${fullName}/pulls?${params}`,
        { maxPages: Math.ceil(limit / 100) || 1 },
      );
      return { repo: fullName, prs: prs.slice(0, limit).map(trimPr) };
    }

    case "github_get_pr": {
      const fullName = await resolveRepoName(tenant, input.repo);
      const res = await githubFetch(
        tenant,
        `/repos/${fullName}/pulls/${input.number}`,
      );
      return { repo: fullName, pr: trimPr(res.data) };
    }

    case "github_create_pr": {
      const fullName = await resolveRepoName(tenant, input.repo);
      const base = input.base || (await getDefaultBranch(tenant, fullName));
      const res = await githubFetch(tenant, `/repos/${fullName}/pulls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: input.title,
          body: input.body,
          head: input.head,
          base,
          draft: !!input.draft,
        }),
      });
      return { repo: fullName, pr: trimPr(res.data) };
    }

    case "github_merge_pr": {
      const fullName = await resolveRepoName(tenant, input.repo);
      const res = await githubFetch(
        tenant,
        `/repos/${fullName}/pulls/${input.number}/merge`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commit_title: input.commit_title,
            commit_message: input.commit_message,
            merge_method: input.method || "squash",
          }),
        },
      );
      return {
        repo: fullName,
        number: input.number,
        merged: res.data?.merged,
        sha: res.data?.sha,
      };
    }

    // Gists ──────────────────────────────────────
    case "github_list_gists": {
      const limit = clampLimit(input.limit, 30);
      const gists = await githubFetchPaginated(tenant, `/gists`, {
        maxPages: Math.ceil(limit / 100) || 1,
      });
      return {
        gists: gists.slice(0, limit).map((g) => ({
          id: g.id,
          description: g.description,
          public: g.public,
          files: Object.keys(g.files || {}),
          updated: g.updated_at,
          url: g.html_url,
        })),
      };
    }

    case "github_create_gist": {
      const res = await githubFetch(tenant, `/gists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: input.description,
          public: !!input.public,
          files: input.files,
        }),
      });
      return { gist: { id: res.data?.id, url: res.data?.html_url } };
    }

    case "github_update_gist": {
      const body = {};
      if (input.description !== undefined) body.description = input.description;
      if (input.files !== undefined) body.files = input.files;
      const res = await githubFetch(tenant, `/gists/${input.gist_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { gist: { id: res.data?.id, url: res.data?.html_url } };
    }

    // Workflows ──────────────────────────────────
    case "github_list_workflow_runs": {
      const fullName = await resolveRepoName(tenant, input.repo);
      const params = new URLSearchParams();
      if (input.branch) params.set("branch", input.branch);
      if (input.status) params.set("status", input.status);
      const path = input.workflow
        ? `/repos/${fullName}/actions/workflows/${encodeURIComponent(input.workflow)}/runs?${params}`
        : `/repos/${fullName}/actions/runs?${params}`;
      const limit = clampLimit(input.limit, 20);
      const res = await githubFetch(tenant, path);
      const runs = (res.data?.workflow_runs || []).slice(0, limit);
      return {
        repo: fullName,
        runs: runs.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          conclusion: r.conclusion,
          branch: r.head_branch,
          sha: r.head_sha?.slice(0, 7),
          created: r.created_at,
          updated: r.updated_at,
          url: r.html_url,
        })),
      };
    }

    case "github_dispatch_workflow": {
      const fullName = await resolveRepoName(tenant, input.repo);
      const ref = input.ref || (await getDefaultBranch(tenant, fullName));
      await githubFetch(
        tenant,
        `/repos/${fullName}/actions/workflows/${encodeURIComponent(input.workflow)}/dispatches`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ref, inputs: input.inputs || {} }),
        },
      );
      return {
        repo: fullName,
        workflow: input.workflow,
        ref,
        dispatched: true,
      };
    }

    case "github_cancel_workflow_run": {
      const fullName = await resolveRepoName(tenant, input.repo);
      await githubFetch(
        tenant,
        `/repos/${fullName}/actions/runs/${input.run_id}/cancel`,
        { method: "POST" },
      );
      return { repo: fullName, run_id: input.run_id, cancelled: true };
    }

    // Search ─────────────────────────────────────
    case "github_search_code": {
      const limit = clampLimit(input.limit, 20);
      const params = new URLSearchParams({
        q: input.query,
        per_page: String(limit),
      });
      const res = await githubFetch(tenant, `/search/code?${params}`);
      return {
        total: res.data?.total_count,
        results: (res.data?.items || []).map((i) => ({
          name: i.name,
          path: i.path,
          repo: i.repository?.full_name,
          url: i.html_url,
        })),
      };
    }

    case "github_search_issues": {
      const limit = clampLimit(input.limit, 20);
      const params = new URLSearchParams({
        q: input.query,
        per_page: String(limit),
      });
      const res = await githubFetch(tenant, `/search/issues?${params}`);
      return {
        total: res.data?.total_count,
        results: (res.data?.items || []).map(trimIssue),
      };
    }

    // User / orgs ────────────────────────────────
    case "github_get_user": {
      const res = await githubFetch(tenant, `/user`);
      const u = res.data || {};
      return {
        login: u.login,
        name: u.name,
        email: u.email,
        bio: u.bio,
        company: u.company,
        location: u.location,
        public_repos: u.public_repos,
        followers: u.followers,
        url: u.html_url,
      };
    }

    case "github_list_orgs": {
      const orgs = await githubFetchPaginated(tenant, `/user/orgs`);
      return {
        orgs: orgs.map((o) => ({
          login: o.login,
          description: o.description,
          url: o.html_url,
        })),
      };
    }

    case "github_list_org_members": {
      const limit = clampLimit(input.limit, 100);
      const members = await githubFetchPaginated(
        tenant,
        `/orgs/${encodeURIComponent(input.org)}/members`,
        { maxPages: Math.ceil(limit / 100) || 1 },
      );
      return {
        org: input.org,
        members: members.slice(0, limit).map((m) => ({
          login: m.login,
          url: m.html_url,
        })),
      };
    }

    // Notifications ──────────────────────────────
    case "github_list_notifications": {
      const params = new URLSearchParams();
      if (input.all) params.set("all", "true");
      if (input.participating) params.set("participating", "true");
      if (input.since) params.set("since", input.since);
      const limit = clampLimit(input.limit, 30);
      const res = await githubFetch(tenant, `/notifications?${params}`);
      const items = Array.isArray(res.data) ? res.data : [];
      return {
        notifications: items.slice(0, limit).map((n) => ({
          id: n.id,
          reason: n.reason,
          repo: n.repository?.full_name,
          subject: n.subject?.title,
          type: n.subject?.type,
          unread: n.unread,
          updated: n.updated_at,
        })),
      };
    }

    case "github_mark_notifications_read": {
      if (input.thread_id) {
        await githubFetch(tenant, `/notifications/threads/${input.thread_id}`, {
          method: "PATCH",
        });
        return { thread_id: input.thread_id, marked_read: true };
      }
      await githubFetch(tenant, `/notifications`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      });
      return { all_marked_read: true };
    }

    default:
      return { error: `Unknown GitHub tool: ${toolName}` };
  }
}

/**
 * Service-to-service helper for callers that just want to confirm the
 * tenant has GitHub connected before bothering with a full tool call.
 * Returns `{ connected, handle }` shape; never throws.
 */
export async function githubStatus(tenant) {
  const auth = await resolveGithubAuth(tenant).catch(() => null);
  return {
    connected: !!auth,
    handle: auth?.handle || null,
    connect_url: !auth ? buildNotConnected().connect_url : null,
  };
}
