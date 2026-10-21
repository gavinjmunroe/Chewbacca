# Product Experience: The V1 User Journey

## Overview: The Complete Experience

This document walks through the end-to-end Tizzy experience, from first wear to long-term improvement tracking.

---

## Step 1: Wear It

### Form Factor: Necklace First

**Why necklace:**
- Can be worn under a shirt (discreet, not covert)
- Doesn't scream "assistive device"
- Close to mouth (good audio capture)
- Accessible through clothing (button press)
- Comfortable for all-day wear

**Secondary R&D:**
- Earrings (compelling long-term, harder to build/service)
- Watch integration (wrist is far from mouth)
- Clip-on variants (collar, pocket)

### Design Principles

1. **Discreet but not hidden** - looks like jewelry or tech accessory
2. **Premium aesthetic** - not "medical device" look
3. **Durable** - survives daily teenage/adult life
4. **Comfortable** - wearable for 8-12+ hours
5. **Accessible controls** - button press through clothing

---

## Step 2: Always-On Capture with Ruthless Privacy Constraints

### The Audio Capture Approach

#### Your Instinct
"Raw audio is required."

#### The Honest Correction
**Raw audio is required for tone understanding, but raw audio storage is not required for coaching.**

### The Tizzy Privacy Architecture

#### What Happens on Device

1. **Capture raw audio** - microphone array records continuous audio
2. **Process locally** - extract acoustic features and embeddings
   - Voice activity detection
   - Speaker diarization
   - Prosody features (pitch, pace, intensity)
   - Emotional tone embeddings
3. **Minimize** - discard or encrypt raw audio
4. **Store features** - keep only what's needed for coaching

#### What Leaves the Device

**Default mode (privacy-first):**
- Acoustic features and embeddings only
- No raw audio
- Anonymized conversational metadata

**Optional mode (with explicit opt-in):**
- Selected conversation clips for review
- Therapist-shared segments
- User-marked moments

### Privacy Modes (User Control)

| Mode | Microphone | Processing | Storage | When to Use |
|------|------------|-----------|---------|-------------|
| **Active Coaching** | On | Full | Features only | Normal daily use |
| **Self-Only** | On | Wearer voice only | Minimal | Practice, solitary |
| **Hard Mute** | Off | None | None | Private conversations, bathroom, etc. |
| **Quiet Hours** | Off | None | None | Scheduled (sleep, class, etc.) |

### Consent Management

#### Every Capture Session Has a Record

- **Session ID** and timestamp
- **Consent mode**: "self-only," "consented conversation," or "no capture"
- **Environment tag**: school, home, therapy, public, work
- **Device state**: active, muted, self-only

#### Bystander Consent (The Hard Problem)

**Options being evaluated:**

1. **Visible indicator light** when capturing others
   - Pros: Clear, socially legible
   - Cons: May feel stigmatizing

2. **NFC tap consent** - bystander taps device to acknowledge
   - Pros: Explicit, auditable
   - Cons: Awkward, slows conversation

3. **Verbal consent prompt** - user says "I'm using a conversation coach"
   - Pros: Natural, builds legitimacy
   - Cons: Relies on user compliance

4. **Context-based auto-mute** - mute by default in public, active in consented spaces
   - Pros: Reduces friction
   - Cons: May miss coaching opportunities

**V1 approach:** Combination of #1 (subtle indicator) and #3 (encouraged verbal disclosure).

---

## Step 3: In-the-Moment Coaching via Haptics

### Real-Time Coaching Philosophy

**Intent-level coaching, not word-level.**

The wearer gets subtle vibration patterns that mean things like:
- Slow down
- Ask a return question
- Clarify
- You are escalating
- They are confused
- Wrap up gracefully

### V1 Haptic Language (3 Patterns)

| Pattern | Sensation | Meaning | When It Triggers | User Action |
|---------|-----------|---------|------------------|-------------|
| **Single pulse** | One short vibration | Pacing or volume adjustment | Speaking 30%+ faster than baseline, or volume spike | Slow down, lower volume |
| **Double pulse** | Two quick vibrations | Ask a return question or clarify | Monologuing 90+ seconds, topic drift detected | Pause, ask question, check understanding |
| **Long pulse** | One 2-second vibration | Escalation risk or exit cue | Stress markers + conversation complexity, or overload risk | Take a breath, consider exiting conversation |

