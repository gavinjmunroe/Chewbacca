# medha-web

**AI-powered psychiatric telehealth platform.**
SSRIs. ADHD medication. Therapy. Brainspotting. Coaching. Psilocybin. Ketamine. Ayahuasca.

Modeled on the Medvi playbook ($20K startup → $1.8B run rate) but applied to the full spectrum of psychiatric care — not just weight loss.

**Founders:** Sagar Tiwari + Caleb Newton
**Built for:** [Perplexity Billion Dollar Build Challenge](https://www.perplexity.ai/computer/a/the-billion-dollar-build-ZWzIFW.FTaKdLtufMa0yhw)
**Engine:** Perplexity Computer runs core product + operations
**See:** `BILLION-DOLLAR-BUILD.md` for competition submission, 90-day plan, and the five criteria
**Related repos (Medha team on GitHub):** `openvision`, `tizzy`, `perplexity-code`

---

## What Medha Is

Medha is a direct-to-consumer telehealth platform that makes psychiatric medication and mental health treatment accessible with minimal friction. Patients get qualified, get prescribed, and get treated — all from their phone.

**The Medvi lesson:** One person with AI agents and the right infrastructure partners can build a billion-dollar telehealth company. The playbook works. The mental health market is larger, more fragmented, and more underserved than GLP-1s.

**The Medha bet:** Apply that exact playbook to psychiatric care.

---

## Service Lines

### Tier 1: Psychiatric Medication (Cash-Pay Subscription)
- **SSRIs** (Sertraline, Escitalopram, Fluoxetine, etc.) — Depression, anxiety, OCD
- **SNRIs** (Venlafaxine, Duloxetine) — Depression, anxiety, chronic pain
- **ADHD Medication** (Adderall, Vyvanse, Concerta, Strattera, Wellbutrin)
- **Anti-anxiety** (Buspirone, Hydroxyzine) — Non-benzo anxiolytics
- **Sleep** (Trazodone, Hydroxyzine) — Insomnia management
- **Mood stabilizers** (Lamotrigine, Lithium) — Bipolar, mood regulation

### Tier 2: Therapy & Coaching (Insurance + Cash-Pay)
- **Psychiatry consultations** — Medication management with licensed psychiatrists
- **Therapy** — CBT, DBT, ACT via video telehealth
- **Brainspotting** — Trauma processing via licensed brainspotting practitioners
- **Coaching** — Mental performance coaching, life coaching, career coaching

### Tier 3: Psychedelic-Assisted Treatment (Cash-Pay, Regulated Markets)
- **Ketamine-assisted therapy** — At-home sublingual tablets with therapist guidance (legal in all 50 states)
- **Psilocybin therapy** — In regulated states (OR, CO) and international (Jamaica, Netherlands)
- **Ayahuasca retreats** — International partnerships (Costa Rica, Peru, Portugal)
- **MDMA-assisted therapy** — As regulatory landscape evolves
- **Integration coaching** — Pre/post psychedelic preparation and integration

---

## Business Model

### Revenue Streams
```
Tier 1: Medication Subscriptions ────── $79-199/month per patient
Tier 2: Therapy/Coaching Sessions ───── $99-250/session (insurance or cash)
Tier 3: Psychedelic Programs ────────── $500-5,000/program (cash-pay)
```

### Unit Economics (Target)
```
Tier 1 CAC:           $30-60 (social ads, SEO, content)
Tier 1 LTV:           $1,200-2,400 (12-24 month retention)
Tier 1 LTV:CAC:       20-40x
Tier 1 Gross Margin:  60-75% (after provider + pharmacy costs)

Tier 2 CAC:           $50-100 (upsell from Tier 1 + organic)
Tier 2 LTV:           $2,000-6,000
Tier 2 Gross Margin:  40-60% (after provider compensation)

Tier 3 CAC:           $100-300 (high-intent search, referral)
Tier 3 LTV:           $3,000-15,000
Tier 3 Gross Margin:  50-70% (after retreat/program costs)
```

---

## Infrastructure Partners (Outsource Everything)

Following the Medvi model — own the brand, customer relationship, and AI. Outsource everything clinical.

| Function | Partner Category | Examples |
|----------|-----------------|----------|
| **Physician network** | Telehealth staffing | OpenLoop Health, Wheel, SteadyMD |
| **Prescriptions** | E-prescribing | DoseSpot, TruePill |
| **Pharmacy fulfillment** | Mail-order pharmacy | Truepill, Alto Pharmacy, Amazon Pharmacy |
| **Compounding** | Compounding pharmacy | For ketamine: Empower Pharmacy, BelmarPharma |
| **Insurance billing** | Billing/RCM | Candid Health, Waystar, DrChrono |
| **Pre-authorization** | Prior auth automation | Cohere Health, Infinitus AI, Rhyme |
| **Scheduling** | Appointment booking | Acuity, Calendly, Healthie |
| **EHR/Charting** | Electronic health records | Healthie, DrChrono, Elation |
| **Compliance** | HIPAA, DEA, state licensing | Compliancy Group, Accountable |
| **Identity verification** | Patient ID | Persona, Veriff |
| **Payment processing** | Subscriptions | Stripe, Square |

---

## AI Operations (The Medvi Playbook Applied)

### AI Agent Stack
| Function | Tool | Purpose |
|----------|------|---------|
| **Code** | Claude Code | Build and maintain the platform |
| **Copywriting** | Claude | Landing pages, email sequences, ad copy |
| **Ad Creative** | Midjourney, Runway | Visual ads for Meta, TikTok, Google |
| **Customer Service** | Claude + custom agent | 24/7 patient support chatbot |
| **Business Analysis** | Claude + Perplexity | Market research, competitor analysis, metrics |
| **Voice** | ElevenLabs | Phone-based patient intake, follow-ups |
| **Prior Auth** | Custom AI agent | Automate insurance pre-authorization |
| **Provider Matching** | Custom AI agent | Match patients to appropriate providers |

---

## Regulatory Landscape

### Controlled Substances (ADHD meds) — Highest Complexity
- **DEA special registration** required for telehealth prescribing of Schedule II substances
- **State licensing** — providers must be licensed in patient's state
- **Ryan Haight Act** — in-person visit requirements (with telehealth exceptions through 2026)
- **Warning:** Done. and Cerebral both faced criminal charges for ADHD overprescribing. Medha must have robust clinical protocols.

### Non-Controlled Psychiatric Meds (SSRIs, SNRIs) — Moderate Complexity
- **No DEA restrictions** — standard prescribing via telehealth
- **State medical board requirements** — prescriber must hold active license in patient's state
- **Pharmacy verification** — standard e-prescribing to retail or mail-order pharmacy

### Ketamine — Moderate Complexity
- **Schedule III** — can be prescribed via telehealth with appropriate protocols
- **Sublingual/troches** legal for at-home use with practitioner oversight
- **Compounding pharmacy** required for custom dosing
- **Noma Therapy model:** Insurance-covered ketamine therapy (BCBS, UHC, Medicare)

### Psilocybin — State-Specific
- **Oregon** — legal for supervised therapy (Measure 109, operational since 2023)
- **Colorado** — legal for supervised use (Proposition 122, rolling out)
- **International** — Jamaica, Netherlands, Portugal (legal or decriminalized)

### Ayahuasca — International Only
- **Not legal in US** for therapeutic use outside religious exemptions
- **International retreats** — Costa Rica, Peru, Portugal, Brazil
- **Medha role:** Vetting, booking, preparation, integration coaching

---

## Go-To-Market Strategy

### Phase 1: SSRIs + Non-Controlled Meds (Month 1-3)
- Lowest regulatory complexity
- Highest volume market (40M+ Americans on SSRIs)
- Cash-pay subscription: $79/month
- AI customer service, AI-generated ads, automated intake
- Partners: OpenLoop Health (providers), Truepill (pharmacy)

### Phase 2: Therapy + Coaching (Month 3-6)
- Add video telehealth therapy sessions
- Brainspotting practitioners, CBT/DBT therapists
- Insurance billing via Candid Health
- Upsell existing Tier 1 patients

### Phase 3: Ketamine-Assisted Therapy (Month 4-8)
- At-home sublingual ketamine with therapist guidance
- Partner with compounding pharmacy (Empower or BelmarPharma)
- Cash-pay: $500-1,500/program (6 sessions)
- Insurance pathway via Noma Therapy model

### Phase 4: ADHD Medication (Month 6-12)
- Higher regulatory bar (Schedule II, DEA special registration)
- Must ensure robust clinical protocols (avoid Done./Cerebral fate)
- Start with non-stimulant options (Strattera, Wellbutrin, Guanfacine)
- Add stimulants only after compliance infrastructure is bulletproof

### Phase 5: Psychedelic Programs (Month 8-18)
- Oregon psilocybin therapy partnerships
- International ayahuasca retreat vetting and booking
- Integration coaching as core differentiator
- Build the most trusted brand in psychedelic mental health

---

## Repo Structure

```
medha-web/
├── README.md                    — This file (business blueprint)
├── CLAUDE.md                    — Claude Code orientation
├── BILLION-DOLLAR-BUILD.md      — Perplexity competition submission
│
├── platform/                    — [TO BUILD] The Medha web platform
│   ├── landing/                 — Landing pages (Next.js)
│   ├── intake/                  — Patient intake flow
│   ├── dashboard/               — Patient dashboard
│   ├── provider/                — Provider portal
│   └── admin/                   — Admin/ops dashboard
│
├── agents/                      — [TO BUILD] AI agent definitions
│   ├── customer-service/        — Patient support chatbot
│   ├── prior-auth/              — Insurance pre-authorization
│   ├── provider-matching/       — Patient-provider matching
│   ├── intake-screening/        — Clinical screening automation
│   └── ad-creative/             — Marketing creative generation
│
├── infrastructure/              — [TO BUILD] Partner integrations
│   ├── telehealth/              — OpenLoop/Wheel/SteadyMD adapter
│   ├── pharmacy/                — Truepill/compounding adapters
│   ├── billing/                 — Insurance billing/RCM
│   ├── ehr/                     — EHR/charting integration
│   └── compliance/              — HIPAA, DEA, state licensing
│
└── research/                    — Market research and competitive intel
    └── medvi-playbook.md        — Lessons from the Medvi model
```

---

## How This Connects to the Amber Ecosystem

Medha is a **standalone business** but built on the same infrastructure patterns as Amber:

```
Rytual Health (amber-*)   — Personal AI health network
Blue Modern Advisory      — B2B advisory (Togari products)
Medha                     — D2C psychiatric telehealth

All three share:
├── Claude AI stack
├── Similar deployment patterns (Railway, Vercel)
└── Sagar's operational oversight
```

Medha does NOT depend on Rytual Health. It is its own business with its own infrastructure.
