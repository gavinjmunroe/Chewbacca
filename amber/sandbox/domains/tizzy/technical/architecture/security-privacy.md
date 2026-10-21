# Security and Privacy: Technical Implementation

**Document Version:** 1.0
**Last Updated:** February 13, 2026
**Audience:** Security team, compliance officers, engineering leads

---

## Executive Summary

Tizzy is an always-listening wearable device that captures conversations—a product category with inherent privacy and security risks. The market has already seen trust failures (Friend pendant's "wearing a wire" perception, Humane AI Pin's opacity). Tizzy's survival depends on architecting privacy and security as **core features**, not afterthoughts.

This document specifies the technical security and privacy measures for V1, covering threat modeling, encryption, access controls, consent mechanisms, bystander protection, compliance frameworks, and incident response.

---

## Guiding Principles

### 1. Privacy by Design
- Minimize data collection: capture only what's necessary for coaching
- Local processing default: raw audio processed on-device; only features transmitted
- User control as feature: every data flow is auditable and configurable

### 2. Security by Default
- Encryption everywhere: data at rest and in transit
- Zero-trust architecture: verify every access, assume breach
- Least privilege: components have minimal necessary permissions

### 3. Transparency and Auditability
- Immutable audit logs: every data access logged
- User-facing audit log: "who accessed my data and when"
- Explainable decisions: coaching actions traceable to specific data

### 4. Consent-Forward, Not Surveillance
- Explicit consent for every use case (coaching, therapist sharing, research)
- Bystander protection: indicator when recording others
- Easy revocation: user can withdraw consent anytime

---

## Threat Model

### Assets to Protect (Ranked by Criticality)

1. **User Conversations (Audio and Features)**
   - Most sensitive: captures private, intimate moments
   - Exposure risk: identity theft, blackmail, social harm

2. **Bystander Voices**
   - Sensitive: non-consenting individuals' voices
   - Legal risk: recording law violations, civil liability

3. **User Identity and Metadata**
   - Sensitive: diagnosis (autism), therapy status, location/environment logs
   - Exposure risk: discrimination, stigma, insurance implications

4. **Model Outputs (Coaching Insights)**
   - Moderately sensitive: inferred behavioral patterns
   - Exposure risk: misuse for profiling, unauthorized access by third parties

5. **System Infrastructure**
   - Critical for availability: API, database, device firmware
   - Exposure risk: service disruption, data breach, ransomware

### Threat Actors

| Actor | Motivation | Capabilities | Likelihood |
|-------|------------|--------------|------------|
| **Curious Bystander** | Wonder what device does | Physical proximity | High |
| **Malicious Individual** | Steal user's private conversations | Physical device access, basic tech skills | Medium |
| **Abusive Partner/Parent** | Surveillance of user | Physical access, may know PIN | Medium |
| **Cybercriminal** | Ransom, data sale | Network attacks, social engineering | Medium |
| **Nation-State Actor** | Espionage, bulk surveillance | Advanced persistent threat (APT) | Low (V1) |
| **Tizzy Insider** | Curiosity, data theft, sabotage | Admin access, codebase knowledge | Low (mitigated by controls) |
| **Law Enforcement** | Legal request for data | Subpoena, warrant | Medium |
| **Competitor** | Steal autism dataset, IP | APT, insider recruitment | Low-Medium |

### Threat Scenarios (Prioritized)

#### High Priority

**T1: Unauthorized Access to User Audio/Features**
- **Attack Vector:** Stolen device, compromised cloud account, insider access
- **Impact:** Privacy violation, blackmail risk, user trust destroyed
- **Mitigations:** Device encryption, cloud access controls, MFA, audit logging

**T2: Bystander Voice Recorded Without Consent**
- **Attack Vector:** User wears device in all-party consent state; bystander unaware
- **Impact:** Legal liability, civil lawsuit, regulatory penalty
- **Mitigations:** Visible indicator LED, consent mode enforcement, user education

**T3: Cloud Data Breach**
- **Attack Vector:** SQL injection, API vulnerability, stolen credentials
- **Impact:** Mass exposure of user conversations, regulatory penalties (COPPA, FTC)
- **Mitigations:** Encryption at rest, input validation, rate limiting, WAF, penetration testing

**T4: Device Theft Leading to Audio Exposure**
- **Attack Vector:** Device lost or stolen; attacker extracts flash storage
- **Impact:** Exposure of one user's recent conversations
- **Mitigations:** Device encryption with user PIN, remote wipe, short audio retention

