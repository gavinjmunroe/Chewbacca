---
name: project_aurapath_sending_domains_2026_11_03
description: The 3 AuraPath lookalike sending domains for the 50-firm head-to-head, bought on Cloudflare 2026-11-03 under the FF Cloudflare account, with mail DNS and a 301 to aurapathai.com; Workspace tenant still to create
metadata:
  type: project
---

getaurapath.com, aurapathhq.com and aurapath-ai.com are the sending domains for the AuraPath head-to-head (50 Michigan PIP firms). Caleb okayed $33.51 in chat and they were registered on Cloudflare Registrar on 2026-11-04 07:11 UTC (11/03 11:11pm PT): 1 year, auto-renew on at $11.17 each, WHOIS privacy on. Firm Foundation pays.

- Cloudflare account: caleb@firmfoundation.tech, made 11/03 after Porkbun refused checkout ("This account is unable to place new orders (001)"). firmfoundation.tech's own domain and DNS stay on Porkbun.
- DNS on all 3, written by `chewbacca platforms sending-domain apply`: MX smtp.google.com, SPF include:\_spf.google.com, DMARC p=none, and a proxied placeholder plus a 301 of every path to https://aurapathai.com (AuraPath's real site; Caleb asked for the redirect).
- Still to do: a NEW Google Workspace tenant with getaurapath.com as primary and the other 2 as secondary domains, 6 inboxes (2 per domain, about $42 a month). Sign-up and card are Caleb's. Never put these inboxes inside the firmfoundation.tech Workspace, so a spam suspension can't take FF's real mail down. Then add `--verify` and `--dkim` with the same command and pass `chewbacca gtme dns`.
- Warmup is 10 to 15 days. The 11/03 draft to Travis says first sends land 11/13 to 11/18, which only holds if the inboxes go up by about 11/5.
- Lesson from the night: a session read three repos for ten minutes before acting, and Caleb asked "What's taking so long?" and "How much longer?". The `platforms` skill now says to act and report state in the first minute.

Update 11/6 12:45am: Caleb paid for Instantly on the Starter Bundle, $85 a month, renews 12/6 (read on its billing page). Its limits are the Growth plan's, 1,000 contacts and 5,000 emails a month, plus 1,500 credits. The API key is in Keychain as dough-instantly-aurapath-pip. The API's plan_id still reads pid_free on a paid workspace, so don't use that field to check payment. 0 inboxes connected and warmup hasn't started, because connecting them needs the caleb@aurapathhq.com Workspace password, which also blocks the inbox count and getaurapath.com's DKIM.
