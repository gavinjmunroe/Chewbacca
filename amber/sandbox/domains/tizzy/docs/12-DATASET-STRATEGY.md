# Dataset Strategy: Building the Autism Moat

**Document Version:** 1.0
**Last Updated:** February 13, 2026
**Owner:** Product & Research Teams

---

## Executive Summary

Tizzy's defensible moat is not the hardware, not the real-time processing, and not access to Modulate's API. **The moat is the autism-specific conversational dataset paired with coaching models that understand how autistic people communicate differently.** This document outlines how to build that dataset ethically, rapidly, and with genuine value exchange—without becoming a surveillance company.

---

## Why the Dataset is the Moat

### The Strategic Context

Voice AI is exploding. General-purpose models (OpenAI Whisper, GPT-4 audio, Claude voice) handle transcription and generic intent. Modulate's ELM handles prosody and tone better than transcript-only systems. But **no one has a large-scale, labeled dataset of autistic conversational patterns mapped to specific coaching outcomes.**

That dataset is:
- **Expensive to replicate** (requires access to willing participants, clinical validation)
- **Hard to commoditize** (highly specialized, not general-purpose)
- **Defensible IP** (proprietary annotations, outcome mappings, personalization layers)
- **The basis for everything else** (product features, clinical credibility, model training)

### What Makes This Dataset Unique

Standard speech datasets focus on:
- Accuracy of transcription
- Generic sentiment or emotion classification
- Command-and-control intent detection

Tizzy's autism dataset must capture:
- **Conversational reciprocity patterns** (interruptions, monologuing, delayed responses)
- **Topic management behaviors** (maintenance, repair, abrupt shifts)
- **Prosody differences** (flat affect, intensity mismatch, pacing issues)
- **Missed social cues** (sarcasm misinterpretation, implied meaning, nonverbal proxy signals)
- **Sensory overload markers** (acoustic stress, conversation breakdown)
- **Outcome anchors** (what patterns predict success vs. breakdown)

This is not general-purpose data. This is specialized, clinically-informed, outcome-linked data.

---

## Core Principles: Building Ethically

### Non-Negotiable Constraints

1. **Explicit, informed consent for all data collection**
   - Participants understand what is captured, how it's used, and who sees it
   - Consent is granular: different permissions for retention, model training, clinical sharing

2. **Value exchange, not extraction**
   - Participants receive tangible benefit for contributing data
   - Free or subsidized hardware, premium features, therapist-ready reports

3. **Minors require extra protection**
   - COPPA compliance for under-13
   - Parental consent with child assent where appropriate
   - Start with 18+ cohorts to reduce regulatory complexity

4. **Bystander protection**
   - Default focus on wearer's behavior, not surveillance of others
   - Explicit consent workflows for recording other people
   - Clear retention and deletion pathways

5. **No stealth capture, no surprise training**
   - Participants explicitly opt in to data donation
   - Clear distinction between "use the product" and "donate to training"

6. **Clinical validation partnerships**
   - Work with SLPs, autism programs, researchers
   - Ground the dataset in established frameworks (ASHA benchmarks, DSM-5 criteria)

---

## Dataset Phases: Start Simple, Scale Methodically

### Phase 0: Adult-Only Pilot (Months 0-6)

**Target:** 50-100 autistic adults (18+), college students preferred

**Why Adults First:**
- Simpler consent (no parental requirements, no COPPA)
- Faster iteration (direct communication with users)
- College transition is a validated pain point

**Recruitment Channels:**
- College disability services offices
- Autism self-advocacy groups (ASAN, local chapters)
- Online communities (Reddit r/autism, autistic Discord servers)
- Direct outreach to autistic college support programs

**Data Collection:**
- Participants wear device for 30 days minimum
- Self-report: mark confusing moments via tap button
- Daily micro-surveys: "How did today's conversations feel?" (1-5 scale)
- Weekly check-ins: what patterns did they notice?

**Value Exchange:**
- Free device loan or $200 subsidy
- Premium coaching features enabled
- Detailed progress report at end of pilot
- Optional: $50/week participation incentive

**Dataset Outputs:**
- 500-1,000 hours of consented conversational audio
- Self-labeled "confusing moment" flags
- Pre/post assessments (self-report confidence, conversation quality)
- Baseline for personalization algorithms

