# 07-PRIVACY-LEGAL

**Status:** CRITICAL - Non-negotiable foundation
**Owner:** Legal + Product + Engineering
**Last Updated:** 2026-02-13

---

## Overview

Tizzy's privacy and legal posture is not optional compliance theater. It is the product's foundation. An always-listening wearable device for minors, capturing real-world conversations in schools, homes, and public spaces, exists in a regulatory minefield. If we get this wrong, we manufacture a scandal that destroys the company and harms users.

**Core Reality:** You cannot "wing this." The product lives or dies on being undeniably assistive, consent-forward, and privacy-governed.

---

## The Cautionary Tales

### What Not to Be

**Friend Pendant:**
- Always listening, marketed as companion
- Real-world reaction: discomfort, suspicion, "wearing a wire" accusations
- Privacy policy places legal responsibility on users to comply with surveillance laws
- Result: Social acceptance failure, trust erosion

**Lesson:** Hidden recording = social and legal disaster. Assistive legitimacy must be built into product design.

**Humane AI Pin:**
- High hype, poor value delivery, shutdown risk
- Futuristic hardware without undeniable daily loop
- Result: Failed trust posture and unclear utility

**Lesson:** Privacy governance without product value is worthless. Both must be excellent.

### What to Learn From

**Limitless Pendant:**
- Help center and Terms explicitly require notice and consent
- LED indicator shows when recording
- Clear consent workflows
- Result: Market validation that "hidden recording" is unacceptable

**Ray-Ban Meta Smartglasses:**
- Clear utility, acceptable form factor
- Millions sold, social acceptance achieved
- Result: Physical pattern validated when trust and value align

---

## Legal and Regulatory Constraints

### A) Children and COPPA (Children's Online Privacy Protection Act)

**Status:** MANDATORY COMPLIANCE

**Core Requirement:**
If Tizzy collects voice recordings from children under 13 through an online service, COPPA applies. The FTC has explicitly issued guidance on voice recordings in this context.

