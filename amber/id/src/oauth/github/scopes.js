/**
 * GitHub OAuth scope catalog.
 *
 * Classic OAuth Apps with "Expire user authorization tokens" turned OFF
 * issue non-expiring access tokens, so one consent permanently grants the
 * agent access until the user explicitly revokes from
 * github.com/settings/applications.
 *
 * Scopes chosen for breadth without tripping the "Delete repositories"
 * consent-screen bounce. Anything destructive enough to scare a first-time
 * connecter (delete_repo, admin:org, admin:public_key) is intentionally
 * absent; we can add them later as opt-in flows.
 *
 * Why each scope:
 *   repo                    full read/write on public + private repos
 *                           (covers contents, commits, branches, issues,
 *                           pulls, releases, statuses on owned + member
 *                           repos)
 *   read:org                list orgs the user belongs to + team membership
 *   user                    profile + email + follow graph
 *                           (umbrella for read:user + user:email + user:follow)
 *   gist                    create / update gists
 *   workflow                trigger + cancel GitHub Actions workflows
 *   write:packages          publish to GHCR / npm / etc.
 *   read:packages           pull from private package registries
 *   admin:repo_hook         manage repo webhooks (so the agent can wire
 *                           event subscriptions when needed)
 *   notifications           read + mark-read the notifications feed
 *   project                 read + write classic + v2 projects
 *   codespace               list / start / stop Codespaces on owned repos
 */

export const GITHUB_SCOPES = [
  "repo",
  "read:org",
  "user",
  "gist",
  "workflow",
  "write:packages",
  "read:packages",
  "admin:repo_hook",
  "notifications",
  "project",
  "codespace",
];

/**
 * GitHub returns scopes comma-separated in the token-exchange response
 * `scope` field. Connect this helper to keep scope serialization in one
 * place if we ever need to switch separators.
 */
export function buildScopeString(scopes) {
  return scopes.join(" ");
}