**T5: Man-in-the-Middle (MITM) Attack on BLE or API**
- **Attack Vector:** Attacker intercepts BLE pairing or API traffic
- **Impact:** Exposure of features, session metadata, coaching insights
- **Mitigations:** BLE encrypted pairing, API TLS 1.3 with certificate pinning

#### Medium Priority

**T6: Malicious App Impersonation**
- **Attack Vector:** Fake Tizzy app in app store; user installs and connects device
- **Impact:** Device data exfiltrated to attacker
- **Mitigations:** BLE device whitelist (only pairs with signed Tizzy app), app store verification

**T7: Therapist Account Compromise**
- **Attack Vector:** Stolen therapist credentials; attacker views client data
- **Impact:** Exposure of multiple users' data
- **Mitigations:** MFA for therapist accounts, access logging, time-limited tokens

**T8: Insider Threat (Tizzy Employee)**
- **Attack Vector:** Employee abuses admin access to view user data
- **Impact:** Privacy violation, trust erosion, potential blackmail
- **Mitigations:** Least privilege access, MFA, audit logging, background checks, legal agreements

**T9: Supply Chain Attack (Firmware Tampering)**
- **Attack Vector:** Compromised firmware build or OTA update
- **Impact:** Backdoor in devices, mass surveillance capability
- **Mitigations:** Secure boot, signed firmware, code signing, build pipeline security

#### Lower Priority (V2+)

**T10: Side-Channel Attacks (Acoustic Emanations, Power Analysis)**
- **Attack Vector:** Advanced attacker extracts encryption keys from device via side channels
- **Impact:** Device encryption broken
- **Mitigations:** Hardware security module (HSM), shielding (future hardware hardening)

**T11: Model Inversion Attacks**
- **Attack Vector:** Attacker queries ML models to infer training data
- **Impact:** Reconstruction of user conversations from model outputs
- **Mitigations:** Differential privacy (V2), model output obfuscation

---

## Security Architecture

### Defense in Depth Layers

```
┌──────────────────────────────────────────────────────────┐
│  Layer 7: Governance & Compliance                        │
│  • Policies, training, audits, incident response         │
└──────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│  Layer 6: Monitoring & Detection                         │
│  • Audit logging, anomaly detection, alerts              │
└──────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│  Layer 5: Application Security                           │
│  • Input validation, rate limiting, CSRF protection      │
└──────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│  Layer 4: Authentication & Authorization                 │
│  • MFA, RBAC, JWT tokens, OAuth                          │
└──────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│  Layer 3: Network Security                               │
│  • TLS 1.3, VPN, WAF, DDoS protection                    │
└──────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│  Layer 2: Data Protection                                │
│  • Encryption at rest, encryption in transit, backups    │
└──────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│  Layer 1: Physical & Device Security                     │
│  • Secure boot, encrypted storage, tamper detection      │
└──────────────────────────────────────────────────────────┘
```

---

## Layer 1: Device Security

### 1.1 Secure Boot

**Purpose:** Prevent unauthorized firmware from running on device

**Implementation:**
- **Boot ROM:** Immutable first-stage bootloader in hardware (e.g., ARM TrustZone)
- **Signed Firmware:** All firmware images signed with Tizzy private key
- **Verification Chain:**
  ```
  Boot ROM (hardware-verified)
    ↓ verifies signature
  Bootloader (Tizzy-signed)
    ↓ verifies signature
  Application Firmware (Tizzy-signed)
    ↓ runs
  ```
- **Rollback Protection:** Version monotonic counter prevents downgrade to vulnerable firmware

**Tooling:**
- Code signing: OpenSSL or HSM-based signing
- Key management: Private key stored in hardware security module (HSM), never on developer machines

### 1.2 Encrypted Storage

**Purpose:** Protect data if device physically compromised

**Implementation:**
- **Algorithm:** AES-256-GCM (authenticated encryption)
- **Key Derivation:**
  ```
  User PIN (4-6 digits)
    ↓ PBKDF2 (100,000 iterations)
  Intermediate Key
    ↓ XOR with Device Hardware ID (unique per device)
  Encryption Key (256-bit)
  ```
- **Key Storage:** Derived key stored in secure enclave (ARM TrustZone TEE or equivalent)
- **Brute-Force Protection:** After 10 failed PIN attempts, device wipes encryption key (data unrecoverable)

