# Story — Product Roadmap

## Overview

Story's roadmap is structured in four phases, each with a clear definition of done before the next phase begins. The phases are not time-boxed arbitrarily — they are milestone-gated. Phase 0 must achieve real user interest before Phase 1 begins. Phase 1 must achieve campus density before Phase 2 begins.

The guiding principle: **build only what is necessary for the current phase, validate the hardest assumption at each phase before building the next layer.**

---

## Phase 0: Pre-Launch (2–6 Weeks)

**Goal**: Validate demand before building product. Confirm that real humans at real campuses want a verified-human social platform with Story's constraints.

**Definition of Done**: 500+ waitlist signups from at least 3 campuses, with at least one campus partner committed to a launch activation event.

### Phase 0 Deliverables

**Landing Page**
- Single-page site at story.social (or equivalent)
- Headline: "Social media rebuilt for humans."
- Subheadline: "Verified humans only. No AI. No ads. No infinite scroll."
- Brief product description: what Story is, what it is not, and why it exists
- Email waitlist capture with campus/school field
- "Join the waitlist" CTA as the only action
- Reference to the founding story (Caleb + Isaac, USC, the problem we are solving)
- Accessible on mobile (many signups will come from phone)

**Waitlist System**
- Email capture with confirmation email
- Campus tagging so we can see which universities are most represented
- Optional "how did you hear about us" field
- Referral mechanism: share your waitlist link, earn priority access (standard referral loop, does not require building a product)

**3–5 Campus Pilots**
- Identify at least 3 campuses with a campus champion (student leader, professor, club officer)
- Champions are briefed on the concept and willing to actively recruit within their community
- At least one campus should be USC (founder network) and at least one should be a non-USC campus to test transferability
- A pre-launch Discord or group chat for campus champions to coordinate

**Pre-Launch Content**
- A brief founder essay published publicly explaining why Story exists (posted to Medium, Substack, or equivalent)
- Social posts from personal accounts of Caleb and Isaac explaining the concept (not from a brand account — the founders are the early brand)
- Outreach to 5–10 journalists or writers who cover tech criticism, social media, and attention economy topics

### Phase 0 — Biggest Assumption to Validate

"Students at real campuses want a more effortful, friction-filled social platform with stricter constraints than anything they currently use."

If the waitlist does not grow organically (via word-of-mouth and the founder essay, not paid ads), the concept needs to be re-examined before building.

---

## Phase 1: Campus MVP (8–12 Weeks)

**Goal**: Ship a functional, real product that can support 100–500 users at one campus living the full Story core loop.

**Definition of Done**: 200+ verified users at one campus with a 7-day MRR above 45% for users who have been active for 14+ days.

### Phase 1 Feature Set (MVP — Build Only This)

**Must-Have (Ship Without These, No Launch):**

| Feature | Description |
|---|---|
| Verified Sign-Up | Face verification via third-party provider (Persona or Onfido). Government ID + liveness check. One-account-per-person enforcement. |
| Profile | Name, campus, one-sentence bio. No follower count. No profile stats. Photo (required, tied to verification). |
| Circle Creation | Create a Circle, invite by username or email. Max 15 members in Phase 1. Accept/decline invitations. |
| Daily Prompt | One prompt served to all users each morning. Prompt visible on home screen. Archive of last 7 days. |
| Story Card Posting | 250–900 word text post. Word count enforced. Pre-post human affirmation required. Posts to your Circles by default. |
| Circle Feed | Chronological feed of your Circles' posts. No algorithm. Every post shown. |
| Reply System | Written replies to Story Cards. 50-word minimum. Threaded within the original post. |
| Voice Story | In-app recording. 90s–6min. No upload from files. Plays inline. |
| Discovery Feed | Manual-curated by founders/team in Phase 1. Unlocks after one Circle interaction per day. |
| Moderation Queue | Internal tool for Story team to review flagged posts. |
| AI Content Detection | Run on all posts pre-publish. Flagged posts held for review before going live. |
| Community Reporting | Any user can flag a post. Flagged posts hidden pending review. |
| Basic Notifications | Circle post notifications (daily digest, not per-post spam). Reply notifications. Prompt reminder (one per day). |

