# Open Questions and Ambiguities

**Version:** 1.0
**Last Updated:** February 13, 2026
**Status:** Living Document - Updated as Decisions Are Made

---

## Purpose

These are not optional questions to "figure out later." These are **core decisions that determine whether Tizzy becomes a world-changing assistive product or a scandal.**

Each question is logged with:
- **Criticality:** How urgent is this decision? (Blocks launch / Blocks scale / Improves product)
- **Who decides:** Who has authority and context to make this call?
- **Decision deadline:** When must this be resolved?
- **Current hypothesis:** What do we think the answer is?
- **Risks of wrong answer:** What happens if we get this wrong?

Questions are marked as **OPEN** (needs decision), **IN PROGRESS** (actively being researched), or **RESOLVED** (decision made, see notes).

---

## Category 1: Bystander Consent and Recording Indicators

### Q1.1: What is the minimum viable indicator that satisfies both social acceptance AND user comfort?

**Status:** OPEN
**Criticality:** Blocks launch
**Who decides:** Product lead + autistic user advisory board + legal counsel
**Decision deadline:** Before first user pilot (Phase 0, Month 2)

**Current hypothesis:**
Small LED indicator on device that:
- Glows steady when recording multi-party conversations
- Off when in self-only mode or muted
- Dim enough not to be distracting, bright enough to be visible when asked "are you recording?"

**Alternatives being explored:**
1. Color-change material (physical indicator, not electronic)
2. Small mechanical flag or position change
3. Smartphone app screen shows status (less ideal, requires showing phone)
4. No indicator + verbal consent only (legal risk, social risk)

**Research needed:**
- User testing with autistic users: What feels safe vs. stigmatizing?
- Bystander testing: Can people notice and understand the indicator?
- Legal review: Does indicator meet "reasonable notice" standard in all-party consent states?

**Risks of wrong answer:**
- Too visible = stigma, bullying, users won't wear it
- Not visible enough = bystander distrust, legal exposure, social backlash
- Confusing indicator = doesn't serve consent or trust purpose

---

### Q1.2: How do we handle environments where consent is impossible or impractical?

**Status:** OPEN
**Criticality:** Blocks scale (especially schools)
**Who decides:** Product lead + legal counsel + school partnership team
**Decision deadline:** Before school pilots (Phase 3, Month 12)

**Scenarios:**
1. **Crowded bus:** Can't get consent from 30 people
2. **Classroom:** Teacher may consent, but what about 25+ students?
3. **Public event:** Concert, sports game, busy restaurant
4. **Spontaneous interaction:** Stranger asks for directions

**Current hypothesis:**
- **Self-only mode as default in public/crowded settings**
  - Device captures only wearer's speech patterns
  - Coaching focuses on user's prosody, pacing, intensity (still valuable)
  - No bystander consent needed if their voices aren't retained
- **Multi-party mode requires explicit activation**
  - User confirms "I have consent for this conversation"
  - System prompts reminder to get consent
- **Classroom mode (future):** School-level consent + opt-out for specific students

