# Tizzy — Product Roadmap

## Operating Principles for This Roadmap

1. **Privacy-first at every milestone.** No milestone ships with a privacy compromise, even temporarily.
2. **Autistic community involvement at every stage.** Beta users are compensated. Feedback is directional. No "we know best."
3. **Ambiguity is logged, not hidden.** Open questions are explicitly tracked below.
4. **Small team discipline.** Every milestone is scoped for a team of two to three people. Scope creep is the primary risk.

---

## 0–90 Days: Prove the Loop

### Month 1: Prototype and Capture Pipeline
**Goal:** Working audio capture → feature extraction → BLE sync on prototype hardware.

**Deliverables:**
- Off-the-shelf hardware prototype: BLE microcontroller development board (nRF5340-DK or Adafruit Feather nRF52840), microphone breakout board, LRA haptic driver, 3D-printed enclosure
- Firmware: VAD threshold, raw feature extraction (turn duration, pause detection, overlap flag), circular buffer write, BLE GATT characteristic for feature sync
- iOS companion app (SwiftUI): BLE scan and pair, receive feature stream, display raw session data (developer view, not polished UI)
- Test harness: synthetic conversation playback to validate feature extraction accuracy on known audio

**Not in Month 1:**
- On-device ML inference (placeholder threshold rules only)
- Production hardware design
- Haptic patterns (single test buzz only)
- App UI

**Success criteria:** Feature extraction pipeline captures turn timing with < 100ms error on a 10-minute test conversation. BLE sync completes a session in under 5 seconds.

---

### Month 2: Haptics MVP and First Model
**Goal:** Working haptic coaching loop on a real conversation.

**Deliverables:**
- Three haptic patterns implemented and calibrated (Notice, Adjust, Ground)
- First coaching model: INT8 quantized classifier, reciprocity dimension only (monologue detection + overlap detection)
- Coaching threshold calibration UI in companion app (slider for sensitivity)
- First internal test session: at least one real conversation with a team member wearing the prototype

**Not in Month 2:**
- Topic management, repair, prosody, overload dimensions (deferred to Month 3+)
- Post-session timeline UI
- Production enclosure

**Success criteria:** Haptic fires within 800ms of a 90-second monologue event in a real conversation. False positive rate (haptic fires when no monologue event occurred) < 20% in internal testing.

---

### Month 3: Beta Recruitment and First External Sessions
**Goal:** 20–50 adult autistic beta users completing at least one session each.

**Deliverables:**
- Beta recruitment: partner with one autism advocacy organization (ASAN, AANE, or equivalent) and one university disability services office for recruitment
- Compensation: $25 gift card per completed session report (minimum 3 sessions per beta user)
- Post-session timeline UI: basic version, showing turn map and haptic event flags
- Feedback collection: post-session survey (5 questions) + optional async video feedback
- Privacy audit: internal walkthrough of the full data path with an external privacy reviewer (not a full audit — a structured walkthrough)

**Not in Month 3:**
- Subscription billing
- Production hardware (still prototypes)
- More than one coaching dimension active (reciprocity only in beta)

**Success criteria:** 20 completed multi-session users. NPS > 50. At least 8 users report the haptic coaching was helpful at least once. Zero data leaks or unintended audio transmission events (verified via network monitoring on all test devices).

---

## 3–6 Months: Prove 30-Day Improvement

### Month 4: Full Taxonomy and Trends
**Goal:** All five coaching dimensions functional. Weekly trends dashboard live.

**Deliverables:**
- Topic management classifier (V1: simple topic shift signal using embedding distance approximation)
- Prosody dimension (V1: speech rate variance only — pitch deferred to V2 for model budget reasons)
- Overload detection (opt-in, requires 14-day baseline before activation)
- Weekly trends dashboard in companion app
- 30-day cohort from beta: first users completing a full month of sessions
- Coaching sentence generator: rule-based first, on-device LLM if model budget allows

**Success criteria:** 30-day retention > 60% of beta cohort. At least 5 users can point to a specific metric improvement over their baseline week.

---

### Month 5: Therapist Export and Privacy Dashboard
**Goal:** SLP-facing tools and full user-facing privacy controls.

**Deliverables:**
- SLP export: PDF report with 30-day trends, session count, and coaching dimension breakdown in clinical language (reviewed by one SLP consultant before launch)
- Privacy dashboard: in-app view of every session ever recorded, with individual session deletion and full data wipe
- Consent receipt log: accessible from settings, exportable as JSON
- Hard mute indicator: companion app shows when pendant is in hard mute state
- Beta expansion: 50–100 users across two university campuses

**Success criteria:** SLP export reviewed positively by at least 3 SLP consultants. Privacy dashboard UI tested with 10 beta users — all can find and delete a session without assistance.

---

### Month 6: V1 Launch Readiness
**Goal:** Product is shippable to a wider audience.

