# Tizzy — Full Product Experience

## The V1 Product Loop

### Step 1: Wear It
The Tizzy pendant is a compact disc-shaped device worn on a cord or magnetic clip around the neck, near the collarbone. It is designed to be invisible under a shirt or indistinguishable from jewelry when exposed. There is no screen. There is no speaker. The only outputs are haptic vibrations and a single small indicator LED.

You put it on in the morning. You forget it is there. It begins passively capturing audio as you move through your day.

### Step 2: Capture
The pendant captures audio through dual microphones. All audio processing happens locally on the device using an edge inference chip. The raw audio never leaves the device. Only extracted features (turn durations, pause lengths, prosody signals, topic shift markers, overlap events) are logged to a local circular buffer. The circular buffer stores approximately 12 hours of conversation features before overwriting.

At the end of the day — or on demand — the pendant syncs feature data (not audio) to the paired iPhone app over Bluetooth.

### Step 3: Haptic Coaching (Real-Time)
When the model detects a pattern that the user has flagged as a coaching target, it delivers a haptic cue. Cues are delivered in real time, during the conversation, with approximately 400–800ms latency from the triggering event.

Three patterns, each with a precise meaning (see Haptic Language section below).

The user calibrates their coaching targets during onboarding and can adjust them at any time via the app. By default, only one to two coaching targets are active at once to prevent sensory overload.

### Step 4: Post-Conversation Replay
After a conversation ends (detected by silence threshold or manual session end), the app presents a post-conversation timeline view. The timeline shows:

- Turn-taking map: who spoke when, relative duration
- Moment flags: each haptic cue on the timeline, with context
- Key metrics: average turn duration, overlap rate, topic shift count, pause distribution
- Coaching note: one sentence describing the single most actionable pattern from this session

The user can tap any flagged moment to read a brief natural-language explanation of what happened: "You shifted topics before Mei finished her thought. This happened 3 times in this conversation."

No audio is replayed. The replay is built entirely from extracted features. This is by design — for privacy, for comfort, and because the goal is pattern recognition, not embarrassment.

### Step 5: Trends Dashboard
The weekly trends view shows rolling 7-day and 30-day averages for each tracked metric, plotted against the user's own baseline. Metrics are always shown relative to the user's own prior performance — never benchmarked against a neurotypical "normal."

One weekly coaching focus is surfaced automatically based on the trend data. The user can accept or override it.

---

## The Coaching Taxonomy (Autism-Specific)

Tizzy coaches to five skill domains identified by SLP literature and validated autistic-led research as the highest-leverage areas for autistic adults in naturalistic social settings:

### 1. Reciprocity / Turn-Taking
The back-and-forth rhythm of conversation. Signals tracked: who speaks, for how long, transition rates, interruption events, floor-holding duration. Common patterns in this domain: monologuing, yielding too quickly, never yielding, missing bid cues.

### 2. Topic Management
Initiating new topics, following others' topic shifts, sustaining a topic, exiting gracefully, detecting when a topic has concluded. Common patterns: abrupt topic shifts, topic perseveration (returning repeatedly to one subject), missing the other person's attempt to introduce a new thread.

### 3. Repair and Recovery
What happens after a breakdown in mutual understanding. Signals tracked: clarification requests, repetition patterns, self-correction events, silence following confusion. Common patterns: freezing after misunderstanding, over-explaining after a misread, skipping repair entirely and hoping it resolves.

### 4. Prosody and Pacing
Speech rate, pause usage, pitch variance, volume modulation. Common patterns: speaking at a constant flat rate, speaking too fast under anxiety, pauses that are longer or shorter than the social context calls for. Tizzy is explicitly not trying to make anyone "sound neurotypical" — it is coaching toward the user's own stated goals (e.g., "I want to pause more before responding").

### 5. Overload Detection
A protective layer. When the model detects features associated with high cognitive load (speech fragmentation, increasing rate variance, shortened turns, abrupt topic exits), it can deliver a grounding cue before shutdown occurs. This is opt-in and configurable.

---

## The Haptic Language

Three patterns. Learned in ten minutes. Permanent.

### Pattern A — "Notice" (single short pulse, 120ms)
A gentle nudge: something just happened worth being aware of. No action required. For low-stakes awareness events (e.g., you just hit three minutes of continuous speaking). The lightest possible signal.

### Pattern B — "Adjust" (double pulse, 120ms + 80ms, 200ms gap)
A coaching cue: this is a moment where you might want to do something different. The specific action depends on your active coaching target. If you are working on turn-taking, adjust means "consider yielding." If you are working on topic management, it means "this topic may be concluding." The user has calibrated what "adjust" means for them during setup.

### Pattern C — "Ground" (long slow wave, 600ms rising, 600ms falling)
A self-regulation cue. Overload protocol triggered. The vibration mimics a slow breath. The user's one job: take one slow breath. Nothing else is expected. This pattern is activated only when the model detects sustained high-load features and only if the user has enabled the overload protocol.

---

## Post-Conversation Timeline Review (Detail)

The timeline is a horizontal scrollable view covering the duration of the conversation. Key elements:

**Track 1: Speaker map.** Color-coded bars showing speaking turns by user (teal) and other speakers (gray). Width proportional to turn duration.

**Track 2: Haptic events.** Small icons on the timeline at the moment each haptic was delivered. Tapping opens the coaching card.

**Track 3: Metric annotations.** Optional overlays showing moments of high speech rate, long pauses, or detected topic transitions.

**Summary card (bottom):**
- Session duration
- Turn count and average turn duration
- Overlap count
- Topic shift count
- Number of haptics delivered, by type
- One coaching sentence

The coaching sentence uses a specific format: [What happened] + [When it happened] + [What to try next time]. Example: "You held the floor for over two minutes in the first third of the conversation. Next time, try checking in after about 90 seconds."

---

## Weekly Trends Dashboard

The trends view is a weekly summary card with:

- Seven-day sparklines for each tracked metric
- 30-day trend line (direction, not absolute)
- "Best moment this week" — a specific conversation event the model identifies as a positive example of the user's coaching target being achieved
- "This week's focus" — the single skill domain with the most coaching activity, with a brief contextual note
- Streak tracker: consecutive days with at least one coaching session

The dashboard never says "you are below average" or "you failed." It says "this is your pattern" and "this is what changed."