**Encrypted Assets:**
- Audio circular buffer (if persisted beyond RAM)
- Feature data awaiting sync
- User settings and preferences
- Device pairing keys

**Unencrypted Assets:**
- Firmware (signed but not encrypted; verification is priority)
- Device logs (limited to non-sensitive operational data)

### 1.3 Physical Tamper Detection

**V1 (Basic):**
- Tamper-evident seal on device casing (user can visually inspect)
- No external debug ports (JTAG disabled in production firmware)

**V2+ (Advanced):**
- Tamper-responsive memory: if casing opened, encryption key zeroed
- Hardware security module (HSM) chip (e.g., ATECC608A) for key storage

### 1.4 Remote Wipe

**Purpose:** User can erase data if device lost or stolen

**Implementation:**
- **Trigger:** User initiates via mobile app: "Device Lost"
- **Mechanism:**
  - App sends authenticated command to cloud backend
  - Backend enqueues wipe command for device
  - Next time device syncs (or via push notification if connected), it receives wipe command
  - Device verifies command signature, then:
    1. Wipes encryption key from secure enclave
    2. Overwrites flash storage with random data (3 passes)
    3. Factory resets device
- **Offline Device:** Wipe command pending; executes when device next connects

**User Flow:**
```
User: "I lost my device"
  ↓
App: "Are you sure? This will delete all data."
  ↓
User: "Yes, wipe it"
  ↓
Cloud: Enqueue wipe command, notify user "Wipe pending"
  ↓
Device connects → Wipe executed
  ↓
User: "Wipe complete" notification
```

---

## Layer 2: Data Protection

### 2.1 Encryption at Rest

**Device (covered in Layer 1):**
- Flash storage: AES-256-GCM

**Mobile App:**
- Local database (SQLite): encrypted with SQLCipher (AES-256)
- Encryption key: stored in iOS Keychain (Secure Enclave) or Android Keystore (TEE)

**Cloud (Backend):**
- **Database (PostgreSQL, TimescaleDB):**
  - Transparent Data Encryption (TDE): AWS RDS encryption or GCP Cloud SQL encryption
  - Encryption key: AWS KMS or GCP Cloud KMS (hardware security module-backed)
- **Blob Storage (S3/GCS):**
  - Server-side encryption (SSE-KMS)
  - Audio snippets: additionally encrypted with user-specific key before upload (double encryption)
- **Backups:**
  - Encrypted with separate backup key (key rotation every 90 days)

### 2.2 Encryption in Transit

**BLE (Device ↔ App):**
- Pairing: Numeric comparison or passkey entry (secure pairing)
- Link encryption: AES-128-CCM (Bluetooth 5.0 LE Secure Connections)
- Certificate pinning equivalent: Device whitelists app's public key during first pairing

**HTTPS (App ↔ Backend):**
- **Protocol:** TLS 1.3 (deprecate TLS 1.2 in 6 months)
- **Certificate Pinning:** Mobile app pins Tizzy backend certificate (prevents MITM with rogue CA)
- **Cipher Suites:** Only AEAD ciphers (AES-GCM, ChaCha20-Poly1305)
- **HSTS:** Strict-Transport-Security header enforced

**API (Backend ↔ External Services, e.g., Modulate):**
- TLS 1.3, mutual TLS (mTLS) where supported
- API keys rotated every 90 days

### 2.3 Key Management

**Key Hierarchy:**
```
Root Key (HSM-protected, offline master key)
  ↓ derives
Environment Keys (Dev, Staging, Production) [AWS KMS / GCP KMS]
  ↓ derives
Service Keys (Database, Blob Storage, API) [Rotated every 90 days]
  ↓ derives
Data Encryption Keys (Per-user keys for blob storage) [Rotated on user request]
```

**Key Rotation Policy:**
- Service keys: every 90 days (automated)
- User keys: on user request or annually (automated)
- Root key: every 2 years (manual, requires security team quorum)

**Key Escrow:**
- **No key escrow for user device encryption:** If user loses device + forgets PIN, data unrecoverable (user-controlled privacy)
- **Cloud keys escrowed in KMS:** Allows Tizzy to decrypt cloud data for legal compliance (with audit trail)

### 2.4 Data Minimization and Retention

**Device:**
- Raw audio: circular buffer, overwritten every 30-120 minutes (default: no retention)
- Features: retained until synced, then deleted

