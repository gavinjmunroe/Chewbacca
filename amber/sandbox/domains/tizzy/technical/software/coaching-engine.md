# Coaching Engine Technical Specification

## Overview

The Coaching Engine is the heart of Tizzy's value proposition. It transforms conversation analysis into actionable, personalized guidance that helps autistic users improve their conversational skills over time. The engine operates in three modes: (1) real-time haptic coaching, (2) post-conversation review and insights, and (3) long-term progress tracking and goal-based personalization.

This document specifies the technical design, algorithms, personalization strategies, and coaching logic that make Tizzy effective without being punitive or conformity-driven.

---

## Core Design Principles

### 1. Empower, Don't Punish

**Philosophy:**
Coaching is framed as skill-building and self-awareness, not error correction. The system celebrates improvements, normalizes challenges, and respects neurodiversity.

**Implementation:**
- Positive reinforcement: Highlight "what went well" before "what to improve"
- Neutral language: "Try pausing" instead of "You interrupted (bad)"
- User choice: Users can dismiss coaching suggestions that feel inauthentic
- No gamification that punishes: No streaks lost, no red X's, no shame mechanics

### 2. Personalization Over Population Norms

**Philosophy:**
Every autistic person's baseline and goals are unique. Coaching must adapt to individual patterns, not force conformity to neurotypical norms.

**Implementation:**
- User-specific baselines established over first 7-14 days
- Coaching thresholds adapted to user's skill level (progressive coaching)
- Context-aware coaching (work vs. family vs. friends)
- Goal-driven: Parents, therapists, or users set specific skill targets

### 3. Transparency and Controllability

**Philosophy:**
Users must understand why they received coaching and be able to control what coaching they receive.

**Implementation:**
- Every haptic pulse has an explanation accessible post-conversation
- Users can disable specific coaching types (e.g., "I want pacing help, not reciprocity cues")
- Confidence scores shown: "We think you might have X (75% confidence)"
- Feedback loop: "Was this helpful?" prompts improve model over time

### 4. Uncertainty Acknowledgment

**Philosophy:**
The system is not omniscient. It should admit uncertainty and ask clarifying questions rather than hallucinate confidence.

**Implementation:**
- Low-confidence detections do not trigger haptics (false positives are harmful)
- Post-conversation: "We weren't sure about this moment. What happened?"
- Active learning: Use uncertainty to gather high-value training labels
- Model performance monitoring: Track haptic accuracy via user feedback

---

## Coaching Taxonomy (V1)

The coaching engine targets specific, evidence-based social communication skills. These map to autism diagnostic criteria (DSM-5), speech-language pathology frameworks (ASHA), and lived experience.

### A) Reciprocity and Turn-Taking

**Target Skills:**
- Balanced turn-taking (not dominating or withdrawing)
- Asking return questions (showing interest in other person)
- Responding to conversational bids (not ignoring attempts to engage)
- Managing interruptions (both reducing and recovering from them)

