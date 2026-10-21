# Story — Platform Mechanics

## Content Primitives

Story supports three and only three types of content. This is a hard constraint. Story does not support short-form posts, photos, videos, Reels, Stories (the Instagram kind), or ephemeral content.

### 1. Story Card (250–900 words)

The primary content format. A Story Card is a written post between 250 and 900 words. Both limits are enforced by the UI.

- **Minimum (250 words)**: Enforces the reflection requirement. Below 250 words is a tweet. A tweet is not a Story. The minimum exists to make broadcasting a hot take structurally impossible.
- **Maximum (900 words)**: Enforces focus. A Story Card is not an essay or a manifesto. It is a thought, developed. The maximum prevents it from becoming a lecture.

Story Cards are the primary response to the daily prompt. They are also the only way to post to the Discovery Feed.

Format constraints:
- Plain text only in the base tier (no images, no embeds)
- Optional single image attachment in premium tier (not as the post — as a supplement)
- No formatting beyond paragraph breaks and basic markdown (bold, italic, headers)
- Author name always shown (no anonymous Story Cards)

### 2. Voice Story (90 seconds – 6 minutes)

A Voice Story is an audio recording. Voice is the closest thing to human presence — it carries tone, hesitation, warmth, and genuine personality in a way that text cannot fully capture.

- **Minimum (90 seconds)**: Prevents one-word audio reactions. A Voice Story requires sustained thought.
- **Maximum (6 minutes)**: Keeps it listenable. Six minutes is roughly 900 words spoken at a comfortable pace — the audio equivalent of a Story Card.

Voice Stories are used for:
- Responding to a daily prompt in spoken form (for users who process better out loud)
- Adding audio context to a text Story Card
- Sharing within a Circle where the relationship is close enough that voice feels right

Voice Stories are not podcasts. They are not produced. They are not edited. The deliberate informality is the point.

Technical constraints:
- Recorded in-app only (no upload from files — prevents pre-produced content)
- No editing beyond trimming silence at start/end
- Plays inline in the feed without autoplay

### 3. Proof Story

A Proof Story is a structured format for sharing real-world evidence of a claim or experience — not an argument, but documentation. Examples:

- A student sharing the result of a social experiment they ran for class
- A user documenting a habit they committed to in a previous Story Card
- A Circle member following up on a decision they wrote about a month ago

Proof Stories include:
- A brief summary (under 100 words)
- Supporting evidence (up to 3 images, a data table, or a linked external source)
- A tie-back to a previous Story Card or Circle thread

Proof Stories are the platform's mechanism for accountability and follow-through. They close loops. They reward people who do what they said they would do.

---

## Anti-Short-Form Stance and Design Enforcement

Story is explicitly anti-short-form. This is not a preference — it is a structural product decision enforced through design mechanisms.

### Why Anti-Short-Form?

Short-form content (tweets, TikToks, Instagram Reels, Threads posts) optimizes for reaction, not reflection. The shorter the format, the more it rewards:
- Hot takes over developed positions
- Emotional provocation over reasoned argument
- Performative identity over genuine thought
- Volume of output over quality of any individual post

Short-form mechanics produce short-form thinking at scale. Story is built on the opposite premise: that the act of writing or speaking at length forces the kind of processing that produces genuine insight, and that the act of reading or listening at length produces genuine understanding.

### Design Enforcement Mechanisms

The anti-short-form stance is not enforced by content moderation — it is enforced by structural design:

**Word count minimums**: The UI will not let you post below 250 words. The "Post" button is grayed out and disabled. A live word counter shows progress toward the minimum. There is no override, no "post anyway" button.

**Voice duration minimums**: Voice Stories below 90 seconds cannot be submitted. A timer shows elapsed time. Stopping early cancels the recording.

**No caption-only image posts**: Images without substantive text context cannot be posted. Story is not Instagram.

**No reposts without commentary**: There is no equivalent of a retweet or share without context. If you want to surface someone else's Story Card, you quote it with your own 250-word minimum response.

**No reactions without text**: There is no like button. The only available response to a Story Card is a written reply (minimum 50 words for replies, shorter than original posts to keep the barrier manageable) or a Voice Story reply.

**Rate limiting**: You can post one Story Card per 24 hours. This is the single most important anti-broadcast mechanism. It prevents the platform from being used as a content stream and forces each post to matter.

---

## Two-Feed Structure: Circle Feed + Discovery Feed

Story uses two distinct feeds, not one. The split is 50/50 in terms of the user's attention, but the mechanisms are entirely different.

### Circle Feed

- Shows content only from people in the user's Circle(s)
- Chronological order — no algorithm
- Every post is shown; there is no filtering based on predicted engagement
- Posts from Circle members who have not been replied to in 7+ days are highlighted with a gentle nudge
- Circle Feed is always available — it is the first tab

The Circle Feed is the core social experience. It is where genuine relationships are maintained. It is where the daily prompt responses live. It is small, known, and real.

### Discovery Feed

- Shows content from outside the user's Circles
- Curated by editorial staff + community trust signals (not engagement metrics)
- Explicitly designed to surface perspectives different from the user's existing network
- Only unlocked after the user has engaged with their Circle that day (read + replied to at least one Circle post)
- Sorted by recency within curated categories, not by predicted engagement

The Discovery Feed is the exploration layer. It is how users find people worth inviting to a Circle. It is how the platform surfaces intellectual diversity without an algorithm optimizing for outrage.

