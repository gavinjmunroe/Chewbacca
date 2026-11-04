---
name: platforms
description: "Reach Cloudflare, Railway, Vercel, Supabase, GitHub, Google Workspace, Porkbun, Clay, Twilio and WhatsApp from one place: who's signed in, the fix, common jobs. Also buy a domain and set up a cold-email sending domain."
triggers: >-
  Use for anything that touches an outside platform account: is X connected, sign in to X, which account am I on, deploy or check a Railway or Vercel app, Supabase projects, Cloudflare DNS, buy or register a domain, domain price or availability, redirect a domain, set up a new sending domain or lookalike domain for cold email, MX SPF DKIM DMARC records, Google Workspace inboxes for outbound, Porkbun, Twilio keys, WhatsApp link. Replaces agent-scripts' cloudflare-registrar and domain-dns-ops, which are set up for another person's account.
license: MIT
requires: [chewbacca]
---

# Platforms

One front door for every outside account Chewbacca, Dough and Anchored lean on.

```bash
chewbacca platforms                  # every platform: connected (as who), or the fix
chewbacca platforms show cloudflare  # install, sign in, used by, common jobs, gotchas
```

Run the status line first whenever a task needs a platform. It's read-only, each check is that
platform's own whoami with a 20 s timeout, and nothing it prints is a secret.

## Rules

- Secrets live in each CLI's own store (cf, gh, railway, vercel, supabase, gws, wacli) or the
  macOS keychain under account `chewbacca` (`chewbacca platforms set-key porkbun`). Never in a repo,
  a note, a memory file or chat.
- A sign-in step is his: start the login yourself (`cf auth login` prints a device code and opens
  the page), tell him the one click, and keep working on the rest.
- Anything that costs money (a domain, a Workspace seat, a plan) gets the exact items and total
  shown to him and his yes on that number before it runs. A domain registration can't be refunded.
- A send under his name (email, WhatsApp, SMS) needs his ok every time.

## Never

- Never spend ten minutes reading before the first useful action. On 2026-11-03 this skill
  didn't exist yet, a session read three repos silently before touching DNS, and Caleb asked
  "What's taking so long?" and then "How much longer?". Run `chewbacca platforms`, do the job,
  and say where it stands in one line within the first minute, with an honest estimate.
- Never leave a lookalike sending domain pointing nowhere. Every one 301s to the client's real
  site from the start (Caleb, 2026-11-03: "Also make them all redirect to the actual aurapath
  site"), so `--redirect` is part of step 2, not an extra.

## Buying a domain

Buy new domains on Cloudflare (account caleb@firmfoundation.tech). Porkbun refused new orders on
2026-11-03 ("This account is unable to place new orders (001)"). firmfoundation.tech stays on Porkbun.

```bash
cf registrar registrations check x --body '{"domains":["a.com","b.com"]}'   # authoritative price, read-only
cf registrar registrations create a.com --years 1 --auto-renew --privacy-mode redaction --force \
  --contacts-registrant-postal-info-name "..." --contacts-registrant-email ... --contacts-registrant-phone "+1.NNNNNNNNNN" \
  --contacts-registrant-postal-info-address-street ... -city ... -state ... -postal-code ... -country-code US
```

Gotchas, all seen on 2026-11-03: `check` needs a dummy positional before `--body`; `create` fails
with "No registrant contact provided" until you pass the contact flags (the name and address are
in `cf billing profiles get`); `-z` takes a zone id, and a domain name there builds a broken URL.

## New cold-email sending domain (tested end to end 2026-11-03)

1. Register it on Cloudflare as above, and the zone shows up on Cloudflare nameservers right away.
2. Mail records and the web redirect, in one command. Dry run first, then `--yes`:
   ```bash
   chewbacca platforms sending-domain plan  getaurapath.com --redirect https://aurapathai.com
   chewbacca platforms sending-domain apply getaurapath.com --redirect https://aurapathai.com --yes
   ```
   That writes MX `smtp.google.com` (priority 1), SPF `v=spf1 include:_spf.google.com ~all`,
   DMARC `v=DMARC1; p=none;` and a proxied placeholder plus a 301 of every path to the real site.
   A rerun reports `exists` and writes nothing. It refuses to add a second SPF or MX, or to replace
   another redirect rule.
3. Google Workspace: a NEW tenant per client, never inside firmfoundation.tech, so a spam
   suspension can't take FF's real mail down. Sign-up and card are his
   (https://workspace.google.com/business/signup/welcome). The first domain is primary, the
   others are secondary domains. Workspace hands over a `google-site-verification=` token:
   `apply <domain> --verify <token> --yes`.
4. DKIM, once the domain is verified: Admin console > Apps > Google Workspace > Gmail >
   Authenticate email, generate a 2048-bit key, then `apply <domain> --dkim '<v=DKIM1 value>' --yes`,
   then press Start authentication in the console.
5. Check from public DNS: `chewbacca platforms sending-domain check <domain>` (that's
   `chewbacca gtme dns`). Ready means mx, spf, dkim, dmarc and site pass and the domain is past the
   warmup minimum. Warm up 10 to 15 days before the first send.

## Who uses what

- Chewbacca: GitHub, Google (gws), Clay through `chewbacca clay`, WhatsApp, Cloudflare for domains.
- Dough: Clay, Google Workspace inboxes, Cloudflare sending domains (`chewbacca gtme dns` lives in Dough's engine).
- Anchored: Railway (anchored.up.railway.app, deploys on push to main), GitHub, Twilio and WhatsApp for Gather texting.

The Claude plugin `cloudflare@cloudflare` (marketplace cloudflare/skills) adds Cloudflare's own
skills and its MCP server. The MCP needs `/mcp` authorization once; the `cf` CLI works without it.
