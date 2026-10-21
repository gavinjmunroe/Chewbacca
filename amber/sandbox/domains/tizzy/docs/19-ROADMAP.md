# Execution Roadmap - Tizzy V1 and Beyond

**Version:** 1.0
**Last Updated:** February 13, 2026
**Status:** Active Planning

---

## Overview

This roadmap is **ambitious and realistic**. It balances speed (prove value fast) with responsibility (don't manufacture scandals). Each phase has specific deliverables, success criteria, and decision gates.

**Key Principle:** We do not advance to the next phase until success criteria for the current phase are met. No "move fast and break things" when users are vulnerable populations.

---

## Phase 0: Foundation (Months 0-3)

**Timeline:** Months 0-3 (Feb 2026 - May 2026)
**Goal:** Build the core daily loop and prove it works with a small, motivated cohort

### Key Deliverables

#### 1. Hardware Prototype (Dev Kit Form Factor)
- **Deliverable:** Functional prototype that captures audio, provides haptic feedback, syncs to phone
- **Form factor:** Dev kit (not final jewelry design yet) - focus on functionality
- **Specifications:**
  - Dual-mic array for directionality
  - Haptic motor with 3 distinguishable patterns
  - 24+ hour battery life
  - Bluetooth LE connectivity
  - Physical mute button
  - Sufficient on-device processing for VAD and feature extraction
- **Success criteria:**
  - Audio capture quality validated by SLP (word error rate <10%)
  - Haptics distinguishable by 10+ test users
  - Battery lasts full day in continuous use
  - Stable Bluetooth connection in real-world conditions

**Milestone gate:** Prototype passes technical validation before recruiting users.

#### 2. Capture and Processing Pipeline
- **Deliverable:** Software pipeline from raw audio → features → insights
- **Components:**
  - Voice activity detection (VAD)
  - Speaker diarization (wearer vs. other)
  - Acoustic feature extraction (pace, pitch, intensity, pauses, overlap)
  - Privacy-preserving encryption before sync
  - Circular buffer storage (4-8 hour retention on device)
- **Success criteria:**
  - Diarization accuracy >85% in one-on-one conversations
  - Feature extraction validated against ground truth (clinician-labeled samples)
  - Privacy review confirms no raw audio leaves device by default
  - Latency <2 seconds from capture to feature availability

**Milestone gate:** Pipeline processes 100+ test conversations with validated accuracy.

#### 3. Mobile App (MVP Version)
- **Deliverable:** iOS app with core user flows
- **Features:**
  - Device pairing and connection management
  - Privacy mode controls (self-only, consented, muted)
  - Post-conversation timeline review
  - Insight cards (what went well, what to try next time)
  - Daily micro-goal display
  - Privacy dashboard (data visibility and deletion)
- **Success criteria:**
  - App connects reliably to device (>95% success rate)
  - User can complete privacy mode switch in <5 seconds
  - Post-conversation summary loads within 30 seconds
  - Privacy dashboard shows accurate data inventory
  - Zero critical bugs in core flows

**Milestone gate:** App passes internal QA and pilot user acceptance.

#### 4. Coaching Model V1
- **Deliverable:** Models that detect conversational patterns and generate coaching
- **Capabilities:**
  - Real-time classification for haptic triggers (3 patterns)
  - Post-conversation analysis for timeline markers
  - Daily micro-goal generation
  - Personalization to user baseline (after 7 days)
- **Training data:**
  - Initially: public datasets + labeled pilot conversations
  - Ongoing: user feedback loop improves accuracy
- **Success criteria:**
  - Haptic triggers have <10% false positive rate (user feedback)
  - Post-conversation insights rated >4/5 "helpful" by pilot users
  - Micro-goals are specific and actionable (clinician review)
  - Model can explain reasoning for each insight

**Milestone gate:** SLP review confirms coaching aligns with evidence-based practices.

#### 5. Privacy and Compliance Foundation
- **Deliverable:** Legal and technical privacy infrastructure
- **Components:**
  - Privacy policy (plain language, reviewed by counsel)
  - Consent flows (onboarding, bystander consent prompts)
  - Data retention policies and automated deletion
  - Audit logging system
  - Security review and penetration testing
- **Success criteria:**
  - Privacy counsel approval
  - COPPA compliance for future minors (but Phase 0 is 18+ only)
  - State recording law analysis complete (know where we can operate)
  - Security audit passes with no critical vulnerabilities
  - Data breach response plan documented

**Milestone gate:** Legal and security clearance before recruiting users.

### Pilot User Recruitment

**Target:** 20-50 adult autistic users (18+ only)
**Profile:**
- College students navigating social transitions
- Young adults in first jobs or new environments
- High motivation for social skill improvement
- Comfortable with early-stage technology
- Can provide detailed feedback

**Recruitment channels:**
- University disability services offices
- Autism support groups and online communities
- SLP clinic partnerships
- Direct outreach to autism advocacy organizations

**Compensation:**
- Free device and 3-month subscription
- Premium support and direct access to product team
- Contribution to research that helps others

### Phase 0 Success Criteria (Gate to Phase 1)

- [ ] 20+ active pilot users wearing device 5+ days/week
- [ ] Pilot users report >4/5 satisfaction with daily loop
- [ ] Zero critical privacy or security incidents
- [ ] Technical reliability >90% (device, app, sync all working)
- [ ] Preliminary evidence of skill improvement (self-report or clinician observation)
- [ ] User feedback guides V1 refinements
- [ ] Legal foundation ready for broader deployment

**Estimated timeline:** 3 months (includes 6 weeks of user pilot)

---

## Phase 1: Validation (Months 3-6)

**Timeline:** Months 3-6 (May 2026 - Aug 2026)
**Goal:** Prove 30-day improvement metrics and build trust infrastructure

### Key Deliverables

#### 1. 30-Day Proof of Value Study
- **Deliverable:** Scientific validation of coaching effectiveness
- **Design:** Pre/post assessment of conversational skills for 50+ users
- **Metrics:**
  - Topic maintenance (average turns per conversation)
  - Reciprocity (questions asked vs. monologue time)
  - Repair attempts (self-correction frequency)
  - Self-reported confidence (7-point scale)
  - Self-reported social "crashes" (reduction)
- **Success criteria:**
  - 70%+ of users show measurable improvement in 1-2 targets
  - Average confidence increase of 1.5+ points
  - Results validated by independent SLP review
  - Publishable research (submit to conference or journal)

**Milestone gate:** Data proves value before scaling beyond pilot.

#### 2. Therapist Export Feature
- **Deliverable:** Shareable summary package for clinicians
- **Components:**
  - Pattern summary (frequency of key behaviors)
  - Timeline with annotated moments
  - Progress trends over time
  - Optional selected clips (explicit opt-in only)
  - Secure sharing via expiring link
- **Success criteria:**
  - 10+ SLPs test export with real clients
  - 80%+ report it saves time and provides value
  - Export format aligns with clinical documentation needs
  - Zero unintended data leakage (security audit)

**Milestone gate:** Therapist validation before marketing this feature.

#### 3. Privacy Dashboard V2
- **Deliverable:** Enhanced transparency and user control
- **Features:**
  - Visual data flow diagram (what happens where)
  - Consent receipt history (every session tagged)
  - Access audit log (who accessed what, when)
  - Granular deletion controls (by session, by date range)
  - Export user's full data archive
- **Success criteria:**
  - Users report feeling "in control" (>4.5/5)
  - <5% express privacy concerns after using dashboard
  - Dashboard passes accessibility standards (screen reader compatible)
  - Privacy advocates review and approve

**Milestone gate:** Trust metrics validate transparency approach.

#### 4. Hardware V2 (Jewelry Form Factor)
- **Deliverable:** Production-ready necklace design
- **Improvements from dev kit:**
  - Smaller size (target: 3cm diameter pendant)
  - Premium materials (durable, hypoallergenic)
  - Better audio quality (improved mic placement)
  - Refined haptic feedback (more subtle)
  - Extended battery (48-hour goal)
- **Success criteria:**
  - Form factor socially acceptable (user testing)
  - Audio quality meets or exceeds dev kit
  - Manufacturing cost <$150 at scale
  - Passes durability testing (drop, water resistance, wear)

**Milestone gate:** Design ready for small-batch manufacturing.

#### 5. Expanded Coaching Taxonomy
- **Deliverable:** More nuanced coaching based on pilot learnings
- **Additions:**
  - Escalation detection and de-escalation coaching
  - Overload risk detection (stress markers in voice)
  - Better theory of mind proxies (implied meaning markers)
  - Cultural context awareness (user-selected communication norms)
- **Success criteria:**
  - Users report new coaching types as helpful (>4/5)
  - False positive rate remains <10%
  - SLP review confirms additions are evidence-based

**Milestone gate:** Expanded taxonomy tested with 30+ users.

### Phase 1 Success Criteria (Gate to Phase 2)

- [ ] 30-day improvement study shows statistically significant results
- [ ] 50+ active users with 60%+ retention at 90 days
- [ ] Therapist export validated by 10+ clinicians
- [ ] Privacy dashboard passes trust metrics (<5% concerns)
- [ ] Hardware V2 ready for production
- [ ] Business model validated (50%+ subscription conversion)
- [ ] Autism advocacy organizations provide endorsement
- [ ] Zero major privacy or security incidents

**Estimated timeline:** 3 months (includes study period and analysis)

---

## Phase 2: Scale (Months 6-12)

**Timeline:** Months 6-12 (Aug 2026 - Feb 2027)
**Goal:** Scale dataset collection ethically, expand distribution channels, build institutional partnerships

### Key Deliverables

#### 1. Ethical Dataset Scaling
- **Deliverable:** 500+ users contributing to autism dataset
- **Strategy:**
  - Explicit opt-in with value exchange (subsidized device, premium features)
  - Active learning for efficient labeling (model flags uncertain moments, users clarify)
  - Therapist annotation partnerships for high-quality labels
  - Privacy-preserving aggregation (insights without raw audio exposure)
- **Success criteria:**
  - Dataset includes diverse users (age, gender, autism presentation, geography)
  - Privacy compliance validated for all data
  - Users report feeling good about contribution (>4/5 "I'm helping others")
  - Model accuracy improves measurably (lower false positive rate)

**Milestone gate:** Dataset moat validates defensibility to investors.

#### 2. Clinical Partnership Program
- **Deliverable:** 10+ clinics/SLP practices actively using Tizzy
- **Model:** B2B2C distribution
  - Clinics offer Tizzy as therapy augmentation tool
  - Clinics get therapist dashboard (group analytics, cohort trends)
  - Clinics provide structured feedback for product improvement
- **Benefits:**
  - Distribution channel validation
  - Clinical credibility and endorsements
  - Research partnership opportunities
- **Success criteria:**
  - 10+ clinics signed (pilot agreements)
  - Clinics report improved therapy outcomes (survey)
  - 100+ users acquired through clinic channel
  - Therapist dashboard meets clinical needs (>4/5 usefulness)

**Milestone gate:** Clinical channel proves viable before heavy investment.

#### 3. Advanced Personalization Engine
- **Deliverable:** Models that deeply learn individual user baselines
- **Capabilities:**
  - Personal communication style profile (user's norm vs. population)
  - Relationship context awareness (family vs. friends vs. work)
  - Goal-based coaching paths (user/parent-set priorities)
  - Adaptive haptic triggers (fade as skills improve)
- **Success criteria:**
  - Personalized coaching rated higher than generic (A/B test)
  - False positive rate drops to <5% after 30 days per user
  - Users report coaching "gets me" (>4.5/5)

**Milestone gate:** Personalization demonstrably improves outcomes.

#### 4. Production Manufacturing and Fulfillment
- **Deliverable:** Scalable hardware supply chain
- **Components:**
  - Manufacturing partner contracted (500+ unit run)
  - Quality control processes established
  - Fulfillment and support infrastructure
  - Warranty and replacement policies
- **Success criteria:**
  - Cost per unit <$150 at 500+ scale
  - Manufacturing defect rate <2%
  - Order-to-delivery time <2 weeks
  - Support response time <24 hours

**Milestone gate:** Operations ready to support 1000+ users.

#### 5. Scholarship and Access Program
- **Deliverable:** Financial assistance for low-income families
- **Funding sources:**
  - Grant applications (autism research, assistive tech)
  - Donor-supported scholarship pool
  - Cross-subsidy from paying users
  - Institutional partnerships
- **Success criteria:**
  - 20%+ of users on scholarship or subsidy
  - Application process is simple and dignified
  - Scholarship users have equal access to features
  - Funding is sustainable (not just one-time)

**Milestone gate:** Impact mission validated through access program.

### Phase 2 Success Criteria (Gate to Phase 3)

- [ ] 500+ active users across multiple cohorts
- [ ] 70%+ retention at 90 days
- [ ] Clinical partnerships driving 30%+ of new users
- [ ] Dataset moat established (proprietary autism conversation data)
- [ ] Personalization engine improves outcomes measurably
- [ ] Manufacturing and fulfillment scale-ready
- [ ] Scholarship program serving 100+ users
- [ ] Revenue model sustainable (break-even on unit economics)

**Estimated timeline:** 6 months (includes ramp-up period)

---

## Phase 3: Institutional Expansion (Months 12-18)

**Timeline:** Months 12-18 (Feb 2027 - Aug 2027)
**Goal:** Enter high school and college programs, build B2B infrastructure, expand beyond autism wedge

### Key Deliverables

#### 1. High School Pilot Programs
- **Deliverable:** 3-5 high schools piloting Tizzy for 14-17 year olds
- **Requirements met:**
  - COPPA compliance (14-17 is simpler than under-13)
  - Parental consent workflows tested and proven
  - School partnership agreements (not direct-to-consumer)
  - Bystander consent mechanisms validated
- **Success criteria:**
  - Schools report program is manageable and valuable
  - Students show skill improvement (clinical assessment)
  - Parents report satisfaction (>4/5)
  - Zero policy violations or incidents
  - Renewal interest from pilot schools

**Milestone gate:** High school model proven before expanding to younger users.

#### 2. College Transition Programs
- **Deliverable:** Partnerships with 10+ college disability services offices
- **Model:**
  - Colleges offer Tizzy to incoming autistic students
  - Focus on first-year social transition support
  - Time-bounded use (6-12 month program)
  - Outcomes tracked (academic retention, social integration)
- **Success criteria:**
  - 200+ college students using Tizzy
  - Colleges report reduced adjustment-related crises
  - Students report improved social confidence
  - Program drives measurable retention and wellbeing

**Milestone gate:** College channel validates "transition moment" wedge.

#### 3. Therapist Dashboard (B2B Platform)
- **Deliverable:** Full-featured portal for clinicians managing multiple clients
- **Features:**
  - Cohort analytics (trends across all clients)
  - Individual client progress tracking
  - Session notes and goal-setting integration
  - Secure messaging with clients/families
  - Export for billing and documentation
- **Success criteria:**
  - 50+ therapists actively using dashboard
  - Therapists report 10+ minutes saved per session
  - Dashboard drives renewal and referrals
  - Pricing model validated (per-seat or per-client)

**Milestone gate:** B2B product-market fit before heavy sales investment.

#### 4. Beyond-Autism Wedge Exploration
- **Deliverable:** Pilot programs for adjacent use cases
- **Target markets:**
  - Speech therapy (articulation, fluency, voice)
  - Social anxiety (neurotypical users with social challenges)
  - Professional communication (interviewing, presentations)
  - Relationship coaching (couples, conflict resolution)
- **Approach:** Small pilots (10-20 users per vertical) to test hypothesis
- **Success criteria:**
  - At least 1 adjacent market shows strong product-market fit
  - Model identifies next expansion vertical
  - Learnings inform multi-market roadmap

**Milestone gate:** Adjacent market validated before brand expansion.

#### 5. Modular Device Ecosystem (Early R&D)
- **Deliverable:** Prototypes for alternate form factors
- **Options:**
  - Clip-on version (better audio, less discreet)
  - Earring version (female-focused form factor)
  - Watch integration (partner with smartwatch makers)
  - Glasses integration (future-looking)
- **Success criteria:**
  - At least 1 alternate form factor reaches functional prototype
  - User testing shows strong demand (50%+ say "I'd prefer this")
  - Technical feasibility validated

**Milestone gate:** Device ecosystem strategy informed by user demand.

### Phase 3 Success Criteria (Gate to Phase 4)

- [ ] 1000+ active users across multiple channels
- [ ] Institutional channels (schools, colleges, clinics) driving 50%+ growth
- [ ] B2B revenue stream established and growing
- [ ] At least 1 beyond-autism vertical validated
- [ ] Brand positioned as "conversational growth platform," not just autism tool
- [ ] Strong unit economics (CAC < 6-month LTV)
- [ ] Fundraising positioned for Series A (if needed)

**Estimated timeline:** 6 months

---

## Phase 4: Platform Maturity (Months 18-24)

**Timeline:** Months 18-24 (Aug 2027 - Feb 2028)
**Goal:** Become the default platform for conversational growth across multiple domains

### Key Deliverables

#### 1. School Expansion (Middle School and Younger)
- **Deliverable:** Programs for 13-and-under users (COPPA-compliant)
- **Requirements:**
  - Full COPPA compliance validated by counsel
  - Enhanced parental controls and oversight
  - Strict bystander consent mechanisms
  - School partnership model only (no direct-to-consumer for minors in schools)
- **Success criteria:**
  - 5+ middle schools piloting successfully
  - Parents and schools report strong value
  - Zero COPPA violations or privacy incidents
  - Model ready for broader school sales

**Milestone gate:** Youngest user segment validated before mass marketing.

#### 2. API and Integration Platform
- **Deliverable:** Developer platform for third-party integrations
- **Use cases:**
  - EHR integration for clinics
  - Learning management system integration for schools
  - Research platform access for academics
  - Custom coaching modules for specialized use cases
- **Success criteria:**
  - 3+ successful integrations launched
  - Developer documentation and support infrastructure
  - Revenue-sharing model for partners

**Milestone gate:** Platform strategy drives ecosystem growth.

#### 3. International Expansion
- **Deliverable:** Tizzy available in 3+ countries beyond U.S.
- **Markets:**
  - Canada (similar regulatory, cultural overlap)
  - UK (strong autism support infrastructure)
  - Australia (English-speaking, progressive disability policy)
- **Requirements:**
  - Localized privacy compliance (GDPR, local laws)
  - Cultural adaptation of coaching (communication norms vary)
  - Local partnerships (clinics, schools, advocacy orgs)
- **Success criteria:**
  - 100+ international users
  - Product-market fit validated in at least 1 non-US market
  - Learnings inform broader international strategy

**Milestone gate:** International model validated before heavy expansion.

#### 4. Advanced AI Capabilities
- **Deliverable:** Next-generation coaching models
- **Capabilities:**
  - Video integration (facial expressions, body language)
  - Group conversation dynamics (3+ people)
  - Real-time transcript with acoustic annotations
  - Predictive coaching (anticipate breakdown before it happens)
  - Multi-modal analysis (audio + motion + context)
- **Success criteria:**
  - User outcomes improve with advanced features
  - Accuracy and safety maintained (no new harm risks)
  - Features are opt-in (privacy-preserving)

**Milestone gate:** Advanced features validated before broad deployment.

#### 5. Research and Clinical Validation Publications
- **Deliverable:** Published peer-reviewed research on Tizzy effectiveness
- **Studies:**
  - RCT comparing Tizzy + therapy vs. therapy alone
  - Longitudinal outcomes study (6-12 month follow-up)
  - Autism-specific communication taxonomy validation
  - Privacy and trust study (user perceptions and behaviors)
- **Success criteria:**
  - At least 2 peer-reviewed publications
  - Results cited by other researchers
  - Clinical community recognizes Tizzy as evidence-based
  - Results drive insurance/coverage conversations

**Milestone gate:** Research credibility supports scaling and advocacy.

### Phase 4 Success Criteria (Long-Term Success)

- [ ] 5000+ active users across multiple verticals
- [ ] Category-defining brand ("conversational growth platform")
- [ ] Strong retention (70%+ at 12 months)
- [ ] Profitable unit economics (self-sustaining growth)
- [ ] Published research validates effectiveness
- [ ] Autism community endorsement maintained
- [ ] Platform positioned for acquisition or long-term independence

**Estimated timeline:** 6 months

---

## Beyond Phase 4: Long-Term Vision (Years 2-5)

### Strategic Goals

1. **Become the default conversational growth platform**
   - Autism, speech therapy, social anxiety, professional development, relationships
   - Multi-device ecosystem (wearables, smartwatches, glasses, earbuds)
   - Global reach (10+ countries)

2. **Drive policy and cultural change**
   - Advocate for neurodiversity acceptance
   - Influence educational policy around autism support
   - Shape privacy norms for always-on wearables
   - Demonstrate ethical AI in assistive technology

3. **Build self-sustaining business**
   - Revenue: Subscription + B2B + institutional contracts
   - Impact: Scholarship program serving 30%+ of users
   - Community: User-driven innovation and co-design
   - Research: Open-source insights and collaboration

4. **Exit options (if desired)**
   - Acquisition by assistive tech company (e.g., Tobii Dynavox)
   - Acquisition by education platform (e.g., ClassDojo, Kahoot)
   - Acquisition by healthcare company (e.g., telehealth platform)
   - Or remain independent mission-driven company

---

## Risk Management and Contingency Plans

### Critical Risks and Mitigations

#### Risk 1: Regulatory Crackdown on Always-On Devices
- **Mitigation:** Stay ahead of policy, proactive transparency, coalition-building with advocacy orgs
- **Contingency:** Pivot to clinic-only or therapist-mediated model if consumer market becomes untenable

#### Risk 2: Privacy Incident or Breach
- **Mitigation:** Security-first architecture, insurance, incident response plan
- **Contingency:** Immediate disclosure, user notification, third-party audit, public accountability

#### Risk 3: Bystander Backlash or Social Rejection
- **Mitigation:** Co-design consent mechanisms, clear assistive tech positioning
- **Contingency:** Pivot to self-only mode as primary offering, multi-party as opt-in advanced feature

#### Risk 4: User Harm from Inaccurate Coaching
- **Mitigation:** Conservative thresholds, uncertainty communication, clinical validation
- **Contingency:** Pause real-time coaching, focus on post-conversation review until accuracy improves

#### Risk 5: Modulate Dependency or Vendor Lock-In
- **Mitigation:** Modular architecture, multi-vendor strategy, proprietary IP on top
- **Contingency:** Swap voice understanding layer (60-day migration plan pre-built)

#### Risk 6: Competitive Entry (Big Tech or Well-Funded Startup)
- **Mitigation:** Build autism dataset moat, clinical partnerships, community trust
- **Contingency:** Focus on trust and mission differentiation vs. feature competition

---

## Decision Gates and Go/No-Go Criteria

### Phase 0 → Phase 1 Gate
**Question:** Does the daily loop work and do users trust us?
- **Go if:** 20+ users active, >4/5 satisfaction, zero critical incidents
- **No-go if:** User adoption <50%, trust metrics fail, technical reliability poor

### Phase 1 → Phase 2 Gate
**Question:** Can we prove measurable improvement and therapist value?
- **Go if:** 30-day study shows improvement, therapist validation >80%, retention >60%
- **No-go if:** No measurable improvement, therapist export not useful, retention <40%

### Phase 2 → Phase 3 Gate
**Question:** Can we scale dataset and distribution ethically?
- **Go if:** 500+ users, clinical partnerships working, privacy metrics strong
- **No-go if:** Dataset growth stalls, clinic channel fails, privacy concerns emerge

### Phase 3 → Phase 4 Gate
**Question:** Can we expand beyond autism wedge and build platform?
- **Go if:** 1000+ users, institutional channels strong, adjacent market validated
- **No-go if:** Autism wedge plateau, B2B model fails, no platform traction

---

## Resource Requirements by Phase

### Phase 0 (Foundation)
- **Team:** 5-8 people (product, engineering, design, clinical advisor, ops)
- **Budget:** $500K-$750K (prototype hardware, initial salaries, legal, pilot users)
- **Timeline:** 3 months

### Phase 1 (Validation)
- **Team:** 8-12 people (add research, marketing, support)
- **Budget:** $1M-$1.5M (hardware V2, study costs, expanded team)
- **Timeline:** 3 months

### Phase 2 (Scale)
- **Team:** 12-20 people (add sales, manufacturing, data/ML specialists)
- **Budget:** $2M-$3M (manufacturing, marketing, clinical partnerships, dataset ops)
- **Timeline:** 6 months

### Phase 3 (Institutional)
- **Team:** 20-30 people (add B2B sales, partnerships, school specialists)
- **Budget:** $3M-$5M (school programs, B2B infrastructure, international setup)
- **Timeline:** 6 months

### Phase 4 (Platform)
- **Team:** 30-50 people (full product, engineering, sales, support, research teams)
- **Budget:** $5M-$10M (platform development, international, advanced AI, research)
- **Timeline:** 6 months

**Total to Platform Maturity:** ~24 months, $12M-$20M cumulative

---

## Success Metrics Dashboard

| Metric | Phase 0 Target | Phase 1 Target | Phase 2 Target | Phase 3 Target | Phase 4 Target |
|--------|---------------|---------------|---------------|---------------|---------------|
| Active Users | 20+ | 50+ | 500+ | 1000+ | 5000+ |
| Daily Active % | 70% | 80% | 80% | 85% | 85% |
| 90-Day Retention | 50% | 60% | 70% | 70% | 70% |
| Skill Improvement % | 60% | 70% | 75% | 75% | 80% |
| Therapist Validation | N/A | 80% | 85% | 90% | 90% |
| Privacy Concern % | <15% | <10% | <5% | <5% | <5% |
| Subscription Conversion | 40% | 50% | 60% | 65% | 70% |
| Scholarship Users % | 10% | 15% | 20% | 25% | 30% |
| Clinical Partnerships | 0 | 3-5 | 10+ | 25+ | 50+ |
| School Programs | 0 | 0 | 0 | 5+ | 20+ |

---

## Summary: The Path to Category-Defining Product

**Phase 0:** Prove the loop works (hardware + software + coaching)
**Phase 1:** Prove the value is measurable (30-day outcomes)
**Phase 2:** Scale the moat (dataset + distribution)
**Phase 3:** Build the platform (institutions + B2B)
**Phase 4:** Own the category (multi-vertical leader)

**This roadmap is ambitious:** We go from prototype to 5000+ users in 24 months.

**This roadmap is realistic:** Every phase has clear success criteria and decision gates. We don't advance until we're ready.

**This roadmap is responsible:** We start with adults, prove value, build trust, then carefully expand to minors and schools.

**The ruthless question:** Can we execute this? Yes, if we:
- Stay focused (V1 scope discipline)
- Build trust proactively (privacy-first design)
- Partner strategically (clinics, schools, advocacy orgs)
- Validate relentlessly (measure outcomes, not vanity metrics)
- Adapt quickly (user feedback drives iteration)

**If we execute this roadmap, Tizzy becomes the category-defining conversational growth platform. If we skip steps or rush gates, we become another failed wearable.**

The choice is ours.