**Alternatives:**
1. "Implied consent" in public spaces (risky legally and ethically)
2. Require manual activation per conversation (friction, users won't do it)
3. Restrict usage to private 1-on-1 only (limits value significantly)

**Research needed:**
- Legal analysis: What counts as "public space" where recording laws are more permissive?
- School legal review: Can schools grant blanket consent for enrolled students?
- Technical feasibility: How accurate is self-only voice isolation?

**Risks of wrong answer:**
- Too restrictive = device isn't useful in real-world situations
- Too permissive = legal violations, bystander complaints, social backlash

---

### Q1.3: What happens when a bystander says "no" mid-conversation?

**Status:** OPEN
**Criticality:** Blocks launch
**Who decides:** Product lead + UX design + legal counsel
**Decision deadline:** Before first user pilot (Phase 0, Month 2)

**Scenario:** User starts conversation, gets consent, then mid-way bystander says "actually, I'm not comfortable with this."

**Current hypothesis:**
- **Immediate graceful pause:**
  - User can tap button to instantly mute and stop capture
  - App shows "Conversation paused - bystander requested stop"
  - Previously captured audio from that session is flagged for review
  - User chooses: Delete entire session OR save only self-analysis (remove other person's voice)

**Alternatives:**
1. Auto-delete everything from that session (safest, loses all value)
2. Save everything but mark as "consent withdrawn" (ethical concern)
3. Segment audio and only delete post-withdrawal portions (complex technically)

**UX questions:**
- How easy is it to pause? (Needs to be instant, no fumbling)
- How do we communicate "I'm pausing now" to the bystander?
- What if user forgets to pause? (Auto-timeout? Reminder prompts?)

**Research needed:**
- User testing: Can users execute pause flow smoothly in real conversation?
- Legal review: What's required when consent is withdrawn?
- Bystander testing: Do they feel respected by pause mechanism?

**Risks of wrong answer:**
- Clunky pause = bystander distrust, social awkwardness
- No deletion = ethical violation, legal exposure
- Lose all data = users won't ask for consent (defeats purpose)

---

### Q1.4: Can we make consent receipts visible to bystanders somehow?

**Status:** IN PROGRESS
**Criticality:** Improves trust (not blocking)
**Who decides:** Product lead + UX design
**Decision deadline:** Phase 1 (Month 6)

**Current hypothesis:**
QR code or NFC tag on device that bystanders can scan to see:
- "This is Tizzy, an assistive conversation coach"
- "Data is stored locally and encrypted"
- "You can ask the wearer to pause or delete at any time"
- Link to public privacy policy and bystander rights

**Alternatives:**
1. Physical card user carries and shows
2. Smartphone screen shows consent receipt
3. Audio announcement from device ("Recording started")
4. No bystander-facing info (rely on verbal explanation)

**Research needed:**
- User testing: Is QR code/NFC socially awkward?
- Bystander testing: Does this increase comfort vs. feeling "tech-heavy"?

**Risks of wrong answer:**
- Overcomplicates consent flow
- Feels too "official" and creates more questions than it answers
- Or does nothing (bystanders don't bother to scan)

---

## Category 2: Minor Users and COPPA Compliance

### Q2.1: Do we require proof of school permission before activating device for minors in school mode?

**Status:** OPEN
**Criticality:** Blocks minors in schools
**Who decides:** Legal counsel + product lead + school partnerships lead
**Decision deadline:** Before high school pilots (Phase 3, Month 12)

**Current hypothesis:**
Yes, require documentation of school permission:
- Parent uploads signed permission form from school
- Or school provides list of approved student IDs
- Device will not activate in "school mode" without verification

**Alternatives:**
1. Honor system (parent confirms school approved)
2. No school-specific requirement (treat as personal device)
3. Require school to provision devices directly (B2B only for schools)

**Tradeoffs:**
- Verification = slower activation, potential privacy concerns (we have school data)
- No verification = policy violations, school backlash, potential bans

**Research needed:**
- School partnership discussions: What do schools need for comfort?
- Legal review: Does this reduce our liability or shift it to parent/school?

**Risks of wrong answer:**
- Too strict = parents can't easily use product
- Too lax = school bans after policy violations

---

### Q2.2: What is our policy when state recording laws conflict?

**Status:** OPEN
**Criticality:** Blocks geographic expansion
**Who decides:** Legal counsel + exec team
**Decision deadline:** Before scaling beyond pilot states (Phase 1, Month 6)

**Scenario:**
- **One-party consent states** (e.g., Texas): Only wearer needs to consent
- **All-party consent states** (e.g., California): Everyone must consent
- **Travel:** User in Texas visits California - which rule applies?

**Current hypothesis:**
Design for most restrictive standard nationwide:
- Require all-party consent mechanisms regardless of state
- Reduces legal exposure and simplifies product
- May be more friction, but avoids confusion and mistakes

**Alternatives:**
1. Geo-based rules (device detects state, enforces local law) - complex, error-prone
2. Restrict availability to one-party states only - limits market
3. User bears responsibility (terms of service) - doesn't protect users or us

**Research needed:**
- Legal analysis: Can we confidently detect jurisdiction? (Travel, border cases)
- User research: Is all-party consent feasible in practice?

**Risks of wrong answer:**
- Geo-based rules fail = legal violations
- One-party only = miss big markets like California, New York
- All-party default = too much friction, users abandon

---

### Q2.3: How do we handle travel between different legal jurisdictions?

**Status:** OPEN
**Criticality:** Improves product (not blocking)
**Who decides:** Legal counsel + product lead
**Decision deadline:** Phase 2 (Month 9)

**Scenario:** Kid uses device in Texas (one-party), travels to California (all-party) for vacation.

**Current hypothesis:**
- App detects location change (GPS or manual user input)
- Prompts user: "You're now in California, an all-party consent state. Please get explicit consent."
- User acknowledges or switches to self-only mode

**Alternatives:**
1. Geo-fencing auto-switches consent mode (error-prone, privacy concerns with GPS)
2. No location awareness (user responsible for knowing local law)
3. Always all-party consent regardless of location (safest, already preferred approach)

**Research needed:**
- Legal review: Is location detection reliable enough to bet on?
- User research: How often do users travel across state lines?

**Risks of wrong answer:**
- Geo-detection fails = violations
- Over-reliance on user knowledge = mistakes
- GPS tracking for compliance = privacy irony

---

### Q2.4: What is minimum viable parental control dashboard?

**Status:** IN PROGRESS
**Criticality:** Blocks minors (under 18)
**Who decides:** Product lead + autistic teen advisors + parent advisors
**Decision deadline:** Before high school pilots (Phase 3, Month 12)

**Tension:** Parents want oversight. Teens want privacy. We must balance.

**Current hypothesis:**
**Parent can see:**
- Device usage (when it was worn, how much)
- High-level patterns (topics coached, trends over time)
- Safety alerts (if system detects distress, escalation, concerning patterns)
- What data exists and when it will be deleted

**Parent cannot see:**
- Raw conversation content (no surveillance playback)
- Specific conversation partners (unless teen chooses to share)
- Real-time tracking or monitoring

**Teen controls:**
- Can share specific insights with parent ("Look, I improved at this!")
- Can set boundaries on what parent sees
- Cannot be forced to share against their will (undermines trust)

**Alternatives:**
1. Full parent access (helicopter parenting, teen won't use)
2. No parent access (parent won't buy, safety concerns)
3. Age-based tiers (under 13 = more parent control, 16+ = teen control)

**Research needed:**
- Teen user testing: What level of parent access feels safe vs. invasive?
- Parent surveys: What do they need to feel comfortable?
- Therapist input: What's clinically appropriate?

**Risks of wrong answer:**
- Too much parent access = teens reject product, masking pressure
- Too little parent access = parents don't buy, safety incidents

---

### Q2.5: Can we build a "bystander consent database" where other parents opt-in their kids?

**Status:** OPEN
**Criticality:** Future optimization (not blocking)
**Who decides:** Product lead + legal counsel + school partnerships
**Decision deadline:** Phase 3+ (Month 18+)

**Concept:**
Parent network where families opt-in:
- "My child consents to being in conversations with other Tizzy users"
- Reduces friction in school/social settings
- Creates network effect (more kids using = easier consent)

**Challenges:**
- Privacy complexity (who manages this database?)
- Revocation (what if parent withdraws consent mid-year?)
- Non-users (what about kids whose parents didn't opt in?)
- Liability (are we now responsible for managing consent at scale?)

**Alternatives:**
1. School-level blanket consent (simpler, but school-dependent)
2. No database (manual consent every time)
3. Self-only mode as default (avoids problem entirely)

**Research needed:**
- Legal review: Is this even viable?
- Parent surveys: Would they participate?
- School discussions: Do schools prefer this or school-level consent?

**Risks of wrong answer:**
- Build complex system that no one uses
- Create new liability exposure
- Or miss opportunity to reduce friction significantly

---

## Category 3: Model Accuracy and Coaching Quality

### Q3.1: What is the right confidence threshold for each haptic pattern?

**Status:** IN PROGRESS
**Criticality:** Blocks launch (impacts user safety)
**Who decides:** ML team + clinical advisor + user testing
**Decision deadline:** Before first user pilot (Phase 0, Month 2)

**Current hypothesis:**
- **High-confidence coaching** (85%+ model certainty): Real-time haptic triggers
- **Medium-confidence observations** (70-85%): Show in post-conversation review with "we think..."
- **Low-confidence signals** (<70%): Don't show to user, use for research only

**Different thresholds by coaching type:**
- **Safety coaching** (escalation, overload): Lower threshold okay (90%+ better safe than miss)
- **Social coaching** (ask return question): Higher threshold (95%+ to avoid false positives)

**Research needed:**
- A/B testing: What threshold minimizes false positives while catching real moments?
- User feedback: Which false positives are most harmful to trust?
- Clinical validation: Do thresholds align with evidence-based practice?

**Risks of wrong answer:**
- Too low = frequent false positives, user disables haptics, trust erodes
- Too high = miss real coaching moments, no value delivered

---

### Q3.2: How do we detect when user is in high-stress state and should NOT be coached?

**Status:** OPEN
**Criticality:** Blocks scale (user safety)
**Who decides:** ML team + clinical advisor
**Decision deadline:** Phase 1 (Month 6)

**Scenario:** User is already overwhelmed, anxious, or in meltdown. Real-time coaching could worsen state.

**Current hypothesis:**
Acoustic stress markers:
- Rapid escalation in pitch variance
- Shortened breath patterns
- Increased speech rate + intensity
- Detected crying or distress vocalizations

**Response:**
- Suppress haptic coaching
- Offer comfort prompt post-conversation ("That seemed hard. Want to talk about it?")
- Gentle suggestion to take break
- Alert parent/therapist if user has opted in for crisis support

**Alternatives:**
1. Always coach (risky)
2. Let user manually enable "do not coach" mode (requires awareness they lack in crisis)
3. Biometric stress detection (heart rate from watch, if integrated)

**Research needed:**
- Clinical literature: What are reliable stress markers in voice?
- User testing: When do users want coaching paused?
- Safety testing: Can we detect distress accurately?

**Risks of wrong answer:**
- Coach during crisis = harm user, worsen anxiety
- Too sensitive = pause coaching when not needed, reduce value

---

### Q3.3: Can we build a "calibration conversation" flow where user practices with known scenarios?

**Status:** IN PROGRESS
**Criticality:** Improves product (not blocking)
**Who decides:** Product lead + UX design + clinical advisor
**Decision deadline:** Phase 1 (Month 6)

**Concept:**
Onboarding includes practice scenarios:
- User has conversation with AI agent or pre-recorded partner
- System learns user's baseline
- User gets feedback in safe environment before real-world use
- Reduces false positives through personalization

**Scenarios:**
- "Tell me about your favorite topic for 2 minutes" (monologue detection)
- "Have a back-and-forth conversation about weekend plans" (reciprocity)
- "Explain something complex to someone unfamiliar" (clarity, pacing)

**Benefits:**
- Faster personalization (don't need 7 days of real-world data)
- User learns haptic patterns in safe environment
- Builds trust (user sees how system works before real stakes)

**Challenges:**
- Takes time (onboarding friction)
- AI conversation partner needs to be good enough
- Practice ≠ real-world (transfer problem)

**Research needed:**
- User testing: Is practice valuable or annoying?
- Technical: Can we build convincing practice scenarios?

**Risks of wrong answer:**
- Bad practice scenarios = user learns wrong patterns
- Too much onboarding = users abandon before real value

---

### Q3.4: How do we handle disagreement between model and user?

**Status:** IN PROGRESS
**Criticality:** Blocks launch (trust and learning)
**Who decides:** ML team + product lead
**Decision deadline:** Before first user pilot (Phase 0, Month 2)

**Scenario:** System says "you interrupted," user says "no I didn't, they were done talking."

**Current hypothesis:**
- **User is always right in their own experience**
- System learns from disagreement:
  - "Thanks for the feedback. We'll adjust."
  - Future similar moments weighted down for that user
  - Aggregate disagreements improve model for everyone
- Post-conversation review always allows "this is wrong" feedback

**Alternatives:**
1. System insists it's right (destroys trust)
2. System always defers to user (no learning)
3. Ask clarifying questions ("Were they done talking, or did you think they were?")

**Research needed:**
- User testing: How do users want to give feedback?
- ML research: How much does user feedback improve accuracy?

**Risks of wrong answer:**
- Ignore user feedback = trust destroyed
- Over-rely on user feedback = users game system or lack insight

---

### Q3.5: What are the most common false positives, and can we systematically reduce them?

**Status:** IN PROGRESS
**Criticality:** Blocks scale (user trust)
**Who decides:** ML team + clinical advisor
**Decision deadline:** Ongoing (continuous improvement)

**Current hypothesis:**
Common false positive patterns we expect:
- **Cultural communication styles** (e.g., overlap is normal in some cultures, not interruption)
- **Relationship context** (teasing sounds like escalation but isn't)
- **Sarcasm/humor** (sounds negative but is bonding)
- **Neurodivergent communication** (directness flagged as rude, special interest depth flagged as monologue)

**Mitigation strategies:**
1. **User-reported culture/context settings**
   - "In my culture, we overlap a lot when excited - that's normal"
2. **Relationship tags**
   - "This is my best friend, we roast each other"
3. **Active learning**
   - System asks "Was this a problem or was it fine?" and learns

**Research needed:**
- Error analysis on pilot data: What are actual false positives?
- Diverse user testing: Do patterns vary by demographics?

**Risks of wrong answer:**
- Cultural bias in coaching = alienate users, harm via conformity pressure
- Can't reduce false positives = users disable coaching

---

## Category 4: Product Philosophy and "Masking"

### Q4.1: What specific coaching language feels supportive vs. conformity-driven?

**Status:** IN PROGRESS
**Criticality:** Blocks launch (core to mission)
**Who decides:** Autistic advisory board + clinical advisor + UX writing
**Decision deadline:** Before first user pilot (Phase 0, Month 2)

**Current hypothesis:**
See Product Philosophy doc for framework. But needs real user testing.

**Research method:**
- Show 20+ autistic users different coaching phrasings
- Ask: "Does this feel supportive or judgmental?"
- A/B test different language in pilot
- Iterate based on feedback

**Example test:**
- Option A: "They seem confused. Try rephrasing."
- Option B: "They might not understand. Want to explain differently?"
- Option C: "Your explanation was unclear. Simplify it."

**Research needed:**
- User testing with diverse autistic users (various ages, support needs, communication styles)

**Risks of wrong answer:**
- Conformity-driven language = community backlash, users feel harmed
- Too vague language = users don't know what to do differently

---

### Q4.2: How do we coach "social calibration" without implying "you must conform"?

**Status:** OPEN
**Criticality:** Blocks scale (core to mission)
**Who decides:** Autistic advisory board + clinical advisor
**Decision deadline:** Phase 1 (Month 6)

**Tension:**
- Users want to understand social expectations (knowledge)
- Users don't want to be pressured to meet them (autonomy)

**Current hypothesis:**
**Framing: "Here's what they might be expecting. You choose how to respond."**

Examples:
- ❌ "Make eye contact, it's polite"
- ✅ "Many people expect eye contact to show listening. If you're comfortable, try it. Or, say 'I'm listening, I just focus better looking away.'"

- ❌ "Stop talking about trains"
- ✅ "They might want to talk about other topics too. You can keep going and say 'let me finish this thought,' or ask 'want to hear more or switch topics?'"

**Settings:**
- User chooses coaching philosophy:
  - **Clarity mode** (default): Help me communicate my intent
  - **Calibration mode** (opt-in): Also explain social expectations

**Research needed:**
- User testing: Does framing preserve autonomy?
- Clinical input: What's evidence-based social skills coaching?

**Risks of wrong answer:**
- Pressure to conform = masking harm
- No calibration = users miss expectations they want to know

---

### Q4.3: Can we build a "coaching philosophy quiz" that personalizes approach to user values?

**Status:** IN PROGRESS
**Criticality:** Improves product (not blocking)
**Who decides:** Product lead + UX design + autistic advisors
**Decision deadline:** Phase 2 (Month 9)

**Concept:**
Onboarding quiz explores user values:
- "I want to understand social rules, even if I don't follow them" (agree/disagree)
- "I want to be more myself, not more 'normal'" (agree/disagree)
- "I want coaching that helps me fit in" (agree/disagree)
- "I want coaching that helps me be understood" (agree/disagree)

**Outputs:**
- Personalized coaching style
- Language adjustments
- Which coaching types are emphasized

**Research needed:**
- User testing: Does quiz feel helpful or intrusive?
- Can we actually personalize effectively based on answers?

**Risks of wrong answer:**
- Quiz forces users into boxes that don't fit
- Or does nothing (no real personalization)

---

### Q4.4: How do we handle parents who want conformity-based coaching for their child?

**Status:** OPEN
**Criticality:** Blocks scale (parent buyers)
**Who decides:** Exec team + autistic advisory board
**Decision deadline:** Before parent-driven sales (Phase 2+)

**Scenario:** Parent says "I want you to teach my child to make eye contact, stop talking about Pokemon, and act normal."

**Current hypothesis:**
**We don't build that product. We educate the parent.**

**Approach:**
1. **Educational content:** "Why masking harms autistic people"
2. **Reframe goals:** "Let's help your child be understood, not make them fake"
3. **Clinical backing:** SLPs and autism experts endorse our approach
4. **Autistic adult testimonials:** "I wish I'd learned clarity, not conformity"

**Hard line:** If parent insists on conformity coaching, we decline the sale.

**Risks:**
- Lose parent buyers (smaller market)
- But maintain mission integrity and community trust

**Alternatives:**
1. Build "parent mode" with conformity coaching (betrays mission)
2. Let parents choose coaching style (enables harm)
3. Age-based control (parents control for young kids)

**Research needed:**
- Parent surveys: How many want conformity vs. clarity?
- Autism advocate input: Where is the line?

**Risks of wrong answer:**
- Build harm tool = community backlash, mission failure
- Turn away too many parents = business fails

---

### Q4.5: What role should stimming, eye contact, and other neurotypical expectations play?

**Status:** OPEN
**Criticality:** Blocks launch (core to mission)
**Who decides:** Autistic advisory board (veto power) + clinical advisor
**Decision deadline:** Before first user pilot (Phase 0, Month 2)

**Current hypothesis:**
**Tizzy does NOT coach these behaviors.**
- No "stop stimming"
- No "make eye contact"
- No "sit still"
- No "don't fidget"

**Why:** These are neurotypical expectations that don't improve communication clarity. Coaching them = masking.

**Exception:** If user specifically requests help with these (opt-in only, with education about risks)

**Research needed:**
- Autistic advisory board discussion
- Clinical literature: What's evidence-based vs. conformity-driven?

**Risks of wrong answer:**
- Coach these = community backlash, harm users
- Never coach even when user wants = paternalism

---

## Category 5: Hardware and Technical Feasibility

### Q5.1: Is under-clothing audio quality sufficient for prosody analysis?

**Status:** IN PROGRESS
**Criticality:** Blocks launch (core product value)
**Who decides:** Hardware team + ML team + clinical advisor
**Decision deadline:** Prototype testing (Phase 0, Month 1)

**Research method:**
- Build prototype
- Test in real environments (under t-shirt, sweater, coat)
- Measure: word error rate, diarization accuracy, prosody feature extraction quality
- Clinician reviews: Can SLP hear tone, pace, intensity clearly?

**Success criteria:**
- Word error rate <10%
- Prosody features extractable with >80% accuracy
- Diarization (who's speaking) >85% accurate

**If quality is insufficient:**
- Fallback 1: Recommend clip-on mode for critical conversations
- Fallback 2: Build alternate form factor (collar clip, brooch)
- Fallback 3: Advanced audio enhancement AI

**Risks of wrong answer:**
- Ship with poor audio = inaccurate coaching = user harm
- Over-invest in perfect audio = delay launch unnecessarily

---

### Q5.2: What is the minimum viable placement that balances discretion and audio quality?

**Status:** IN PROGRESS
**Criticality:** Blocks launch (form factor decision)
**Who decides:** Hardware team + UX design + user testing
**Decision deadline:** Prototype testing (Phase 0, Month 1)

**Options:**
1. **Under shirt, mid-chest:** Most discreet, worst audio
2. **On collar, outside shirt:** Better audio, more visible
3. **Under shirt, near collar:** Compromise
4. **Clip-on brooch/pin:** Easy to adjust, less stigmatizing than "medical device"

**User testing needed:**
- Autistic users: What feels comfortable socially?
- Audio testing: Which placement gives sufficient quality?

**Risks of wrong answer:**
- Too visible = users won't wear it
- Too hidden = audio too poor for coaching

---

### Q5.3: Can we use AI-based audio enhancement to recover signal from muffled audio?

**Status:** IN PROGRESS
**Criticality:** Improves product (not blocking)
**Who decides:** ML team + hardware team
**Decision deadline:** Phase 1 (Month 6)

**Current hypothesis:**
Yes, train audio enhancement model:
- Input: Muffled/noisy audio from under-clothing
- Output: Enhanced audio with recovered high frequencies, reduced noise
- Train on paired dataset (clean audio + artificially muffled versions)

**Benefits:**
- Better coaching accuracy
- More forgiving hardware design
- Works across different clothing types

**Risks:**
- Enhancement artifacts = false prosody signals
- Computationally expensive (battery drain)
- Doesn't exist yet (R&D risk)

**Research needed:**
- Literature review: State-of-the-art audio enhancement
- Prototype testing: Does it actually improve coaching?

---

### Q5.4: Should we build multiple form factors for different use cases?

**Status:** OPEN
**Criticality:** Future product strategy
**Who decides:** Product lead + exec team
**Decision deadline:** Phase 2+ (Month 9+)

**Current hypothesis:**
Yes, eventually:
- **Necklace:** Default, most versatile
- **Clip-on:** Better audio for critical conversations (interviews, presentations)
- **Earring:** Future R&D, female-focused
- **Watch integration:** Partner with smartwatch makers
- **Glasses:** Long-term, pairs with video analysis

**V1:** Necklace only (focus)
**V2:** Add clip-on option
**V3+:** Explore ecosystem

**Risks:**
- Too many form factors = support burden, manufacturing complexity
- One form factor only = doesn't fit everyone's needs

---

### Q5.5: What is the user's mental model of "when to adjust device for better audio"?

**Status:** OPEN
**Criticality:** Improves product (not blocking)
**Who decides:** UX research + product lead
**Decision deadline:** Phase 1 (Month 6)

**Current hypothesis:**
Most users won't think about audio quality. We need to guide them.

**Approach:**
- **Real-time quality indicator** in app ("Audio quality: Good/Fair/Poor")
- **Smart suggestions:** "Audio is muffled. Try adjusting necklace or moving to quieter space."
- **Post-conversation quality score:** "This session had noisy audio, insights may be less accurate."

**Research needed:**
- User testing: Do users notice quality issues?
- Can we predict when audio will be too poor for coaching?

---

## Category 6: Business Model and Partnerships

### Q6.1: What is fair pricing for Modulate inference at scale?

**Status:** IN PROGRESS
**Criticality:** Impacts unit economics
**Who decides:** Exec team + finance + Modulate partnership
**Decision deadline:** Before contract negotiation (Phase 0, Month 2)

**Pricing models:**
- **Per-minute:** $0.0X per minute of audio processed
- **Per-user:** $X per active user per month
- **Flat license:** $X per year regardless of volume
- **Revenue share:** X% of Tizzy subscription revenue

**Research needed:**
- Modulate's current pricing (if available)
- Competitive voice AI pricing (OpenAI, Google, Hume)
- Our usage projections (hours per user per month)

**Target:** Modulate cost <20% of subscription revenue

**Risks of wrong answer:**
- Overpay = unit economics don't work
- Underpay = Modulate won't partner or restricts use

---

### Q6.2: Do we need Modulate for V1, or can we ship with simpler models first?

**Status:** IN PROGRESS
**Criticality:** De-risk dependency
**Who decides:** ML team + product lead
**Decision deadline:** Before contract negotiation (Phase 0, Month 2)

**Current hypothesis:**
**V1 can ship with simpler models. Add Modulate in V2 when we have revenue.**

**V1 approach:**
- Open-source speech models (Whisper for transcription)
- Basic prosody analysis (librosa, custom features)
- Simple classification models for coaching triggers
- Proves product value without vendor dependency

**V2 approach:**
- Add Modulate for better tone/emotion understanding
- Improves accuracy but not required for core value

**Benefits:**
- Reduces upfront costs
- Proves we can build without Modulate (negotiation leverage)
- Faster iteration (no vendor approval needed)

**Risks:**
- V1 accuracy is lower (more false positives)
- Modulate's value prop is real, delaying it delays better coaching

**Research needed:**
- Prototype testing: Is simpler model "good enough"?

---

### Q6.3: What happens if Modulate gets acquired by competitor?

**Status:** OPEN
**Criticality:** Strategic risk
**Who decides:** Exec team + legal counsel
**Decision deadline:** Before contract signature (Phase 0, Month 2)

**Scenario:** Meta buys Modulate. Or Google. Or Microsoft. They restrict access or sunset the product.

**Current hypothesis:**
**Contract must include:**
- **Change of control clause:** If Modulate is acquired, we get continued access at same terms OR we can exit with no penalty
- **12-month notice period** for any termination
- **Data protection:** Modulate cannot transfer our data to acquirer

**Fallback plan:**
- Modular architecture means we can swap voice understanding layer in 60-90 days
- Pre-identified alternatives (OpenAI, Hume AI, open-source)

**Risks:**
- No contract protection = sudden loss of core dependency
- Over-rely on Modulate = existential risk

---

### Q6.4: How do we prevent Modulate from seeing our coaching IP?

**Status:** IN PROGRESS
**Criticality:** IP protection
**Who decides:** ML team + legal counsel
**Decision deadline:** Before integration (Phase 0, Month 3)

**Current hypothesis:**
**Inference API should be black box:**
- We send: Audio features or embeddings
- They return: Tone, emotion, prosody classifications
- We keep: Coaching logic, personalization, skill taxonomy

**Our coaching IP stays in our systems:**
- Mapping from voice signals to coaching actions
- User personalization algorithms
- Progress tracking and goal generation

**Contract term:** Modulate has no training rights to our autism dataset or coaching models.

**Risks:**
- API exposes too much data = Modulate learns our approach
- We expose coaching logic in API calls = they copy it

---

### Q6.5: Can we contribute to open-source voice understanding projects as alternative?

**Status:** OPEN
**Criticality:** Long-term strategy
**Who decides:** Exec team + ML team
**Decision deadline:** Phase 2+ (Month 9+)

**Concept:**
Contribute to open-source prosody/emotion AI projects:
- Share non-sensitive research findings
- Collaborate with academic researchers
- Build community alternative to commercial APIs

**Benefits:**
- Reduces vendor dependency long-term
- Aligns with mission (open, accessible)
- Good PR and community trust

**Risks:**
- Time investment with uncertain ROI
- Could help competitors
- Distracts from core product

**Research needed:**
- What open-source projects exist?
- Would contribution actually help us?

---

## Decision Tracking and Accountability

### How We'll Use This Document

1. **Review every sprint:** Product team reviews open questions
2. **Escalate blockers:** Critical decisions get exec attention immediately
3. **Document decisions:** When resolved, log decision, rationale, who decided
4. **Revisit as needed:** Decisions can be revisited if new information emerges

### Decision Log Template

When a question is resolved, update with:

```
**RESOLVED - [Date]**
**Decision:** [What we decided]
**Who decided:** [Names/roles]
**Rationale:** [Why this decision]
**Risks accepted:** [Known downsides]
**Revisit trigger:** [What would make us reconsider]
```

---

## Summary

These 30+ open questions are not weaknesses. They are **evidence of thoughtful, responsible product development.**

**The companies that fail in this space:** Friend, Humane, etc. - didn't ask these questions. They shipped and dealt with consequences.

**The companies that succeed:** Ray-Ban Meta, Limitless - thought hard about trust, consent, and value before shipping.

**Tizzy will succeed by:**
- Asking hard questions early
- Getting input from affected communities
- Making decisions deliberately
- Adapting as we learn

**These questions are a feature, not a bug.**