### Haptic Design Principles

1. **Subtle** - not alarming or attention-grabbing
2. **Private** - only wearer feels it
3. **Consistent** - same pattern = same meaning
4. **Learnable** - user learns associations quickly
5. **Disablable** - user can turn off specific patterns or all haptics

### What NOT to Coach in Real-Time (V1)

Some coaching is too complex for haptics:
- ❌ Topic appropriateness (too contextual)
- ❌ Theory of mind failures (too nuanced)
- ❌ Specific word choice (too detailed)
- ❌ Facial expression mismatch (no video in V1)

**These go in post-conversation review instead.**

---

## Step 4: Post-Conversation "Instant Replay"

### When It Happens

After a conversation ends (or at end of day), the user opens the app.

**Conversation end detection:**
- 5+ minutes of silence
- Location change (via Bluetooth disconnect)
- Manual "review now" button
- End of day summary

### What the User Sees

#### 1. Timeline of Moments That Matter

**NOT full surveillance playback by default.**

The app shows:
- Conversation duration and participants
- Key moments (color-coded)
  - 🟢 Green: Positive moments (good reciprocity, successful repair)
  - 🟡 Yellow: Learning opportunities (patterns to improve)
  - 🔴 Red: Breakdown moments (confusion, escalation)

#### 2. Short Annotated Clips (Only If Explicitly Enabled)

**User must opt-in to clip retention.**

If enabled:
- 10-30 second clips of specific moments
- Overlay annotation explaining what happened
- Audio + transcript + coaching insight

Example:
> 🟡 **Clip: 2:43-3:12** (29 seconds)
> You talked about Minecraft for 2 minutes while Jake looked uncomfortable.
> Notice: Jake said "uh-huh" 7 times but didn't ask follow-up questions.
> Try: After 30-60 seconds, pause and ask "What do you think?" or "Do you play?"

#### 3. "What Went Well" (Top 2)

Positive reinforcement is critical.

Examples:
- ✅ "You asked 3 return questions - great reciprocity!"
- ✅ "You caught yourself interrupting and apologized - excellent repair!"
- ✅ "You matched Emma's quieter volume in the library - good context awareness!"

#### 4. "What to Try Next Time" (Top 2)

Constructive coaching.

Examples:
- 💡 "You talked for 4 minutes about Pokemon without pausing. Try asking a question after 60 seconds."
- 💡 "When Mom hinted she was tired ('It's been a long day'), you didn't offer to help. Consider offering support when people share feelings."
- 💡 "Your volume jumped when you got excited. Try staying at conversation level even when enthusiastic."

#### 5. One Micro-Goal for Tomorrow

**Small, specific, achievable.**

Examples:
- "Tomorrow: When you've talked for 60 seconds, pause and ask a question."
- "Tomorrow: If someone seems confused (long pause, 'huh?'), try rephrasing instead of moving on."
- "Tomorrow: Match the other person's energy level in the first minute of conversation."

#### 6. Optional: Suggested Practice Drill

Short roleplay or practice activity.

Examples:
- "Practice: Have a 2-minute conversation where you ask at least 2 questions about the other person."
- "Practice: Tell a story, and pause every 30 seconds to check if the listener is following."
- "Practice: Record yourself talking for 1 minute, then listen back to notice your pace and tone."

---

## Step 5: Long-Term Trends

### Weekly Dashboard

#### Overview Stats

```
This Week's Conversations
─────────────────────────
Total: 28 conversations
Average length: 5.8 minutes (↗️ up from 4.5 min)
Most common setting: School lunch (12 conversations)
Active coaching days: 6 of 7
```

#### Progress Tracking

**Your improving skills:**

1. **Reciprocity (Asking return questions)**
   - 2 weeks ago: 0.8 per conversation
   - Last week: 1.4 per conversation
   - This week: 2.1 per conversation
   - ↗️ **+50% improvement**