**Metrics for Success:**
- 70% retention through 30 days
- Average 3+ self-labels per day
- Positive user satisfaction (4/5 or higher)
- At least 30% show measurable improvement on target skills

---

### Phase 1: Therapy & Coaching Partnerships (Months 6-12)

**Target:** 200-500 participants through clinical partnerships

**Why Therapy Channel:**
- Built-in outcome validation (therapist assessments)
- Higher-quality labels (expert annotation on subset of data)
- Distribution channel validation
- Clinical credibility for institutional sales

**Partnership Model:**
- SLPs and autism clinics recruit their clients
- Tizzy provides devices at cost or free for research cohorts
- Therapists get dashboard access to see real-world patterns
- Shared research collaboration (co-authored papers, case studies)

**Clinical Frameworks to Align With:**
- ASHA Social Communication Benchmarks (topic maintenance, repair, turn-taking)
- DSM-5 autism criteria (social reciprocity, prosody, nonverbal communication)
- Validated outcome measures (SRS-2, SCQ where appropriate)

**Data Collection:**
- Participants wear device during daily life (not just therapy sessions)
- Weekly therapist annotations on flagged moments
- Pre/post standardized assessments
- Parent/caregiver observations (for minors)

**Labeling Strategy:**
- **Weak labels:** Self-report + parent report (cheap, scalable)
- **Strong labels:** Therapist annotation on 10-20% of data (expensive, high-quality)
- **Active learning:** Model flags uncertain moments → therapist clarifies → model improves

**Value Exchange:**
- Therapists: Better insight into real-world behavior (not just clinic performance)
- Participants: Better therapy outcomes, subsidized device
- Clinics: Research partnership, potential co-marketing

**Dataset Outputs:**
- 2,000-5,000 hours of labeled conversational data
- Expert-validated coaching outcome mappings
- Longitudinal improvement data (proof coaching works)
- Published case studies or pilot research

**Metrics for Success:**
- 10+ clinic partnerships established
- 60% of participants show measurable improvement on at least 2 target skills
- Therapist satisfaction 4.5/5 or higher
- At least 1 peer-reviewed publication or case study

---

### Phase 2: Parent-Driven Kids Adoption (Months 12-24)

**Target:** 1,000-2,000 minor users (ages 8-17) through parent purchase

**Why Wait Until Phase 2:**
- Governance and privacy workflows must be bulletproof first
- Product value must be proven (parents need evidence it works)
- COPPA compliance infrastructure must be built and tested

**Consent Infrastructure:**
- Parental consent required for purchase and data collection
- Child assent process for ages 8+ (age-appropriate explanation, opt-in)
- Separate consent tiers: "use the product" vs. "donate to training"
- Transparent data dashboard showing exactly what's captured

**Data Collection:**
- Optional data donation program (not default)
- Parents can review flagged moments before donation
- Kids can tap "private" to exclude moments from training
- Quarterly data reports sent to parents

**Value Exchange:**
- Data donors: $100-200 discount on hardware + premium features
- Non-donors: Standard pricing, still get full coaching
- Scholarship pool for low-income families (funded by grants/donors)

**Dataset Outputs:**
- 5,000-10,000 hours of diverse age ranges and contexts
- Parent-validated outcome improvements
- Developmental progression data (how patterns change with age)
- Expanded coaching model coverage

**Metrics for Success:**
- 40%+ of users opt into data donation program
- Zero privacy breaches or consent violations
- Parent satisfaction 4/5 or higher
- Strong word-of-mouth growth (NPS 50+)

---

### Phase 3: Institutional & School Partnerships (Months 24+)

**Target:** School districts, autism programs, research institutions

**Why Last:**
- FERPA, procurement, and policy complexity is high
- Requires proven track record and institutional trust
- Long sales cycles (6-12 months)

**Compliance Requirements:**
- FERPA-compliant data handling (vendor agreements, data destruction policies)
- School board approval processes
- Parental consent at scale (district-wide or program-wide)

**Data Collection:**
- Cohort studies (whole classrooms or support programs)
- Controlled research protocols with IRB approval
- Anonymized aggregate data for population insights