**Deliverables:**
- Production hardware: first manufacturing run of 500 units (contract manufacturer)
- App Store submission: iOS app reviewed and approved
- Subscription billing: Stripe integration, $9.99/month and $79/year tiers
- Scholarship pool: first cohort of 20 scholarship spots allocated
- Privacy policy and terms: externally reviewed, plain language, cross-referenced against architecture
- Website: tizzy.app (or equivalent), landing page with waitlist

**Not at V1 launch:**
- Android
- Clinic plan (in beta only, not generally available)
- School accounts

**Success criteria:** 500 units manufactured. App Store approval. Legal review complete. Waitlist > 1,000 signups before launch.

---

## 6–12 Months: Scale Dataset and Clinical Relationships

### Month 7–9: Dataset Initiative
- Launch opt-in data contribution program for subscribed users
- Per-session compensation: $2 credit toward subscription per consented contributing session
- Partner with one autism research lab for dataset validation and co-authorship
- Target: 10,000 labeled conversation sessions from 200+ consented autistic adults

### Month 10–12: Clinic Partnerships (Wave 2)
- Clinic plan generally available: $299/month
- Formal partnership with 10 SLP practices
- CE module submitted to ASHA for accreditation
- First peer-reviewed paper on coaching taxonomy validation submitted (with research partner)

---

## 12–24 Months: Expand and Govern

### Month 13–18: Second Coaching Dimension Depth
- Repair and recovery classifier: significantly harder than reciprocity; requires larger training set
- Prosody V2: pitch mean and variance added (requires more model budget — target hardware upgrade or model compression advances)
- Personalization layer: individual user model fine-tuning using their own 90-day session history

### Month 19–24: Adolescent Beta (13–17, Therapist Channel Only)
- Separate account architecture for minors: teenager primary account, parent aggregate-only view with teenager's ongoing consent
- External consent architecture audit
- Launch only through therapist referrals — not direct-to-consumer
- Target: 200 adolescent users, therapist-referred, in structured 90-day studies

### Schools: Not Before Month 36
This is a hard constraint. The governance model does not exist yet. The privacy architecture for minors in educational settings has not been audited. The autistic community's trust in Tizzy has not been established at the scale required to justify institutional use. Month 36 is the earliest possible consideration date, not a target.

---

## Explicitly Logged Ambiguities

These are open questions that have not been resolved. They are logged here so they do not get silently assumed away.

**Ambiguity 1: Autistic speech model generalizability**
It is unknown whether a coaching model trained on one population of autistic adults (college students, English-speaking, high-support-needs adjacent) will generalize to autistic adults with very different communication profiles (AAC users, selective mute users, non-speaking autistic people). V1 explicitly scopes to verbal autistic adults. The generalization question is tracked but not resolved.

**Ambiguity 2: Haptic tolerance across sensory profiles**
Some autistic users have tactile sensitivity that makes haptic feedback aversive rather than helpful. The current design assumes haptics are universally acceptable with calibration. This assumption may be wrong for a meaningful subset of the target population. Mitigation: extensive sensory profile questions in onboarding, ability to disable any pattern, and audio-only coaching mode as a V2 alternative.

**Ambiguity 3: Two-party consent state compliance in practice**
The legal posture for two-party consent states is well-defined on paper. In practice, it is unclear how much friction the in-app consent prompt will add to the user experience and whether users in these states will find the product usable. Mitigation: A/B test consent flow friction in beta with California and Florida users (both two-party consent states).

**Ambiguity 4: Model accuracy on naturalistic vs. structured conversation**
The coaching models are validated on structured test conversations (lab settings, known participants). Real-world naturalistic conversations (background noise, multiple simultaneous speakers, phone calls, video calls) are significantly harder. Accuracy in naturalistic settings is unknown until beta data is collected.

**Ambiguity 5: Clip-sharing social pressure**
The product deliberately has no sharing features. It is unknown whether this will be a competitive disadvantage (users want to share wins with therapists or friends) or a trust advantage (users feel safe knowing nothing can be shared). This will be answered by qualitative beta feedback.

**Ambiguity 6: Insurance and HSA/FSA eligibility**
If Tizzy achieves some form of clinical validation, it may be eligible for HSA/FSA coverage as a qualified medical expense. This would significantly reduce the effective cost for users with health savings accounts. The path to eligibility is unclear and not worth pursuing until after V1 launch.

---

## Final Positioning Statement

Tizzy is the conversation coach that shows up in the real conversation — not in a therapy room, not in a role-play exercise, not in an app simulation. It is the first product to close the loop between in-the-moment coaching, post-session review, and long-term skill tracking for autistic adults in naturalistic social settings.

It earns trust by doing what no other product in this space has done: processing everything locally, storing nothing it does not need, and measuring its success by how much less you need it over time.

The goal is not to be the conversation coach you use forever. The goal is to be the conversation coach that teaches you to trust yourself.