**App:**
- Cached features: 30 days, then purged
- Coaching insights: 90 days, then purged (unless user pins)

**Cloud:**
- Full-resolution features: 90 days
- Aggregated summaries: 1 year
- Audio snippets (if retained): 7 days default, user can extend to 30 days max
- Audit logs: 7 years (compliance requirement)

**Automated Deletion:**
- Cron job runs daily, deletes expired data
- User-initiated deletion: immediate (within 1 hour)

---

## Layer 3: Network Security

### 3.1 API Gateway Security

**Framework:** Kong, AWS API Gateway, or Cloudflare Workers

**Security Controls:**

**Rate Limiting:**
- Per user: 100 requests/minute (prevent abuse)
- Per IP: 1,000 requests/minute (prevent DDoS)
- Per therapist: 500 requests/minute (higher limit for dashboards)

**Request Validation:**
- JSON Schema validation (reject malformed requests)
- Input sanitization (prevent injection attacks)
- Maximum request size: 10 MB (prevent memory exhaustion)

**WAF (Web Application Firewall):**
- OWASP Top 10 protection (SQL injection, XSS, etc.)
- Bot detection and blocking (Cloudflare, AWS WAF)
- Geo-blocking: Block requests from high-risk countries (configurable)

**DDoS Protection:**
- Cloudflare DDoS protection (Layer 3/4 and Layer 7)
- Auto-scaling backend (absorb legitimate traffic spikes)

### 3.2 VPN and Internal Network Security

**Production Environment:**
- No direct SSH access to servers; access via bastion host (jump box)
- Bastion host: MFA required, IP whitelist (office + approved VPN)
- Database: not publicly accessible; only reachable from backend services

**Network Segmentation:**
```
Internet
  ↓ (Firewall)
API Gateway (DMZ)
  ↓ (Firewall, only HTTPS allowed)
Backend Services (Private Subnet)
  ↓ (Firewall, only backend IPs allowed)
Database (Private Subnet, isolated)
```

### 3.3 Secure API Design

**Authentication:**
- JWT (JSON Web Tokens) with short expiration (1 hour)
- Refresh tokens: HTTP-only cookies, stored securely, 30-day expiration
- Token revocation: Logout triggers token blacklist (Redis cache)

**Authorization:**
- Role-Based Access Control (RBAC):
  - `USER`: Access own data only
  - `THERAPIST`: Access consented clients' data (read-only)
  - `ADMIN`: Limited operational access (no user data access without legal justification)
- Attribute-Based Access Control (ABAC) for therapist access:
  - Check: `user.therapist_access.therapist_id == requesting_therapist.id`
  - Check: `user.therapist_access.expires_at > now()`

**API Security Headers:**
```
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
```

---

## Layer 4: Authentication and Authorization

### 4.1 User Authentication

**Primary Method:** Email + Password

**Password Requirements:**
- Minimum 12 characters
- Must include: uppercase, lowercase, number, special character
- Hashing: Argon2id (winner of Password Hashing Competition)
- Salt: unique per user (cryptographically random, 32 bytes)

**Multi-Factor Authentication (MFA):**
- Optional for users (encouraged via app prompts)
- **Required** for therapists and admins
- Methods: TOTP (Google Authenticator, Authy), SMS (fallback)

**Social Login:**
- Google, Apple Sign-In (OAuth 2.0)
- Benefit: User doesn't manage yet another password
- Risk mitigation: Tizzy doesn't store password, relies on OAuth provider

### 4.2 Device Pairing Authentication

**First-Time Pairing:**
```
User opens app → Scans for Tizzy device (BLE advertisement)
  ↓
App displays pairing code (6-digit numeric)
  ↓
User verifies code matches device screen (or LED blink pattern if no screen)
  ↓
User confirms pairing in app
  ↓
BLE secure pairing completed (ECDH key exchange)
  ↓
Device and app store pairing keys (encrypted)
```

**Subsequent Connections:**
- App and device recognize each other via stored pairing keys
- No re-pairing required unless user explicitly "forgets device"

**Security:**
- Device can only pair with one app at a time
- If user pairs new phone, old phone's pairing invalidated (prevents ex-partner surveillance)

### 4.3 Therapist Access Control

