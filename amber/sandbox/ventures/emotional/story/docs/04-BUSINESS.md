# Story — Business Model and Metrics

## Monetization Philosophy

Story's business model is constrained by its product philosophy. The constraint: the monetization mechanism cannot create incentives that conflict with the platform's core commitments (human verification, no dopamine, anti-AI, anti-polarization). This rules out:

- **Advertising**: Ad revenue requires maximizing engagement to sell attention. Engagement maximization produces infinite scroll, outrage amplification, and algorithmic manipulation. Incompatible.
- **Data selling**: Selling user data to third parties violates the trust relationship. If users are the customers, selling their data makes them the product. Incompatible.
- **Premium engagement features**: Any premium feature that amplifies reach, virality, or follower count creates a two-tier system where money buys social status. Incompatible.

What remains: **subscription revenue from users who want more depth, not more reach.**

---

## Monetization Tiers

### Tier 0: Core (Free)

Everything required for the core loop is free. A user can:
- Create a verified account
- Join up to 2 Circles
- Post one Story Card per day (250–900 words)
- Record one Voice Story per day (90s–6min)
- Access Circle Feed and Discovery Feed
- Reply to Circle posts
- Submit and read daily prompts
- View their own Circle health indicators (not scores, just health signals)

The free tier is the full product. Premium is not required to participate meaningfully. This is critical — a platform that requires payment for basic participation cannot achieve the community density required to make the product valuable.

### Tier 1: Story Premium ($8/month or $72/year)

Premium unlocks depth features only. No feature in the premium tier amplifies reach, accelerates engagement, or creates status signaling.

**What premium unlocks:**

| Feature | Description |
|---|---|
| Extended Story Cards | Up to 2,000 words (vs. 900 word cap in free tier) |
| Single image attachment | Add one image to a Story Card as supplementary context |
| Archived Prompts | Access the full archive of past daily prompts and write late responses |
| Circle expansion | Join up to 5 Circles (vs. 2 in free tier) |
| Cross-campus Discovery | Discovery Feed includes content from other campuses, not just your own |
| Weekly Chapter digest | Personalized weekly email summarizing your Circle's week and highlights from Discovery |
| Voice Story playback speed | 1x, 1.25x, 1.5x playback speed control |
| Circle analytics (private) | Personal dashboard showing your own reciprocity patterns, completion rates, dwell time — visible only to you |
| Priority human support | Faster response on verification issues, account review, appeals |

**What premium does NOT unlock:**
- Larger audience
- Algorithmic boost in Discovery Feed
- Public metrics (engagement counts, follower counts)
- Ability to post more than one Story Card per day
- Bypass of verification requirements
- Access to analytics about other users

### Tier 2: Story Scholarship (Free)

For users who cannot afford premium but demonstrate financial need. Scholarship access is:
- Automatically available to students who verify via an institution with a need-based aid population above a threshold
- Available via direct application for non-students
- Full premium access without payment
- Not publicized within the app (scholarship users are not identifiable from their profile)

The scholarship program is funded by a percentage of premium revenue and by an optional "pay-it-forward" mechanism where premium subscribers can contribute additional scholarship slots.

---

## North Star Metric: Meaningful Reciprocity Rate (MRR)

Story's north star metric is the **Meaningful Reciprocity Rate (MRR)**.

**Definition**: The percentage of active users who, in a given 7-day period, (a) posted at least one Story Card or Voice Story AND (b) wrote substantive replies (50+ words, introducing new ideas) to at least two other Circle members' posts.

**Why this metric?**

Every metric a platform optimizes for shapes the platform. Optimizing for DAU produces infinite scroll and notification spam (maximize returns). Optimizing for content volume produces broadcast culture. Optimizing for engagement produces outrage amplification. Optimizing for MRR produces genuine reciprocal conversation.

MRR is high only when:
- Users are posting (they find value in the platform)
- Users are reading their Circle (they trust the content)
- Users are replying with substance (they are genuinely engaged, not performing)

MRR is resistant to gaming in a way that simpler metrics are not. You cannot inflate it by posting more (you can only post once per day). You cannot inflate it by harvesting likes (there are no likes). You cannot inflate it by going viral (virality is not a mechanism). The only way to improve MRR is to make the product genuinely more valuable for genuine conversation.

**Target MRR**: 60%+ among users active for 30+ days. (Baseline hypothesis; to be validated in pilot.)

---

## Supporting Metrics

### Health Metrics (Internal Only)

| Metric | Definition | Target |
|---|---|---|
| Circle Retention Rate | % of Circles that have at least one post and one reply from 80%+ of members in any given week | 70%+ |
| Verification Completion Rate | % of sign-up starts that complete verification | 65%+ |
| Discovery Unlock Rate | % of daily active users who unlock the Discovery Feed (meaning they completed Circle engagement first) | 75%+ |
| Voice Story Completion | % of Voice Story plays that reach 80%+ of duration | 60%+ |
| Reply Depth Score | Average word count of replies, platform-wide | 80+ words |
| Prompt Response Rate | % of active users who post a Story Card on any given day | 40%+ |

### Growth Metrics

| Metric | Definition | Notes |
|---|---|---|
| Campus Density | % of total student population at a given campus who are verified Story users | Target: 15% density before expanding to next campus |
| Circle Formation Rate | Average number of Circles joined per user in first 30 days | Target: 1.5 Circles |
| Network Bridging | % of users who are in at least one Circle with someone from a different department/major/background | Anti-echo-chamber health signal |
| Waitlist-to-Verified Conversion | % of waitlist signups who complete verification | Target: 50%+ |

