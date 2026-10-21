# Tizzy — Business Model and Go-to-Market

## Business Model

### Principle: Never Sell the Data
The business model is built around not selling user data. This is a constraint, not a marketing line. Every revenue stream is designed to be sustainable without monetizing conversation data, voice patterns, or behavioral signals. If Tizzy cannot survive without data monetization, Tizzy does not deserve to survive.

### Revenue Streams

**Hardware (at cost, V1)**
The pendant is sold at or near manufacturing cost in V1. The goal is to remove price as a barrier to adoption for the target market (autistic college students, many of whom are on fixed financial aid budgets) and to build user base quickly. Hardware margin expands modestly in V2 as manufacturing scales and BOM decreases.

Estimated V1 BOM target: under $65. V1 retail: $89–$99. Margin: intentionally thin.

**Coaching Subscription ($9.99/month or $79/year)**
The subscription unlocks:
- Post-conversation timeline review (basic session end summary is free)
- Weekly trends dashboard
- Unlimited coaching target customization (free tier: one active target)
- SLP export report (PDF, shareable with therapists)
- Priority support and onboarding call

Free tier exists and is functional. The free tier provides real-time haptic coaching and a basic session summary. It is genuinely useful. Subscriptions convert users who have experienced real value, not users locked out of core functionality.

Estimated LTV target (12-month subscription): $120. CAC target (Wave 1): under $40 via disability services channel.