2. **Repair (Fixing misunderstandings)**
   - 2 weeks ago: 0.5 per conversation
   - Last week: 1.2 per conversation
   - This week: 1.8 per conversation
   - ↗️ **+50% improvement**

3. **Interruptions**
   - 2 weeks ago: 5.2 per conversation
   - Last week: 3.8 per conversation
   - This week: 2.1 per conversation
   - ↗️ **60% reduction**

#### Patterns to Focus On

**Your top 3 recurring patterns (most impact on outcomes):**

1. **Monologuing about special interests**
   - Frequency: 3-4x per week
   - Impact: High (causes visible disengagement)
   - Coaching focus: Pause every 60 seconds to ask a question
   - Progress: 20% improvement over 2 weeks

2. **Missing conversation endpoints**
   - Frequency: 2-3x per week
   - Impact: Medium (makes exits awkward)
   - Coaching focus: Listen for closing signals ("Well, I should go...")
   - Progress: 15% improvement over 2 weeks

3. **Volume too loud when excited**
   - Frequency: Daily in enthusiastic conversations
   - Impact: Medium (overwhelming to others)
   - Coaching focus: Match partner's volume
   - Progress: 35% improvement over 2 weeks

#### Context Insights

**Where you're doing best:**
- 🏠 Home with family: Strong reciprocity, comfortable repair
- 🎮 Gaming friends: Shared interests, natural flow

**Where there's opportunity:**
- 🏫 School lunch: Larger groups, more interruptions
- 🏪 Public/stores: Need to work on volume matching

---

### Monthly Progress Report

**Shareable with:**
- Parents (if under 18 with permission)
- Therapist (with explicit opt-in)
- Self (for reflection)

#### Report Contents

1. **Overall trajectory** - improving, stable, or needs focus
2. **Skill progress** - breakdown by taxonomy bucket
3. **Goal achievement** - daily micro-goals completion rate
4. **Pattern evolution** - how recurring patterns have changed
5. **Next month focus** - recommended coaching priorities

---

## Step 6: Optional Therapist View

### Opt-In Required (Not Default)

This is a **huge wedge for therapy effectiveness**, but also a governance minefield.

### How Opt-In Works

1. **User (or parent) enables therapist sharing** in app settings
2. **Therapist receives invitation** with access scope
3. **User can revoke at any time** - instant access removal
4. **Audit log** shows exactly what therapist accessed and when

### What Therapists Can See

#### Default View (Insights Only)

- **Weekly summary report**
  - Progress on IEP goals or therapy targets
  - Most frequent patterns
  - Skill trend data
  - Context breakdown (where user succeeds/struggles)

- **Goal-setting interface**
  - Therapist can set coaching goals aligned with therapy
  - Tizzy tracks progress toward those goals
  - Collaborative planning

#### Optional: Selected Conversation Details

**User chooses which conversations therapist can see.**

- Conversation timeline with moments
- Insights and coaching provided
- Optional: Annotated clips (if user enabled clip retention)

#### Never Shared (Unless Explicitly Enabled Per Conversation)

- ❌ Raw audio of conversations
- ❌ Full transcripts
- ❌ Names of conversation partners (anonymized by default)
- ❌ Specific locations beyond general context

### Therapist Workflow Example

**Scenario: SLP working with 12-year-old Alex on topic maintenance**

1. **Monday therapy session:**
   - SLP and Alex set goal: "Maintain topic for average 4 turns per conversation"
   - Goal is entered in Tizzy app

2. **During the week:**
   - Tizzy tracks Alex's topic maintenance
   - Provides in-moment and post-conversation coaching
   - Alex reviews insights each evening

3. **Friday (before next session):**
   - SLP reviews weekly report
   - Sees: Alex maintained topic for average 3.2 turns (up from 2.1)
   - Notices: Alex struggles more in group settings than 1-on-1
   - Plans next session focus: group conversation strategies

