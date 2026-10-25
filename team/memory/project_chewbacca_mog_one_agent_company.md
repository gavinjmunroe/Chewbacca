---
name: project_chewbacca_mog_one_agent_company
description: Goal set 2026-10-25, research only so far. Chewbacca should let anyone run Phil Hewinson's "one person, one agent, whole company" setup (37 roles, 122 skills, 47 scheduled jobs) easily, and beat Omarchy and the other AI-native OSes. Has a role-by-role gap map (8 have, 16 partial, 13 missing, Finance all missing) and the first steps
metadata:
  type: project
---

Chewbacca's bar from 2026-10-25: anyone can set up the "one person, one agent, the
whole company" model that Phil Hewinson (Multiply Academy) showed in a meeting, and
it's easy. It should also beat the AI-native operating systems, Omarchy most of all.
Caleb: "We gotta mog all of them." Backlog item CB-523. Nothing has been built yet.

## Phil's setup

Phil is the only human. He decides, gives the context and reads everything before
it goes out. He speaks and never types. The agent is Claude Code on a folder of
plain-text files with 122 skills (87 company, 14 platform repo, 21 personal) and 47
scheduled jobs on an always-on Mac Mini. The one-page org chart is rendered from an
"Org Chart.md". It's plugged into Gmail, Calendar, Drive, Xero, Stripe, Monzo,
Supabase, PostHog, Sentry, Mux, ElevenLabs, HeyGen, Hubdoc, WhatsApp, LinkedIn and
Chrome. His rule: nothing reaches a person, publishes or pays without him. Hooks,
deny rules and circuit breakers enforce it, and he approves every word that leaves.

There are 37 roles. Each one lists its slash skills and, when it runs on a
schedule, how often. Each also has its status in Chewbacca as of 10/25: HAVE = a
tool exists, PARTIAL = some of it or not scheduled, MISSING = nothing found. Tools
were matched by name and not run.

Marketing

- Video producer: /video-generate, /story-film. PARTIAL (creative-video, animated-video, reel-assemble)
- Demo producer: /demo-studio, /demo-new, /demo-clip. HAVE (demo skill, demo-shoot)
- Copywriter: /linkedin-post daily 01:07. PARTIAL (chewbacca-linkedin, no daily job)
- Testimonial editor: /testimonial-prep, -process, -approval, -signed. MISSING
- Content strategist: /linkedin-engine weekly, /linkedin-page monthly. MISSING
- Performance analyst: linkedin-metrics every 15 min, linkedin-comments daily, /linkedin-review. MISSING
- Market analyst: /competitor, /messaging-consolidate. PARTIAL (deep-research)

Sales

- Chief of staff: /briefing weekdays 04:07, /meeting-prep, /talk-prep, /whereabouts daily. HAVE (brief service 08:00, meeting-prep, call-practice); no whereabouts
- Follow-up writer: /followup, /pdf-export, /message. HAVE (mac-followups, chewbacca-pdf, texts)
- Proposal writer: /story, /story-pdf, /quote. PARTIAL (no quote builder)
- Sales development rep: /chase daily. PARTIAL (gtme, people texts owed)
- Researcher: /research-contact. HAVE (prospect-brief, people brief, resolve)
- Call analyst: /sales-calls hourly. PARTIAL (call-watch, call-listen, granola-import)
- Adoption consultant: /consult. MISSING

Customers

- Executive assistant: /email-triage every 5 min, /contact-triage weekdays, whatsapp-sync hourly. PARTIAL (chewbacca-email, messages-refresh 10 min, people-sync, ff-inbox-socal 15 min)
- Ghostwriter: /message, /draft-gaps. HAVE (texts drafts, voice-check)
- Data analyst: /impact-hours weekly, /report monthly, /team-progress. PARTIAL (team board, gtm reports)
- Account admin: /enterprise, /whitelist, /gift, /switch-seat, /switch-login, /reassign. MISSING (only matters for a product with seats)

Finance (every role missing)

- Payments clerk: /payment-check every 5 min, stripe-transfer-check daily. MISSING
- Contracts manager: /review-contract, /nda, /referral, /sales-agreement, /legal-update. MISSING
- Bookkeeper: /invoice, /receipt, /expenses, /reissue-invoice. MISSING (startup-finance skill only)
- FP&A analyst: /kpis weekly, /international-guardrails. MISSING
- Partner manager: /commission monthly, /attribution daily, /introducer-update monthly. MISSING

Product and platform

