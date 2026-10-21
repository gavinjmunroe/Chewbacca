# Critical Challenges - The Hardest Problems Tizzy Must Solve

**Version:** 1.0
**Last Updated:** February 13, 2026
**Status:** Active Risk Tracking

---

## Executive Summary

These are not "nice to solve" problems. These are **existential challenges** that determine whether Tizzy becomes a transformative assistive technology or another failed wearable that triggers backlash. Each problem requires thoughtful, proactive solutions - not reactive crisis management.

If we mishandle any of these, the product dies. Not slowly. Quickly. With public backlash, regulatory pressure, or user harm.

---

## Problem 1: Social Acceptance and Bystander Trust

### The Core Problem

**The Friend pendant demonstrated the risk:** Even in adult tech circles, an always-listening device triggered "are you wearing a wire?" reactions and made bystanders uncomfortable. ([WIRED Review](https://www.wired.com/story/i-hate-my-ai-friend/))

If Tizzy is perceived as covert surveillance, it will:
- Create social friction for the wearer (exactly what we're trying to reduce)
- Generate public backlash and media criticism
- Be banned from schools, institutions, and public spaces
- Destroy trust with the autism community

### Why This Is Hyper-Critical

**Autistic users are already fighting stigma.** Adding "creepy tech" stigma on top of autism stigma is cruel and counterproductive. The device must be socially legible as assistive technology, not surveillance.

**Bystanders have legitimate concerns.** They cannot consent to something they don't know exists. If we position Tizzy as "hidden under a shirt" with "no visible indicator," we are manufacturing a scandal.

### Current Design Tensions

| Your Instinct | The Risk | The Resolution |
|---------------|----------|----------------|
| "Hide device under shirt to avoid bullying" | Hidden device = covert recording | Device can be *discreet* (normal-looking jewelry) without being *covert* (no indicator) |
| "No LED indicator, people will ask questions" | No indicator = bystander distrust | Explore subtle, socially acceptable indicators (small light, color change, simple signal) |
| "Just trust users to disclose" | Inconsistent disclosure = policy/legal exposure | System-enforced consent prompts for multi-party mode |

### Mitigation Strategies

#### 1. Reframe the Problem: Hide Stigma, Not Recording
- **Design goal:** Device looks like normal jewelry/accessory, premium and stylish
- **Not:** Device is hidden and covert
- **Analogy:** Hearing aids evolved from "hide it" to "stylish accessibility." Tizzy follows that path.

#### 2. Consent Mechanism That Is Socially Simple
- **Visual cue options being explored:**
  - Small LED that glows when recording others (not just wearer)
  - Subtle color-change material
  - Simple physical indicator (e.g., small flag or position change)
- **Verbal consent script:** App provides simple, non-awkward scripts:
  - "Hey, I'm using a conversation coach device. It records for my learning. Are you comfortable with that?"
  - "This necklace helps me with conversations. It's recording right now. Is that okay?"

#### 3. Self-Only Mode as Default Safe Mode
- **When device first activates:** Captures only wearer's voice (for solo practice/reflection)
- **Multi-party mode:** Requires explicit activation + consent prompt
- **School/public mode:** Auto-suggests self-only mode in busy environments

#### 4. Community Co-Design
- **Involve autistic users in indicator design:** What feels safe vs stigmatizing?
- **Test in real environments:** Does the consent mechanism work in practice?
- **Parent/therapist input:** What do they need to feel confident?

### Success Criteria

- [ ] <5% of user-reported interactions involve bystander discomfort or suspicion
- [ ] Consent mechanism tested with 50+ real conversations, refined based on feedback
- [ ] Device passes "coffee shop test" (strangers don't react with suspicion)
- [ ] Zero "hidden recording" media stories or social media incidents in first year
- [ ] Autism advocacy organizations endorse the product as ethically designed

### Open Questions (Must Answer by Prototype Phase)

1. What is the minimum viable indicator that satisfies both social acceptance AND user comfort?
2. How do we handle environments where consent is impossible (crowded bus, classroom)?
3. What happens when a bystander says "no" mid-conversation? (Graceful pause? Immediate mute?)
4. Can we make consent receipts visible to bystanders somehow? (QR code to show "this is assistive tech, not surveillance"?)

---

## Problem 2: Minors, Consent, and Schools

### The Core Problem

**Our target market is heavily minors.** Autistic kids navigating school transitions are a primary use case. But:
- **COPPA applies** to voice recordings from children under 13 ([FTC Guidance](https://www.ftc.gov/news-events/news/press-releases/2017/10/ftc-provides-additional-guidance-coppa-voice-recordings))
- **State recording laws vary** (one-party vs all-party consent) ([Justia Guide](https://www.justia.com/50-state-surveys/recording-phone-calls-and-conversations/))
- **Schools have FERPA obligations** and vendor control requirements ([Ed.gov Vendor FAQ](https://studentprivacy.ed.gov/sites/default/files/resource_document/file/Vendor%20FAQ.pdf))
- **Parental consent is complex:** Parent can consent for child to wear device, but cannot consent for OTHER children to be recorded

### Why This Is Hyper-Critical

**One incident destroys the company.**
- Parent discovers their child was recorded without consent → lawsuit
- School bans device after policy violation → media story → other schools pre-ban
- FTC enforcement action for COPPA violation → fines, mandatory audits, reputation damage

**This is not a "move fast and break things" problem.** This requires deliberate, conservative design.

### Current Legal/Policy Landscape

| Constraint | Requirement | Impact on Tizzy |
|------------|-------------|-----------------|
| COPPA (under 13) | Verifiable parental consent before collecting personal info | Need parent-controlled onboarding flow, not kid-initiated |
| State recording laws | Varies by state (CA = two-party, TX = one-party) | Must design for most restrictive (all-party consent) or restrict availability |
| School policies | Varies by district, often requires administrative approval | Cannot assume "parent bought it, school allows it" |
| FERPA (if school-integrated) | School must have direct control over vendor, written agreements | School partnership requires legal agreements, not consumer sales |

### Mitigation Strategies

#### 1. Phased Rollout by Age Group

**Phase 0: Adults only (18+)**
- College students, young adults navigating first jobs
- Eliminates COPPA, simplifies consent
- Proves product value before expanding to minors

**Phase 1: High school (14-17)**
- Parental consent required but simpler than under-13
- Still navigating consent for peers being recorded
- Work with schools on pilot programs with clear policies

**Phase 2: Middle school and younger (13 and under)**
- Only after COPPA compliance is fully validated
- Only after consent mechanisms are proven in older cohorts
- Requires most conservative design (e.g., self-only mode as strong default)

#### 2. School Partnership Model (Not Direct-to-Consumer for Schools)

**Consumer model:** Parent buys device, child wears to school
- **Problem:** School may not allow, parent and child lack authority to record other kids
- **Solution:** Clear school approval requirement, parent must get written permission

**School partnership model:** School pilots program with vendor agreement
- **Benefit:** FERPA compliance, clear data governance, cohort-based deployment
- **Requirement:** Legal agreement, training, oversight
- **Timeline:** Not V1, only after adult/consumer pilots prove value

#### 3. Conservative Data Handling for Minors

- **No cloud storage of raw audio for under-18 by default**
- **Parental dashboard:** Parents can see device activity, not raw recordings (respects teen privacy while giving parents oversight)
- **Automatic deletion timelines:** Shorter retention for minors
- **No therapist export without explicit parental approval**

#### 4. Legal Counsel and Compliance Review

- **Required before any minor users:** Retained privacy counsel review
- **State-by-state analysis:** Where can we operate without legal exposure?
- **Terms of Service clarity:** User explicitly acknowledges recording law obligations
- **Insurance:** Liability coverage for privacy incidents

### Success Criteria

- [ ] Zero COPPA violations
- [ ] Zero recording law violations or lawsuits
- [ ] Schools report Tizzy's consent model is clear and manageable
- [ ] Parents report feeling in control of their child's data
- [ ] State-by-state legal analysis completed before each market launch
- [ ] Privacy counsel retained and actively involved in product decisions

### Open Questions (Must Answer Before Serving Minors)

1. Do we require proof of school permission before activating device for minors in school mode?
2. What is our policy when state recording laws conflict? (Restrict service or design to most restrictive?)
3. How do we handle travel? (Kid uses device in one-party state, travels to all-party state)
4. What is minimum viable parental control dashboard? (Full surveillance = bad, no visibility = risky)
5. Can we build a "bystander consent database" where other parents opt-in their kids? (Complex but potentially valuable)

---

## Problem 3: Accuracy and Harm Risk

### The Core Problem

**Incorrect coaching can cause harm.** If we buzz a kid incorrectly mid-conversation, we can:
- Increase anxiety and self-consciousness
- Disrupt a conversation that was going fine
- Create mistrust of the device
- Worsen social performance instead of improving it

**False negatives are less harmful than false positives in real-time coaching.** It's better to miss a coaching moment than to incorrectly interrupt.

### Why This Is Hyper-Critical

**Autistic users often experience social anxiety and hypervigilance.** Adding an AI system that gives incorrect feedback can worsen these experiences. We are building assistive technology, not a perfectionist critic.

**Trust is fragile.** A few bad buzzes early on can cause users to disable haptics or abandon the device entirely.

### Current Technical Limitations

| Challenge | Why It's Hard | Risk Level |
|-----------|---------------|------------|
| Audio-only limits context | Cannot see facial expressions, body language, environmental cues | HIGH |
| Prosody interpretation is subtle | Sarcasm, teasing, and affection can sound similar acoustically | MEDIUM |
| Cultural/individual variation | What's "too loud" varies by culture, relationship, environment | MEDIUM |
| Novel situations | Model trained on limited dataset may not generalize | HIGH |
| Real-time processing constraints | Cannot run deepest analysis before haptic trigger | MEDIUM |

### Mitigation Strategies

#### 1. Conservative Confidence Thresholds

- **Haptic triggers only fire when model confidence is HIGH** (e.g., >85% confidence)
- **When uncertain, stay silent** (no buzz is better than wrong buzz)
- **Post-conversation review can show lower-confidence observations** ("We think this might have been a moment, what do you think?")

#### 2. Personalization and Baseline Calibration

- **First 7-14 days:** Device learns user's baseline
  - Normal speaking pace, pitch, intensity
  - Typical conversation patterns
  - User's own feedback on what's working
- **Coaching relative to personal baseline,** not population norms
- **Gradual introduction of haptics:** Start with fewer triggers, expand as confidence grows

#### 3. User Feedback Loop (Essential for V1)

- **After each haptic buzz:** User can mark it as "helpful" or "not helpful" (optional, quick)
- **After conversation:** Review shows "we buzzed you here because..." with option to disagree
- **Model learns from feedback:** False positives get downweighted for that user
- **Aggregate learning:** Patterns of false positives improve model for all users (privacy-preserving)

#### 4. Uncertainty Communication

- **Post-conversation language:**
  - "We noticed..." (observation, not judgment)
  - "You might try..." (suggestion, not command)
  - "We're not sure, but..." (when confidence is lower)
- **No absolutist language:** Never say "you did this wrong"
- **Celebrate complexity:** "Conversations are nuanced. We're learning together."

#### 5. Therapist-in-the-Loop for Edge Cases

- **Optional therapist review mode:** User can flag confusing sessions for therapist input
- **Therapist feedback improves model:** "Actually, this moment was fine because..."
- **Clinical validation studies:** Partner with SLPs to validate coaching accuracy

### Success Criteria

- [ ] False positive rate <5% (user-reported "unhelpful" haptic feedback)
- [ ] Users report feeling "supported, not criticized" (>4.5/5 on survey)
- [ ] Haptic accuracy improves over first 30 days per user (personalization works)
- [ ] Zero reports of device causing harm (anxiety, social harm, etc.)
- [ ] Clinical validation with SLPs shows coaching aligns with best practices

### Open Questions (Ongoing Research)

1. What is the right confidence threshold for each haptic pattern? (May vary by coaching type)
2. How do we detect when user is in high-stress state and should NOT be coached?
3. Can we build a "calibration conversation" flow where user practices with known scenarios?
4. How do we handle disagreement between model and user? (User says "that was fine," model said "issue")
5. What are the most common false positives, and can we systematically reduce them?

---

## Problem 4: The "Masking" Trap

### The Core Problem

**Masking is when autistic people suppress their natural behavior to "pass" as neurotypical.** It is exhausting, psychologically harmful, and associated with burnout and mental health struggles.

**Tizzy's coaching could accidentally teach masking instead of authentic communication.** If we coach users to "act neurotypical" rather than "communicate clearly while being yourself," we become part of the problem.

### Why This Is Hyper-Critical

**The autism community will (rightfully) reject a product that increases masking.** Autistic advocates have been vocal about the harms of masking and the importance of neurodiversity acceptance.

**Our mission is empowerment, not conformity.** We must distinguish between:
- **Helpful coaching:** "They seem confused, try rephrasing" (clarity)
- **Harmful coaching:** "Stop stimming, it's weird" (conformity)

### Current Design Risks

| Coaching Scenario | Masking Risk | Better Approach |
|-------------------|--------------|-----------------|
| "You're speaking too monotone, add expression" | Pressures user to fake emotion | "They might not realize you're interested. Try saying 'I'm really interested in this.'" |
| "Stop interrupting, it's rude" | Shames natural communication style | "They were still talking. Try waiting 2 seconds, then jump in." |
| "Don't talk about trains again, they're bored" | Suppresses special interests | "They changed the subject. Ask if they want to hear more or if we should switch topics." |
| "Make eye contact" | Forces uncomfortable behavior | "They might think you're not listening. Try nodding or saying 'uh-huh' to show you are." |

### Mitigation Strategies

#### 1. Product Philosophy: Clarity Over Conformity

**Core principle:** Tizzy coaches "How can you communicate your intent more clearly?" not "How can you act more normal?"

**Examples:**
- **Not:** "Stop talking about your interest"
- **Instead:** "Check if they want to keep discussing this topic"

- **Not:** "You're being too intense"
- **Instead:** "They seem overwhelmed. Try slowing down or pausing."

- **Not:** "Fix your tone"
- **Instead:** "Your tone might sound angry. If you're not angry, try adding 'I'm curious about...'"

#### 2. User Control Over Coaching Style

- **Settings for "coaching philosophy":**
  - **Clarity-focused** (default): Help me communicate clearly while being myself
  - **Social calibration:** Help me understand unspoken social expectations (opt-in)
- **Never force conformity:** User can disable specific coaching types
- **"Why this matters" explanations:** Every piece of coaching explains the communication goal, not a social rule

#### 3. Co-Design with Autistic Community

- **Advisory board of autistic adults:** Review coaching language and philosophy
- **User testing with diverse autistic users:** What feels supportive vs. conformity-driven?
- **Open feedback channel:** Users can report coaching that felt like "masking pressure"

#### 4. Celebrate Autistic Communication Styles

- **Strengths-based language:**
  - "You're great at sticking with topics deeply. Here's how to invite others in."
  - "Your direct communication is clear. Here's how to soften when needed."
- **Normalize neurodiversity:** App content explicitly talks about different communication styles being valid

#### 5. Self-Advocacy Coaching

- **Teach boundary-setting:**
  - "I need a break from this conversation"
  - "I'm getting overwhelmed, can we talk about this later?"
  - "I process things differently, can you give me a minute?"
- **Teach repair without apology:**
  - "Let me rephrase that"
  - "I think we misunderstood each other"
  - (Not: "Sorry for being weird")

### Success Criteria

- [ ] Autism advocacy organizations review and endorse coaching philosophy
- [ ] Users report feeling "supported to be myself" >90% (vs. "pressured to conform")
- [ ] Zero reports of coaching that felt like masking pressure (after refinement)
- [ ] Coaching language reviewed and approved by autistic advisors
- [ ] Strengths-based language prominent in app (measured via content audit)

### Open Questions (Requires Community Input)

1. What specific coaching language feels supportive vs. conformity-driven? (Needs user testing)
2. How do we coach "social calibration" (reading social expectations) without implying "you must conform"?
3. Can we build a "coaching philosophy quiz" that personalizes approach to user values?
4. How do we handle parents who want conformity-based coaching for their child? (Values conflict)
5. What role should stimming, eye contact, and other neurotypical expectations play? (Likely: device does NOT coach these)

---

## Problem 5: Hardware Audio Quality Under Clothing

### The Core Problem

**You want the device hidden under a shirt to avoid stigma.** Acoustically, this is challenging:
- Fabric muffles high frequencies
- Rubbing noise from clothing movement
- Reduced directionality and spatial clarity
- Moisture/sweat affecting microphone performance

**If audio quality is poor, the coaching will be inaccurate.** All downstream value depends on accurate capture.

### Why This Is Hyper-Critical

**Core product value requires acoustic nuance.** We're not building a transcription tool (where "good enough" audio works). We're detecting prosody, timing, intensity, hesitation - subtle acoustic features that are degraded by poor capture.

**Users will blame the product, not the hardware design.** "Tizzy gave me bad advice" = product failure, even if root cause is audio quality.

### Current Technical Challenges

| Scenario | Challenge | Impact on Coaching |
|----------|-----------|-------------------|
| Under t-shirt | Muffled, high-frequency loss | Prosody detection harder |
| Under sweater | Significant muffling, movement noise | Diarization (who's speaking) harder |
| Winter coat over device | Severe acoustic degradation | May be unusable |
| Physical activity (running, sports) | Wind noise, movement noise | Likely too noisy for coaching |
| Quiet environments (library) | Picks up echo, environmental noise | May work okay |

### Mitigation Strategies

#### 1. Hardware Design for Under-Clothing Use

- **Dual-microphone array:** Beamforming to isolate wearer's voice
- **Wind/noise filtering:** Advanced DSP to reduce clothing noise
- **Microphone placement:** Front-facing mics rather than bottom-facing
- **Hydrophobic coating:** Protect from sweat/moisture
- **Rigid housing:** Minimize vibration transmission from clothing contact

#### 2. Alternate Wearable Positions

- **Collar clip mode:** Device clips to collar (outside shirt) for better audio in critical situations
- **Necklace on outside:** Socially acceptable jewelry mode for users comfortable with visibility
- **Future forms:** Earring, watch, pin (R&D track)

#### 3. Audio Quality Detection and User Guidance

- **Real-time quality check:** Device detects poor audio and alerts user
  - "Audio quality low. Consider adjusting position."
- **Post-conversation quality score:** "This session had noisy audio, coaching may be less accurate."
- **Onboarding guidance:** "For best results, wear device outside shirt or clipped to collar."

#### 4. Graceful Degradation

- **When audio quality is poor:**
  - Reduce real-time haptic coaching (fewer false positives)
  - Focus on self-voice analysis (still valuable)
  - Provide general encouragement rather than specific coaching
- **When audio quality is good:**
  - Full coaching feature set
  - More confident insights

#### 5. Extensive Real-World Testing

- **Test environments:**
  - Classrooms (background noise, multiple speakers)
  - Cafeterias (loud, chaotic)
  - Outdoor spaces (wind, distance)
  - One-on-one quiet spaces (ideal case)
- **Test clothing:**
  - T-shirts, button-downs, sweaters, hoodies, coats
- **Test activities:**
  - Sitting, walking, running, fidgeting

### Success Criteria

- [ ] Word-error rate <10% in typical under-clothing scenarios
- [ ] Diarization accuracy (wearer vs. other) >90% in one-on-one conversations
- [ ] Prosody feature extraction quality validated via clinical SLP review
- [ ] Users report <5% of sessions have "unusable" audio
- [ ] Device works acceptably in 80%+ of real-world scenarios

### Open Questions (Requires Prototyping)

1. Is under-clothing audio quality sufficient for prosody analysis? (Empirical testing required)
2. What is the minimum viable placement that balances discretion and audio quality?
3. Can we use AI-based audio enhancement to recover signal from muffled audio?
4. Should we build multiple form factors for different use cases? (Discreet vs. high-quality modes)
5. What is the user's mental model of "when to adjust device for better audio"?

---

## Problem 6: Modulate Dependency and Vendor Lock-In Risk

### The Core Problem

**Modulate's ELM is positioned as the best voice-intent model for our use case** ([Modulate announcement](https://www.modulate.ai/press-releases/modulate-unveils-the-ensemble-listening-model-elm-a-fundamentally-new-ai-architecture-optimized-for-accuracy-transparency-and-cost)). But if we structure the relationship wrong:

- **We become a feature, not a company:** "Tizzy = Modulate API wrapper"
- **They control our roadmap:** Model changes break our product
- **They capture our value:** We generate autism dataset, they benefit
- **Exit is hard:** Switching vendors means rebuilding entire stack

### Why This Is Hyper-Critical

**Investors will ask: "What's your moat if Modulate builds this themselves?"**

**Strategic partnerships can become strategic traps.** If Modulate sees our traction and decides to build autism-specific coaching, we have no defensibility.

### Mitigation Strategies

#### 1. Clear IP Boundaries

**Non-negotiables in any agreement:**
- **Tizzy owns the autism dataset, 100%**
- **Modulate gets inference-only license** (they run models on our data, they don't train on it)
- **No transfer of training rights** without explicit separate agreement + payment

#### 2. Modular Architecture (Vendor Swap Capability)

- **Abstraction layer:** Tizzy's coaching logic is separate from voice understanding layer
- **Model output schema:** Standardized so we can swap underlying voice model
- **Fallback capability:** If Modulate API is down, degraded mode still works (even if less accurate)

#### 3. Build Proprietary Value on Top

**Modulate provides:** Voice intent, emotion, prosody understanding (commodity layer)

**Tizzy provides:**
- Autism-specific coaching taxonomy
- Personalization to individual user baselines
- Integration with haptics, timeline, progress tracking
- Clinical validation and therapist workflows
- Privacy and trust infrastructure

**This layering ensures Tizzy is defensible even if voice understanding becomes commoditized.**

#### 4. Multi-Vendor Strategy (Longer-Term)

- **Phase 1:** Modulate as primary voice model
- **Phase 2:** Evaluate alternatives (OpenAI, Anthropic, Hume AI, open-source)
- **Phase 3:** Build some proprietary voice models for autism-specific features

#### 5. Strategic Partnership Without Exclusivity

- **No exclusivity clause** unless Modulate pays significant fee to compensate
- **No "most favored nation" pricing** that blocks us from negotiating better deals elsewhere
- **Audit rights:** We can verify how our data is handled
- **Change control:** We must approve major model changes before deployment

### Success Criteria

- [ ] Modulate contract protects Tizzy's dataset ownership
- [ ] Architecture allows vendor swap within 60 days if needed
- [ ] Investors view Tizzy as defensible independent company
- [ ] We can articulate moat without mentioning Modulate
- [ ] We have evaluated 2+ alternative voice understanding platforms

### Open Questions (Legal and Strategic)

1. What is fair pricing for Modulate inference at scale? (Per-minute? Per-user?)
2. Do we need Modulate for V1, or can we ship with simpler models first? (De-risk dependency)
3. What happens if Modulate gets acquired by competitor? (Contingency planning)
4. Can we contribute to open-source voice understanding projects as alternative? (Community strategy)
5. How do we prevent Modulate from seeing our coaching IP? (Inference API should not expose our logic)

---

## Summary: These Are Not Optional Problems

These six challenges are **gating risks** for Tizzy's success:

1. **Social acceptance:** Solve this or device gets banned/rejected
2. **Minors and consent:** Solve this or face legal/regulatory disaster
3. **Accuracy and harm:** Solve this or damage users we're trying to help
4. **Masking trap:** Solve this or lose autism community trust
5. **Audio quality:** Solve this or core product doesn't work
6. **Modulate dependency:** Solve this or lack defensible moat

**Each problem has mitigation strategies, but they require proactive, thoughtful execution.** These are not "we'll figure it out later" problems. They are "design decisions we make NOW" problems.

**The ruthless truth:** Most hardware wearables fail not because of technology, but because of trust, adoption, or business model. These six problems address those failure modes head-on.

If we solve these, Tizzy becomes transformative. If we ignore them, Tizzy becomes a cautionary tale.