**Detection Signals:**
- Turn length imbalance (wearer >70% of total speech time)
- Monologuing (>45 seconds without pause for other speaker)
- Interruption rate (overlapping speech initiated by wearer)
- Missed bids (other speaker asked question, wearer didn't respond)
- Zero return questions asked in >2 minute conversation

**Coaching Actions:**

**Real-Time (Haptic):**
- Double pulse after 45 seconds of continuous wearer speech: "Consider asking them something"
- Double pulse when conversational bid detected but wearer continued own topic: "They're trying to share something"

**Post-Conversation:**
- "You spoke for 80% of the conversation. Try inviting the other person to share more next time."
- "You asked 0 return questions. Practice: 'What about you?' or 'How did you feel about that?'"

**Drill Suggestion:**
- "Challenge: Ask 3 follow-up questions in your next conversation."

### B) Topic Management

**Target Skills:**
- Starting topics appropriately (gauge other person's interest)
- Maintaining shared topics (not drifting off-topic)
- Gracefully shifting topics (transitions, not non-sequiturs)
- Recognizing when to let a topic go (not perseverating)

**Detection Signals:**
- Topic shift abruptness (sudden change in semantic content + prosody break)
- Topic perseveration (same topic repeated despite disengagement cues from other)
- Lack of shared topic (wearer and other speaker talking about different things)
- Topic duration imbalance (wearer's topic 90% of conversation)

**Coaching Actions:**

**Real-Time (Haptic):**
- Single pulse when other speaker shows disengagement (shorter responses, flat tone): "They might not be as interested in this topic"

**Post-Conversation:**
- "At 2:15 PM, the topic shifted abruptly. Try using transitions like: 'That reminds me of...' or 'Speaking of X...'"
- "You returned to [topic] three times after the other person changed subjects. Consider following their lead."

**Drill Suggestion:**
- "Practice noticing when someone gives short answers (sign of low interest)."

### C) Repair and Recovery

**Target Skills:**
- Noticing confusion moments (in self or other)
- Asking clarifying questions
- Rephrasing when misunderstood
- Apologizing or acknowledging misunderstandings
- Gracefully exiting confusing conversations

**Detection Signals:**
- Confusion markers: "What?", "Huh?", "I don't understand", long pauses after wearer speaks
- Repair attempts by wearer: "I mean...", "Let me explain...", "Sorry, what I meant was..."
- Escalation after confusion (frustration indicators in prosody)
- Successful recovery (confusion resolved, conversation continues smoothly)

**Coaching Actions:**

**Real-Time (Haptic):**
- Long pulse when confusion detected + escalation risk: "They might be confused. Try rephrasing or checking in."

**Post-Conversation:**
- "✓ Great job at 3:42 PM: You noticed confusion and asked 'Does that make sense?'"
- "At 1:20 PM, there was a long pause after you spoke. This might mean they didn't understand. Next time, try: 'Should I explain that differently?'"

**Drill Suggestion:**
- "Practice repair phrases: 'Let me rephrase that,' 'What I mean is...,' 'Is this making sense?'"

### D) Prosody, Pacing, and Volume

**Target Skills:**
- Speaking at a pace others can follow (not too fast or too slow)
- Modulating volume (not too loud or too quiet for context)
- Using pitch variation (avoiding flat affect when appropriate)
- Matching intensity to context (excited when appropriate, calm when needed)

**Detection Signals:**
- Pace too fast (>20% above user baseline, or >200 words per minute)
- Pace too slow (<80 words per minute, causing disengagement)
- Volume too loud (intensity >20dB above baseline for context)
- Flat prosody (pitch variance <10Hz when emotional context warrants variation)
- Intensity mismatch (high intensity in calm context, e.g., library)

**Coaching Actions:**

**Real-Time (Haptic):**
- Single pulse when pace sustained >15 seconds above fast threshold: "Try slowing down"
- Single pulse when volume detected as too loud: "Consider lowering your volume"

**Post-Conversation:**
- "You spoke at 185 words per minute (your baseline is 140). When excited, try taking a breath between sentences."
- "Your pitch was flat during a story that seemed exciting. Varying your tone can help others follow along."

**Drill Suggestion:**
- "Practice: Record yourself telling a story, then listen back. Does your voice match the emotion?"

### E) Nonverbal Mismatch Proxies (No Video)

**Target Skills:**
- Recognizing likely missed cues (without video, inferred from conversation breakdown)
- Pausing to check in when something feels off
- Asking direct questions when confused ("Are you upset?")

**Detection Signals:**
- Sudden silence after wearer speaks (possible uncomfortable reaction)
- Abrupt topic shift by other speaker (discomfort or disinterest)
- Overlapping speech increase (possible frustration)
- Tone-content mismatch (sarcasm detection via prosody analysis)

**Coaching Actions:**

**Real-Time (Haptic):**
- Long pulse when sudden silence >5 seconds after wearer speaks: "They went quiet. Consider checking in."

**Post-Conversation:**
- "At 4:10 PM, the other person went quiet after your comment. You may have missed a social cue."
- "The other person's tone suggested sarcasm, but you responded literally. Practice noticing tone changes."

**Drill Suggestion:**
- "Practice asking: 'Did I say something wrong?' when someone goes quiet."

### F) Theory of Mind and Implied Meaning

**Target Skills:**
- Recognizing indirect requests ("It's cold in here" → offer to close window)
- Understanding implied criticism ("Interesting choice" said flatly)
- Perspective-taking (others may not share your assumptions)

**Detection Signals:**
- Literal interpretation patterns (responding to surface meaning, not intent)
- Missed indirect requests (other speaker hints, wearer doesn't act)
- Assumptions stated as facts (not acknowledging other perspectives)

**Coaching Actions:**

**Real-Time (Haptic):**
- Not typically coached in real-time (too complex for haptics)

**Post-Conversation:**
- "At 11:30 AM, they said 'It's cold.' This might have been a request to close the window."
- "You assumed they knew about [topic], but they seemed confused. Try checking: 'Are you familiar with X?'"

**Drill Suggestion:**
- "Practice: When someone makes a statement, ask yourself: Is this also a request?"

### G) Social Calibration (Boundaries, Politeness, Context-Fit)

**Target Skills:**
- Sharing appropriately for relationship stage (not oversharing early)
- Using polite phrasing when needed (requests, not demands)
- Adjusting formality to context (work vs. friends)
- Respecting conversational boundaries (not pressing when someone deflects)

**Detection Signals:**
- Personal disclosure early in conversation (vulnerability mismatch)
- Direct phrasing in high-politeness context (sounds rude to listener)
- Persistent questioning after deflection (boundary violation)
- Formality mismatch (too casual at work, too formal with friends)

**Coaching Actions:**

**Real-Time (Haptic):**
- Not coached in real-time (too subjective and context-dependent)

**Post-Conversation:**
- "You shared personal information in the first 2 minutes. Consider building rapport first."
- "You asked 'Why?' directly after they deflected. They might want to move on from that topic."

**Drill Suggestion:**
- "Practice: Match how much the other person shares before sharing deeply yourself."

### H) Overload and Breakdown Prevention

**Target Skills:**
- Recognizing early signs of sensory or cognitive overload
- Taking breaks before breaking down
- Exiting conversations gracefully when overwhelmed
- Communicating limits ("I need a minute")

**Detection Signals:**
- Stress indicators in voice (tension, breathiness, increased jitter)
- Disorganization (fragmented speech, incomplete sentences, word-finding difficulty)
- Volume drop + pace drop (shutting down)
- Conversation length >15 minutes in noisy environment (overload risk)

**Coaching Actions:**

**Real-Time (Haptic):**
- Long pulse when stress indicators sustained >30 seconds: "You sound stressed. Consider taking a break."
- Long pulse in loud environment after 10+ minutes: "Long conversation in noise. Check in with yourself."

**Post-Conversation:**
- "At 3:50 PM, your voice showed stress markers. You exited 2 minutes later—good self-awareness!"
- "This 18-minute conversation in a cafeteria may have been taxing. Consider shorter chats in noisy places."

**Drill Suggestion:**
- "Practice exit phrases: 'I need to step away for a minute,' 'Can we continue this later?'"

---

## Real-Time Haptic Coaching Engine

### Architecture

```
Conversation Audio Stream
  ↓
Feature Extraction (Layer 1)
  ↓
Pattern Detection (Layer 2)
  ↓
[Coaching Decision Engine]
  ├→ Check confidence threshold (>0.8)
  ├→ Check user settings (haptics enabled for this pattern?)
  ├→ Check cooldown timer (avoid haptic fatigue)
  ├→ Check conversation context (appropriate moment?)
  ↓
Haptic Command
  ↓
Device Haptic Actuator
```

### Decision Logic (Pseudocode)

```python
def should_send_haptic_coaching(pattern, confidence, context, user_settings):
    """
    Decide whether to send haptic coaching for detected pattern.

    Args:
        pattern: Detected coaching moment (e.g., 'monologuing', 'pace_too_fast')
        confidence: Model confidence score (0-1)
        context: Current conversation state (duration, speaker_count, environment)
        user_settings: User's coaching preferences

    Returns:
        (send_haptic: bool, haptic_pattern: str, explanation: str)
    """

    # Rule 1: Confidence threshold
    if confidence < 0.8:
        return (False, None, "Low confidence")

    # Rule 2: User has disabled this coaching type
    if pattern in user_settings.disabled_patterns:
        return (False, None, "User disabled this pattern")

    # Rule 3: Cooldown to prevent haptic fatigue
    time_since_last_haptic = get_time_since_last_haptic(pattern)
    if time_since_last_haptic < COOLDOWN_SECONDS[pattern]:
        return (False, None, f"Cooldown: {time_since_last_haptic}s ago")

    # Rule 4: Context appropriateness
    if not is_appropriate_moment(pattern, context):
        return (False, None, "Not appropriate moment")

    # Rule 5: Map pattern to haptic
    haptic = get_haptic_for_pattern(pattern)
    explanation = get_explanation_for_pattern(pattern, context)

    return (True, haptic, explanation)


def get_haptic_for_pattern(pattern):
    """Map coaching pattern to haptic pulse type."""
    HAPTIC_MAP = {
        'monologuing': 'double_pulse',
        'missed_bid': 'double_pulse',
        'pace_too_fast': 'single_pulse',
        'volume_too_loud': 'single_pulse',
        'escalation_risk': 'long_pulse',
        'overload_risk': 'long_pulse',
        'confusion_detected': 'long_pulse',
    }
    return HAPTIC_MAP.get(pattern, 'single_pulse')


def is_appropriate_moment(pattern, context):
    """
    Check if this is an appropriate moment for haptic.

    Avoid coaching during:
    - First 30 seconds of conversation (let user settle in)
    - While user is mid-sentence (wait for natural pause)
    - If conversation already ended
    - If environment is tagged as 'therapy' (therapist may not want interruptions)
    """
    if context.conversation_duration < 30:
        return False

    if context.user_is_speaking and not context.at_natural_pause:
        return False

    if context.conversation_ended:
        return False

    if context.environment == 'therapy' and not context.user_settings.allow_haptics_in_therapy:
        return False

    return True


# Cooldown periods (seconds) to avoid haptic spam
COOLDOWN_SECONDS = {
    'monologuing': 60,        # Don't nag repeatedly
    'pace_too_fast': 90,      # Give time to adjust
    'volume_too_loud': 120,   # Rare issue, longer cooldown
    'escalation_risk': 120,   # Serious, but rare
    'overload_risk': 180,     # Very rare, very long cooldown
}
```

### Adaptive Coaching Intensity

Users can set coaching sensitivity:

**Conservative Mode:**
- Only send haptics for high-severity, high-confidence patterns
- Longer cooldowns
- Use case: New users, users with anxiety about feedback

**Moderate Mode (Default):**
- Standard thresholds (confidence >0.8, standard cooldowns)
- Balance between helpful and non-intrusive

**Aggressive Mode:**
- Lower confidence threshold (0.7)
- Shorter cooldowns
- More patterns enabled
- Use case: Users actively working on specific skill, during practice conversations

### Haptic Learning Mode

During first 3 days, run in "training mode":
- Send haptic but immediately explain it in app
- "You just felt a double pulse. This means: Consider asking a return question. Got it?"
- Track user's understanding: Quiz after 3 days to confirm comprehension

---

## Post-Conversation Insights Engine

### Summary Generation Pipeline

```
Conversation Session
  ↓
Feature Analysis (Layer 1 + Layer 2)
  ↓
[Insight Generation]
  ├→ Identify top positive moments (2-3)
  ├→ Identify top improvement areas (2-3)
  ├→ Generate micro-goal (1, specific, actionable)
  ├→ Suggest practice drill
  ├→ Compute conversation score
  ↓
Render in App UI
```

### Insight Selection Algorithm

**Goal:** Provide actionable feedback without overwhelming the user.

**Step 1: Rank All Detected Patterns**

```python
def rank_coaching_moments(moments, user_baseline, user_goals):
    """
    Rank detected moments by coaching priority.

    Priority factors:
    1. Severity (how much did this impact conversation?)
    2. Frequency (how often did this happen?)
    3. Improvability (can user realistically change this?)
    4. Goal-alignment (is this a user's stated goal?)
    """
    scores = []
    for moment in moments:
        severity = compute_severity(moment, user_baseline)
        frequency = compute_frequency(moment, moments)
        improvability = IMPROVABILITY_SCORES[moment.pattern]
        goal_alignment = 1.5 if moment.pattern in user_goals else 1.0

        score = severity * frequency * improvability * goal_alignment
        scores.append((moment, score))

    return sorted(scores, key=lambda x: x[1], reverse=True)
```

**Step 2: Select Top 2 Improvement Areas**

```python
def select_improvement_areas(ranked_moments):
    """
    Select 2 improvement areas (avoid overwhelming user).

    Rules:
    - Must be different skill categories (e.g., not both turn-taking)
    - At least one must be "high improvability" (quick wins)
    - If user is new (<7 days), prioritize simple skills (pace, volume)
    """
    selected = []
    used_categories = set()

    for moment, score in ranked_moments:
        category = get_skill_category(moment.pattern)

        if category in used_categories:
            continue  # Avoid redundancy

        if len(selected) == 0:
            # First selection: highest priority
            selected.append(moment)
            used_categories.add(category)
        elif len(selected) == 1:
            # Second selection: different category, ideally high improvability
            if IMPROVABILITY_SCORES[moment.pattern] >= 0.7:
                selected.append(moment)
                used_categories.add(category)
                break

    return selected
```

**Step 3: Select Top 2 Positive Moments**

```python
def select_positive_moments(moments):
    """
    Highlight what went well (positive reinforcement).

    Prioritize:
    - Successful repair attempts
    - Good reciprocity (balanced turn-taking, return questions)
    - Moments where user improved compared to baseline
    """
    positive = [m for m in moments if m.is_positive]
    ranked = sorted(positive, key=lambda m: m.impact_score, reverse=True)
    return ranked[:2]
```

**Step 4: Generate Micro-Goal**

```python
def generate_micro_goal(improvement_areas, user_history):
    """
    Generate one specific, achievable micro-goal for next conversation.

    Characteristics:
    - Specific (not vague)
    - Measurable (user can self-assess)
    - Achievable (one small change)
    - Related to top improvement area
    """
    top_issue = improvement_areas[0]

    MICRO_GOAL_TEMPLATES = {
        'monologuing': [
            "Pause after 30 seconds to let the other person share.",
            "Ask at least 2 return questions in your next chat.",
        ],
        'pace_too_fast': [
            "Take a breath between sentences when excited.",
            "Count to 1 after the other person finishes before responding.",
        ],
        'missed_bid': [
            "When someone asks you a question, ask them the same question back.",
        ],
        'interruption': [
            "Wait 1 full second after you think they're done before speaking.",
        ],
    }

    templates = MICRO_GOAL_TEMPLATES.get(top_issue.pattern, ["Keep practicing!"])

    # Personalize based on history
    if user_history.has_attempted_goal(templates[0]):
        return templates[1] if len(templates) > 1 else templates[0]

    return templates[0]
```

**Step 5: Compute Conversation Score**

```python
def compute_conversation_score(moments, user_baseline):
    """
    Generate 0-100 score for conversation quality.

    Components:
    - Reciprocity balance (30% weight)
    - Repair success rate (20% weight)
    - Prosody appropriateness (15% weight)
    - Topic management (15% weight)
    - Positive engagement (20% weight)

    Normalized to user's baseline (score relative to their typical performance).
    """
    reciprocity_score = compute_reciprocity_score(moments)
    repair_score = compute_repair_score(moments)
    prosody_score = compute_prosody_score(moments)
    topic_score = compute_topic_score(moments)
    engagement_score = compute_engagement_score(moments)

    raw_score = (
        0.30 * reciprocity_score +
        0.20 * repair_score +
        0.15 * prosody_score +
        0.15 * topic_score +
        0.20 * engagement_score
    )

    # Normalize to user baseline (50 = average for this user)
    baseline_avg = user_baseline.average_score
    normalized = 50 + (raw_score - baseline_avg) * 50 / (100 - baseline_avg)

    return max(0, min(100, normalized))  # Clamp to [0, 100]
```

### Summary Rendering (Example)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Lunch with Alex • 8 minutes
1:15 PM - 1:23 PM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Conversation Score: 72/100
(Above your average of 65!)

✓ What went well:
  • You asked 3 return questions—great reciprocity!
  • You successfully repaired a confusion at 1:18 PM

⚠️ What to work on:
  • You spoke quickly when excited (180 wpm vs 140 baseline)
  • You interrupted twice when discussing your project

💡 Micro-goal for tomorrow:
Try pausing for 1 second after they finish speaking before you respond.

🎯 Practice Drill:
Next conversation: Count "1 Mississippi" silently after they stop talking.

[View Timeline]  [Mark as Important]
```

---

## Long-Term Progress Tracking and Personalization

### User Baseline Establishment

**Phase 1: Initial Observation (Days 1-7)**

- Capture conversations in "observe-only" mode (no haptic coaching)
- Establish baseline metrics for all skill areas:
  - Average pace (words per minute)
  - Average turn length
  - Turn-taking balance
  - Interruption rate
  - Topic management patterns
  - Prosody characteristics (pitch variance, intensity variance)
  - Repair frequency and success rate

**Baseline Computation:**

```python
def compute_user_baseline(first_week_conversations):
    """
    Compute user's natural conversational baseline.

    Returns personalized norms for:
    - Pace, volume, pitch patterns
    - Turn-taking habits
    - Topic management style
    - Stress indicators
    """
    baseline = {}

    # Aggregate across all conversations
    all_turns = [turn for conv in first_week_conversations for turn in conv.turns if turn.speaker == 'wearer']

    baseline['pace_wpm'] = {
        'mean': np.mean([t.pace_wpm for t in all_turns]),
        'std': np.std([t.pace_wpm for t in all_turns]),
        'percentile_80': np.percentile([t.pace_wpm for t in all_turns], 80),
    }

    baseline['turn_length_seconds'] = {
        'mean': np.mean([t.duration for t in all_turns]),
        'median': np.median([t.duration for t in all_turns]),
    }

    baseline['interruption_rate'] = {
        'per_conversation': np.mean([count_interruptions(c) for c in first_week_conversations]),
    }

    # ... similar for other metrics

    return baseline
```

**Phase 2: Adaptive Baseline (Ongoing)**

- Baseline updated monthly to reflect skill improvements
- Old baseline archived (to show progress)
- Coaching thresholds adapt automatically

```python
def update_baseline_monthly(user_id, current_baseline, last_month_conversations):
    """
    Update user baseline to reflect skill improvement.

    Strategy:
    - Compute new baseline from last month's data
    - Compare to previous baseline
    - If improvement detected, adjust coaching thresholds upward
    - Archive old baseline for progress visualization
    """
    new_baseline = compute_user_baseline(last_month_conversations)

    # Detect improvements
    improvements = {}
    for metric in current_baseline.keys():
        old_val = current_baseline[metric]['mean']
        new_val = new_baseline[metric]['mean']

        if is_improvement(metric, old_val, new_val):
            improvements[metric] = (new_val - old_val) / old_val  # Percent change

    # Adjust coaching thresholds
    if 'pace_wpm' in improvements and improvements['pace_wpm'] > 0.1:
        # User improved pace control by >10%
        # Make coaching more demanding (raise the bar)
        new_baseline['pace_wpm']['coaching_threshold'] = new_baseline['pace_wpm']['percentile_80'] * 1.1

    # Save and archive
    save_baseline(user_id, new_baseline, archive=current_baseline)

    return new_baseline
```

### Goal-Based Coaching

Users, parents, or therapists can set specific goals. Coaching prioritizes goal-aligned patterns.

**Goal Definition Schema:**

```python
{
    "goal_id": "uuid",
    "user_id": "uuid",
    "goal_text": "Improve turn-taking and reduce interruptions",
    "target_skills": ["reciprocity", "turn_taking"],
    "target_metric": "interruption_rate",
    "current_value": 5.2,  # per conversation
    "target_value": 2.0,   # per conversation
    "deadline": "2026-05-01",
    "set_by": "parent" | "user" | "therapist",
    "status": "active" | "achieved" | "paused"
}
```

**Goal-Aligned Coaching Logic:**

```python
def apply_goal_based_coaching(patterns, user_goals):
    """
    Boost coaching priority for patterns aligned with user goals.
    """
    for pattern in patterns:
        for goal in user_goals:
            if pattern.skill_category in goal['target_skills']:
                pattern.priority_score *= 1.5  # Boost goal-aligned patterns

    return patterns
```

### Progress Dashboard

**Weekly View:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your Progress: Feb 6-12, 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 Conversations: 12 (42 minutes total)

🎯 Top Skills:

Turn-Taking       ████████░░ 78 (+12% vs last week)
Topic Management  ██████░░░░ 65 (-2%)
Prosody           ████████░░ 82 (+8%)

⚠️ Needs Work:
• Topic shifts still sometimes abrupt
• 3 overload moments this week (down from 5!)

✓ Wins:
• Zero interruptions in 4 conversations!
• Asked return questions in 10/12 chats

💡 Focus for Next Week:
Practice smooth topic transitions using "That reminds me..." or "Speaking of..."
```

**Monthly Report:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
January 2026 Progress Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Conversations: 48 (3.2 hours)
📈 Overall improvement: +18%

🏆 Biggest Wins:
  1. Interruptions reduced by 40% (5.2 → 3.1 per conversation)
  2. Turn-taking balance improved: Now 55/45 (was 70/30)
  3. Asked return questions in 85% of conversations (was 45%)

⚡ Skills Improving:
  • Reciprocity: +25%
  • Repair: +15%
  • Prosody: +12%

⚠️ Still Challenging:
  • Topic management (need more practice on transitions)
  • Overload prevention (work on recognizing early signs)

🎯 Your Goal: "Improve turn-taking"
  Status: 65% achieved (target: 2 interruptions per conversation)
  Current: 3.1 (started at 5.2)

💪 Recommended Focus:
Continue working on turn-taking. You're making great progress! Also start focusing on topic transitions—this will level up your conversations significantly.

[Download PDF Report]  [Share with Therapist]
```

### Therapist Collaboration Features

**Therapist Dashboard View:**

- View multiple clients' progress side-by-side
- Annotate specific conversation moments
- Set goals for clients
- Export progress reports for clinical documentation

**Therapist Annotation Workflow:**

1. Therapist logs into dashboard
2. Selects client
3. Views timeline of flagged moments from specific conversation
4. Adds clinical notes: "Good example of perspective-taking here. Discuss in next session."
5. Client sees annotation in their app: "Your therapist noted: ..."

**Privacy Controls:**

- Client must explicitly opt-in to therapist view per conversation
- Client can revoke access at any time
- Therapist access is read-only by default (no data deletion by therapist)

---

## Machine Learning Models and Training

### Model Architecture

**Model Type:** Gradient Boosted Decision Trees (XGBoost or LightGBM)

**Why Not Deep Learning?**
- Interpretability: GBDT models allow feature importance analysis
- Data efficiency: Effective with smaller datasets (important for rare autism dataset)
- Inference speed: Faster on-device and cloud inference
- Reliability: Less prone to catastrophic failures than neural networks

**Hybrid Approach:**
- Modulate API provides neural embeddings and tone scores (deep learning)
- Tizzy coaching models use embeddings as features in GBDT (hybrid)

### Feature Engineering

**Input Features (per conversation segment):**

1. **Acoustic Features (from Layer 1):**
   - Pace (words per minute)
   - Pause duration and frequency
   - Pitch mean, variance, range
   - Intensity mean, variance
   - Jitter, shimmer (voice quality)
   - Energy (RMS)

2. **Interaction Features:**
   - Turn length
   - Turn-taking balance
   - Overlap percentage
   - Response latency
   - Speaker diarization confidence

3. **Modulate Features (from Layer 2):**
   - Intent classification probabilities
   - Emotion scores (neutral, positive, negative, frustrated, confused)
   - Conversational signal scores (interest, disengagement, rapport)

4. **Context Features:**
   - Conversation duration (so far)
   - Environment tag (school, home, work)
   - Time of day
   - Speaker count

5. **User-Specific Features:**
   - Deviation from user baseline (e.g., pace 20% faster than baseline)
   - Historical pattern frequency (has user shown this pattern before?)

**Target Labels:**

```python
COACHING_LABELS = [
    'monologuing',
    'interruption',
    'missed_bid',
    'pace_too_fast',
    'pace_too_slow',
    'volume_too_loud',
    'flat_prosody',
    'escalation',
    'confusion_detected',
    'successful_repair',
    'good_reciprocity',
    'topic_shift_abrupt',
    'overload_risk',
    # ... 20-30 total labels
]
```

### Training Data Collection

**Phase 1: Supervised Learning with Therapist Labels**

- Partner with 5-10 speech-language pathologists
- Annotate 100-200 hours of autistic conversation recordings
- Label specific coaching moments with timestamps
- Cost: ~$20-40K for initial labeled dataset

**Phase 2: Active Learning**

- Deploy model with low confidence threshold (0.6)
- When confidence between 0.6-0.8, ask user: "Did you interrupt here? Yes/No"
- High-value labels with minimal user effort
- Improves model rapidly with real-world data

**Phase 3: Self-Supervised and Weak Supervision**

- Use user-reported moments: "I felt confused here" (button tap)
- Use conversation outcomes: If user rated conversation 8/10, assume positive patterns were present
- Use therapist post-session notes as weak labels

### Model Evaluation

**Metrics:**

- **Precision:** Of all haptics sent, what % were helpful? (user feedback)
- **Recall:** Of all true coaching moments, what % did we detect?
- **F1 Score:** Harmonic mean of precision and recall
- **User Satisfaction:** "Was this helpful?" rating per haptic

**Target Performance:**
- Precision >0.75 (75% of haptics are helpful)
- Recall >0.60 (catch 60% of coachable moments)
- User satisfaction rating >3.5/5

**A/B Testing:**

- Randomly assign 10% of users to new model version
- Compare haptic helpfulness ratings and user outcomes (conversation scores)
- Rollout if new model performs ≥5% better

### Model Monitoring and Retraining

**Continuous Monitoring:**
- Track model confidence distribution (drifting lower = model degrading)
- Track user feedback on haptics (% helpful vs. not helpful)
- Alert if precision drops below 0.70

**Retraining Schedule:**
- Retrain monthly with new labeled data
- Versioning: Models tagged with training date and performance metrics
- Rollback capability if new model underperforms

---

## Coaching Effectiveness Measurement

### How Do We Know Coaching Is Working?

**Primary Metrics:**

1. **User-Reported Improvement:**
   - Monthly survey: "Are your conversations getting easier?" (1-5 scale)
   - Specific skills: "Do you feel you're interrupting less?" (Yes/No)

2. **Objective Skill Metrics:**
   - Interruption rate trend (decreasing over time)
   - Turn-taking balance trend (moving toward 50/50)
   - Conversation score trend (increasing over time)

3. **Goal Achievement:**
   - % of users achieving stated goals within 90 days
   - Time to reach goal milestone

4. **Therapist Validation:**
   - Therapist ratings of client progress
   - Correlation between Tizzy metrics and clinical assessments

**Secondary Metrics:**

- User engagement: % of users wearing device 5+ days/week
- Haptic acceptance: % of haptics rated as helpful
- Feature adoption: % of users reviewing post-conversation summaries

### Randomized Controlled Trial (Future)

**Design:**
- Recruit 200 autistic adults/teens
- Randomly assign to:
  - Group A: Full Tizzy system (haptics + insights)
  - Group B: Insights only (no haptics)
  - Group C: Observe-only (no coaching, data collection only)
- Duration: 12 weeks
- Measure: Social communication skills (validated assessment), user satisfaction, goal achievement

**Expected Outcome:**
- Group A (full system) shows significantly greater improvement than Group C (control)
- If successful, publish in peer-reviewed journal (credibility for clinical adoption)

---

## Ethical Coaching Guardrails

### What Tizzy Does NOT Coach

1. **Suppressing Stimming:**
   - Tizzy does not coach against harmless self-soothing behaviors
   - Only flags if behavior disrupts conversation (e.g., loud vocalization drowns out speech)

2. **Forcing Neurotypical Norms:**
   - Goal is mutual understanding, not conformity
   - Example: Tizzy will not coach "smile more" (facial expressions are out of scope in V1 anyway)

3. **Punishing Authenticity:**
   - If user's direct communication style is effective for them, Tizzy doesn't force politeness
   - Coaching is about choice: "Here's how others might perceive this. You decide if you want to adjust."

4. **Coaching in Private Spaces:**
   - User can tag conversations as "private" (no coaching, no storage)
   - Hard mute feature for conversations user doesn't want captured at all

### User Control and Agency

- Users can dismiss any coaching suggestion: "Not helpful" → System learns
- Users can disable entire skill categories: "Don't coach me on prosody"
- Users can set coaching intensity: Conservative / Moderate / Aggressive
- Users can export and delete all their data at any time

---

## Open Questions and Future Research

1. **Context-Specific Coaching:**
   - How do we adapt coaching for different relationship types (boss vs. friend)?
   - Requires more granular context tagging and larger dataset

2. **Long-Term Skill Transfer:**
   - Does improvement with the device persist when device removed?
   - Requires longitudinal study with device-on and device-off phases

3. **Coaching for Co-Occurring Conditions:**
   - Many autistic people have ADHD, anxiety, or language processing differences
   - How do we adapt coaching for these co-occurring profiles?

4. **Generalization Across Environments:**
   - Does improvement in one context (home) transfer to others (work)?
   - May require targeted practice across contexts

5. **Balancing Coaching Density:**
   - Too much coaching = overwhelming and demoralizing
   - Too little coaching = not enough value
   - Optimal coaching frequency varies by user—how to personalize?

---

## Conclusion

Tizzy's Coaching Engine is the differentiator. It must be:
- **Effective:** Measurably improve conversational outcomes within 30 days
- **Personalized:** Adapt to each user's baseline, goals, and learning pace
- **Respectful:** Empower without punishing, honor neurodiversity
- **Transparent:** Users understand why they receive coaching
- **Controllable:** Users can customize or disable coaching as desired

This specification provides the foundation for building a coaching system that is technically robust, clinically grounded, and ethically sound. Success will be measured not by technology sophistication, but by lived experience improvement: better friendships, fewer misunderstandings, more confidence, less masking burnout.

The coaching engine must teach clarity and self-advocacy, not conformity. That is the mission.