**Should-Have (Ship If Time Allows):**

| Feature | Description |
|---|---|
| Circle Health Indicator | Personal, private signal visible only to the user showing their reciprocity engagement. |
| Weekly Chapter Email | Friday digest of the week's Circle activity. Opt-in. |
| Proof Story format | Structured format for documenting real-world follow-through. |
| Campus-bound Circle categories | Pre-made Circle categories for common campus structures (class cohort, dorm floor, club). |

**Do Not Build in Phase 1:**

- Cross-campus discovery
- Premium tier (validate product before charging)
- Mobile apps (web-first with mobile-responsive design)
- Public profiles or search-by-interest
- Circle analytics dashboard
- Algorithmic anything

### Phase 1 Technology Stack

- **Framework**: Next.js 15 + TypeScript
- **Styling**: Tailwind CSS
- **Database**: Supabase (Postgres + Auth + Storage)
- **Verification**: Persona or Onfido API
- **Voice**: Web Audio API for recording, Supabase Storage for hosting
- **AI Detection**: OpenAI text classifier or Originality.ai API
- **Email**: Resend or Postmark
- **Hosting**: Vercel
- **Analytics** (internal only): PostHog (self-hosted or cloud)

### Phase 1 Campus Activation

Week 1: In-person launch event at the lead campus (USC). Story Verification Pop-Up: set up a table, verify users in person, help people form their first Circles.

Week 2–4: Monitor MRR, Circle health, Discovery unlock rate. Identify which prompts generate the most response. Find the power users and interview them.

Week 4–8: Iterate on the daily prompt format. Adjust Circle size limits based on what health data shows. Fix verification friction points.

Week 8–12: Evaluate Definition of Done metrics. If 200+ verified users and 45%+ MRR, prepare Phase 2 plan.

---

## Phase 2: Viral-by-Community Expansion

**Goal**: Expand to 3+ campuses. Introduce premium tier. Build the mechanisms that let community growth replace founder-driven growth.

**Definition of Done**: 1,000+ verified users across 3+ campuses. Premium conversion rate above 8%. Campus density above 10% at the lead campus.

### Phase 2 Key Initiatives

**In-Person Verification Pop-Ups (Campus Tour)**

Story launches a "Campus Verification Tour" — showing up at 3–5 campuses over 4–6 weeks to run in-person verification events. These events serve multiple purposes:
- Reduce verification friction (in-person is faster than remote digital for many users)
- Generate press and word-of-mouth (a physical event is newsworthy in a way an app update is not)
- Provide the "Campus Verified" badge, which is only available via in-person verification
- Create a shared Story identity moment: everyone who got verified at the same pop-up is connected by that experience

**Story Cafe (Community Event Format)**

Story Cafe is a structured community event — 60–90 minutes, small group (8–20 people), hosted at a coffee shop or campus common area. Format:
- The week's daily prompt is projected on a screen
- Participants share their written or spoken responses out loud
- Facilitated discussion follows
- New Circles often form from Story Cafe attendees

Story Cafe is not a marketing event. It is a product extension into physical space. It demonstrates that the platform's core loop works IRL as well as digitally.

**Premium Tier Launch**

Premium launches in Phase 2, priced at $8/month or $72/year. Launch offer: first 100 premium subscribers get founding member pricing ($60/year forever). Scholarship program activated simultaneously.

**Cross-Campus Discovery Beta**

Premium users gain access to Discovery Feed content from other campuses. This is the first mechanism by which the campuses become networked with each other, not just internally.

**Circle Ambassador Program**

Identify and formalize the role of Circle Ambassadors — highly engaged users (high MRR, active Circles, long tenure) who help onboard new users and facilitate the formation of new Circles. Ambassadors get premium access in exchange for onboarding contribution.

