/**
 * SHARE LINKS: one page, one URL, anybody who has it.
 *
 *   POST   /v1/org/pages/:pageId/link     make one (or hand back the live one)
 *   GET    /v1/org/pages/:pageId/links    what exists, and whether it is used
 *   DELETE /v1/org/share-links/:linkId          off, now
 *   GET    /p/:token                      the page itself, to anybody
 *
 * THE LAST ROUTE IS THE ONLY UNAUTHENTICATED ONE IN THE ORG SURFACE, and it
 * is narrow by construction rather than by care: the token names one row,
 * the policies in migration 094 admit that row and the one page it points
 * at, and the flag that raises them is transaction-local.
 *
 * AN ARTIFACT IS SERVED AS ITSELF. A page whose body is one fenced html
 * block is a thing that RUNS, so the public route returns that markup as a
 * document -- which is what "share it outside" has to mean for a tool. It
 * goes out with a restrictive CSP and no credentials, on a path that sets no
 * cookie, so a shared artifact cannot reach back into anything.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { makeResolveActor, requireOrgMember } from "../lib/resolve-actor.js";
import { openTenantScope } from "../db/tenant.js";
import { getPage } from "../db/org-knowledge-store.js";
import {
  createPageLink,
  listPageLinks,
  revokePageLink,
  readPublicPage,
} from "../db/org-page-links.js";

const org = (request) => request.actor.orgId;
const who = (request) => request.actor.amberId;

/** The one fenced block an imported or built artifact's body is. */
function artifactSource(body) {
  const m = String(body ?? "").match(/^```(html|svg)\n([\s\S]*?)\n```\s*$/i);
  return m ? m[2] : null;
}

const escape = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

/** A readable page for anything that is not an artifact. */
function documentShell(page) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escape(page.title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; background:#f5f6f8; color:#1b1b1d;
         font:16px/1.65 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  main { max-width:760px; margin:0 auto; padding:48px 24px 96px; }
  h1 { font-size:28px; line-height:1.25; margin:0 0 8px; }
  .sub { color:#6b6b70; margin:0 0 28px; font-size:14px; }
  .body { white-space:pre-wrap; background:#fff; border:1px solid #e6e6e9;
          border-radius:14px; padding:28px; }
</style>
</head><body><main>
<h1>${escape(page.title)}</h1>
<p class="sub">${page.summary ? escape(page.summary) : "Shared from Amber"}</p>
<div class="body">${escape(page.body)}</div>
</main></body></html>`;
}

export function registerOrgPageLinkRoutes(
  app,
  { requireAuth = defaultRequireAuth, resolveActor = makeResolveActor() } = {},
) {
  const asMember = {
    preHandler: [requireAuth, resolveActor, requireOrgMember, openTenantScope],
  };

  app.post("/v1/org/pages/:pageId/link", asMember, async (request, reply) => {
    const orgId = org(request);
    const pageId = String(request.params.pageId);

    /* Read it the way the screen reads it: a page this person cannot see is
       a 404 here exactly as it is there, and is certainly not one they can
       hand to the internet. */
    const page = await getPage({ orgId, pageId, viewerId: who(request) });
    if (!page) return reply.code(404).send({ error: "not_found" });

    const out = await createPageLink({ orgId, pageId, createdBy: who(request) });
    if (!out.ok) return reply.code(400).send({ error: out.reason });
    return { ok: true, link: out.link, reused: out.reused };
  });

  app.get("/v1/org/pages/:pageId/links", asMember, async (request, reply) => {
    const orgId = org(request);
    const page = await getPage({ orgId, pageId: request.params.pageId, viewerId: who(request) });
    if (!page) return reply.code(404).send({ error: "not_found" });
    return { links: await listPageLinks({ orgId, pageId: request.params.pageId }) };
  });

  app.delete("/v1/org/share-links/:linkId", asMember, async (request, reply) => {
    const out = await revokePageLink({ orgId: org(request), linkId: request.params.linkId });
    if (!out.ok) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  /**
   * THE PUBLIC PAGE. No session, no cookie, no tenant.
   *
   * A revoked or unknown token gets the same answer, because telling the
   * difference would say whether a link ever existed.
   */
  app.get("/p/:token", async (request, reply) => {
    const page = await readPublicPage(request.params.token);
    if (!page) {
      return reply
        .code(404)
        .type("text/html; charset=utf-8")
        .send(
          `<!doctype html><meta charset="utf-8"><title>Not here</title>` +
            `<body style="font:16px/1.6 ui-sans-serif,system-ui;padding:48px;color:#1b1b1d">` +
            `<h1 style="font-size:22px">This link is not working</h1>` +
            `<p style="color:#6b6b70">It may have been turned off by whoever shared it.</p>`,
        );
    }

    const source = artifactSource(page.body);

    /*
     * A TIGHT CSP ON SOMEBODY ELSE'S MARKUP. The artifact is self-contained
     * by construction -- that is what it was built to be -- so denying it
     * the network costs it nothing and means a shared page cannot phone
     * anywhere, embed a tracker, or be framed by a site pretending it is
     * theirs. default-src 'none' with inline script and style allowed is
     * exactly the shape of the sandbox it already renders in.
     */
    return reply
      .code(200)
      .type("text/html; charset=utf-8")
      .header(
        "content-security-policy",
        "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; " +
          "script-src 'unsafe-inline'; font-src data:; frame-ancestors 'none'; form-action 'none'",
      )
      .header("referrer-policy", "no-referrer")
      .header("x-robots-tag", "noindex, nofollow")
      .send(source ?? documentShell(page));
  });
}