4. **Next Monday therapy session:**
   - SLP: "Great progress on topic maintenance! Let's look at this group lunch conversation where you struggled. What do you think happened?"
   - Uses specific Tizzy insights to drive therapy discussion
   - Real-world data makes therapy more concrete and effective

---

## Hardware Experience

### Physical Specs (V1 Target)

#### Form Factor
- **Type:** Pendant necklace
- **Size:** ~1.5" diameter, 0.4" thick
- **Weight:** <30g (comfortable for all-day wear)
- **Material:** Brushed aluminum or premium polymer
- **Color options:** Black, silver, rose gold (to look like jewelry/tech)

#### Battery
- **Target:** 24 hours minimum
- **Ideal:** 48 hours
- **Charging:** USB-C, wireless charging optional
- **Low battery warning:** Haptic + app notification at 20%

#### Microphones
- **Count:** 2 microphones (directionality and noise robustness)
- **Placement:** Front-facing and omnidirectional
- **Challenge:** Muffling under shirts
- **Solution:** Advanced signal processing + optional collar placement guide

#### Haptics
- **Type:** Linear actuator (precise vibration patterns)
- **Strength:** Adjustable (user can increase/decrease intensity)
- **Response time:** <100ms from trigger to vibration

#### Buttons
- **Primary button:** Multi-function action button
  - Single press: Mark moment ("that was confusing")
  - Long press (3 sec): Hard mute toggle
  - Double press: Manual conversation end
- **Accessible through clothing:** Button is raised and easy to find

#### Connectivity
- **Primary:** Bluetooth LE to phone
- **Range:** 30 feet
- **Syncing:** Automatic when in range, manual trigger available
- **No Wi-Fi in V1:** Privacy and battery risk

#### Indicator Lights
- **Status LED:** Small, discreet
  - Solid green: Active, capturing
  - Slow pulse: Muted
  - Red pulse: Low battery
  - Off: Powered down
- **Recording indicator:** Subtle (not obnoxious)
  - Required for bystander awareness
  - Can be dimmed but not fully disabled

#### Storage
- **Type:** Circular buffer for raw audio
- **Duration:** 4-8 hours (overwritten unless explicitly retained)
- **Purpose:** Enables "instant replay" without building surveillance archive
- **User control:** Can clear buffer manually at any time

---

## App Experience

### Mobile App (iOS and Android)

#### Home Screen

**Quick glance view:**
- Current status (Active / Muted / Battery low)
- Today's micro-goal with progress
- Recent conversations (tap to review)
- Quick mute toggle (large, obvious)

#### Conversations Tab

**List of recent conversations:**
- Timeline view (today, yesterday, this week)
- Each conversation shows:
  - Duration, participant count, location
  - Quick summary (positive, neutral, challenging)
  - Tap to see full review

#### Insights Tab

**Your patterns and progress:**
- Current skills focus (top 3)
- Trend graphs (reciprocity, interruptions, etc.)
- Pattern evolution over time
- Suggested coaching priorities

#### Goals Tab

**Your learning path:**
- Current micro-goal
- Upcoming goals
- Past goal completion history
- Therapist-set goals (if enabled)

#### Settings Tab

**Privacy and control center:**
- Privacy mode selection
- Mute schedules (quiet hours)
- Consent settings
- Therapist sharing (opt-in/out)
- Data retention controls
- Audit log (what data exists, where)
- Delete data (per conversation or all)
- Haptic pattern customization
- Device pairing and battery status

### Privacy Dashboard (Critical Feature)

**Complete transparency about data:**

```
Your Data at a Glance
─────────────────────
Conversations captured: 127
Raw audio retained: 3 clips (user-saved)
Raw audio deleted: 124 conversations (automatic)
Features stored: 127 conversations
Shared with therapist: 12 conversations (insights only)

Data Retention
─────────────
Automatic deletion: 30 days after conversation
Raw audio: Deleted immediately unless you save
Features: Retained for trend analysis
Clips you saved: 3 (manage below)

Access Log
─────────
Feb 12: You reviewed conversation with Emma
Feb 11: Dr. Kim (therapist) viewed weekly summary
Feb 10: You saved clip from math class conversation
Feb 9: You deleted conversation data from Feb 2-5
```

