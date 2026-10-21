# Data Governance

**Document Purpose:** Comprehensive data handling, retention, deletion, and security policies for Tizzy.

**Status:** Operational Framework - Required for Launch
**Owner:** Engineering + Legal + Security + Product
**Last Updated:** 2026-02-13

---

## Overview

Data governance is not a compliance afterthought. It is a product design principle.

Tizzy handles extraordinarily sensitive data:
- Voice recordings of intimate, real-world conversations
- Autism status and disability information
- Children's data (if serving minors)
- Emotional patterns, stress indicators, social struggles
- Bystander voice (in some contexts)

**The Stakes:**
If we mishandle this data, we harm vulnerable people, violate trust, and face regulatory action.

**The Principle:**
Collect the minimum necessary. Store the minimum necessary. Delete proactively. Encrypt everything. Give users control.

This document defines how Tizzy collects, processes, stores, retains, shares, and deletes data.

---

## Data Governance Principles

### 1. Data Minimization

**Principle:** Collect only what is necessary for product functionality. Process and discard what is not needed for coaching.

**Implementation:**
- Capture raw audio on-device, extract features, discard raw audio by default
- Store embeddings and structured data, not full transcripts unless opt-in
- Minimize bystander data (focus on wearer's behavior)
- No collection of extraneous personal information (location history, contacts, etc. unless directly needed)

**Metrics:**
- Average data storage per user (target: minimize)
- % of users with raw audio stored (target: <20%)
- % of conversations with transcripts (target: opt-in minority)

---

### 2. Purpose Limitation

**Principle:** Use data only for stated purposes. Do not repurpose without consent.

**Stated Purposes:**
1. **Conversation Coaching:** Analyze wearer's conversational patterns and provide coaching
2. **Product Improvement:** Aggregate, anonymized analytics to improve models and features (opt-in)
3. **Research:** Contribute to autism/speech research (opt-in, de-identified)
4. **Therapeutic Collaboration:** Share insights with user's therapist (opt-in)
5. **Support:** Diagnose technical issues, respond to user inquiries

**Prohibited Purposes:**
- Advertising or marketing (third-party or Tizzy's own products)
- Sale to data brokers or third parties
- Profiling for non-coaching purposes (e.g., employment screening, insurance underwriting)
- Surveillance (by parents, schools, or others beyond agreed-upon therapeutic oversight)

**Enforcement:**
- Data use policies in contracts with all employees and vendors
- Technical controls (access restrictions, audit logging)
- Regular audits to ensure compliance

---

### 3. Storage Limitation (Retention Minimization)

**Principle:** Retain data only as long as necessary for its purpose. Delete proactively.

**Implementation:**
- Define retention periods for each data type
- Auto-delete data when retention period expires
- User can delete data anytime (override retention periods)
- No indefinite storage without explicit user opt-in

**Metrics:**
- Average age of stored data (should be recent, not years old)
- % of data auto-deleted on schedule (should be high)
- User-initiated deletion frequency (should be easy and common)

---

### 4. Security and Confidentiality

**Principle:** Protect data with strong security measures. Encrypt everything. Limit access.

**Implementation:**
- Encryption at rest (database, file storage, device storage)
- Encryption in transit (TLS 1.3+, end-to-end where feasible)
- Access controls (role-based, least privilege)
- Authentication (MFA for admin, strong passwords for users)
- Audit logging (all data access logged and monitored)

**Metrics:**
- % of data encrypted (target: 100%)
- Access violations (target: zero)
- Security incidents (target: zero)

---

### 5. User Control and Transparency

**Principle:** Users can see what data exists, how it's used, and can delete it anytime.

**Implementation:**
- Privacy dashboard (see all data, usage, sharing, retention)
- User rights portal (access, delete, correct, export)
- Clear privacy policy and in-app explanations
- No hidden data collection

**Metrics:**
- Privacy dashboard usage (% of users who access it)
- User satisfaction with transparency (survey)
- User rights request fulfillment time (target: <48 hours)

---

### 6. Accountability

**Principle:** Tizzy is accountable for data handling. Document everything. Audit regularly.

**Implementation:**
- Data inventory and data flow maps (updated regularly)
- Compliance audits (internal and third-party)
- Incident response and breach notification procedures
- Transparency reports (annual publication)

**Metrics:**
- Audit completion rate (target: 100% on schedule)
- Incidents resolved on time (target: 100%)
- Transparency report published (target: annually)

---

## Data Lifecycle

### Phase 1: Data Collection

**What Is Collected:**

**Primary Data (from user/device):**
1. **Voice Data:**
   - Raw audio (captured on-device in circular buffer)
   - Acoustic features (prosody, pace, intensity, pitch variance, pause timing)
   - Voice embeddings (compressed representations for tone/intent analysis)
   - Transcripts (opt-in feature)
   - Speaker diarization results (wearer vs other speakers)

2. **Conversation Metadata:**
   - Timestamp (start, end)
   - Duration
   - Environment tag (home, school, therapy, public, work)
   - Consent mode (muted, self-only, consented)
   - Consent method (if consented)
   - Bystander count estimate
   - Device state (battery, connectivity)

3. **Coaching Data:**
   - Flagged moments (good repair, missed cue, escalation, etc.)
   - Coaching insights generated (turn-taking patterns, prosody issues, topic management)
   - User's baseline over time (personalized norm)
   - User's goals (set by user or therapist)

4. **User Profile:**
   - Account information (name, email, date of birth, parent/guardian info if minor)
   - Autism diagnosis status (self-reported, optional)
   - Therapy/clinical information (if shared)
   - Device pairing information (device ID, firmware version)

5. **Usage Data:**
   - App interactions (which features used, frequency)
   - Device usage patterns (hours worn, mute frequency)
   - Error logs (for technical support)

**Bystander Data:**
- In self-only mode: Minimal (only conversational context cues, not stored)
- In consented mode: Voice may be stored if user opts to save conversation (with consent obtained)

**What Is NOT Collected:**
- Location history (GPS) unless user explicitly enables for environment tagging (opt-in)
- Contacts or address book
- Other apps' data
- Biometric data beyond voice (no face, fingerprint, etc. in V1)
- Health data beyond autism status (unless user shares in profile)

**Collection Methods:**
- Device microphone (always-on when not muted)
- User input (profile information, goals, environment tags)
- App usage telemetry (standard analytics, privacy-preserving)

**Consent for Collection:**
- User consents during account creation and device setup
- Specific consents for optional features (raw audio storage, transcripts, location, research participation)
- Parental consent if user is under 13 (COPPA compliance)

---

### Phase 2: Data Processing

**On-Device Processing:**
1. **Voice Activity Detection:** Identify when speech is happening
2. **Speaker Diarization:** Separate wearer from other speakers
3. **Feature Extraction:** Extract prosody, pacing, intensity, timing features
4. **Embedding Generation:** Create compressed voice embeddings for tone/intent
5. **Lightweight Coaching:** Real-time haptic feedback based on on-device model
6. **Encryption:** Encrypt data before sending to cloud

**Cloud Processing:**
1. **Conversation Analysis:**
   - Receive encrypted features, embeddings, metadata from device
   - Decrypt in secure processing environment
   - Run coaching models (Tizzy proprietary + Modulate ELM)
   - Generate coaching insights (turn-taking, prosody, topic management, repair opportunities)

2. **Personalization:**
   - Update user's baseline over time
   - Adjust coaching based on user's patterns and progress
   - Recommend micro-goals

3. **Trend Analysis:**
   - Aggregate user's conversations over time
   - Identify recurring patterns (highest-impact behaviors to coach)
   - Generate weekly/monthly progress reports

4. **Optional Processing (Opt-In):**
   - Transcript generation (speech-to-text)
   - Sentiment analysis (emotional tone tracking)
   - Advanced analytics (comparison to population norms, if user consents)

**Third-Party Processing (Modulate):**
- Send voice embeddings (not raw audio) to Modulate API for tone/intent inference
- Receive tone classifications (confused, escalating, empathetic, etc.)
- Data Processing Agreement: Modulate cannot retain or train on Tizzy user data

**Processing Controls:**
- All processing is logged (what data was processed, by which model, when)
- User can see processing history in privacy dashboard
- User can opt-out of cloud processing (device-only mode, limited coaching)

---

### Phase 3: Data Storage

**On-Device Storage:**

**Circular Buffer (Raw Audio):**
- Size: 5 minutes to 2 hours (user-configurable)
- Format: Encrypted audio files
- Behavior: Continuously overwritten unless user explicitly saves segment
- Use Case: "Instant replay" of recent conversation for user review
- Retention: Volatile (cleared on power cycle) or persistent (survives power cycle but still overwritten)
- Deletion: Auto-overwritten when buffer is full; user can manually clear anytime

**Device Metadata:**
- Device ID, firmware version, user account pairing
- Last sync timestamp
- Mute state (persists across power cycles)
- Retention: Until device is factory reset or unpaired

**Cloud Storage:**

**Primary Database (Structured Data):**
- User profiles, conversation metadata, consent logs, coaching insights
- Format: Encrypted database (AES-256)
- Access: Role-based, least privilege (engineers do not have direct access without audit trail)
- Backup: Encrypted backups, geographically distributed
- Retention: Per retention policy (see below)

**Object Storage (Audio, Transcripts if opted-in):**
- Saved conversation audio (if user explicitly saves)
- Transcripts (if user enables transcript feature)
- Format: Encrypted files (AES-256)
- Access: User only (via authenticated API), support (with user permission and audit log)
- Retention: Per retention policy (see below)

**Analytics Storage (Aggregate, De-Identified):**
- Aggregate statistics (population-level trends, model performance)
- De-identified: No direct user identifiers
- Retention: Longer than individual user data (for product improvement)

**Storage Locations:**
- Cloud provider: AWS, GCP, or Azure (to be determined)
- Data residency: U.S. only for V1 (to be determined for international expansion)
- Compliance: SOC 2, ISO 27001 certified data centers

**Storage Security:**
- Encryption at rest: AES-256
- Key management: Hardware Security Module (HSM) or cloud key management service
- Access logging: All access to storage logged and monitored
- Intrusion detection: Anomaly detection for unusual access patterns

---

### Phase 4: Data Retention

**Retention Principles:**
1. **Active Use Period:** Data is retained while actively useful for coaching
2. **Auto-Deletion:** Data is automatically deleted when no longer needed
3. **User Control:** User can delete data anytime, overriding retention periods
4. **Minimum Retention:** Some data must be retained temporarily for technical/legal reasons (e.g., backups, legal holds)

**Retention Periods by Data Type:**

**1. Raw Audio (in circular buffer):**
- Default retention: 5 minutes to 2 hours (user-configurable), then overwritten
- User-saved segments: 30 days default, then auto-deleted (user can adjust: 7 days, 30 days, 90 days, or "keep until I delete")
- Rationale: Minimize surveillance risk; user reviews recent conversations, not archives

**2. Conversation Metadata:**
- Default retention: 1 year
- Rationale: Allows long-term trend analysis and progress tracking
- User control: User can delete specific conversations or all metadata anytime
- After 1 year: Auto-deleted unless user opts to extend

**3. Coaching Insights (Patterns, Trends, Micro-Goals):**
- Default retention: 1 year
- Rationale: Coaching value persists over time (tracking progress across months)
- User control: User can delete anytime
- After 1 year: Auto-deleted unless user opts to extend

**4. Transcripts (if enabled):**
- Default retention: 30 days
- Rationale: Transcripts are more identifiable than features; minimize retention
- User control: User can delete specific transcripts anytime
- After 30 days: Auto-deleted unless user opts to extend (max 90 days)

**5. User Profile:**
- Retention: Duration of account
- Deletion: Deleted when user closes account (see account deletion below)

**6. Consent Logs:**
- Retention: 3 years (legal requirement for record-keeping)
- Rationale: Legal defense if consent is challenged
- Deletion: After 3 years, or when user closes account (whichever is longer for active disputes)

**7. Support Tickets and Communications:**
- Retention: 2 years
- Rationale: Customer support continuity, legal defense
- Deletion: After 2 years or when user closes account

**8. Audit Logs (Access, Processing):**
- Retention: 1 year
- Rationale: Security monitoring, incident investigation
- Deletion: After 1 year (rolling deletion)

**9. Aggregate, De-Identified Analytics:**
- Retention: Indefinite (used for product improvement, research)
- Rationale: De-identified data cannot be linked back to user
- User control: User can opt-out of analytics contribution prospectively (cannot delete past de-identified data)

**Retention Adjustments:**

**Legal Holds:**
- If data is subject to legal hold (litigation, regulatory investigation), retention periods are suspended
- Data is preserved until hold is lifted
- User is notified (if legally permissible)

**User-Requested Extensions:**
- User can choose to keep data longer than default (e.g., "keep this conversation forever")
- Maximum retention: 5 years (after which user must actively re-affirm to keep)
- Rationale: Prevent indefinite surveillance archives

**Early Deletion:**
- User can delete any data anytime (except data under legal hold)
- Deletion is hard delete (see Phase 5)

**Auto-Deletion Notifications:**
- User is notified 7 days before auto-deletion (e.g., "Your conversations from February 2025 will be deleted in 7 days. Want to keep any?")
- User can review and selectively save

---

### Phase 5: Data Deletion

**Deletion Principles:**
1. **Hard Delete:** Data is permanently removed, not just flagged as deleted
2. **Verification:** Deletion is confirmed to user
3. **Backup Purging:** Deleted data is purged from backups (may take 30-90 days)
4. **Third-Party Notification:** If data was shared with third parties, they are notified to delete (if technically feasible)

**User-Initiated Deletion:**

**Delete Specific Conversation:**
- User selects conversation in app, chooses "Delete"
- Confirmation prompt: "This will permanently delete all data from this conversation, including audio, transcripts, and insights. Are you sure?"
- User confirms
- System deletes: Audio, transcript, features, embeddings, coaching insights, metadata (except consent log entry for audit trail)
- Confirmation: "Conversation deleted. It will be removed from backups within 90 days."

**Delete All Data (Account Deletion):**
- User chooses "Close My Account" in settings
- Confirmation prompt: "This will permanently delete your account and all data. This cannot be undone. Are you sure?"
- User confirms (may require password re-entry or MFA)
- System deletes:
  - All voice data (audio, features, embeddings, transcripts)
  - All conversation metadata
  - All coaching insights and trends
  - User profile
  - App usage data
  - Device pairing (device is unpaired)
- Retained (for legal/technical reasons):
  - Consent logs (3 years)
  - Support tickets (2 years)
  - Audit logs (1 year)
  - De-identified analytics (indefinite)
- Confirmation: "Your account has been closed. Most data is deleted immediately. Some data (consent logs, support tickets) will be retained for up to 3 years for legal compliance."

**Bystander Deletion Request:**
- Bystander contacts user or Tizzy support
- User initiates deletion of relevant conversation (see above)
- Confirmation provided to bystander (via user or support)

**Auto-Deletion:**
- System runs daily job to identify data past retention period
- Data is flagged for deletion
- 7-day grace period (user is notified, can save if desired)
- After grace period, data is hard deleted
- User is notified: "X conversations from [date range] were auto-deleted per your retention settings."

**Backup Purging:**
- Deleted data is removed from primary database immediately
- Backups are overwritten on rolling basis (30-90 days)
- After backups are purged, deletion is complete
- User is informed of backup purge timeline upfront

**Third-Party Deletion:**
- If data was shared with therapist, parent, or research partner, Tizzy notifies them of deletion
- Therapist/parent is expected to delete their copy (contractual obligation)
- Research data: If de-identified, cannot be deleted (de-identification is irreversible)

**Technical Implementation:**
- Deletion is hard delete (database records removed, files deleted from object storage)
- Deletion is logged (audit trail: what was deleted, when, by whom)
- Deletion is verified (automated checks to ensure data is gone)

---

### Phase 6: Data Sharing

**Sharing Principles:**
1. **User Control:** All sharing requires explicit user opt-in
2. **Transparency:** User can see who has access to what
3. **Revocability:** User can revoke shared access anytime
4. **Purpose Limitation:** Shared data is used only for agreed-upon purpose
5. **Security:** Shared data is transmitted and stored securely

**Sharing Categories:**

**1. Therapist/Clinician Sharing:**

**What Can Be Shared:**
- Coaching insights summary (patterns, trends, micro-goals)
- Specific conversation clips (audio, transcript) if user opts in
- Progress reports (weekly, monthly)

**How It Works:**
- User enables "Therapist Access" in app
- User enters therapist's email
- Therapist receives invite link
- Therapist creates secure account (password + MFA)
- Therapist sees user's dashboard (read-only, scoped to what user permits)
- User can revoke access anytime

**Therapist Obligations:**
- Data Processing Agreement: Therapist agrees to confidentiality, no onward sharing, deletion on user request
- HIPAA (if applicable): If therapist is HIPAA-covered, therapist treats data as PHI
- Clinical ethics: Therapist uses data only for treatment

**Access Controls:**
- Therapist can view, not download (reduces data leakage)
- Therapist access is logged (user can see what therapist viewed and when)
- Therapist access expires after 90 days (user must re-authorize)

---

**2. Parent/Guardian Oversight (for minors):**

**What Can Be Shared:**
- Depends on user's age and autonomy settings:
  - **Under 13:** Parent has full access (COPPA requirement)
  - **13-17:** User can choose: Full access, insights only (no audio), or limited access
  - **18+:** Parent has no access unless user explicitly grants

**How It Works:**
- Parent creates guardian account during setup (if user is minor)
- Parent links to child's account
- Parent sees dashboard based on access level
- Teen users (13-17) can adjust parent's access level in settings
- Parent can request access expansion; user can approve or deny

**Parent Responsibilities:**
- Respect user's autonomy and privacy (especially teens)
- Use data to support user's growth, not surveil or punish
- Discuss Tizzy usage openly with user

**Access Controls:**
- Parent access is logged (user can see what parent viewed)
- Parent cannot delete user's data (user control)
- Parent access ends when user turns 18 (unless user extends)

---

**3. Research Participation (Opt-In):**

**What Can Be Shared:**
- De-identified conversation data (audio features, not raw audio)
- Aggregate patterns (autism-specific conversational markers)
- User demographics (age, autism diagnosis, but not name or identifiable info)

**How It Works:**
- User opts in to "Contribute to Research" in settings
- User consents to specific research purpose (e.g., "autism conversation patterns research")
- Data is de-identified (remove name, email, device ID, etc.)
- De-identified data is shared with research partners (universities, autism research orgs)
- User receives updates on research findings

**Research Partner Obligations:**
- IRB approval (Institutional Review Board for human subjects research)
- Data use agreement: Research purposes only, no re-identification attempts
- Publication: Findings can be published, but no individual user data

**User Rights:**
- User can opt out of research prospectively (future data not shared)
- User cannot delete past de-identified data (de-identification is irreversible)
- User can see which research projects their data contributed to

---

**4. Product Improvement (Aggregate Analytics):**

**What Is Shared:**
- Aggregate, anonymized usage statistics (e.g., "80% of users use self-only mode")
- Model performance metrics (coaching accuracy, user satisfaction)
- Error logs (for debugging)

**How It Works:**
- Tizzy uses aggregate data internally to improve product
- Data is anonymized (no individual user identifiable)
- Opt-out available: User can choose "Do not use my data for product improvement"

**Internal Use Only:**
- Not shared with third parties
- Used by Tizzy engineering and product teams
- Access is logged and restricted

---

**5. No Selling or Advertising:**

**Prohibited:**
- Tizzy will NEVER sell user data to advertisers, data brokers, or third parties
- Tizzy will NEVER use conversation data for behavioral advertising
- Tizzy will NEVER build user profiles for non-coaching purposes

**Commitment:**
- Public statement: "We do not sell your data. Ever."
- Terms of service: Explicit prohibition
- Technical controls: No integrations with ad networks or data brokers

---

### Phase 7: Data Breach Response

**Breach Definition:**
Unauthorized access to, disclosure of, or loss of user data.

**Breach Response Plan:**

**1. Detection (0-1 hour):**
- Intrusion detection system alerts security team
- Incident commander activated
- Initial assessment: What data, how many users, how did breach occur

**2. Containment (1-4 hours):**
- Isolate affected systems
- Stop ongoing breach
- Preserve evidence for forensic investigation

**3. Assessment (4-24 hours):**
- Forensic investigation: What data was accessed, by whom, for how long
- Determine breach scope: Number of users affected, types of data
- Determine breach cause: Vulnerability, human error, malicious attack
- Legal counsel engaged

**4. Notification (24-60 days):**
- **To Affected Users:**
  - Notify within 60 days of discovery (FTC Health Breach Notification Rule)
  - Email, in-app notification, letter (depending on severity)
  - Explain: What data was breached, when, how, what we're doing, what user should do
  - Offer: Free credit monitoring, account security assistance

- **To FTC:**
  - If 500+ users affected: Notify FTC via website within 60 days

- **To Media:**
  - If 500+ users in same state/jurisdiction: Notify prominent media outlets within 60 days

- **To State Attorneys General:**
  - Some state breach notification laws require AG notification

**5. Remediation (1-4 weeks):**
- Fix vulnerability
- Implement additional security measures
- Third-party security audit
- Publish post-mortem (transparency)

**6. Follow-Up (1-6 months):**
- Monitor for secondary impacts
- User support (dedicated hotline for breach-related questions)
- Comprehensive security review
- Update incident response plan based on lessons learned

**Legal Compliance:**
- FTC Health Breach Notification Rule (if applicable)
- State breach notification laws (varies by state)
- COPPA (if children affected, notify parents)

**User Support:**
- Dedicated breach support team
- FAQ on breach (transparent, honest)
- Regular updates on remediation progress

---

## Data Security Measures

### Encryption

**Encryption at Rest:**
- **Cloud Database:** AES-256 encryption
- **Object Storage (audio, transcripts):** AES-256 encryption
- **Device Storage (circular buffer):** AES-128 or AES-256 (depending on device capability)
- **Backups:** Encrypted with same standard as primary data

**Encryption in Transit:**
- **Device to Cloud:** TLS 1.3 (minimum TLS 1.2)
- **API Communications:** HTTPS with certificate pinning (prevent man-in-the-middle attacks)
- **End-to-End Encryption (E2EE):** Consider for highly sensitive data (e.g., raw audio if uploaded to cloud)

**Key Management:**
- **Cloud Provider Key Management Service (KMS):** AWS KMS, GCP KMS, or Azure Key Vault
- **Hardware Security Module (HSM):** For highest security tier (future enhancement)
- **Key Rotation:** Annually or on security incident
- **Key Access:** Strictly controlled, logged, audited

---

### Access Controls

**Role-Based Access Control (RBAC):**
- **User:** Can access own data only
- **Support:** Can access user data with user permission and audit log
- **Engineer:** Can access de-identified or aggregate data; individual user data only for debugging with approval and audit log
- **Admin:** Can manage system, not access user data directly without audit trail
- **Security:** Can access logs, audit trails, not user content without incident investigation

**Least Privilege:**
- Users have only the permissions they need
- Engineers do not have standing access to production user data
- Access requests are logged and require justification

**Authentication:**
- **User Login:** Password (strong password policy) + optional MFA
- **Admin/Internal Access:** MFA required (TOTP, hardware token, or biometric)
- **API Authentication:** OAuth 2.0, JWT tokens, API keys with rotation

**Session Management:**
- **Session Timeout:** 30 minutes inactivity (configurable)
- **Re-Authentication:** Required for sensitive actions (delete account, change password, share data)

---

### Audit Logging

**What Is Logged:**
- **User Actions:** Login, logout, data access, data deletion, sharing, settings changes
- **System Actions:** Data processing, auto-deletion, backup creation
- **Admin Actions:** Access to production systems, configuration changes, security events
- **API Calls:** All API requests and responses (user ID, endpoint, timestamp, result)

**Log Retention:**
- 1 year (security monitoring, incident investigation)
- After 1 year: Archived or deleted

**Log Monitoring:**
- Real-time alerts for suspicious activity (unusual data access, brute force attempts, privilege escalation)
- Weekly review by security team
- Quarterly audit by compliance team

**Log Security:**
- Logs are encrypted
- Logs are tamper-evident (append-only, cryptographic signatures)
- Log access is restricted (security team only)

---

### Network Security

**Firewalls:**
- Restrict inbound traffic to only necessary services
- Outbound traffic monitoring (detect data exfiltration attempts)

**Intrusion Detection/Prevention System (IDS/IPS):**
- Monitor network traffic for malicious patterns
- Block or alert on suspicious activity

**DDoS Protection:**
- Cloud provider DDoS mitigation (AWS Shield, GCP DDoS protection, etc.)

**Vulnerability Scanning:**
- Weekly automated scans of cloud infrastructure
- Quarterly penetration testing by third party

---

### Application Security

**Secure Coding Practices:**
- Input validation (prevent injection attacks)
- Output encoding (prevent XSS)
- Parameterized queries (prevent SQL injection)
- Secure error handling (don't leak sensitive info in error messages)

**Code Reviews:**
- All code reviewed by at least one other engineer
- Security-focused review for high-risk changes

**Dependency Management:**
- Regular updates of third-party libraries
- Vulnerability scanning of dependencies (Snyk, Dependabot, etc.)
- Avoid unmaintained or insecure libraries

**Security Testing:**
- Static Application Security Testing (SAST) in CI/CD pipeline
- Dynamic Application Security Testing (DAST) before releases
- Penetration testing (third-party) before launch and annually

---

### Physical Security (Device)

**Device Storage Encryption:**
- Circular buffer is encrypted on device
- Encryption key is generated on device, not extractable

**Device Lock:**
- Device can be remotely locked if lost/stolen (via app)
- Locked device cannot be accessed without unlock code

**Device Wipe:**
- User can remotely wipe device data (via app)
- Useful if device is lost or stolen

**Tamper Resistance:**
- Device firmware is signed (prevent unauthorized firmware)
- Physical tamper detection (if feasible in hardware design)

---

## Data Governance Roles and Responsibilities

### Legal Counsel

**Responsibilities:**
- Draft and review privacy policy, terms of service, consent mechanisms
- Monitor legal landscape (new laws, regulations, case law)
- Provide guidance on data handling and user rights
- Manage legal holds and regulatory inquiries
- Oversee breach notification and compliance

**Frequency:**
- Ongoing retainer or fractional general counsel
- Weekly check-ins during pre-launch
- Monthly check-ins post-launch

---

### Privacy/Compliance Officer

**Responsibilities:**
- Oversee compliance with COPPA, CCPA, FERPA, recording laws, FTC rules
- Manage user rights requests (access, delete, correct)
- Maintain data inventory and data flow maps
- Conduct internal compliance audits
- Coordinate third-party audits
- Report to leadership on compliance status

**Frequency:**
- Full-time role or part-time depending on scale
- Weekly compliance reviews
- Monthly reporting to leadership

---

### Security Officer/Team

**Responsibilities:**
- Design and implement security architecture
- Monitor security logs and respond to incidents
- Conduct vulnerability assessments
- Manage third-party security audits
- Train staff on security best practices
- Maintain incident response plan

**Frequency:**
- Full-time role post-launch
- 24/7 on-call for security incidents

---

### Engineering Team

**Responsibilities:**
- Implement privacy and security features (encryption, access controls, deletion)
- Build privacy dashboard and user rights portal
- Maintain data minimization (process and discard what's not needed)
- Participate in security reviews and code audits
- Respond to security vulnerabilities (patching, fixes)

**Frequency:**
- Ongoing as part of product development

---

### Product Team

**Responsibilities:**
- Design user-facing privacy controls
- Ensure privacy by design (minimize collection, maximize user control)
- User education (onboarding, help docs)
- Balance coaching value with privacy protection
- User testing of privacy features

**Frequency:**
- Ongoing as part of product development

---

### Support Team

**Responsibilities:**
- Respond to user privacy questions
- Fulfill user rights requests (access, delete, correct)
- Handle bystander deletion requests
- Escalate privacy/security concerns to compliance and legal
- Track privacy-related tickets (identify patterns, improve product)

**Frequency:**
- Daily (customer support operations)

---

### Leadership (CEO, COO, CTO)

**Responsibilities:**
- Set privacy-first culture and tone from top
- Allocate budget for privacy and security (not just compliance minimum)
- Review compliance reports and security incidents
- Make strategic decisions (age threshold, data retention, sharing policies)
- Public accountability (transparency reports, breach communication)

**Frequency:**
- Monthly compliance/security briefings
- Immediate notification of incidents

---

## Data Inventory and Mapping

### Data Inventory

**Purpose:** Comprehensive list of all data types collected, processed, and stored.

**Format:** Spreadsheet or database with the following fields:

| Data Element | Data Type | Source | Purpose | Retention Period | Storage Location | Encryption | Access Control | CCPA Category |
|--------------|-----------|--------|---------|------------------|------------------|------------|----------------|---------------|
| Raw audio | Audio file | Device mic | Coaching analysis | Circular buffer (5min-2hr), user-saved (30 days) | On-device, optionally cloud | AES-256 | User only | Audio |
| Voice embeddings | Vector | Device processing | Tone/intent inference | 1 year | Cloud database | AES-256 | Tizzy backend, Modulate API | Biometric |
| Transcripts | Text | Speech-to-text (opt-in) | Review, sharing | 30 days | Cloud storage | AES-256 | User, therapist (opt-in) | Audio (derived) |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

**Update Frequency:** Quarterly or when new data type is added

**Owner:** Privacy Officer + Engineering

---

### Data Flow Mapping

**Purpose:** Visualize how data moves through Tizzy's systems.

**Components:**
1. **Data Sources:** Device, user input, third-party APIs
2. **Processing Nodes:** On-device, cloud backend, third-party services (Modulate)
3. **Storage Nodes:** Device storage, cloud database, cloud object storage
4. **Data Sharing:** Therapist portal, parent dashboard, research partners
5. **Data Deletion:** User-initiated, auto-deletion, backup purging

**Format:** Diagram (Lucidchart, draw.io, or similar) with annotations

**Update Frequency:** When architecture changes

**Owner:** Engineering + Privacy Officer

---

## Vendor Management

### Vendor Vetting

**Before Engaging Vendor:**
- [ ] Security questionnaire (assess vendor's security practices)
- [ ] Certifications required: SOC 2 Type II, ISO 27001, or equivalent
- [ ] Privacy policy review (does vendor have strong privacy commitments?)
- [ ] Data residency (where is data stored? U.S. required for V1)
- [ ] Subprocessors (does vendor use subprocessors? who are they?)

**Evidence Required:**
- SOC 2 report
- ISO 27001 certificate
- Privacy policy
- Data Processing Agreement (DPA)

---

### Data Processing Agreements (DPAs)

**Required for All Vendors That Process User Data:**

**Key Terms:**
1. **Data Use Restrictions:**
   - Vendor processes data only for agreed-upon purpose
   - No onward sharing without Tizzy's consent
   - No training on user data without explicit opt-in

2. **Security Requirements:**
   - Encryption, access controls, audit logging (at least as strong as Tizzy's)
   - Incident notification (vendor must notify Tizzy of breaches within 24 hours)

3. **Data Retention and Deletion:**
   - Vendor deletes data when no longer needed or on Tizzy's request
   - Vendor provides deletion confirmation

4. **Audit Rights:**
   - Tizzy can audit vendor's data handling practices
   - Annual audits or on-demand if incident occurs

5. **Liability:**
   - Vendor is liable for breaches caused by vendor's negligence
   - Insurance requirements (cyber liability insurance)

6. **Subprocessors:**
   - Vendor must disclose all subprocessors
   - Vendor must ensure subprocessors comply with same DPA terms

**Template:**
- Legal counsel drafts DPA template
- Negotiated with each vendor
- Executed before vendor integration goes live

---

### Modulate Relationship (Special Focus)

**Given Modulate's Central Role in Coaching:**

**Non-Negotiables:**
- [ ] **Inference-Only License:** Tizzy pays for model usage; Modulate does not get training rights to Tizzy user data
- [ ] **Data Minimization:** Send only embeddings/features, not raw audio
- [ ] **No Retention:** Modulate deletes data immediately after inference (no storage)
- [ ] **No Onward Sharing:** Modulate cannot share Tizzy data with third parties
- [ ] **Auditability:** Tizzy can audit Modulate's data handling
- [ ] **Exit Plan:** Tizzy can swap to alternative tone engine if needed (no vendor lock-in)

**Contract Terms:**
- Data Processing Agreement with above terms
- SLA (Service Level Agreement) for API availability and performance
- Change control (Modulate must notify Tizzy of model updates; Tizzy can test and approve)

**Ongoing Monitoring:**
- Annual audit of Modulate's compliance
- Review API usage logs (ensure no unexpected data transmission)

---

## User Rights and Requests

### Right to Know (Access)

**User Request:** "What data do you have about me?"

**Response Process:**
1. User submits request via privacy dashboard or support
2. Verify user identity (login, password, or security questions)
3. Generate data export:
   - User profile (JSON)
   - Conversation metadata (CSV)
   - Coaching insights (PDF or JSON)
   - Consent logs (CSV)
   - Optional: Audio files (if user has saved conversations)
4. Provide download link (secure, time-limited, encrypted)
5. Log request and fulfillment

**SLA:** 45 days (CCPA requirement), target: 7 days

**Format:** Machine-readable (JSON, CSV) and human-readable (PDF summary)

---

### Right to Delete

**User Request:** "Delete my data."

**Response Process:**
1. User submits request via privacy dashboard or support
2. Verify user identity
3. Confirm intent (deletion is permanent)
4. Execute deletion (see Phase 5: Data Deletion above)
5. Notify user of completion and backup purge timeline
6. Log request and fulfillment

**SLA:** 45 days (CCPA requirement), target: 24-48 hours for primary deletion (backups may take 30-90 days)

**Exceptions:**
- Data under legal hold (notify user)
- De-identified data (cannot be deleted as it's irreversibly anonymized)

---

### Right to Correct

**User Request:** "My profile information is incorrect."

**Response Process:**
1. User submits request via privacy dashboard or support
2. Verify user identity
3. Identify inaccurate data
4. Correct or allow user to correct in app
5. Notify user of correction
6. Log request and fulfillment

**SLA:** 45 days (CCPA requirement), target: 7 days

**Scope:**
- User profile information (name, email, date of birth, etc.)
- Cannot "correct" conversation data (it's historical record); user can delete if inaccurate

---

### Right to Opt-Out

**User Request:** "Stop selling my data" (even though Tizzy doesn't sell)

**Response Process:**
1. User submits request via privacy dashboard or support
2. Confirm opt-out (immediate)
3. Tizzy does not sell data, so opt-out is symbolic, but we honor it
4. Log request

**SLA:** Immediate

---

### Right to Limit Use of Sensitive Data

**User Request:** "Limit use of my sensitive data to necessary purposes only."

**Response Process:**
1. User submits request via privacy dashboard or support
2. Limit data use:
   - No product improvement analytics
   - No research participation (unless already opted in and separate consent)
   - Coaching only
3. Notify user of changes
4. Log request

**SLA:** 45 days (CCPA requirement), target: 7 days

---

### User Rights Request Tracking

**System:**
- Support ticketing system or dedicated user rights portal
- Track: Request date, type, user, status, resolution date
- Generate reports: Volume by type, fulfillment times, trends

**Metrics:**
- Total requests per month
- Fulfillment time (target: 90% within 7 days)
- User satisfaction with response (survey after fulfillment)

---

## Transparency and Reporting

### Privacy Dashboard (User-Facing)

**Contents:**
- Data collection summary (what's collected, when, how much)
- Data usage summary (what models accessed data, what insights generated)
- Data sharing summary (who has access, what they viewed)
- Data retention timeline (what will be auto-deleted when)
- Consent audit trail (consent logs)
- User rights actions (access, delete, correct, opt-out)

**Design:**
- Clear, visual, accessible
- Mobile-first (app is primary interface)
- Export functionality (PDF or CSV)

**Update Frequency:**
- Real-time (user sees current state)

---

### Transparency Report (Public-Facing)

**Published Annually:**

**Contents:**
1. **User Base:**
   - Total users
   - Breakdown by age group (respecting privacy: aggregate only)
   - Breakdown by geography (U.S. states or regions)

2. **Data Handling:**
   - Total conversations processed
   - Average data storage per user
   - Auto-deletion effectiveness (% of data deleted on schedule)

3. **User Rights Requests:**
   - Total requests by type (access, delete, correct, opt-out)
   - Fulfillment times (average, median, 90th percentile)
   - Fulfillment rate (% fulfilled vs denied with reason)

4. **Security:**
   - Security incidents (if any): Number, type, impact, resolution
   - Breaches (if any): Full disclosure
   - Security audits conducted: Dates, types, high-level findings

5. **Law Enforcement Requests:**
   - Number of requests (if any)
   - What was requested (aggregate: user data, metadata, etc.)
   - How Tizzy responded (provided data, challenged request, notified user)
   - Legal basis (warrant, subpoena, etc.)

6. **Compliance:**
   - Certifications obtained (SOC 2, ISO 27001, etc.)
   - Compliance audits conducted
   - Policy updates (changes to privacy policy, terms of service)

**Format:**
- Blog post + PDF
- Plain language, honest, no marketing spin

**Goal:**
- Build trust through radical transparency
- Industry-leading transparency (set standard for assistive tech)

---

## Continuous Improvement

### Feedback Loops

**User Feedback:**
- In-app surveys: "How do you feel about Tizzy's privacy controls?"
- Support ticket analysis: Track privacy-related questions and complaints
- Privacy dashboard usage analytics: What features are used, what's confusing?

**Bystander Feedback (Beta):**
- Survey bystanders: "Did you feel informed? Comfortable?"
- Bystander complaints: Track and analyze

**Partner Feedback:**
- Therapists, schools, clinics: "Does Tizzy meet your privacy standards?"

**Regulatory Feedback:**
- Monitor FTC guidance, new laws, enforcement actions
- Adjust policies and practices proactively

---

### Iteration Plan

**Quarterly Reviews:**
- Review data governance policies
- Review user rights request volume and fulfillment
- Review security incidents and near-misses
- Identify areas for improvement

**Annual Overhaul:**
- Comprehensive review of all policies
- Legal counsel review (ensure continued compliance)
- Third-party privacy audit
- Update transparency report
- Public commitment: "Here's what we improved this year"

---

## Conclusion

Data governance is not a static document. It is a living, evolving commitment to protecting user privacy, respecting autonomy, and building trust.

This framework provides:
- **Clear data lifecycle:** Collection, processing, storage, retention, sharing, deletion
- **Strong security measures:** Encryption, access controls, audit logging, breach response
- **User control:** Privacy dashboard, user rights portal, transparent policies
- **Accountability:** Roles, responsibilities, audits, transparency reporting
- **Continuous improvement:** Feedback loops, iteration, proactive compliance

**The Tizzy Commitment:**
We collect the minimum necessary. We store the minimum necessary. We delete proactively. We encrypt everything. We give users control. We are transparently accountable.

If we honor this commitment, Tizzy becomes not just an effective conversation coach, but a trusted partner in users' growth.

Implement this framework rigorously. Measure compliance. Report transparently. Iterate based on feedback.

**Trust is earned through consistent, boring excellence in data governance.**