**Access Grant Flow:**
```
User: "Share my data with Dr. Smith"
  ↓
App: "This will allow Dr. Smith to view your conversation insights. Continue?"
  ↓
User: "Yes" + re-authenticates (password or biometric)
  ↓
Backend: Create therapist_access record
  {
    user_id: user_123,
    therapist_id: therapist_xyz,
    access_level: "INSIGHTS_ONLY",  // or "INSIGHTS_AND_CLIPS"
    granted_at: "2026-02-13T10:00:00Z",
    expires_at: "2026-08-13T10:00:00Z"  // 6 months default
  }
  ↓
Audit log: Record consent action
```

**Access Revocation:**
```
User: "Revoke Dr. Smith's access"
  ↓
Backend: Delete therapist_access record (soft delete, retain in audit log)
  ↓
Audit log: Record revocation
  ↓
Notify therapist: "User has revoked your access to their data"
```

**Time-Limited Access:**
- Access expires after 6 months by default
- User receives reminder 2 weeks before expiration: "Renew Dr. Smith's access?"

---

## Layer 5: Application Security

### 5.1 Secure Development Lifecycle

**Code Review:**
- All code peer-reviewed before merge (GitHub PRs)
- Security-focused review for authentication, authorization, data access code

**Static Analysis:**
- SAST tools: SonarQube, Semgrep (detect vulnerabilities in code)
- Dependency scanning: Snyk, GitHub Dependabot (detect vulnerable libraries)

**Dynamic Analysis:**
- DAST tools: OWASP ZAP (test running application for vulnerabilities)
- Penetration testing: Annual third-party pentest (required for V1 launch)

**Secure Coding Standards:**
- OWASP Top 10 awareness training for all developers
- No secrets in code (use environment variables + secrets manager)
- Input validation on all user inputs (never trust user data)

### 5.2 Input Validation and Sanitization

**API Endpoints:**
- JSON Schema validation (reject malformed JSON)
- Whitelist allowed characters (e.g., user_id must be UUID format)
- Sanitize HTML inputs (prevent XSS if displaying user-generated content)

**SQL Injection Prevention:**
- Use parameterized queries (prepared statements) exclusively
- ORM frameworks (SQLAlchemy, Sequelize) configured to prevent injection

**Example (Node.js + Sequelize):**
```javascript
// GOOD: Parameterized query
const sessions = await Session.findAll({
  where: { user_id: req.user.id }  // req.user.id validated as UUID
});

// BAD: String concatenation (vulnerable to SQL injection)
const sessions = await db.query(`SELECT * FROM sessions WHERE user_id = '${req.user.id}'`);
```

### 5.3 CSRF Protection

**Mechanism:** Synchronizer Token Pattern

**Implementation:**
- Backend generates CSRF token on login, stores in session
- Token embedded in HTML forms and AJAX request headers
- Backend validates token on state-changing requests (POST, PUT, DELETE)

**Mobile App:**
- CSRF not applicable to native mobile apps (no browser cookies)
- JWT tokens in Authorization header provide protection

### 5.4 Session Management

**Session Timeout:**
- User sessions: 7 days idle timeout, 30 days absolute timeout
- Therapist sessions: 1 hour idle timeout (more sensitive)

**Session Storage:**
- Server-side sessions in Redis (encrypted)
- Session ID: cryptographically random, 128-bit

**Logout:**
- Client-side: Delete tokens from local storage
- Server-side: Add token to blacklist (Redis, expires with token TTL)

---

## Layer 6: Monitoring and Detection

### 6.1 Audit Logging

**Purpose:** Immutable record of all data access and security-relevant actions

**Logged Events:**
- User authentication (login, logout, failed attempts)
- Data access (who viewed what data, when)
- Data modification (create, update, delete)
- Consent changes (grant, revoke)
- Security events (failed auth, suspicious activity)
- Admin actions (privileged operations)

**Log Format:**
```json
{
  "log_id": "audit_abc123",
  "timestamp": "2026-02-13T14:16:05.000Z",
  "event_type": "DATA_ACCESS",
  "actor": {
    "actor_id": "therapist_xyz",
    "actor_type": "THERAPIST",
    "ip_address": "192.168.1.100",
    "user_agent": "Mozilla/5.0..."
  },
  "subject": {
    "subject_id": "user_123",
    "resource": "/api/v1/users/user_123/sessions"
  },
  "action": "VIEW",
  "consent_verified": true,
  "consent_id": "consent_abc"
}
```

**Log Storage:**
- Append-only database (no updates or deletes)
- Encrypted at rest
- Retention: 7 years (compliance requirement)
- Backup: Daily incremental, weekly full backup