**Why 50/50?**
An entirely Circle-based feed becomes an echo chamber because you chose who is in your Circle. An entirely algorithmic feed becomes an outrage amplifier. The 50/50 split is structural anti-echo-chamber design. You must engage with people you know before you get access to perspectives you do not know. The order matters.

---

## Replacing Likes with Impact Signals

Story has no like button. No heart. No thumbs up. No reaction emoji. These are banned by design, not policy.

Instead, Story tracks five impact signals internally. These signals are used to determine Circle health and Discovery Feed curation, but they are NEVER shown to users as public counts or scores.

### Impact Signal 1: Completion Rate
What percentage of Circle members who started reading a Story Card finished it? A completion rate near 100% signals high-quality content. This is analogous to YouTube's "average percentage viewed" — a measure of whether the content earned sustained attention.

### Impact Signal 2: Dwell Quality
How long did readers spend on the post relative to its word count? A post that takes 4 minutes to read but receives 30 seconds of attention was not actually read. Dwell quality detects skimming versus genuine reading.

### Impact Signal 3: Reflection Reaction
Did reading the post cause the reader to write something? Did it prompt a Voice Story reply? Did it trigger a new Story Card within 24 hours on a related topic? Reflection reactions measure whether content produced genuine cognitive engagement.

### Impact Signal 4: Reply Depth
How substantive were the replies? A one-sentence reply ("great post!") scores lower than a multi-paragraph engagement. Reply depth is measured by word count and by whether the reply introduced new ideas not present in the original post.

### Impact Signal 5: Reciprocity Score
Did the original poster read and reply to their Circle's posts in return? Reciprocity is the master signal. A user who writes prolifically but never reads or responds is not a good Circle member, regardless of how high their other signals are. Reciprocity score weights all other signals.

### Why Not Show These Scores?

Public metrics create status competition and gaming. If users can see their completion rate, they will optimize for it — writing cliffhangers and manipulative hooks rather than honest reflection. If users can see their reciprocity score, they will perform reciprocity (short replies, checking the box) rather than genuine engagement.

The signals exist to make the platform better. They do not exist to reward users for performing for an audience.

---

## Anti-Echo-Chamber Constraints

Story is structurally designed against homophily (the tendency to cluster with like-minded people):

**Discovery Feed Diversity Requirement**: At least 30% of Discovery Feed content must come from users whose Circle networks do not overlap with the reader's. Implemented via graph distance scoring.

**Prompt Universality**: The daily prompt is the same for every user on the platform. It creates shared context across communities that would otherwise never interact.

**Cross-Campus Discovery**: Premium users can access Discovery Feed content from other campuses. This is the geographic version of the diversity requirement.

**Reply Surfacing**: When a Story Card in the Discovery Feed receives substantive replies, the best reply is surfaced alongside the original post. This means you see both the idea and the pushback on the same screen.

**No Trending Lists**: There are no trending topics, no trending posts, no "what's popular" feeds. Trending mechanics amplify whatever is generating the most reaction at any given moment — which is usually outrage. Story does not surface trends.

---

## Verification System

### Phase 1: Face Verification (Remote)

At sign-up, every user completes:
1. Government-issued ID scan (passport, driver's license, or national ID)
2. Liveness check (short selfie video that cannot be spoofed by a static image)
3. Age verification (18+ required in Phase 1)

The verification is handled by a third-party identity verification provider (e.g., Persona, Onfido, or similar). Story stores only a verification token, not the raw biometric data. The verification result: real human, unique, adult.

One-person-one-account is enforced by biometric uniqueness. Attempting to create a second account with the same biometric triggers a block and flags the original account for review.

### Phase 2: In-Person Verification (Campus)

The highest trust tier requires in-person verification at a Story Verification Pop-Up event on campus. The process:
1. Show university ID at the pop-up
2. Brief face-to-face liveness check with a Story staff or trained campus partner
3. Receive a "Campus Verified" badge on the account

Campus Verified users have access to campus-exclusive Circles and Circle categories. Their posts are weighted more heavily in Discovery Feed curation. In-person verification creates a layer of community trust that remote verification cannot fully replicate.

### Ongoing Verification Integrity

- Accounts flagged by multiple Circle members for suspected bot behavior are reviewed
- Behavioral anomalies (posting patterns inconsistent with human usage, copy-paste content) trigger review
- The "No AI Content" policy is enforced via a combination of AI detection tools and community reporting — with the understanding that no detection tool is perfect, and the community reporting layer is the primary enforcement mechanism

---

## No AI Content Policy

Story's no-AI-content stance is a brand pillar, not a content moderation afterthought. Implementation:

**At posting**: A declaration is required before every post — a single-tap acknowledgment that the content was written by the user and not generated by AI. This is not a lengthy legal disclaimer. It is a one-sentence human affirmation that takes one second and creates intentional accountability.

**Detection layer**: AI-generated text detection tools run on all posts. Flagged posts are queued for human review before publication.

**Community reporting**: Any Circle member can flag a post as suspected AI-generated. Flagged posts are hidden from the Circle Feed pending review. Repeated flagging of the same user triggers escalated review.

**Enforcement**: First confirmed violation: 7-day suspension and mandatory re-verification. Second confirmed violation: permanent account termination with no appeal.

**Tone**: The policy is communicated as a community commitment, not a legal requirement. "Story is a space for human voices. AI-generated content is not welcome here — not because we think AI is bad, but because this space is specifically for what humans think." The framing matters.