---

## Onboarding Experience (First-Time Setup)

### Setup Flow (15-20 minutes)

#### 1. Welcome & Mission

**Screen 1:**
> **Welcome to Tizzy**
> The conversation coach you can actually trust.
>
> Tizzy helps you improve real conversations by showing you patterns you can't see and coaching you toward clearer communication.

#### 2. Privacy Education (Critical)

**Screen 2:**
> **Your Privacy, Your Control**
>
> Tizzy captures conversations to provide coaching, but YOU decide:
> - What gets captured (active vs. muted)
> - What gets stored (auto-delete vs. saved clips)
> - Who sees what (private vs. therapist-shared)
>
> We'll show you how to control everything.

**Interactive tutorial:**
- How to mute (button press demo)
- How to set quiet hours
- How to review and delete data
- How to see exactly what's stored

#### 3. Consent Education

**Screen 3:**
> **Using Tizzy with Others**
>
> When you wear Tizzy around other people, they should know. Here's why and how:
>
> - It's respectful and builds trust
> - It's required by law in many places
> - It makes Tizzy feel like helpful tech, not creepy surveillance
>
> Try saying: "I'm using a conversation coach that helps me with social cues. Is that okay with you?"
>
> Most people will understand and support your growth!

#### 4. Voice Calibration

**Screen 4:**
> **Let's Calibrate Your Voice**
>
> Read these sentences out loud so Tizzy learns your voice:
> 1. "Hello, my name is [your name]."
> 2. "I'm excited to try Tizzy."
> 3. "This is my normal speaking voice."
>
> [Record button]

**Behind the scenes:** Establishing baseline prosody profile

#### 5. Goals Setting

**Screen 5:**
> **What Do You Want to Work On?**
>
> Select 1-2 goals to start:
> - [ ] Have longer, smoother conversations
> - [ ] Ask more questions and listen better
> - [ ] Stop interrupting people
> - [ ] Notice when people are confused
> - [ ] Manage overwhelming social situations
> - [ ] Be more confident in conversations
>
> You can change these anytime.

#### 6. Haptic Training

**Screen 6:**
> **Feel the Coaching**
>
> Tizzy uses gentle vibrations to coach you in the moment. Let's learn the patterns:
>
> [Trigger single pulse] - This means: slow down or lower volume
> [Trigger double pulse] - This means: ask a question or check understanding
> [Trigger long pulse] - This means: you're escalating or getting overloaded
>
> You can adjust or disable these in Settings.

#### 7. Device Pairing

**Screen 7:**
> **Pair Your Tizzy Device**
>
> 1. Make sure your Tizzy is charged
> 2. Press and hold the button for 5 seconds
> 3. Wait for the blue light
> 4. Tap "Pair" below
>
> [Pair Device button]

#### 8. Ready to Go

**Screen 8:**
> **You're All Set!**
>
> Your first goal: Have a conversation and review the insights afterward.
>
> Remember:
> - You're in control (mute anytime)
> - Let people know you're using a coach
> - Review insights to learn patterns
> - Progress takes time - be patient with yourself
>
> [Start Using Tizzy button]

---

## Summary: The Complete Loop

### Daily Experience

1. **Morning:** Put on Tizzy, check today's micro-goal
2. **Throughout day:** Subtle haptic coaching during conversations
3. **Evening:** Review 2-3 key conversations, see insights
4. **Before bed:** Acknowledge progress, set intention for tomorrow

### Weekly Experience

1. **Friday/Saturday:** Review weekly trends
2. **Identify:** Top pattern to focus on next week
3. **Celebrate:** Improvements, even small ones
4. **Plan:** Micro-goals for upcoming week

### Monthly Experience

1. **Generate:** Monthly progress report
2. **Share:** With therapist or parent (if opted in)
3. **Reflect:** What's working, what's not
4. **Adjust:** Goals and focus areas for next month

**The product works if the loop is simple, helpful, and respectful. Anything that breaks trust breaks everything.**