**Log Access:**
- User can view their own audit log via app ("Who accessed my data")
- Admins can query logs (with justification + logging of the log access)

### 6.2 Anomaly Detection

**Behavioral Anomalies:**
- User login from new location (flag for MFA challenge)
- Therapist accessing unusually high number of clients (flag for review)
- API requests outside normal pattern (e.g., 100 requests in 1 second)

**Data Access Anomalies:**
- Admin accessing user data (requires justification + approval workflow)
- Bulk data export (flag for review)

**Alerting:**
- Critical anomalies: Page on-call engineer
- Warning anomalies: Slack notification to security team

### 6.3 Security Information and Event Management (SIEM)

**Tools:** Datadog Security Monitoring, Splunk, or ELK Stack

**Data Sources:**
- Application logs (API requests, errors)
- Audit logs (data access)
- Infrastructure logs (AWS CloudTrail, GCP Audit Logs)
- WAF logs (blocked requests, attack patterns)

**Detection Rules:**
- Brute-force login attempts (>5 failed logins in 5 minutes)
- Privilege escalation attempts (user accessing admin endpoints)
- Data exfiltration (large data transfers to unknown IPs)

### 6.4 Penetration Testing

**Frequency:**
- Annual third-party penetration test (required for V1 launch)
- Continuous internal testing (quarterly)

**Scope:**
- Web API (OWASP Top 10)
- Mobile app (client-side vulnerabilities, insecure storage)
- Device firmware (if accessible)
- Cloud infrastructure (misconfigurations)

**Remediation:**
- Critical vulnerabilities: Fix within 7 days
- High vulnerabilities: Fix within 30 days
- Medium/Low vulnerabilities: Prioritize in next sprint

---

## Layer 7: Governance and Compliance

### 7.1 Compliance Frameworks

