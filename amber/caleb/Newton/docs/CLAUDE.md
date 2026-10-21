# Claude Code: medha-web

## What This Is
Medha is a D2C psychiatric telehealth startup built for the Perplexity Billion Dollar Build Challenge. Think Medvi ($1.8B GLP-1 business, 2 employees, AI-powered) but for psychiatric medication and mental health treatment.

## Founders
- **Sagar Tiwari** — Stanford GSB, Rytual Health founder
- **Caleb Newton** — Built amber-caleb (iMessage agent, 250K+ msgs, Loop Message SDK, 80 AI tools)

## Competition Criteria (from Perplexity)
1. **Massive Market** — $240B mental health, 40M+ Americans on SSRIs
2. **Computer is the Engine** — Computer runs intake, matching, pre-auth, customer service, marketing, analytics
3. **Real Traction** — Paying customers by submission day (90-day plan in BILLION-DOLLAR-BUILD.md)
4. **Wild Economics** — Competitors need 50-500 people; Medha needs 2 + Computer
5. **Founder-Market Fit** — Sagar (health + ops) + Caleb (engineering + AI agents)

## Service Lines
1. **Psychiatric medication** (SSRIs, ADHD meds, SNRIs, mood stabilizers) — cash-pay subscriptions
2. **Therapy & coaching** (CBT, DBT, brainspotting, coaching) — insurance + cash
3. **Psychedelic-assisted treatment** (ketamine, psilocybin, ayahuasca) — cash-pay, regulated markets

## Key Principle
Own the brand, customer relationship, and AI. Outsource everything clinical to infrastructure partners (OpenLoop Health for providers, Truepill for pharmacy, etc.).

## Related Repos (Medha team on GitHub)
- `openvision` — Apple Vision Pro spatial computing in browser (Next.js, Vercel)
- `tizzy` — Wearable conversation coach for autism (React Native + Next.js)
- `perplexity-code` — Perplexity coding agent CLI tool

## Key Files
- `README.md` — Full business blueprint
- `BILLION-DOLLAR-BUILD.md` — Competition submission + 90-day plan
- `research/medvi-playbook.md` — Lessons from the Medvi model
- `agents/` — AI agents (intake, customer service, prior auth, ads, provider matching)
- `platform/` — Next.js apps (landing, admin, provider, intake, dashboard)
- `infrastructure/` — Partner integrations (telehealth, pharmacy, compliance, EHR, billing)

## Development
The platform will be built in `platform/` using Next.js. AI agents in `agents/`. Infrastructure adapters in `infrastructure/`.

## Regulatory Warning
ADHD stimulants are Schedule II controlled substances. Done. and Cerebral faced criminal charges for overprescribing. Medha must have bulletproof clinical protocols before touching stimulants. Start with SSRIs (non-controlled).