**Value Exchange:**
- Schools: Grant-funded or bulk pricing
- Researchers: Access to unique dataset for publications
- Districts: Measurable outcomes for special education programs

**Dataset Outputs:**
- Population-level insights (norms, developmental trajectories)
- Controlled studies with strong outcome validation
- Institutional credibility for scaling

---

## The Labeling Strategy: Efficient and Scalable

Building a labeled dataset traditionally requires expensive human annotation. Tizzy's approach combines **weak labels at scale** with **strong labels on critical subsets**.

### Weak Labels (Cheap, Scalable)

**Self-Report:**
- User taps button during conversation: "That was confusing"
- Post-conversation survey: "Did you feel heard?" "Did you understand them?"
- Daily reflection: "Which conversation was hardest today?"

**Parent/Caregiver Report:**
- "My child seemed frustrated after school"
- "They mentioned a friend misunderstood them"

**Automated Heuristics:**
- Long pauses (>3 seconds) → likely confusion
- Overlapping speech → possible interruption or missed turn
- Sudden silence → breakdown or overload
- Intensity spikes → escalation risk

### Strong Labels (Expensive, Targeted)

**Therapist Annotation:**
- Review flagged moments (10-20% of data)
- Categorize: "missed cue," "topic shift failure," "repair attempt," "good reciprocity"
- Rate: confidence, severity, coachability

**Active Learning Loop:**
1. Model flags uncertain moments
2. System asks user or therapist short clarifying question
3. Answer becomes high-value label
4. Model improves, asks better questions

### Outcome Anchors (The Gold Standard)

Labels alone aren't enough. Tizzy needs to link patterns to outcomes:
- Did improving this pattern reduce social crashes?
- Did coaching this behavior increase friendship quality?
- Did personalization improve user confidence?

**Outcome Measurement:**
- Pre/post self-report surveys (validated scales)
- Parent/therapist observations
- Behavioral proxies (conversation length, reciprocity turns, repair attempts)
- Long-term retention and satisfaction

---

## Privacy-First Dataset Architecture

### Default Minimization

- Raw audio processed on-device → acoustic features + embeddings
- Raw audio discarded unless user explicitly retains
- Training happens on features, not raw audio (where possible)

### Consent Tiers

**Tier 1: Use the Product**
- Coaching requires processing, but not retention
- Data stays local or encrypted ephemeral processing

**Tier 2: Donate to Training (Anonymous)**
- User opts in to contribute de-identified acoustic features
- No raw audio, no bystander voice, no identifying info

**Tier 3: Clinical Sharing**
- User opts in to share insights with therapist
- Explicit consent, auditable, revocable

**Tier 4: Research Participation**
- Highest bar: IRB protocols, informed consent, compensation
- Used for controlled studies and publications

### Bystander Protection

- Default: Focus on wearer's behavior (monologuing, pacing, tone)
- Bystander voice: Only captured with explicit consent (future feature)
- Deletion pathway: Users can purge specific conversations

### Data Governance Dashboard

Every user sees:
- What data was captured (dates, durations, contexts)
- What was retained vs. discarded
- What was used for training (if opted in)
- What was shared (therapist, research, etc.)
- One-click deletion for any session

---

## Competitive Moat: Why This Dataset is Defensible

### Barriers to Replication

1. **Access to Participants**
   - Autism community trust takes years to build
   - Clinical partnerships require credibility and track record

2. **Specialized Annotation**
   - Understanding autism-specific patterns requires domain expertise
   - General-purpose labelers will miss critical nuances

3. **Longitudinal Data**
   - Coaching effectiveness requires weeks-to-months of data
   - Competitors starting from zero face 12-24 month delay

4. **Personalization Layer**
   - Population models are table stakes
   - Individual baselines and coaching adaptation is the real moat

5. **Ethical Governance**
   - Privacy-first architecture is expensive and slow
   - Competitors taking shortcuts will face backlash and regulatory risk

### IP Strategy

- **Patents:** Autism-specific coaching methods, acoustic feature extraction for social cues
- **Trade Secrets:** Model architectures, labeling protocols, outcome mappings
- **Copyright:** Annotated datasets, proprietary coaching content
- **Contractual:** Modulate license keeps training rights with Tizzy

---

## Success Metrics by Phase