**Clinic Licensing ($299/month per clinic)**
SLP clinics and autism support organizations can subscribe to a Tizzy Clinic plan. This provides:
- Multi-user management dashboard (therapist sees aggregated trends for consented clients, not raw session data)
- SLP coaching integration (therapist can add coaching notes that appear as context in the user's post-session review)
- Clinic-branded onboarding for referred clients
- Bulk device purchasing at clinic discount

The clinic plan is a B2B subscription layered on top of the user subscription. The user's data remains the user's — the clinic sees only what the user explicitly shares.

**Scholarship Pool (10% of subscription revenue)**
Ten percent of monthly subscription revenue is pooled into a scholarship fund. Autistic users who cannot afford the subscription apply through a simple process (no income verification theater — self-attestation with limited spots). Scholarship slots are filled on a rolling basis. This is non-negotiable in the business model and will be reflected in the cap table and operating agreement from day one.

### What Tizzy Will Never Do
- Sell conversation data, voice features, or behavioral profiles to any third party
- Allow employers, schools, or parents to access user data without explicit user consent
- Offer a "family plan" that gives parents monitoring access over adult children or minors without the minor's own account and consent
- Use coaching session data to train third-party models without explicit per-session opt-in and compensation to the contributing user
- Accept advertising revenue tied to user behavior

---

## Go-to-Market

### Wave 1: College Transitions (Months 1–18)
**Who:** Autistic college freshmen and sophomores, ages 17–22, primarily at large research universities with active disability services offices.

**Why now:** The college transition is the single highest-anxiety social inflection point for autistic young adults. Support systems from high school disappear. Social demands spike (roommates, group projects, networking events, office hours). The motivation to improve is acute. The window of intervention is narrow.

**Channel:** University disability services offices (OSAS, DRS, equivalent). These offices actively refer students to supportive technology. A formal referral relationship (not a paid partnership — a service relationship) is the primary channel. Secondary channel: autistic student organizations on campus.

**Strategy:** 
1. Identify five universities with strong autism support programs and active disability services (UCLA, UT Austin, Ohio State, UNC, Michigan are targets).
2. Place ten devices per campus, free, with five beta testers in a structured 90-day study.
3. Publish anonymized outcomes data from the study. The data is the marketing.
4. Use outcomes data to formalize referral relationships with disability services.

**Metrics:** 30-day retention > 70%, subscription conversion > 25% of active users, NPS > 60.

### Wave 2: Therapy and SLP Integration (Months 12–30)
**Who:** Speech-Language Pathologists working with autistic adolescents and adults. Autism-specialized therapists and behavioral coaches.

**Why:** SLPs are the primary professional channel for conversation skills intervention with autistic clients. If Tizzy is useful to their clients between sessions, SLPs will recommend it — and eventually integrate it into their practice workflow (clinic plan).

**Channel:** SLP professional organizations (ASHA), autism conference speaking slots, SLP Facebook groups and subreddits, direct outreach to autism-specialized private practices.

**Strategy:**
1. Ship SLP export report feature (PDF summary of 30-day trends, in clinical language).
2. Offer free clinic plan to five SLP practices in exchange for structured feedback.
3. Build an ASHA-accredited CE module around Tizzy's coaching taxonomy (content marketing + credibility).

**Metrics:** Clinic plan conversion > 5% of SLPs who try the tool, 30-day client retention in clinic cohort > 80%.

### Wave 3: Parent-Driven (Months 24–36)
**Who:** Parents of autistic teenagers (13–17) seeking coaching tools outside clinical settings.

**Why:** Parents are highly motivated buyers. They will pay a premium for tools that their teenagers will actually use. The risk is building a monitoring tool rather than a coaching tool — which would destroy user trust and contradict the product's values.

**The constraint:** Tizzy for adolescents requires a separate account structure where the teenager is the primary user and the parent has visibility only into aggregate trends (not session-level data) and only with the teenager's explicit ongoing consent (not a one-time signup consent). This is non-trivial to build correctly. It is not launched until the consent architecture has been audited externally.

### Wave 4: Schools (Months 36+)
**Who:** School districts, special education programs, autism support classrooms.

**Why:** Scale. Schools represent enormous reach.

**Why last:** Schools require FERPA compliance, district IT approval, IEP integration, union considerations, and a governance model for student data that does not yet exist in this product category. Launching in schools before the governance is proven is how you destroy trust with the entire autistic community in a single news cycle.

**Commitment:** Tizzy will not pursue school contracts until:
1. The product has at least 18 months of real-world privacy track record
2. An external privacy audit has been completed and published
3. Autistic-led advocacy organizations have reviewed and endorsed the school governance model
4. A student-specific data architecture has been built, audited, and documented

---

## Competitive Landscape

### Friend Pendant (Cautionary Tale)
The Friend pendant was an always-wearable AI companion device. It was marketed as a social AI that would help you in conversations. It failed for several reasons: the core value proposition was a parasocial AI relationship (not a coaching tool), the privacy architecture was opaque, and the device leaked user conversation data in multiple well-documented incidents. Tizzy's differentiation: skill coaching, not companionship. Local processing, not cloud. Privacy architecture as a feature, not an afterthought.

The Friend case is a template for what not to do. Study it carefully. Do not repeat any of it.

### Limitless Pendant (Adjacent, Not Direct Competitor)
Limitless (formerly Rewind) built a wearable AI pendant focused on meeting transcription and personal memory augmentation. It is primarily a productivity tool for neurotypical knowledge workers. It operates in the cloud. It competes on meeting recall, not conversation coaching. The target market overlap with Tizzy is minimal. The privacy architecture difference is significant — Limitless stores audio in the cloud with consent, Tizzy does not store audio at all.

Limitless is useful to monitor as a hardware precedent (form factor, BLE pairing, app experience) and as a distribution cautionary tale (they serve a broad market with low urgency; Tizzy serves a specific population with acute need).

### Amazon Bee (Acquisition Risk)
Amazon acquired a conversational AI wearable startup (referred to here as "Bee") in 2024. The acquisition signals that large platforms are watching the always-on conversational AI wearable space. Amazon's strategic interest is device ecosystem lock-in and conversational data. Tizzy's differentiation: the data never leaves the user's device, which makes Tizzy unsuitable as an acquisition target for any company whose business model depends on data. This is a feature for users and for the founding team's integrity — not a bug.

### No Direct Competitor (Yet)
There is no product that combines: (1) always-wearable pendant form factor, (2) real-time haptic coaching, (3) autism-specific taxonomy, (4) local-only processing, and (5) post-session timeline review. This combination is the product. Any competitor entering this space from the autism support side will be building clinical tools with clinical UX (boring, not wearable). Any competitor entering from the AI wearable side will build for neurotypical productivity and get the autism coaching taxonomy wrong.

The window is approximately 18–24 months before a well-resourced competitor can replicate the core experience. The moat after that window is: user data continuity, the autistic speech dataset, and the clinical relationships built during Wave 2.

---

## Ruthless V1 Feature Set

What is in V1 (no exceptions, no additions):
- Real-time haptic coaching (three patterns, two active targets max)
- Session end basic summary (free)
- Post-session timeline review (subscription)
- Weekly trends dashboard (subscription)
- One-tap session deletion
- Hard mute physical button
- BLE-only sync (no cloud)
- SLP export PDF (subscription)

What is explicitly NOT in V1 (no matter how many people ask):
- Voice playback or transcription of any kind
- Multi-user or family accounts
- Cloud sync or backup
- Android support
- School or institutional accounts
- Any sharing feature
- In-app messaging with Tizzy team
- AI chat interface
- Custom vibration pattern creation
- Location-based features of any kind
- Integration with any third-party app (calendar, health, Todoist, etc.)

The V1 feature set is small enough to build with a team of three in six months. Every item on the "not in V1" list is a distraction until the core loop is proven.