- Product engineer: /build (spec, browser QA, security review, main). HAVE (shipping, reviewing-changes, review-gate, land)
- On-call engineer: /sentry-check hourly. MISSING
- Support engineer: /regenerate, /redo-context, /deactivate-user, stuck-reflections daily. MISSING (specific to his product)
- Release manager: /release-masters, /release-video, /model-eval, /rotate-keys. PARTIAL (release-mac-app, release-tweets); leave key rotation out of Caleb's own setup

Operations

- Note-taker: /inbox, /transcripts. HAVE (ingest, granola-import, meeting-autopilot)
- Internal auditor: /workspace-review monthly, /instruction-audit monthly. PARTIAL (lint, recur, kit-debt, guard-fp daily, recall-gate daily)
- Curriculum designer: /improve, /master-new, -review, -sync, /video-script. PARTIAL (skill-forge, skill-training, evolve)
- Research librarian: /product, /book-summary, /product-add. PARTIAL (deep-research, ingest)
- Sysadmin: /backup weekly, vault-integrity weekly, syncs hourly, watchdog every 5 min. PARTIAL (orphan-reap, jobs, agent-watch, doctor); no backup job

Personal

- Personal assistant: /tasks daily 05:00, /shop, /watch. PARTIAL (work-ledger)
- Health coach: /health, /flourishing, HRV check. PARTIAL (`fitness` bin, unchecked)
- Travel agent: /trip-prep, /day-plan, /packing. PARTIAL (agenda, google-flights op)
- Family bookkeeper: /finances, /budget-update monthly, /accountant. MISSING
- Faith assistant: /manna daily 02:20, /sermon. HAVE (verse service every 15 min on the HUD)

Count: 8 HAVE, 16 PARTIAL, 13 MISSING. Chewbacca runs 24 daemon services, and most
are plumbing. Phil runs 47, and most of his are business jobs.

## The structural gap

Phil's whole company is one readable file, and his schedule comes from it.
Chewbacca's schedule is 24 JSON files in ~/.chewbacca/daemon/services/ that nobody
sees together. The move is an org chart file (role, skills, cadence, services
needed) that a setup interview writes. chewbacca-daemon registers the jobs from
it, and a renderer draws the one-page chart.

Phil also approves every word that leaves. Caleb's own setup sends on its own
([[feedback_agents_send_by_default]]). For other users that probably means a send
setting per role. Still undecided.

## The OS competitors (checked 2026-10-25)

- Omarchy (omarchy.org, DHH, 37signals, Omacom Foundation): Arch + Hyprland, v4.0.6,
  1.3M ISO downloads in year one, 45.7k stars. The default agent is picked at first
  boot (Claude Code, Codex, Copilot CLI and about 10 more), and
  `omarchy default agent` installs it if missing. A top-bar panel shows each
  agent's 5-hour and weekly limits. It supports multiple accounts per agent with
  auto-switch at 95%. Crash dumps from systemd-coredump go to the agent with a
  diagnose-crash skill. The Omarchy skill is symlinked into ~/.claude/skills,
  ~/.codex/skills and others. Agents run auto-approve. Theme changes sync into the
  agents. On a Mac it only runs in a VM.
- Shadowfetch: Mission Control shows what changed, which tests ran and the output,
  then waits for approval. Fire mode is online cloud agents, Ice is offline,
  and Firebreak limits the agent to the project plus the files the task needs.
- MakuluLinux Electra: a floating command bar, a self-hosted backend, and a local
  model when offline.
- Gnoppix: air-gapped local Mistral 7B, no telemetry.
- Linux-AI OS: a Cinnamon assistant.
- MAGI OS: Ollama + Whisper, abandoned.
- MeghaOS for Mac: the closest thing to Chewbacca on a Mac. It's a native app with a
  local 0.6B model, generative UI and workflows, plus iMessage, Mail, Notes,
  Reminders, Calendar, HomeKit and Shortcuts. It runs as a window, not a desktop.
- Apple `fm` CLI (macOS 27): a free local model in the terminal. Decode runs on the
  Neural Engine, so a Mac Mini matches an M3 Ultra (about 56 tok/s decode). Off the
  shelf, it could handle chewb's cheap classifications once machines are on 27.
- exo: clusters Macs over Thunderbolt 5 RDMA and serves OpenAI, Claude and Ollama APIs.

## First steps when this is picked up

1. Recheck the HAVE/PARTIAL/MISSING list against bin/, skills/ and the daemon
   services, since tools may have landed since then.
2. Ask Caleb which department goes first, and send vs approve for other users,
   each with a take. Proposed: Finance first, since it's all missing and Stripe
   checks are easy to verify.
3. Spec the org chart file and how the daemon registers jobs from it.

Borrow from Omarchy: the usage panel, account auto-switch, crash-to-agent and theme sync.
