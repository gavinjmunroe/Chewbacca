# Compliance Checklist

**Document Purpose:** Comprehensive compliance checklist for Tizzy covering COPPA, state recording laws, FERPA, health data protection, and state privacy laws.

**Status:** Pre-Launch Compliance Framework
**Owner:** Legal + Compliance + Product + Engineering
**Last Updated:** 2026-02-13

---

## Overview

This checklist provides actionable compliance requirements across all relevant legal frameworks for Tizzy. Each item includes:
- **Requirement:** What must be done
- **Owner:** Who is responsible
- **Status:** Not Started / In Progress / Complete
- **Evidence:** What documentation/implementation proves compliance
- **Priority:** Critical / High / Medium / Low
- **Timeline:** When it must be completed

**Usage:** Review weekly pre-launch, monthly post-launch. Update status and evidence links as work progresses.

---

## COPPA (Children's Online Privacy Protection Act)

**Applies to:** Children under 13 using Tizzy's online service (if applicable)

**Reference:** [FTC COPPA Compliance Guide](https://www.ftc.gov/business-guidance/resources/childrens-online-privacy-protection-rule-six-step-compliance-plan-your-business)

**Strategic Decision Needed:**
- [ ] **DECISION: Age threshold for V1** (Owner: Leadership, Priority: CRITICAL, Timeline: Before product definition)
  - Option A: 13+ only (avoids COPPA complexity)
  - Option B: Include under-13 with full COPPA compliance
  - **Recommendation:** Start with 13+ for V1, expand with proven governance

---

### COPPA Requirements (if serving under-13)

#### 1. Privacy Policy

- [ ] **Draft comprehensive privacy policy for children's service** (Owner: Legal, Priority: Critical, Timeline: Pre-launch)
  - Must be clear, understandable, complete
  - Must be prominently posted on website and in app
  - Evidence: Privacy policy URL, legal review documentation

- [ ] **Privacy policy includes all required COPPA elements:** (Owner: Legal, Priority: Critical, Timeline: Pre-launch)
  - [ ] Contact information for operator
  - [ ] Types of personal information collected from children
  - [ ] How information is collected (device, app, etc.)
  - [ ] How information is used
  - [ ] Whether information is disclosed to third parties
  - [ ] Parental rights (review, delete, refuse further collection)
  - [ ] How parents can exercise rights
  - Evidence: Privacy policy section-by-section compliance mapping

- [ ] **Privacy policy in plain language accessible to parents** (Owner: Legal + Product, Priority: Critical, Timeline: Pre-launch)
  - Test readability (target: 8th grade reading level)
  - Evidence: Readability score, parent user testing results

#### 2. Parental Consent

- [ ] **Implement verifiable parental consent mechanism** (Owner: Engineering + Product, Priority: Critical, Timeline: Pre-launch)
  - Must verify adult status before collecting child's data
  - Cannot use child's information to obtain consent
  - Evidence: Consent flow documentation, technical implementation

- [ ] **Choose FTC-approved consent method:** (Owner: Product + Legal, Priority: Critical, Timeline: Pre-launch)
  - [ ] Option: Consent form + credit/debit card verification
  - [ ] Option: Consent form + government ID verification
  - [ ] Option: Consent form + video conference verification
  - [ ] Option: Consent form + toll-free phone call verification
  - Evidence: Selected method documentation, implementation details

- [ ] **Design consent flow** (Owner: Product + Engineering, Priority: Critical, Timeline: Pre-launch)
  - Clear explanation of what's being collected and why
  - List of parental rights
  - How to revoke consent
  - Evidence: Consent flow wireframes, user testing results

- [ ] **Store consent records** (Owner: Engineering, Priority: Critical, Timeline: Pre-launch)
  - Timestamp, method, parent identity, child identity
  - Immutable, auditable log
  - Evidence: Database schema, audit log implementation

- [ ] **Implement consent verification before data collection** (Owner: Engineering, Priority: Critical, Timeline: Pre-launch)
  - App/device must check consent status before activation
  - Block usage if consent not obtained
  - Evidence: Code review, QA test results

#### 3. Parental Rights and Controls

- [ ] **Build parental dashboard** (Owner: Engineering + Product, Priority: Critical, Timeline: Pre-launch)
  - View what data is collected from child
  - View how data is used
  - Control collection settings
  - Evidence: Dashboard screenshots, feature documentation

- [ ] **Implement parental data review mechanism** (Owner: Engineering, Priority: Critical, Timeline: Pre-launch)
  - Parents can access child's personal information
  - Secure access (verify parent identity)
  - Evidence: Data access portal, security audit

- [ ] **Implement parental deletion mechanism** (Owner: Engineering, Priority: Critical, Timeline: Pre-launch)
  - Parents can delete child's data anytime
  - Hard delete (not just flag)
  - Confirmation to parent
  - Evidence: Deletion workflow, database purge verification

- [ ] **Implement refuse further collection mechanism** (Owner: Engineering, Priority: Critical, Timeline: Pre-launch)
  - Parents can stop further data collection without deleting account
  - Device enters limited mode (no capture, coaching on existing data only)
  - Evidence: Limited mode specification, implementation

- [ ] **Parental rights request response process** (Owner: Legal + Support, Priority: Critical, Timeline: Pre-launch)
  - SLA for response (recommend: 24-48 hours)
  - Staff training on how to fulfill requests
  - Evidence: Support documentation, staff training log

#### 4. Data Minimization

- [ ] **Audit all data collection for necessity** (Owner: Product + Engineering, Priority: Critical, Timeline: Pre-launch)
  - Collect only what's needed for product functionality
  - Document why each data element is necessary
  - Evidence: Data inventory, necessity justification document

- [ ] **Remove unnecessary data collection** (Owner: Engineering, Priority: High, Timeline: Pre-launch)
  - Cannot condition participation on providing more info than needed
  - Evidence: Code review, data flow audit

- [ ] **Design age-appropriate data collection** (Owner: Product, Priority: Critical, Timeline: Pre-launch)
  - Consider cognitive development of target age group
  - Extra protections for younger children (e.g., 6-9 vs 10-12)
  - Evidence: Product requirements, age-based feature matrix

#### 5. Data Security

- [ ] **Implement reasonable data security procedures** (Owner: Engineering + Security, Priority: Critical, Timeline: Pre-launch)
  - Encryption at rest and in transit
  - Access controls
  - Audit logging
  - Evidence: Security architecture document, third-party security audit

- [ ] **Document security procedures** (Owner: Engineering + Legal, Priority: High, Timeline: Pre-launch)
  - Written security policies
  - Incident response plan
  - Evidence: Security policy document, incident response playbook

- [ ] **Train staff on child data handling** (Owner: Legal + HR, Priority: High, Timeline: Pre-launch)
  - COPPA requirements
  - Security best practices
  - Incident response
  - Evidence: Training materials, staff sign-off log

#### 6. Third-Party Disclosure

- [ ] **Audit all third-party data sharing** (Owner: Engineering + Legal, Priority: Critical, Timeline: Pre-launch)
  - List all third parties that receive child data
  - Determine if sharing is necessary
  - Evidence: Third-party data flow map

- [ ] **Obtain parental consent for third-party disclosure** (Owner: Legal + Product, Priority: Critical, Timeline: Pre-launch)
  - If data is shared with third parties, parents must consent
  - Exception: Service providers under contract (e.g., cloud hosting)
  - Evidence: Consent flow, third-party agreements

- [ ] **Vet third-party partners** (Owner: Legal + Security, Priority: Critical, Timeline: Pre-launch)
  - Third parties must maintain confidentiality and security
  - Written agreements required
  - Evidence: Vendor agreements, security questionnaire responses

- [ ] **Special scrutiny for third-party ad networks, analytics** (Owner: Legal + Engineering, Priority: Critical, Timeline: Pre-launch)
  - Cannot use child data for behavioral advertising
  - Cannot build profiles of children
  - If using analytics, must be privacy-preserving (anonymized, aggregated)
  - Evidence: Analytics configuration, no-tracking implementation

#### 7. Voice Recording Specific (FTC 2017 Guidance)

- [ ] **Review FTC voice recording guidance** (Owner: Legal, Priority: Critical, Timeline: Pre-launch)
  - FTC issued specific guidance on voice recordings under COPPA
  - [FTC Voice Recording Guidance](https://www.ftc.gov/news-events/news/press-releases/2017/10/ftc-provides-additional-guidance-coppa-voice-recordings)
  - Evidence: Legal memo on applicability

- [ ] **Extra protections for voice data** (Owner: Product + Engineering, Priority: Critical, Timeline: Pre-launch)
  - Voice is "personal information" under COPPA
  - Consider: Local processing only for under-13, no cloud upload
  - Consider: Voice embeddings instead of raw audio
  - Evidence: Technical architecture, data flow diagram

- [ ] **Parental control over voice retention** (Owner: Product, Priority: Critical, Timeline: Pre-launch)
  - Parents can choose voice retention period
  - Parents can delete voice data separately from other data
  - Evidence: Parent settings UI, deletion granularity

---

## State Recording Consent Laws

**Applies to:** All users capturing conversations in U.S. states

**Reference:** [Justia 50-State Recording Laws Survey](https://www.justia.com/50-state-surveys/recording-phone-calls-and-conversations/)

---

### General Compliance

- [ ] **Legal research on state recording laws** (Owner: Legal, Priority: Critical, Timeline: Pre-launch)
  - Comprehensive 50-state analysis
  - Identify all-party consent states
  - Identify one-party consent states
  - Identify any special provisions (e.g., expectation of privacy, workplace, etc.)
  - Evidence: Legal memo, state-by-state compliance matrix

- [ ] **Design for strictest standard (all-party consent)** (Owner: Product + Legal, Priority: Critical, Timeline: Pre-launch)
  - Default product behavior assumes all-party consent required
  - This ensures compliance in all states
  - Evidence: Product requirements, consent mechanism design

- [ ] **User education on recording laws** (Owner: Product + Legal, Priority: Critical, Timeline: Pre-launch)
  - Onboarding includes recording law overview
  - User agrees they are responsible for compliance
  - Provide state-specific guidance (optional: auto-detect user state)
  - Evidence: Onboarding flow screenshots, user agreement text

#### Consent Mechanism

- [ ] **Design visible recording indicator** (Owner: Product + Engineering, Priority: Critical, Timeline: Pre-launch)
  - Meets legal "notice" requirement
  - Socially acceptable (not obnoxious, but not covert)
  - Options: LED, haptic reminder + consent card, app indicator
  - Evidence: Hardware design, indicator behavior specification

- [ ] **Implement consent modes** (Owner: Engineering, Priority: Critical, Timeline: Pre-launch)
  - **Muted:** No capture
  - **Self-only:** Capture wearer voice only (no multi-party)
  - **Consented:** Full multi-party capture (consent obtained)
  - Evidence: App UI, consent mode logic, state machine diagram

- [ ] **Default to privacy-maximizing mode** (Owner: Product, Priority: High, Timeline: Pre-launch)
  - Device starts in "self-only" or "muted" mode
  - User must explicitly enable "consented" mode
  - Evidence: Default settings documentation

- [ ] **Create consent communication templates** (Owner: Product + Legal, Priority: High, Timeline: Pre-launch)
  - Verbal consent script
  - Consent card (physical card user shows others)
  - Age-appropriate versions (for kids to use with peers)
  - Evidence: Consent card design, script copy

- [ ] **Implement consent logging** (Owner: Engineering, Priority: Critical, Timeline: Pre-launch)
  - Log consent mode for each conversation
  - Log consent method (verbal, card shown, etc.)
  - Log environment and bystander count estimate
  - Evidence: Database schema, consent log UI

- [ ] **Build consent audit trail** (Owner: Engineering, Priority: High, Timeline: Pre-launch)
  - User can review consent history
  - User can generate consent report (for records, school, etc.)
  - Evidence: Audit trail UI, export functionality

#### User Warnings and Liability

- [ ] **Draft user agreement on recording law compliance** (Owner: Legal, Priority: Critical, Timeline: Pre-launch)
  - User agrees to obtain consent where required
  - User agrees to comply with state laws
  - Tizzy provides tools but user is responsible for legal compliance
  - Evidence: Terms of service section, user agreement flow

- [ ] **In-app warnings for high-risk contexts** (Owner: Product, Priority: Medium, Timeline: V1 or V2)
  - Detect environment tags (school, work, public)
  - Remind user to obtain consent
  - Evidence: Contextual reminder logic, UI mockups

- [ ] **Optional: Geographic awareness** (Owner: Product + Engineering, Priority: Low, Timeline: V2+)
  - Detect user's state (via GPS or user input)
  - Provide state-specific consent guidance
  - Evidence: Geolocation logic, state-specific content

#### Bystander Protection

- [ ] **Implement bystander deletion request process** (Owner: Legal + Support + Engineering, Priority: High, Timeline: Pre-launch)
  - How bystanders can request deletion if recorded without consent
  - Contact info prominently available
  - Fast response (recommend: 24-48 hours)
  - Evidence: Deletion request workflow, support documentation

- [ ] **Build bystander deletion workflow in app** (Owner: Engineering + Product, Priority: High, Timeline: Pre-launch)
  - User reports bystander deletion request
  - User identifies conversation session
  - System deletes all data from that session
  - Confirmation to user and (if possible) bystander
  - Evidence: Deletion UI, backend logic

- [ ] **Track and respond to bystander complaints** (Owner: Legal + Support, Priority: High, Timeline: Pre-launch)
  - Log all bystander complaints
  - Investigate each one
  - Identify patterns (if many complaints, consent mechanism needs improvement)
  - Evidence: Complaint tracking system, response SLA

---

## FERPA (Family Educational Rights and Privacy Act)

**Applies to:** School-based usage and partnerships

**Reference:** [Department of Education FERPA Resources](https://studentprivacy.ed.gov/)

**Strategic Note:** Schools are recommended for Wave 4 distribution (after trust posture proven with consumer and therapy channels).

---

### FERPA Applicability

- [ ] **Determine if Tizzy creates/accesses educational records** (Owner: Legal, Priority: High, Timeline: Before school partnerships)
  - If Tizzy captures conversations in educational settings linked to students, may be educational records
  - If Tizzy is used as instructional/therapeutic tool, may fall under school official exception
  - Evidence: Legal memo on FERPA applicability

- [ ] **FERPA compliance decision** (Owner: Legal + Product, Priority: High, Timeline: Before school partnerships)
  - Option A: Avoid FERPA by focusing on home/personal use only (not school-authorized)
  - Option B: Design for FERPA compliance (school official exception, written agreements)
  - **Recommendation:** Option A for V1-V3, Option B for Wave 4 school channel

---

### FERPA Requirements (if applicable)

#### 1. Written Agreement with Schools

- [ ] **Draft FERPA-compliant vendor agreement template** (Owner: Legal, Priority: High, Timeline: Before school partnerships)
  - School maintains direct control over data
  - Permitted uses clearly specified
  - No unauthorized disclosure
  - Data destruction obligations
  - Evidence: Agreement template, legal review

- [ ] **Define permitted uses of student data** (Owner: Legal + Product, Priority: High, Timeline: Before school partnerships)
  - Specific to educational purpose (e.g., speech therapy, social skills coaching)
  - Cannot use for marketing or product improvement without separate consent
  - Evidence: Permitted use specification in agreement

- [ ] **Negotiate agreements with each school/district** (Owner: Business Development + Legal, Priority: High, Timeline: Per partnership)
  - Cannot have one-size-fits-all; districts may have additional requirements
  - Evidence: Executed agreements, negotiation records

#### 2. Direct Control by School

- [ ] **Build school administrator dashboard** (Owner: Engineering + Product, Priority: High, Timeline: Before school partnerships)
  - School can see what data is collected from students
  - School can see how data is used
  - School can audit Tizzy's practices
  - Evidence: Admin dashboard screenshots, feature documentation

- [ ] **Implement school control mechanisms** (Owner: Engineering, Priority: High, Timeline: Before school partnerships)
  - School can limit data collection (e.g., certain environments only)
  - School can terminate access
  - School can require data deletion
  - Evidence: Admin controls specification, implementation

- [ ] **Provide usage reports to schools** (Owner: Product + Engineering, Priority: High, Timeline: Before school partnerships)
  - Regular reports on student usage
  - Aggregate analytics (privacy-preserving)
  - Evidence: Report templates, reporting workflow

#### 3. No Redisclosure

- [ ] **Restrict third-party data sharing for school data** (Owner: Engineering + Legal, Priority: High, Timeline: Before school partnerships)
  - School-context data cannot be shared with third parties
  - Exception: Necessary subcontractors (e.g., cloud provider) under same restrictions
  - Evidence: Data flow audit, access controls

- [ ] **Flag school-context data separately** (Owner: Engineering, Priority: High, Timeline: Before school partnerships)
  - Tag conversations captured in school environments
  - Apply stricter access controls
  - Evidence: Data tagging schema, access control rules

- [ ] **Subcontractor agreements** (Owner: Legal, Priority: High, Timeline: Before school partnerships)
  - If subcontractors access school data, they must comply with FERPA
  - Written agreements required
  - Evidence: Subcontractor agreement templates, executed agreements

#### 4. Data Destruction

- [ ] **Implement data destruction at end of school relationship** (Owner: Engineering + Legal, Priority: High, Timeline: Before school partnerships)
  - When student leaves school, school partnership ends, etc.
  - School can require deletion of all student data
  - Hard delete, including backups
  - Evidence: Deletion workflow, backup purge process

- [ ] **Define retention periods for school data** (Owner: Legal + Product, Priority: High, Timeline: Before school partnerships)
  - Align with school policies (districts may have specific retention rules)
  - Cannot retain indefinitely for Tizzy's own purposes
  - Evidence: Retention policy, school agreement terms

- [ ] **Provide data destruction verification to schools** (Owner: Engineering + Legal, Priority: High, Timeline: Before school partnerships)
  - Confirmation that data has been deleted
  - Audit trail showing deletion
  - Evidence: Deletion certificate template, verification process

#### 5. Parent/Student Rights under FERPA

- [ ] **Honor parent rights to review student data** (Owner: Engineering + Support, Priority: High, Timeline: Before school partnerships)
  - Parents have right to review educational records (including Tizzy data if applicable)
  - School facilitates this; Tizzy provides data to school or directly to parent
  - Evidence: Data access workflow, parent request process

- [ ] **Honor parent rights to request correction** (Owner: Engineering + Support, Priority: Medium, Timeline: Before school partnerships)
  - If data is inaccurate, parents can request correction
  - Evidence: Data correction workflow

- [ ] **Honor parent rights to limit disclosure** (Owner: Engineering + Legal, Priority: High, Timeline: Before school partnerships)
  - Parents may limit disclosure of directory information or other data
  - Tizzy respects parent opt-outs
  - Evidence: Opt-out implementation, school data sharing controls

#### 6. FERPA-Specific Data Security

- [ ] **Enhanced security for school data** (Owner: Engineering + Security, Priority: High, Timeline: Before school partnerships)
  - Encryption, access controls, audit logging (already required)
  - May need additional protections based on school requirements
  - Evidence: Security architecture, school security review

- [ ] **Security audits for school partnerships** (Owner: Security + Legal, Priority: High, Timeline: Before school partnerships)
  - Third-party security audit before first school partnership
  - Annual audits for school channel
  - Evidence: Audit reports, remediation documentation

---

## Health Data Protection (FTC Health Breach Notification Rule)

**Applies to:** Tizzy as a connected health device handling health-related information

**Reference:** [FTC Health Breach Notification Rule](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0)

---

### Applicability

- [ ] **Legal analysis of Health Breach Notification Rule applicability** (Owner: Legal, Priority: Critical, Timeline: Pre-launch)
  - Tizzy is not HIPAA-covered (not provider, plan, clearinghouse)
  - But may be "vendor of personal health records" or connected device
  - Autism is health-related; voice patterns, emotional data are health-adjacent
  - Evidence: Legal memo on applicability

- [ ] **Assume applicability and design for compliance** (Owner: Legal + Engineering, Priority: Critical, Timeline: Pre-launch)
  - Safer to over-comply than under-comply
  - Evidence: Compliance decision document

---

### Breach Prevention

- [ ] **Implement comprehensive data security** (Owner: Engineering + Security, Priority: Critical, Timeline: Pre-launch)
  - Encryption at rest (database, file storage)
  - Encryption in transit (TLS 1.3+, end-to-end where possible)
  - Access controls (role-based, least privilege)
  - Authentication (MFA for admin access)
  - Audit logging (all data access logged)
  - Evidence: Security architecture document, implementation verification

- [ ] **Third-party security audit** (Owner: Security + Legal, Priority: Critical, Timeline: Pre-launch)
  - Independent penetration testing
  - Vulnerability assessment
  - Remediate all critical/high findings
  - Evidence: Audit report, remediation log

- [ ] **Regular security audits** (Owner: Security, Priority: High, Timeline: Quarterly or semi-annual post-launch)
  - Ongoing penetration testing
  - Code security reviews
  - Dependency vulnerability scanning
  - Evidence: Audit schedule, audit reports

- [ ] **Incident detection and monitoring** (Owner: Engineering + Security, Priority: High, Timeline: Pre-launch)
  - Intrusion detection system
  - Anomaly detection (unusual data access patterns)
  - Alerts for potential breaches
  - Evidence: Monitoring system documentation, alert configuration

#### Breach Response

- [ ] **Draft Health Breach Notification Rule response plan** (Owner: Legal + Security, Priority: Critical, Timeline: Pre-launch)
  - Incident response playbook specifically for data breaches
  - Roles and responsibilities
  - Notification templates
  - Evidence: Breach response plan document

- [ ] **Designate breach response team** (Owner: Legal + Leadership, Priority: Critical, Timeline: Pre-launch)
  - Incident commander
  - Legal counsel
  - Technical lead
  - Communications lead
  - Evidence: Team roster, contact information

- [ ] **Breach notification procedures** (Owner: Legal + Engineering, Priority: Critical, Timeline: Pre-launch)
  - **To affected individuals:** Within 60 days of discovery
  - **To FTC:** If 500+ individuals affected (via FTC website)
  - **To media:** If 500+ individuals in same state/jurisdiction
  - Evidence: Notification workflow, template emails/letters

- [ ] **Breach notification templates** (Owner: Legal + Communications, Priority: High, Timeline: Pre-launch)
  - User notification email/letter
  - FTC notification (if required)
  - Media statement (if required)
  - Must include: date of breach, description, types of data involved, steps taken, contact info
  - Evidence: Template library

- [ ] **Test breach response plan** (Owner: Security + Legal, Priority: Medium, Timeline: Pre-launch)
  - Tabletop exercise or simulated breach
  - Identify gaps, improve plan
  - Evidence: Exercise notes, plan updates

#### Ongoing Compliance

- [ ] **Maintain security documentation** (Owner: Security + Legal, Priority: High, Timeline: Ongoing)
  - Document all security measures
  - Document breach response activities (if any)
  - Evidence: Security documentation repository

- [ ] **Consider cyber insurance** (Owner: Finance + Legal, Priority: Medium, Timeline: Pre-launch or early post-launch)
  - Coverage for breach costs (notification, remediation, legal)
  - May require certain security controls as prerequisite
  - Evidence: Insurance policy, coverage details

---

## State Privacy Laws (CCPA/CPRA, Virginia CDPA, etc.)

**Applies to:** Users in states with comprehensive privacy laws

**Reference:** [California CCPA/CPRA](https://oag.ca.gov/privacy/ccpa)

**Strategic Note:** Treat California CCPA/CPRA as baseline; design to exceed it.

---

### CCPA/CPRA (California)

#### 1. Privacy Notice

- [ ] **Draft CCPA-compliant privacy policy** (Owner: Legal, Priority: Critical, Timeline: Pre-launch)
  - Must include all required disclosures
  - Evidence: Privacy policy, CCPA compliance checklist

- [ ] **Privacy policy includes required elements:** (Owner: Legal, Priority: Critical, Timeline: Pre-launch)
  - [ ] Categories of personal information collected
  - [ ] Sources of personal information
  - [ ] Business/commercial purposes for collection
  - [ ] Categories of third parties with whom data is shared
  - [ ] Categories of personal information sold or shared (if any)
  - [ ] Consumer rights and how to exercise them
  - [ ] Evidence: Privacy policy section mapping

- [ ] **Provide "Notice at Collection"** (Owner: Product + Legal, Priority: Critical, Timeline: Pre-launch)
  - At or before collection, inform user of categories of PI being collected and purposes
  - Evidence: In-app notice, onboarding flow

#### 2. Consumer Rights

- [ ] **Implement Right to Know** (Owner: Engineering + Legal, Priority: Critical, Timeline: Pre-launch)
  - User can request: what PI is collected, sources, purposes, third parties, specific pieces of PI
  - Response within 45 days (can extend 45 more)
  - Evidence: Data access portal, request fulfillment process

- [ ] **Implement Right to Delete** (Owner: Engineering + Legal, Priority: Critical, Timeline: Pre-launch)
  - User can request deletion of PI (with exceptions)
  - Hard delete, including backups
  - Notify third parties if data was shared
  - Response within 45 days
  - Evidence: Deletion portal, backend deletion logic, third-party notification workflow

- [ ] **Implement Right to Correct** (Owner: Engineering + Legal, Priority: High, Timeline: Pre-launch or V1.1)
  - User can request correction of inaccurate PI
  - Response within 45 days
  - Evidence: Data correction portal, correction workflow

- [ ] **Implement Right to Opt-Out of Sale/Sharing** (Owner: Engineering + Legal + Product, Priority: Critical, Timeline: Pre-launch)
  - User can opt-out of sale or sharing for cross-context behavioral ads
  - **Tizzy commitment:** NEVER sell data (make this a core value, not just compliance)
  - Provide "Do Not Sell or Share My Personal Information" link
  - Evidence: Opt-out mechanism (even if not needed due to no-sale policy), privacy policy commitment

- [ ] **Implement Right to Limit Use of Sensitive Personal Information** (Owner: Engineering + Legal, Priority: High, Timeline: Pre-launch)
  - Sensitive PI includes: health data, precise geolocation, voice recordings, etc.
  - User can limit use to necessary purposes only
  - Evidence: Sensitive data controls, user settings

- [ ] **User rights request verification** (Owner: Engineering + Legal, Priority: High, Timeline: Pre-launch)
  - Verify user identity before fulfilling requests (protect against fraudulent requests)
  - Reasonable verification method (match account info, email verification, etc.)
  - Evidence: Verification workflow, security measures

- [ ] **Track and respond to user rights requests** (Owner: Legal + Support + Engineering, Priority: Critical, Timeline: Pre-launch)
  - Log all requests (know, delete, correct, opt-out, limit)
  - SLA: 45 days (can extend 45 more with notice)
  - Provide confirmation to user
  - Evidence: Request tracking system, response templates

#### 3. Children-Specific (CCPA)

- [ ] **Enhanced protections for users under 16** (Owner: Legal + Product, Priority: High, Timeline: Pre-launch if serving under-16)
  - Cannot sell PI of users under 16 without opt-in
  - Under 13: Parent opt-in required
  - 13-15: User (child) opt-in required
  - Evidence: Age-gating, opt-in flows

- [ ] **Age-appropriate privacy notices** (Owner: Product + Legal, Priority: Medium, Timeline: Pre-launch if serving minors)
  - Simplified, clear language for teens/kids
  - Evidence: Kid-friendly privacy notice

#### 4. Data Inventory and Mapping

- [ ] **Create comprehensive data inventory** (Owner: Engineering + Legal, Priority: Critical, Timeline: Pre-launch)
  - List all personal information collected
  - Categorize (CCPA categories: identifiers, biometric, audio, health, etc.)
  - Evidence: Data inventory spreadsheet

- [ ] **Map data flows** (Owner: Engineering + Legal, Priority: Critical, Timeline: Pre-launch)
  - Where data comes from (device, user input, third parties)
  - Where data goes (cloud, third parties, analytics)
  - How data is used (coaching, analytics, product improvement)
  - Evidence: Data flow diagram, narrative description

- [ ] **Document retention periods** (Owner: Legal + Product, Priority: High, Timeline: Pre-launch)
  - How long each type of data is kept
  - When it's deleted
  - Evidence: Data retention schedule

- [ ] **Audit third-party data sharing** (Owner: Legal + Engineering, Priority: Critical, Timeline: Pre-launch)
  - List all third parties that receive user data
  - Document what they receive and why
  - Ensure contracts prohibit onward sale/sharing
  - Evidence: Third-party data sharing log, contract audit

#### 5. "Do Not Sell" Commitment

- [ ] **Adopt "No Data Sales" core value** (Owner: Leadership + Legal, Priority: Critical, Timeline: Pre-launch)
  - Tizzy will NEVER sell user data to advertisers, data brokers, etc.
  - Make this a public commitment, not just legal compliance
  - Evidence: Public blog post, privacy policy statement, marketing materials

- [ ] **Implement technical controls to prevent sale** (Owner: Engineering, Priority: Critical, Timeline: Pre-launch)
  - No integrations with data brokers
  - No ad networks with behavioral targeting
  - Analytics must be first-party or privacy-preserving only
  - Evidence: Code review, integration audit

- [ ] **Provide "Do Not Sell" link anyway** (Owner: Product + Legal, Priority: High, Timeline: Pre-launch)
  - Even though Tizzy doesn't sell, provide mechanism for compliance
  - Link can go to page explaining "We don't sell your data"
  - Evidence: Website link, landing page

---

### Other State Privacy Laws (Virginia CDPA, Colorado CPA, Connecticut CTDPA, Utah UCPA)

- [ ] **Research other state privacy law requirements** (Owner: Legal, Priority: High, Timeline: Pre-launch)
  - Similar to CCPA but some differences
  - Generally: consumer rights (access, delete, opt-out), privacy notices, data security
  - Evidence: Legal memo, compliance matrix

- [ ] **Design for multi-state compliance** (Owner: Legal + Product, Priority: High, Timeline: Pre-launch)
  - If compliant with CCPA/CPRA, likely compliant with others (CCPA is strictest in most areas)
  - Monitor for state-specific nuances
  - Evidence: Compliance checklist for each state law

---

## Accessibility and Non-Discrimination

**Applies to:** Product design for users with disabilities (Tizzy's target population)

---

### ADA and Digital Accessibility

- [ ] **Review ADA Title III applicability** (Owner: Legal + Product, Priority: Medium, Timeline: Pre-launch)
  - Applies to "places of public accommodation" (may include websites/apps)
  - Tizzy is assistive tech for people with disabilities; must be accessible to target users
  - Evidence: Legal memo

- [ ] **Design accessible app and website** (Owner: Product + Engineering, Priority: High, Timeline: Pre-launch)
  - WCAG 2.1 AA compliance (Web Content Accessibility Guidelines)
  - Screen reader compatibility
  - Color contrast, font size, alternative text
  - Evidence: Accessibility audit, WCAG checklist

- [ ] **User testing with target population** (Owner: Product, Priority: High, Timeline: Pre-launch)
  - Test with autistic users (diverse profiles)
  - Identify accessibility barriers
  - Iterate based on feedback
  - Evidence: User testing reports, design iterations

---

## Marketing and Advertising Compliance

**Applies to:** All marketing materials, claims, and advertising

---

### FTC Act Section 5 (Unfair/Deceptive Practices)

- [ ] **Review all marketing claims for truthfulness** (Owner: Legal + Marketing, Priority: Critical, Timeline: Pre-launch and ongoing)
  - Cannot make false or misleading claims
  - Must have substantiation for claims (e.g., "improves conversation skills")
  - Evidence: Claim substantiation files, legal review of marketing materials

- [ ] **Avoid clinical claims without validation** (Owner: Legal + Product, Priority: Critical, Timeline: Pre-launch)
  - V1 is coaching/self-improvement, NOT medical device
  - Cannot claim to diagnose, treat, cure autism or any medical condition
  - Can claim: "conversation coaching," "skill-building," "helps users improve communication"
  - Evidence: Marketing guidelines, legal review

- [ ] **Testimonials and endorsements compliance** (Owner: Marketing + Legal, Priority: High, Timeline: If using testimonials)
  - Must disclose material connections (e.g., if paid)
  - Must be genuine experiences, not fabricated
  - Evidence: Testimonial consent forms, disclosure language

---

### Children's Advertising (COPPA, CARU)

- [ ] **Review CARU guidelines if marketing to children** (Owner: Marketing + Legal, Priority: High, Timeline: If targeting under-13)
  - Children's Advertising Review Unit (CARU) self-regulatory guidelines
  - Cannot exploit children's credulity
  - Cannot pressure children to purchase
  - Evidence: CARU compliance review

- [ ] **Parental focus for marketing (if targeting kids)** (Owner: Marketing, Priority: High, Timeline: If targeting under-13)
  - Market to parents, not directly to young children
  - Explain benefits, privacy, safety to parents
  - Evidence: Marketing strategy document

---

## Data Processing Agreements and Vendor Management

**Applies to:** All third-party vendors and partners that process user data

---

### Vendor Vetting

- [ ] **Create list of all vendors that access user data** (Owner: Engineering + Legal, Priority: Critical, Timeline: Pre-launch)
  - Cloud hosting (AWS, GCP, Azure)
  - AI models (Modulate, OpenAI, etc.)
  - Analytics (if any)
  - Support tools (if any)
  - Payment processors
  - Evidence: Vendor inventory

- [ ] **Vendor security questionnaires** (Owner: Security + Legal, Priority: Critical, Timeline: Pre-launch)
  - Assess vendor security practices
  - Require SOC 2, ISO 27001, or equivalent certifications
  - Evidence: Completed questionnaires, certifications

- [ ] **Data Processing Agreements (DPAs) with all vendors** (Owner: Legal, Priority: Critical, Timeline: Pre-launch)
  - Define data use restrictions
  - No training on user data without consent
  - No onward sharing
  - Deletion obligations
  - Security requirements
  - Evidence: Executed DPAs

---

### Modulate Relationship (Special Focus)

- [ ] **Negotiate Modulate contract with strict boundaries** (Owner: Legal + Leadership, Priority: Critical, Timeline: Pre-launch)
  - Tizzy owns the autism dataset (Modulate has no training rights by default)
  - Inference-only license (pay for model usage, don't gift moat)
  - No exclusivity that traps Tizzy
  - Auditability and change control
  - Exit plan (ability to swap underlying tone engine)
  - Evidence: Executed Modulate agreement, legal review

- [ ] **Limit Modulate data access** (Owner: Engineering + Legal, Priority: Critical, Timeline: Pre-launch)
  - Send only what's necessary for inference (embeddings, features)
  - Do not send raw audio or full transcripts unless absolutely necessary
  - Encrypt data in transit
  - Evidence: API integration design, data minimization verification

- [ ] **Audit Modulate's data handling** (Owner: Legal + Security, Priority: High, Timeline: Annually)
  - Right to audit in contract
  - Verify Modulate is not retaining/using data improperly
  - Evidence: Audit reports, Modulate compliance attestations

---

## International Considerations (Future)

**Applies to:** If Tizzy expands internationally

**Note:** V1 is U.S.-only. This section is for future reference.

---

### GDPR (European Union)

- [ ] **GDPR compliance research** (Owner: Legal, Priority: Low, Timeline: Before EU expansion)
  - More stringent than U.S. laws
  - Requires: lawful basis for processing, data minimization, user rights (access, delete, portability, object), Data Protection Officer, etc.
  - Evidence: Legal memo

- [ ] **GDPR-compliant consent mechanisms** (Owner: Product + Legal, Priority: Low, Timeline: Before EU expansion)
  - Explicit, informed, freely given consent
  - Easy to withdraw
  - Evidence: Consent flow design

- [ ] **Data localization** (Owner: Engineering + Legal, Priority: Low, Timeline: Before EU expansion)
  - May need to store EU user data in EU (Schrems II concerns)
  - Evidence: Hosting strategy, data residency plan

---

### Other Jurisdictions

- [ ] **Research privacy laws in target countries** (Owner: Legal, Priority: Low, Timeline: Before international expansion)
  - Canada (PIPEDA), UK (UK GDPR), Australia (Privacy Act), etc.
  - Evidence: Legal memos per jurisdiction

---

## Compliance Monitoring and Auditing

**Applies to:** Ongoing compliance post-launch

---

### Internal Audits

- [ ] **Establish compliance review schedule** (Owner: Legal + Compliance, Priority: High, Timeline: Post-launch)
  - Monthly: Review user rights requests, deletion fulfillment
  - Quarterly: Privacy policy review (any updates needed?)
  - Quarterly: Data inventory audit (any new data collected?)
  - Semi-annually: Vendor compliance check
  - Annually: Comprehensive compliance audit
  - Evidence: Audit schedule, audit reports

- [ ] **Designate compliance officer or team** (Owner: Leadership, Priority: High, Timeline: Post-launch)
  - Responsible for tracking compliance
  - Liaison with legal counsel
  - Evidence: Role description, team roster

- [ ] **Compliance metrics and reporting** (Owner: Legal + Compliance, Priority: Medium, Timeline: Post-launch)
  - Track: User rights request volume and response time, deletion requests, bystander complaints, consent mode distribution, security incidents
  - Report to leadership monthly or quarterly
  - Evidence: Compliance dashboard, reports

---

### External Audits

- [ ] **Third-party privacy audit** (Owner: Legal + Security, Priority: Medium, Timeline: Annually post-launch)
  - Independent review of privacy practices
  - Identify gaps, recommend improvements
  - Evidence: Audit report, remediation plan

- [ ] **Third-party security audit** (Owner: Security, Priority: High, Timeline: Annually post-launch)
  - Penetration testing, vulnerability assessment
  - Evidence: Audit report, remediation log

- [ ] **Consider privacy certifications** (Owner: Legal + Product, Priority: Low, Timeline: Post-launch)
  - TRUSTe, IAPP certifications, etc.
  - Market signal of privacy commitment
  - Evidence: Certification documentation

---

## Training and Education

**Applies to:** All team members handling user data

---

### Staff Training

- [ ] **Privacy and security training for all employees** (Owner: Legal + HR, Priority: High, Timeline: Pre-launch and ongoing)
  - COPPA compliance (if applicable)
  - State recording laws
  - FERPA (if applicable)
  - Data security best practices
  - Incident response
  - Evidence: Training materials, completion tracking

- [ ] **Role-specific training** (Owner: Legal + HR, Priority: High, Timeline: Pre-launch)
  - Engineers: Secure coding, data minimization
  - Support: User rights request fulfillment, privacy inquiries
  - Marketing: Advertising compliance, truthful claims
  - Evidence: Role-specific training modules

- [ ] **Annual refresher training** (Owner: Legal + HR, Priority: Medium, Timeline: Annually)
  - Update on new laws, regulations, best practices
  - Evidence: Training records

---

### User Education

- [ ] **Privacy onboarding for users** (Owner: Product + Legal, Priority: High, Timeline: Pre-launch)
  - Explain privacy controls, consent mechanisms, user rights
  - Interactive tutorial
  - Evidence: Onboarding flow, user feedback

- [ ] **Consent best practices education** (Owner: Product + Legal, Priority: High, Timeline: Pre-launch)
  - How to obtain consent
  - State recording law overview
  - Social scripts and consent card usage
  - Evidence: Educational content, videos, FAQs

- [ ] **Ongoing privacy tips and reminders** (Owner: Product, Priority: Medium, Timeline: Post-launch)
  - In-app tips, blog posts, email newsletters
  - Reinforce responsible use
  - Evidence: Content library, distribution schedule

---

## Documentation and Record-Keeping

**Applies to:** All compliance activities

---

### Required Documentation

- [ ] **Privacy policy** (Owner: Legal, Priority: Critical, Timeline: Pre-launch)
  - Evidence: Published privacy policy, legal review

- [ ] **Terms of service** (Owner: Legal, Priority: Critical, Timeline: Pre-launch)
  - Evidence: Published ToS, legal review

- [ ] **Consent mechanism documentation** (Owner: Product + Legal, Priority: Critical, Timeline: Pre-launch)
  - How consent is obtained, logged, audited
  - Evidence: Consent mechanism design doc

- [ ] **Data inventory and data flow maps** (Owner: Engineering + Legal, Priority: Critical, Timeline: Pre-launch)
  - Evidence: Data inventory spreadsheet, data flow diagrams

- [ ] **Vendor agreements and DPAs** (Owner: Legal, Priority: Critical, Timeline: Pre-launch)
  - Evidence: Executed agreements, agreement repository

- [ ] **Incident response plan** (Owner: Legal + Security, Priority: Critical, Timeline: Pre-launch)
  - Evidence: Incident response playbook

- [ ] **User rights request logs** (Owner: Legal + Support, Priority: High, Timeline: Post-launch)
  - Track all requests and responses
  - Evidence: Request tracking system

- [ ] **Compliance audit reports** (Owner: Legal + Compliance, Priority: High, Timeline: Post-launch)
  - Internal and external audits
  - Evidence: Audit report repository

---

## Pre-Launch Compliance Gate

**Critical:** Do not launch product until these items are complete.

---

### Pre-Launch Checklist

- [ ] **Privacy policy drafted and legally reviewed** ✅ Critical
- [ ] **Terms of service drafted and legally reviewed** ✅ Critical
- [ ] **User rights portal built (access, delete, correct)** ✅ Critical
- [ ] **Consent mechanism implemented and tested** ✅ Critical
- [ ] **Data security architecture reviewed and audited** ✅ Critical
- [ ] **Vendor agreements executed (Modulate, cloud, etc.)** ✅ Critical
- [ ] **Incident response plan documented and team trained** ✅ Critical
- [ ] **Compliance officer/team designated** ✅ High
- [ ] **Staff trained on privacy and security** ✅ High
- [ ] **User education materials created (onboarding, FAQs)** ✅ High
- [ ] **Age-gating decision made and implemented (13+ vs under-13)** ✅ Critical
- [ ] **COPPA compliance complete (if serving under-13)** ✅ Critical (if applicable)
- [ ] **Recording law compliance design finalized** ✅ Critical
- [ ] **Bystander protection mechanisms in place** ✅ Critical
- [ ] **FERPA compliance (if school channel in V1)** ✅ Critical (if applicable)
- [ ] **Legal counsel sign-off on compliance posture** ✅ Critical

**Launch Decision:**
- **GREEN (Go):** All critical items complete, high items complete or with plan
- **YELLOW (Delay):** Some critical items incomplete; target date for completion
- **RED (No Go):** Multiple critical items incomplete; significant compliance risk

---

## Post-Launch Compliance Maintenance

### Monthly

- [ ] Review user rights requests and response times
- [ ] Review bystander complaints and resolutions
- [ ] Review consent mode distribution and consent logging
- [ ] Review support tickets for privacy concerns

### Quarterly

- [ ] Privacy policy review (any updates needed?)
- [ ] Data inventory audit (any new data types?)
- [ ] Vendor compliance check
- [ ] Compliance metrics report to leadership
- [ ] Security incident review

### Annually

- [ ] Comprehensive compliance audit (internal)
- [ ] Third-party privacy and security audits
- [ ] Staff refresher training
- [ ] Legal landscape review (new laws, regulations)
- [ ] Transparency report publication

---

## Conclusion

Compliance is not a one-time checklist. It is an ongoing commitment.

This checklist provides a comprehensive framework for Tizzy's compliance obligations. It must be:
- **Reviewed regularly** (weekly pre-launch, monthly post-launch)
- **Updated as laws change** (legal monitoring is critical)
- **Owned cross-functionally** (legal, product, engineering, support all have roles)
- **Measured and reported** (leadership must see compliance status)

**Remember:** Privacy and compliance are not constraints. They ARE the product. Tizzy wins by being both effective and trusted.

Use this checklist to build that trust, systematically and transparently.