### Business Metrics

| Metric | Definition | Target |
|---|---|---|
| Free-to-Premium Conversion | % of active users who convert to premium within 60 days | 8-12% (benchmarked against Spotify) |
| Premium Retention | Month-over-month retention of premium subscribers | 85%+ |
| Scholarship-to-Premium | % of scholarship users who convert to paid premium within 12 months of financial eligibility | 30%+ |
| CAC (Campus) | Cost per verified user acquired via campus activation | Target: under $15 |
| LTV (Estimated) | Average lifetime value of a premium subscriber | Target: $150+ (18+ months at $8/month) |

---

## Failure Modes and Mitigations

### Failure Mode 1: Verification Kills Adoption

**The risk**: The friction of face verification causes sign-up abandonment rates above 50%, preventing the platform from reaching density at any campus.

**Indicators**: Verification completion rate below 40%; campus density stalling below 5%.

**Mitigations**:
- Simplify the verification UX — onboarding should take under 3 minutes from download to first post
- Offer university email verification as a bridging mechanism (not a replacement for biometric verification, but a way to let users into a "pending verification" zone where they can see the platform while completing the full process)
- In-person verification pop-ups as an alternative path (some users prefer this over remote digital verification)
- Build verification into campus partner activations so the social pressure of "your friends are doing it" accompanies the friction

### Failure Mode 2: No-Dopamine Becomes Boring

**The risk**: Without likes, streaks, follower counts, and notification spikes, users find the platform flat and stop returning. MRR is high among power users but daily active engagement is low.

**Indicators**: D7 retention below 30%; prompt response rate below 20%; average session length declining after week 2.

**Mitigations**:
- The weekly chapter digest (premium feature, potentially free for all) provides a ritual return trigger that is not dopamine-based — it is anticipation of a meaningful summary
- Circle health nudges give users a low-pressure reason to return ("your Circle hasn't heard from you this week")
- The daily prompt itself is the primary retention mechanism — a good prompt creates genuine curiosity about what Circle members will write. Prompt quality is a product priority, not a content afterthought.
- Community events (a special prompt themed to a campus event, a Circle reading challenge) provide non-dopamine engagement spikes

### Failure Mode 3: Quality Collapse

**The risk**: As the platform scales, the average quality of Story Cards declines. Users start writing the minimum 250 words of nothing. Circle conversations become hollow. Discovery Feed fills with content that meets technical requirements but lacks genuine substance.

**Indicators**: Dwell quality scores declining; reply depth scores declining; Circle retention rate declining.

**Mitigations**:
- Editorial curation of the Discovery Feed is the primary quality gate — human editors (initially Story staff, eventually trained community curators) select what surfaces
- Circle health scoring surfaces and gently flags low-engagement Circles, prompting users to refresh their composition
- The minimum word count is a floor, not a quality signal — it prevents the worst case but does not guarantee quality. The real quality mechanism is reciprocity: if you write lazily, your Circle will reply lazily, and you will feel the difference

### Failure Mode 4: Anti-AI Enforcement Fails

**The risk**: AI detection tools are imperfect. Sophisticated users find ways to post AI-generated content that passes detection. The brand promise ("everything here is human") erodes.

**Indicators**: Community reports of suspected AI content increasing; AI detection confidence scores declining on flagged posts.

**Mitigations**:
- The community reporting layer is the primary enforcement mechanism — no AI tool is as good as a human reader who knows the community
- The pre-post human affirmation creates legal and moral accountability that detection cannot
- Public, visible enforcement actions (not named individuals, but "X accounts terminated this month for AI content policy violations") signal that enforcement is real
- Invest in partnerships with AI content detection research as the state of the art improves

### Failure Mode 5: Circles Become Cliques

**The risk**: The Circle model creates tight in-groups that are warm internally but cold to newcomers. New users cannot find the right Circles and churn. The platform balkanizes into fixed groups with no circulation.

**Indicators**: New user Circle formation rate below 1.0; average Circle age increasing month-over-month; new user D30 retention below 20%.

**Mitigations**:
- Campus activation events are specifically designed to create cross-group Circles at launch
- Discovery Feed functions as the "how you find your next Circle" mechanism
- Campus partner organizations (clubs, dorms, cohorts) provide organic Circle formation paths for new users
- "Open Circles" (up to 30 members, invitation-open within a campus) are a permitted format for larger communities like a class or a club

---

## Potential Pivots That Keep the Soul Intact

If the platform needs to evolve, these pivots are compatible with Story's core values:

**Pivot 1: B2B Campus Licensing**
License Story's verified-human community platform directly to universities as a replacement for clunky institution-built campus apps. The university pays, the students get free premium access, Story gets a predictable revenue stream. Does not require ads or data selling.

**Pivot 2: The Civic Lane (CivicQ Integration)**
Expand into verified civic engagement: politicians answer questions from verified human constituents. The civic lane was the original CivicQ concept. It is compatible with Story's verification infrastructure and anti-manipulation values. Adds a public-facing, high-trust use case that could drive national press and policy attention.

**Pivot 3: Workplace Circles**
Offer Story's Circle mechanics to teams inside organizations as a replacement for performative Slack culture. Private, premium, employer-sponsored. Keeps the human verification requirement (employment verification), keeps the no-dopamine design, adds a B2B revenue stream.

**Pivot 4: Story for Alumni Networks**
As campus users graduate, their university ties persist. An alumni Circle tier keeps the community alive post-graduation and creates a multi-generational network. Could be a premium university partnership feature.

All four pivots maintain: verified humans, no ads, no data selling, reciprocity as core loop, anti-AI content stance.