**COPPA (Children's Online Privacy Protection Act):**
- **Applicability:** If users under 13, COPPA applies
- **V1 Strategy:** No users under 13 (college/adult wedge); defer complexity to V2
- **V2 Requirements:**
  - Verifiable parental consent (e.g., credit card verification, government ID)
  - Parental access to child's data
  - Option for parent to delete child's data

**State Recording Laws:**
- **Challenge:** 12 US states require all-party consent for recording
- **Tizzy Approach:**
  - Design for strictest standard (all-party consent)
  - Visible indicator LED (meets "audible/visible signal" requirements in many states)
  - User education: "In some states, you must inform others you're recording"

**FERPA (Family Educational Rights and Privacy Act):**
- **Applicability:** If used in schools, FERPA applies
- **V1 Strategy:** No school partnerships in V1 (too complex)
- **V3 Requirements:**
  - Written agreement with schools (school has "direct control" over data)
  - Data deletion upon school's request
  - No sale of student data

**FTC Health Breach Notification Rule:**
- **Applicability:** Consumer health apps storing health data
- **Requirement:** Notify FTC + users within 60 days of breach
- **Tizzy Compliance:** Incident response plan includes breach notification

**GDPR (General Data Protection Regulation, EU):**
- **V1 Strategy:** US-only, no EU users
- **V2 Strategy:** Architect for GDPR compliance:
  - Explicit consent (opt-in, not opt-out)
  - Right to erasure (user can delete all data)
  - Right to data portability (export data in machine-readable format)
  - Automated decision-making transparency (explainable ML)

### 7.2 Privacy Policy and Terms of Service

**User-Facing Privacy Policy:**
- Written in plain language (Flesch reading ease score >60)
- Covers:
  - What data is collected (audio features, metadata, not raw audio by default)
  - How data is used (coaching, research if opted in)
  - Who data is shared with (therapist if consented, no third-party sales)
  - How long data is retained (90 days full, then aggregated)
  - User rights (access, delete, export)
- Updated whenever data practices change (user notified, must re-consent)

**Therapist Terms:**
- HIPAA-like confidentiality obligations (even though Tizzy not HIPAA-covered)
- Prohibition on copying/storing client data outside Tizzy platform
- Termination for misuse

**Bystander Notice:**
- Device user manual includes: "You must inform others when recording"
- App displays reminder before first use: "In some locations, you must inform others"

### 7.3 Data Subject Rights (GDPR-Style)

**Right to Access:**
- User can view all data Tizzy has about them (via app or export)

**Right to Erasure ("Right to be Forgotten"):**
- User can delete all data (device, app, cloud)
- Deletion is immediate (completed within 1 hour)
- Audit log retains fact of deletion (not the deleted data)

**Right to Data Portability:**
- User can export data in JSON format (machine-readable)
- Export includes: sessions, features, coaching insights, haptic events

**Right to Object:**
- User can object to specific data processing (e.g., "don't use my data for research")
- Granular controls in app

### 7.4 Incident Response Plan

**Incident Categories:**
- **P0 (Critical):** Active data breach, ransomware, system compromise
- **P1 (High):** Suspected breach, unauthorized access, data leak
- **P2 (Medium):** Vulnerability discovered, denial of service
- **P3 (Low):** Non-security operational issue

**Response Workflow (P0/P1):**
```
Incident Detected
  ↓
1. CONTAIN: Isolate affected systems, revoke compromised credentials
  ↓
2. ASSESS: Determine scope (which users affected, what data exposed)
  ↓
3. ERADICATE: Remove attacker access, patch vulnerability
  ↓
4. RECOVER: Restore from clean backups, resume operations
  ↓
5. NOTIFY: Inform affected users, regulators (if required), law enforcement
  ↓
6. LEARN: Post-mortem, improve defenses
```

**Notification Requirements:**
- **Users:** Notify within 72 hours if personal data compromised (GDPR standard)
- **FTC:** Notify if health breach (Health Breach Notification Rule)
- **State AGs:** Notify if state breach notification laws triggered (varies by state)

**Post-Incident Actions:**
- Root cause analysis (RCA) within 1 week
- Remediation plan within 2 weeks
- Security improvements implemented within 30 days

### 7.5 Employee Security Training

**Frequency:** Quarterly security training for all employees

**Topics:**
- Phishing awareness (simulated phishing tests)
- Password hygiene (use password managers, MFA)
- Social engineering defense
- Data handling policies (no user data on personal devices)

**Background Checks:**
- All employees with data access: background check before hire
- Admins with elevated access: enhanced background check

---

## Privacy-Specific Controls

### P1: Consent Management System

**Consent Types:**
- **Capture Consent:** User consents to device capturing their conversations
- **Bystander Consent:** User acknowledges responsibility to inform bystanders (one-party vs. all-party consent states)
- **Therapist Sharing Consent:** User explicitly grants therapist access
- **Research Consent:** User opts into contributing anonymized data for model training
- **Audio Retention Consent:** User opts into retaining audio snippets (default: off)

**Consent Receipts:**
```json
{
  "consent_id": "consent_abc123",
  "user_id": "user_123",
  "consent_type": "THERAPIST_SHARING",
  "granted_at": "2026-02-13T10:00:00Z",
  "expires_at": "2026-08-13T10:00:00Z",
  "consent_text_version": "v1.2",
  "user_signature": "I consent to sharing my conversation insights with Dr. Jane Smith.",
  "authentication_method": "PASSWORD"
}
```

**Consent Withdrawal:**
- User can revoke consent anytime (via app)
- Revocation logged in audit trail
- Data associated with revoked consent deleted or access terminated (depending on type)

### P2: Bystander Protection Mechanisms

**Challenge:** Bystanders did not consent to being recorded

**Mitigation Strategies:**

**1. Visible Indicator:**
- LED on device edge (green when recording)
- Not obnoxious, but visible when device exposed

**2. Speaker Diarization:**
- Separate wearer's voice from bystanders' voices
- By default, only wearer's features retained

**3. Consent Modes:**
- **SELF_ONLY:** Only wearer's voice processed (bystander voice filtered out)
- **CONVERSATION:** Multi-speaker capture (user responsible for informing bystanders)
- **MUTED:** No recording

**4. User Education:**
- Onboarding tutorial: "You must inform others when recording"
- In-app reminders when switching to CONVERSATION mode

**5. Audio Snippet Restrictions:**
- If user marks moment for audio retention, app prompts: "Did everyone in this conversation consent to recording?"

### P3: Therapist Data Access Transparency

**Therapist Dashboard Watermark:**
- Every page displays: "This data is shared with consent from [User Name]. Access expires [Date]."

**Therapist Action Logging:**
- Every therapist data access logged and visible to user
- User can see: "Dr. Smith viewed your weekly report on Feb 13 at 2:30 PM"

**Therapist Audit:**
- Random audits of therapist access patterns
- Flag: Therapist accessing data of users not on their caseload (potential misuse)

### P4: Data Minimization in Practice

**Device:**
- Circular buffer size: user configurable (30-120 min)
- Raw audio never transmitted to cloud by default

**Cloud:**
- Store only features, not raw audio (unless explicitly retained)
- Aggregate data after 90 days (delete full-resolution features)

**Research Dataset:**
- De-identified: Remove user_id, device_id, location
- Anonymized: Age range (not exact age), diagnosis category (not full clinical notes)

---

## Security Testing and Validation

### Pre-Launch Security Checklist

**Device:**
- [ ] Secure boot implemented and tested
- [ ] Encrypted storage validated (extract flash, verify unreadable)
- [ ] Hard mute button functional (microphone power physically cut)
- [ ] Remote wipe tested (device unrecoverable after wipe)

**Mobile App:**
- [ ] Local database encrypted (SQLCipher)
- [ ] BLE pairing secure (no plain-text key exchange)
- [ ] Certificate pinning functional (MITM attack fails)
- [ ] Biometric authentication working (iOS FaceID, Android fingerprint)

**Backend:**
- [ ] API rate limiting enforced (test with 1000 req/sec)
- [ ] SQL injection tested (OWASP ZAP scan clean)
- [ ] XSS vulnerability tested (all user inputs sanitized)
- [ ] Authentication bypass attempts fail (JWT token tampering rejected)
- [ ] Authorization bypass attempts fail (user cannot access other user's data)

**Infrastructure:**
- [ ] Database not publicly accessible (nmap scan from external IP fails)
- [ ] SSH access requires bastion host + MFA
- [ ] WAF blocking malicious requests (test with OWASP attack payloads)
- [ ] DDoS protection active (Cloudflare enabled)

**Compliance:**
- [ ] Privacy policy published and linked in app
- [ ] Terms of service accepted by user during onboarding
- [ ] Consent receipts stored for all users
- [ ] Audit logging functional (test data access, verify log entry)
- [ ] Incident response plan documented and team trained

---

## Open Security Questions

### Q1: Should device have a "panic mode" that wipes data instantly?

**Use Case:** User in abusive situation; needs to destroy data immediately

**Implementation:** Triple-press button → wipe encryption key + overwrite flash

**Risk:** Accidental trigger (user loses data)

**V1 Decision:** Include panic mode, but require confirmation (hold button 10 seconds)

### Q2: Should we support law enforcement data requests?

**Challenge:** Legal obligation to comply with warrants, but user expectation of privacy

**V1 Position:**
- Comply with valid legal process (subpoena, warrant)
- Notify user unless legally prohibited (gag order)
- Minimal disclosure (only data specified in request)
- Transparency report published annually (number of requests, compliance rate)

### Q3: Should therapists have read-only access, or can they add notes?

**Benefit of Notes:** Clinical collaboration, better care

**Risk:** Therapist notes stored in Tizzy = liability, storage burden

**V1 Decision:** Therapists can add notes (encrypted, user can view)

### Q4: Should we implement differential privacy for research dataset?

**Benefit:** Stronger privacy guarantee (prevent model inversion attacks)

**Cost:** Reduced model accuracy (noise added to data)

**V1 Decision:** Not yet (de-identification sufficient for V1); explore in V2 after dataset grows

---

## Conclusion

Tizzy's security and privacy architecture is designed to be defense-in-depth, transparent, and user-controlled. The seven-layer security model ensures that even if one layer is compromised, others provide protection. Privacy controls are features, not checkboxes, and are surfaced to users in the app interface.

**Key Differentiators:**
- **No Raw Audio Transmission by Default:** Features-first architecture minimizes privacy risk
- **User-Facing Audit Log:** Users can see exactly who accessed their data and when
- **Bystander Protection:** Visible indicator, consent modes, speaker diarization
- **Time-Limited Therapist Access:** Consent expires, must be renewed
- **Incident Response Readiness:** Plan documented, team trained, tested quarterly

**V1 Security Posture:**
- Suitable for 100-1,000 adult users in college/therapy setting
- Annual penetration test before public launch
- SOC 2 Type II compliance (future milestone, required for enterprise sales)

**Next Steps:**
1. Complete pre-launch security checklist
2. Conduct third-party penetration test
3. Publish privacy policy and terms of service
4. Train support team on incident response procedures
5. Set up SIEM (Datadog Security Monitoring)
6. Establish bug bounty program for responsible disclosure
