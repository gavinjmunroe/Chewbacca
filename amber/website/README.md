# Amber — amberintelligence.ai

Waitlist-only site. A scroll-scrubbed geode (`components/ScrollClipStage`) that
hands over to a three-field form (full name, phone, email). Submissions go to
one Clay table. No marketing copy, no sections, no database.

## Local

```bash
cp .env.example .env.local   # add CLAY_WEBHOOK_URL
npm install
npm run dev
```

## Deploy (Railway)

`Dockerfile` + `railway.toml` + Next.js `standalone`. Push to `main` and
Railway rebuilds; there is no CI and no staging, so main is production.

**The runner image has no `next` binary, and that is deliberate.**
`next.config.ts` sets `output: "standalone"`, so the build emits a
self-contained server that the Dockerfile copies to `/app/server.js`. Both
`npm run start` and the Dockerfile's `CMD` run `node server.js`. Anything
that runs `next start` in the container fails with `sh: next: not found` --
if you ever see that in the deploy logs, something is invoking the wrong
command, not missing a dependency. `npm run start:next` exists for running a
non-standalone production build locally.

Variables: `CLAY_WEBHOOK_URL`, `NEXT_PUBLIC_SITE_URL`. Custom domain
`amberintelligence.ai` is attached to the service.

## Waitlist

`POST /api/waitlist` with `{ name, phone, email }` posts to `CLAY_WEBHOOK_URL`.
A hidden `website` honeypot field is dropped server-side, and there is a
per-IP limit of 5 submissions per 5 minutes.

Clay is the only store. If the webhook refuses, the visitor sees an error and
the log carries `CLAY REFUSED` or `CLAY UNREACHABLE` with the email — that line
is the only record, so it is worth an alert.

`/waitlist` is the same form on a plain page, `noindex`, kept as the no-JS
fallback since the root page's scrub is driven from JavaScript.