**Reference:** [FTC COPPA Voice Recording Guidance (2017)](https://www.ftc.gov/news-events/news/press-releases/2017/10/ftc-provides-additional-guidance-coppa-voice-recordings)

**Requirements:**
1. **Verifiable Parental Consent:**
   - Must obtain verifiable parental consent before collecting, using, or disclosing personal information from children under 13
   - Consent mechanism must be robust and documented
   - Cannot use child's information to obtain parental consent

2. **Clear Privacy Notice:**
   - Must provide clear, comprehensive privacy policy
   - Must describe what information is collected, how it's used, and disclosure practices
   - Must be accessible and understandable to parents

3. **Data Minimization:**
   - Collect only information reasonably necessary for participation
   - Cannot condition participation on providing more information than necessary

4. **Parental Rights:**
   - Parents must be able to review child's personal information
   - Parents must be able to refuse further collection or use
   - Parents must be able to delete child's information

5. **Data Security:**
   - Must maintain reasonable procedures to protect confidentiality, security, and integrity of personal information

**Tizzy Implementation Requirements:**
- [ ] Implement robust parental consent workflow before device activation for users under 13
- [ ] Build parental dashboard with full visibility into data collection and usage
- [ ] Provide clear, accessible privacy notice in plain language
- [ ] Implement parental rights portal (review, modify, delete child data)
- [ ] Document consent records with timestamps and audit trail
- [ ] Design age-gating mechanism to separate under-13 from 13+ users
- [ ] Implement additional protections for voice data of children

**Decision Point:** Consider 13+ only for V1 to reduce compliance complexity while building trust posture. Expand to under-13 in later version with proven governance.

---

### B) State Recording Consent Laws

**Status:** MANDATORY DESIGN CONSTRAINT

**Core Problem:**
U.S. state recording laws vary significantly. Some require all-party consent, some require one-party consent. Creating legal exposure for users is unacceptable.

**Reference:** [Justia 50-State Survey on Recording Laws](https://www.justia.com/50-state-surveys/recording-phone-calls-and-conversations/)

**Key State Categories:**

**All-Party Consent States (Strictest):**
California, Connecticut, Florida, Illinois, Maryland, Massachusetts, Montana, New Hampshire, Pennsylvania, Washington

**Implication:** All participants in a conversation must consent to recording.

**One-Party Consent States:**
Most other states allow recording if one party (the wearer) consents.

**Tizzy Design Decision:**
Design for the strictest practical standard (all-party consent) or provide clear mechanisms to comply with varying state laws.

**Requirements:**
1. **Default to Strictest Standard:**
   - Product should assume all-party consent requirement by default
   - Require users to obtain consent from conversation partners

2. **Consent Mechanism:**
   - Provide standard, socially acceptable consent script/card
   - Log consent events in app
   - Support "consent mode" vs "self-only mode"

3. **Geographic Awareness (Optional V2):**
   - Could detect user's state and adjust consent requirements
   - Provide state-specific guidance

4. **User Education:**
   - Clear onboarding about recording laws
   - Warning that user is responsible for legal compliance
   - Guidance on how to obtain consent

**Tizzy Implementation Requirements:**
- [ ] Design visible, socially acceptable consent indicator
- [ ] Create standard consent communication templates
- [ ] Build "consent mode" tracking in app
- [ ] Provide clear legal guidance in user documentation
- [ ] Include consent best practices in onboarding
- [ ] Consider consent card/visual aid for users to show others
- [ ] Log consent events with timestamps

**Product Philosophy:**
We hide stigma, not recording. The device looks normal and premium, and the consent mechanism is simple, standardized, and socially legible.

---

### C) Schools and FERPA (Family Educational Rights and Privacy Act)

**Status:** REQUIRED FOR SCHOOL DISTRIBUTION

**Core Reality:**
If Tizzy works through schools, it inherits FERPA complexity. Schools must maintain "direct control" over student data, and vendors must follow strict practices.

**Reference:** [Department of Education Vendor FAQ](https://studentprivacy.ed.gov/sites/default/files/resource_document/file/Vendor%20FAQ.pdf)

**Key FERPA Concepts:**

**Educational Records:**
If Tizzy captures conversations in educational settings that could be linked to individual students, it may create or incorporate educational records.

**School Official Exception:**
Vendors can access student data without consent if they perform institutional services and are under "direct control" of the school.

**Requirements for Vendors:**
1. **Written Agreement:**
   - Must have written agreement with school
   - Agreement must specify permitted uses of data
   - Must prohibit unauthorized disclosure

2. **Direct Control:**
   - School must maintain direct control over vendor's use of data
   - Vendor must use data only for authorized purposes
   - School must be able to audit vendor practices

3. **Data Destruction:**
   - Must destroy or return data when no longer needed
   - Cannot retain data for vendor's own purposes without separate consent

4. **No Redisclosure:**
   - Cannot redisclose student data to third parties
   - Exception: Necessary subcontractors under same constraints

**Tizzy Implementation Requirements (School Channel):**
- [ ] Develop FERPA-compliant vendor agreement template
- [ ] Build school administrator dashboard with usage visibility
- [ ] Implement data destruction workflows at end of school relationship
- [ ] Document "direct control" mechanisms (school can audit, limit, terminate access)
- [ ] Separate school-context data from personal/home context data
- [ ] Provide clear guidance on which conversations are "educational records"
- [ ] Build consent workflows for non-school use of school-captured data
- [ ] Implement data portability at student transition/graduation

**Strategic Decision:**
Schools are a LATER-stage distribution channel. Do not lead with schools. Build trust posture with direct-to-consumer and therapy channels first, then approach schools with proven compliance.

**Recommended Approach:**
Wave 1: College students (18+, adult consent, simpler)
Wave 2: Therapy/clinic channel (B2B2C, clinical oversight)
Wave 3: Parents buying directly for kids (parental consent, home use)
Wave 4: Schools (only after governance proven)

---

### D) Health Data and FTC Health Breach Notification Rule

**Status:** HIGHLY RELEVANT EVEN WITHOUT HIPAA

**Core Reality:**
Even if Tizzy is not HIPAA-covered (not a healthcare provider, plan, or clearinghouse), it handles sensitive health-adjacent data. The FTC's Health Breach Notification Rule applies to personal health records and connected health devices.

**Reference:** [FTC Health Breach Notification Rule](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0)

**When It Applies:**
- Vendors of personal health records not covered by HIPAA
- Connected device companies that collect health information
- Apps that track health-related information

**Tizzy Exposure:**
- Autism is a health-related condition
- Voice patterns, stress indicators, emotional regulation data = health-adjacent
- Conversations may include health information
- Product is assistive/therapeutic in nature

**Requirements If Breach Occurs:**
1. **Notification to Affected Individuals:**
   - Must notify users whose information was breached
   - Must do so promptly (within 60 days of discovery)

2. **Notification to FTC:**
   - Must notify FTC if breach affects 500+ individuals

3. **Notification to Media:**
   - Must notify prominent media if breach affects 500+ in same jurisdiction

**Tizzy Implementation Requirements:**
- [ ] Implement breach detection and logging systems
- [ ] Develop breach notification protocols and templates
- [ ] Designate breach response team and responsibilities
- [ ] Build encrypted data storage and transmission (encryption at rest and in transit)
- [ ] Conduct regular security audits
- [ ] Implement access controls and authentication
- [ ] Maintain incident response plan
- [ ] Consider cyber insurance
- [ ] Document all security measures for compliance demonstration

**Security Design Principles:**
1. **Encryption Everywhere:**
   - On-device encryption for stored data
   - Encrypted transmission to cloud
   - Encrypted cloud storage
   - End-to-end encryption for sensitive data

2. **Access Controls:**
   - Role-based access for internal team
   - Multi-factor authentication for admin access
   - Audit logging for all data access

3. **Data Minimization:**
   - Process and discard what's not needed
   - Minimize retention periods
   - Maximize on-device processing

---

### E) State Privacy Laws (CCPA, Virginia CDPA, etc.)

**Status:** GROWING LANDSCAPE

**Core States:**

**California (CCPA/CPRA):**
- Applies to businesses collecting personal information of California residents
- Provides rights: know, delete, opt-out, correct, limit sensitive data
- Covers children with enhanced protections (under 13: opt-in required, 13-16: opt-in from child)

**Virginia, Colorado, Connecticut, Utah:** Similar frameworks with consumer data rights.

**Tizzy Implications:**
- Voice recordings = personal information
- Autism status = sensitive personal information
- Children's data = enhanced protection

**Requirements:**
1. **Privacy Notice:**
   - Clear disclosure of data collection, use, sharing practices
   - Categories of data collected
   - Purposes for collection
   - Categories of third parties with whom data is shared

2. **Consumer Rights:**
   - Right to know what data is collected
   - Right to delete data
   - Right to opt-out of sale (Tizzy should NEVER sell data)
   - Right to correct inaccurate data
   - Right to limit use of sensitive data

3. **Children-Specific:**
   - Cannot sell data of users under 16 without opt-in
   - Enhanced consent requirements

**Tizzy Implementation Requirements:**
- [ ] Draft comprehensive, clear privacy policy
- [ ] Build user rights portal (access, delete, correct data)
- [ ] Implement "Do Not Sell" commitment (make it a core value)
- [ ] Track data flows and third-party sharing
- [ ] Implement data inventory and mapping
- [ ] Build age-appropriate privacy notices for minors
- [ ] Provide parental rights portal
- [ ] Document all data processing activities

**Recommendation:**
Treat California's CCPA/CPRA as baseline. Design to exceed it. This future-proofs against other state laws and demonstrates privacy commitment.

---

## The Consent Problem IS the Product Problem

### The Challenge

Limitless openly requires consent and uses LED indicator. Friend triggered "wearing a wire" reactions. Your desire to hide the device is emotionally understandable (bullying avoidance), but covert capture is the wrong axis.

### The Tizzy Solution

**We do not hide recording. We hide stigma.**

That means:
1. The device looks normal, premium, fashionable (not medical/assistive in appearance)
2. The consent mechanism is simple, standardized, and socially legible
3. The product's legitimacy is obvious (assistive tech with clear mission)
4. The governance is visible and auditable

### Consent Mechanism Design Requirements

See `/Users/joelnewton/Desktop/2026-Code/tizzy/legal/consent-framework.md` for detailed implementation.

**High-Level Requirements:**
1. **Visible but Non-Obnoxious Indicator:**
   - Not a bright LED that draws attention
   - Could be: small light, haptic pattern, app-controlled signal
   - Must meet legal "notice" requirement without causing stigma

2. **Consent Communication Templates:**
   - Standard script users can say
   - Visual consent card to show others
   - Age-appropriate explanations

3. **Consent Modes:**
   - **Self-Only Mode:** Only captures wearer's voice/behavior (default safe mode)
   - **Consented Conversation Mode:** Full capture with consent obtained
   - **Muted:** No capture at all

4. **Consent Logging:**
   - Track consent events in app
   - Associate with conversation sessions
   - Provide audit trail

5. **Bystander Protection:**
   - System focuses on wearer's behavior, not bystanders
   - If bystander voice is stored, explicit consent required
   - Deletion pathway for bystander data

---

## Core Privacy Commitments

### 1. No Raw Audio Storage by Default

**Commitment:**
Raw audio is processed on-device into feature representations. Raw audio is NOT retained unless explicitly enabled per user and per context.

**Implementation:**
- Circular buffer on device (minutes to hours) for "instant replay"
- Buffer is overwritten unless user explicitly marks for retention
- Cloud storage receives embeddings, features, and structured data by default
- Raw audio upload only with explicit opt-in per conversation

**User Control:**
- User can enable "save conversation audio" per session
- User can review and delete saved audio
- Default is privacy-maximizing (no raw storage)

### 2. Consent Receipts

**Commitment:**
Every capture session has a record of consent mode and context.

**Implementation:**
- Each conversation session tagged with: "self-only," "consented conversation," or "muted"
- Consent events logged with timestamp and method (verbal consent, shown card, etc.)
- Audit trail available to user

### 3. Bystander Protection

**Commitment:**
System is designed to focus on wearer's behavior. Bystander voice is minimized or explicitly consented.

**Implementation:**
- Speaker diarization separates wearer from others
- Analysis focuses on wearer's patterns (turn-taking, prosody, topic management)
- Bystander speech is processed for conversational context but not stored by default
- If bystander voice must be retained, explicit consent required

### 4. Hard Mute and Quiet Hours

**Commitment:**
Users have absolute control over when device is capturing.

**Implementation:**
- Physical mute button (single press = mute toggle)
- Haptic and visual confirmation of mute state
- "Quiet hours" schedule (auto-mute during set times)
- Mute state syncs to app
- No capture, no processing, no transmission when muted

### 5. Visible Recording Indicator

**Commitment:**
When capturing multi-party conversations, there is a socially acceptable indicator.

**Implementation Options:**
- Small LED (discreet but visible on close inspection)
- Haptic pulse pattern (wearer can inform others)
- App-based indicator (can show phone screen)
- Consent card (physical card user carries and shows)

**Design Principle:**
Balance legal "notice" requirement with anti-stigma goals. Not obnoxious, but not covert.

### 6. No Viral Sharing

**Commitment:**
Conversation clips cannot be shared socially or go viral. Sharing is limited to therapeutic/trusted contexts.

**Implementation:**
- No "share to social media" feature
- Sharing limited to: therapist export, trusted guardian (parent)
- Sharing requires explicit opt-in per clip
- Shared data is access-controlled and auditable
- No public profiles, no leaderboards, no comparison to other users without consent

---

## Data Governance Summary

See `/Users/joelnewton/Desktop/2026-Code/tizzy/legal/data-governance.md` for detailed policies.

**Key Principles:**
1. **Minimize collection:** Process and discard what's not needed
2. **Minimize retention:** Delete data when no longer needed for coaching
3. **Maximize local processing:** Keep as much on-device as possible
4. **Encrypt everything:** At rest, in transit, in use where possible
5. **User control:** Users can access, review, delete their data anytime
6. **No third-party sales:** NEVER sell user data to advertisers or data brokers
7. **Transparent processing:** Users can see how data is used in privacy dashboard

---

## Compliance Checklist

See `/Users/joelnewton/Desktop/2026-Code/tizzy/legal/compliance-checklist.md` for comprehensive checklist.

**Critical Items:**
- [ ] COPPA compliance for under-13 users (if applicable)
- [ ] State recording law compliance (design for all-party consent)
- [ ] FERPA compliance for school partnerships (Wave 4)
- [ ] FTC Health Breach Notification Rule preparedness
- [ ] State privacy law compliance (CCPA/CPRA baseline)
- [ ] Data security and breach response protocols
- [ ] Privacy policy drafted and reviewed by legal counsel
- [ ] Terms of service drafted and reviewed
- [ ] Consent mechanism implemented and tested
- [ ] User rights portal built (access, delete, correct)
- [ ] Parental controls and oversight (if serving minors)

---

## Legal Posture: Assistive Technology, Not Surveillance

### Positioning Statement

**Tizzy is assistive technology with a legitimate, visible mission.**

We are not:
- Social listening for advertising
- Surveillance for parents to spy on kids
- Data harvesting for third-party sale
- "AI friend" companionship (the creepy category)

We are:
- Conversational coaching to improve real-world communication
- Scaffolding and training wheels for social fluency
- Clinical support tool for therapy and speech-language pathology
- Measurable skill-building platform

### Product Philosophy Operational Rules

1. **The user is never punished for being autistic.**
2. **The user is coached toward understanding and clarity, not conformity.**
3. **The user is always in control of capture, retention, and sharing.**
4. **Trust is a feature, not a policy document.**

### Trust as Product Feature

Build a privacy dashboard where users can see:
- What data has been collected (timestamps, contexts, modes)
- How data has been used (coaching insights generated, models accessed)
- What data has been shared (therapist exports, guardian access)
- What data has been deleted (deletion log)
- Data retention timeline (when data will be auto-deleted)

**Make privacy auditable and boring.**

Nobody believes always-on devices. So build a system that is auditable and boringly transparent.

---

## Risk Assessment

### High-Risk Scenarios

**Scenario 1: Unauthorized recording of third parties**
- Risk: Legal liability, trust violation, public backlash
- Mitigation: Consent mechanism, visible indicator, user education, consent logging

**Scenario 2: Data breach exposing sensitive conversations**
- Risk: FTC Health Breach Notification Rule trigger, user harm, reputation damage
- Mitigation: Encryption, access controls, breach response plan, cyber insurance

**Scenario 3: Misuse by parents to surveil/control children**
- Risk: Ethical violation, product misuse, harm to vulnerable users
- Mitigation: User-controlled mute, age-appropriate autonomy features, parent guidance on ethical use, therapist education

**Scenario 4: School recording without proper consent/oversight**
- Risk: FERPA violation, recording law violation, bystander exposure
- Mitigation: School compliance package, administrator controls, FERPA-compliant agreements, clear policies

**Scenario 5: Minors sharing device, violating others' consent**
- Risk: Recording law violation, trust breach
- Mitigation: Device pairing to single user, user authentication, education on responsible use

**Scenario 6: Perceived as "creepy surveillance tech"**
- Risk: Social acceptance failure, market rejection, media backlash
- Mitigation: Clear assistive mission, visible consent mechanism, premium design, trust-first marketing

### Medium-Risk Scenarios

**Scenario 7: Unclear compliance with evolving state laws**
- Risk: Legal exposure as new privacy laws pass
- Mitigation: Ongoing legal monitoring, privacy-by-design exceeding current requirements

**Scenario 8: Third-party vendor (e.g., Modulate) accesses user data inappropriately**
- Risk: Trust violation, regulatory exposure
- Mitigation: Vendor contracts with strict data use limitations, no training rights to user data, audit rights

**Scenario 9: User deletes data but it persists in backups/logs**
- Risk: Privacy law violation (right to deletion)
- Mitigation: Hard delete mechanisms, backup purging protocols, deletion verification

---

## Legal Team Requirements

### Pre-Launch Legal Review

**Required Deliverables:**
1. Privacy Policy (reviewed and approved by legal counsel)
2. Terms of Service (reviewed and approved)
3. Consent mechanism legal review (meets recording law standards)
4. COPPA compliance assessment (if serving under-13)
5. FERPA compliance package (for school channel)
6. Data Processing Agreement templates (for partners/vendors)
7. Breach notification protocols (FTC Health Breach Rule)
8. User rights fulfillment procedures (access, delete, correct)

### Ongoing Legal Support

**Required:**
- Regular privacy law monitoring (new state laws, FTC guidance)
- Contract review for partnerships (schools, clinics, therapy networks)
- Incident response support (breach, misuse, legal inquiry)
- Marketing/claims review (avoid clinical claims without validation)
- User complaint resolution (privacy concerns, deletion requests)

### Legal Budget Considerations

Privacy and compliance are not optional. Budget for:
- Legal counsel (fractional general counsel or law firm retainer)
- Privacy/security consultant for technical review
- Compliance software (consent management, data mapping, breach notification)
- Cyber insurance
- Third-party audits (security, privacy)

---

## Open Questions and Decisions Needed

### Critical Decisions

**Decision 1: Age Threshold for V1**
- **Option A:** 13+ only for V1 (avoids COPPA, simpler consent)
- **Option B:** Include under-13 with full COPPA compliance from day one
- **Recommendation:** Option A. Build trust with adults and teens first, expand to children with proven governance.

**Decision 2: Raw Audio Storage**
- **Option A:** Never store raw audio (most privacy-protective)
- **Option B:** Store raw audio on-device only, circular buffer, overwrite unless marked
- **Option C:** Optional raw audio upload to cloud with explicit opt-in
- **Recommendation:** Option B for V1 (enables instant replay), Option C as opt-in feature.

**Decision 3: Consent Indicator**
- **Option A:** Small LED on device
- **Option B:** Haptic pattern + consent card
- **Option C:** App-based indicator only
- **Recommendation:** Option B (balances notice with discretion, provides user control).

**Decision 4: School Channel Timeline**
- **Option A:** Pursue schools from V1
- **Option B:** Wait until Wave 3-4 after trust posture proven
- **Recommendation:** Option B. Schools are high-complexity, slow-moving. Build momentum elsewhere first.

**Decision 5: Therapist Data Sharing**
- **Option A:** User can export insights summary only (no raw audio/transcripts)
- **Option B:** User can export full conversations with explicit opt-in per session
- **Option C:** Therapist gets live access to user's dashboard with user permission
- **Recommendation:** Start with Option A, expand to B and C in later versions with clear consent flows.

---

## Next Steps

### Immediate Actions (Pre-Product Development)

1. **Engage legal counsel** with expertise in privacy law, children's privacy (COPPA), and health data
2. **Draft privacy policy and terms of service** for legal review
3. **Design consent mechanism** (indicator, communication templates, logging)
4. **Create compliance documentation** package (checklist, procedures, audit trails)
5. **Build privacy-first technical architecture** (encryption, minimization, local processing)

### Product Development Phase

1. **Implement consent flows** in app and device
2. **Build privacy dashboard** (user visibility into data collection and use)
3. **Implement user rights portal** (access, delete, correct)
4. **Create parental oversight features** (if serving minors)
5. **Test consent mechanism** with beta users for usability and social acceptance

### Pre-Launch

1. **Legal review of all privacy/consent implementations**
2. **Security audit** (third-party penetration testing, vulnerability assessment)
3. **Privacy audit** (third-party privacy review)
4. **User testing** of consent flows and privacy controls
5. **Breach response drill** (test incident response procedures)

### Post-Launch

1. **Monitor compliance** with privacy laws and user rights requests
2. **Track consent patterns** and user feedback on consent mechanism
3. **Iterate on privacy features** based on user needs and feedback
4. **Regular security audits** (quarterly or semi-annual)
5. **Legal landscape monitoring** (new laws, FTC guidance, case law)

---

## Resources and References

### Legal and Regulatory

- [FTC COPPA Compliance](https://www.ftc.gov/business-guidance/resources/childrens-online-privacy-protection-rule-six-step-compliance-plan-your-business)
- [FTC COPPA Voice Recording Guidance](https://www.ftc.gov/news-events/news/press-releases/2017/10/ftc-provides-additional-guidance-coppa-voice-recordings)
- [FTC Health Breach Notification Rule](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0)
- [Department of Education FERPA Resources](https://studentprivacy.ed.gov/)
- [FERPA Vendor FAQ](https://studentprivacy.ed.gov/sites/default/files/resource_document/file/Vendor%20FAQ.pdf)
- [Justia Recording Laws by State](https://www.justia.com/50-state-surveys/recording-phone-calls-and-conversations/)
- [California CCPA/CPRA Resources](https://oag.ca.gov/privacy/ccpa)

### Industry Examples

- [Limitless Consent Help Center](https://help.limitless.ai/en/articles/10540861-how-to-ask-for-consent-and-let-others-know-you-are-recording)
- [Friend Privacy Policy](https://friend.com/privacy.pdf)
- WIRED Friend Review: Cautionary tale on social acceptance

### Privacy Frameworks

- NIST Privacy Framework
- ISO 27001 (Information Security)
- Privacy by Design principles (Ann Cavoukian)

---

## Conclusion

Privacy and legal compliance are not constraints on the product. They ARE the product.

Tizzy wins if and only if it becomes the first always-wearable conversational coach that is both effective AND trusted. The category is heating up fast, and backlash against creepy "AI friend" wearables confirms trust is the differentiator.

Your unfair advantage is that you will treat privacy and consent as the product, not as legal fine print.

Build transparently. Build auditably. Build with radical respect for user autonomy and dignity.

If you do this right, Tizzy becomes the standard others try to match.