---

## Phase 3: Multi-Campus Network

**Goal**: Build the infrastructure for Story to operate as a genuine multi-campus network — not just separate communities on the same platform, but a network where cross-campus connection is normal and valuable.

**Definition of Done**: 10,000+ verified users across 10+ campuses. Cross-campus Circle formation rate above 15% among premium users. Waitlist demand exceeding current campus supply.

### Phase 3 Key Initiatives

**Cross-Campus Circles**

Allow Circle formation across campuses. A USC student and a UMich student can be in the same Circle. Cross-campus Circles are premium-only to maintain quality control and prevent the cross-campus layer from becoming a general social network before the platform is ready.

**The Civic Lane (CivicQ Integration)**

Introduce a separate, clearly labeled section of Story for civic participation. Verified Story users can pose questions to public figures. Public figures (initially local and campus-level: student government presidents, mayors, local state representatives) can create verified Story accounts and post responses. This is a direct extension of the original CivicQ concept.

**Story for Alumni**

Graduated users keep their Story account. Alumni are given a new verification pathway (alumni email + graduation verification). Alumni Circles bridge generations on the same campus. This creates a long-term retention mechanism and a multi-generational community.

**Platform API and Circle Tools**

Open a limited API for universities to integrate Story into official campus infrastructure. A university might embed a Story Circle into their LMS (learning management system) for a class, or use Story as the discussion platform for a campus speaker event.

---

## MVP Feature Set Summary

The absolute minimum required to launch Phase 1 and be a real product:

1. Face verification (government ID + liveness check)
2. Profile (name, campus, bio, photo)
3. Circle creation and invitation (up to 15 members)
4. Daily prompt (one per day, same for all users)
5. Story Card posting (250–900 words, one per day)
6. Circle Feed (chronological, unfiltered)
7. Reply system (50-word minimum)
8. Voice Story (90s–6min, in-app recording only)
9. Discovery Feed (manually curated in Phase 1)
10. AI content detection + community flagging
11. Basic notification system (daily digest only)
12. Moderation queue (internal tool)

Everything else is Phase 2 or later.

---

## The 5 Biggest Questions to Answer

These are the fundamental unknowns that Story must answer with real data before it can be confident in its approach. Each one is tested in Phase 0 or Phase 1.

**Question 1: Will the verification friction kill adoption?**
Hypothesis: 65%+ of people who start verification will complete it.
Test: Phase 1 sign-up funnel data.
If wrong: Simplify verification UX, explore university email as a bridging mechanism, increase in-person verification options.

**Question 2: Is the daily prompt strong enough to drive return visits?**
Hypothesis: 40%+ of verified users will post a Story Card on any given day within their first 30 days.
Test: Phase 1 prompt response rate data.
If wrong: Iterate on prompt format, experiment with prompt timing (morning vs. evening), allow users to skip days without guilt nudges.

**Question 3: Will Circles actually achieve reciprocity, or will they degenerate into broadcast-and-lurk?**
Hypothesis: 60%+ of active users achieve MRR in weeks 3–8.
Test: Phase 1 MRR data.
If wrong: Reduce Circle size limits, increase reciprocity nudges, introduce Circle health visibility for members (not just the individual user).

**Question 4: Is the no-dopamine design sticky, or does it cause churn at week 2?**
Hypothesis: D30 retention above 40% among verified users.
Test: Phase 1 cohort retention analysis.
If wrong: Introduce non-dopamine engagement mechanisms (weekly chapter, Circle events, themed prompts) faster than planned.

**Question 5: Will the anti-AI brand position attract users or repel them?**
Hypothesis: The waitlist grows to 500+ organically, driven primarily by the anti-AI brand message.
Test: Phase 0 waitlist growth and source attribution.
If wrong: The anti-AI position may be a value held by a smaller audience than believed. Adjust brand emphasis toward "verified humans" and "genuine connection" rather than leading with anti-AI.