### Phase 0 (Adult Pilot)
- 50-100 participants recruited
- 500-1,000 hours labeled data
- 70% retention through 30 days
- Baseline model trained and validated

### Phase 1 (Therapy Partnerships)
- 10+ clinic partnerships
- 2,000-5,000 hours expert-labeled data
- 60% show measurable improvement
- 1+ published case study

### Phase 2 (Kids Adoption)
- 1,000+ minor users
- 40% opt into data donation
- Zero privacy breaches
- NPS 50+

### Phase 3 (Institutions)
- 5+ school/research partnerships
- 10,000+ hours population data
- Controlled outcome studies published
- Institutional credibility established

---

## Budget Estimate: Data Collection Costs

### Phase 0 (Adult Pilot)
- Hardware subsidies: $10,000-20,000 (50-100 devices at $200 each)
- Participation incentives: $15,000 ($50/week × 6 weeks × 50 people)
- Platform/tooling: $10,000
- **Total: ~$40,000**

### Phase 1 (Therapy Partnerships)
- Device subsidies: $50,000 (250 devices at $200)
- Therapist annotation budget: $30,000 (200 hours at $150/hour)
- Partnership coordination: $20,000
- **Total: ~$100,000**

### Phase 2 (Kids Adoption)
- Device discounts: $100,000 (1,000 users × $100 discount)
- Scholarship pool: $50,000
- COPPA compliance infrastructure: $30,000
- **Total: ~$180,000**

### Phase 3 (Institutions)
- Research grants and partnerships: $200,000+
- Bulk device discounts: $100,000
- IRB and compliance: $50,000
- **Total: ~$350,000**

**Cumulative Dataset Investment: ~$670,000 over 24 months**

This is a realistic budget for a seed/Series A funded startup. Compare to cost of building from scratch later: $2-5M+ and 3-5 year delay.

---

## Risk Mitigation

### Risk: Privacy Breach or Consent Violation
**Mitigation:**
- Privacy-first architecture from day one
- Legal review of all consent workflows
- Third-party security audits
- Clear incident response plan

### Risk: Poor Data Quality
**Mitigation:**
- Active learning to focus labeling effort
- Therapist validation on critical subsets
- Regular quality audits
- User feedback loops

### Risk: Low Participation or High Dropout
**Mitigation:**
- Strong value exchange (subsidies, features, reports)
- Frequent check-ins and support
- Gamification and progress visibility
- Community building

### Risk: Competitor Poaching Dataset Strategy
**Mitigation:**
- Trade secret protection
- Contractual NDAs with partners
- Fast execution (18-month head start is huge)
- Relationship moat (trust with autism community)

### Risk: Modulate Gets Training Rights
**Mitigation:**
- Explicit contractual prohibition in license agreement
- Tizzy owns all training data
- Modulate provides inference only
- Exit strategy if relationship sours

---

## Conclusion: The Dataset is the Company

Tizzy is not a hardware company. It's not a Modulate wrapper. **Tizzy is a dataset company that happens to use hardware and AI as distribution mechanisms.**

The autism conversational dataset, paired with clinically-validated coaching models, is:
- **The defensible moat** (18-24 months to replicate)
- **The product foundation** (coaching only works if patterns are understood)
- **The clinical credibility** (evidence-based outcomes, publishable research)
- **The long-term platform** (expand to other populations, other skills)

Building this dataset ethically and rapidly is the single most important strategic priority for Tizzy in Year 1.

---

## Next Steps

1. **Immediate (Next 30 Days):**
   - Finalize adult pilot recruitment plan
   - Draft consent forms and privacy disclosures
   - Set up data collection infrastructure
   - Recruit first 20 adult beta users

2. **Short-Term (Months 2-6):**
   - Launch adult pilot cohort
   - Begin SLP partnership outreach
   - Validate labeling protocols
   - Train baseline coaching models

3. **Medium-Term (Months 6-12):**
   - Scale therapy partnerships
   - Build COPPA compliance infrastructure
   - Prepare for kids adoption phase
   - Publish initial case studies

4. **Long-Term (Months 12-24):**
   - Launch parent-driven adoption
   - Expand dataset to 10,000+ hours
   - Begin institutional partnerships
   - Establish research collaborations

**The dataset is not a nice-to-have. It is the entire game.**
