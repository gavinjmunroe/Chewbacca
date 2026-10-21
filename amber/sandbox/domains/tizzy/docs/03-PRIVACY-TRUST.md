# Tizzy — Privacy and Trust

## The Brutal Truth About Always-Listening Wearables

There is no such thing as a privacy-preserving always-on microphone that people fully trust. The category starts from a deficit of trust and has to earn every inch of it. Every product in this space — from voice assistants to the Friend pendant to Limitless — has been met with the same question: "Who is actually listening?"

The answer most companies give is: "Trust us, we encrypt it, we don't sell it." That answer is insufficient. Not because the companies are lying (some are, some are not), but because trust cannot be built on assertions. It has to be built on structure — on architectural choices that make the bad behavior impossible, not just unlikely.

Tizzy's privacy posture is built on a simple principle: **privacy through architecture, not through policy.**

---

## The Tizzy Trust Model

### 1. Local Processing by Default
The core processing pipeline runs entirely on the pendant's edge chip. The raw audio is processed locally and never transmitted. The microphone captures sound, an on-device model extracts features, and only the features (not audio) are synced to the paired app. This is not a fallback option — it is the default, mandatory mode.

Cloud sync is not offered in V1. It is not a premium feature withheld to drive subscriptions. It does not exist. If the pendant cannot process locally, it does not process at all.

### 2. Consent Receipts
Every time the pendant activates a session, the paired app logs a consent receipt: timestamp, location category (if location permissions granted), estimated session duration. The user can see every session that has ever been recorded. They can delete any session. They can export the full log. This log is never transmitted to Tizzy servers.

### 3. Bystander Protection
Anyone within earshot of a Tizzy pendant is a bystander who did not consent to being part of a coaching session. This is the hardest problem in the space and the one most companies sidestep. Tizzy's approach:

- The pendant LED indicator is always visible when capturing (amber glow)
- The default session mode is "self-only" — the model focuses on the user's own speech patterns, not on modeling or analyzing other speakers
- Bystander audio is processed but not stored in any form, even as features; only the user's own speech features are retained
- In V1, no bystander voice profiles are built

### 4. Hard Mute
The pendant has a physical mute button. When muted, the microphone circuit is physically broken — not software-muted. The LED indicator turns off. This is verifiable by the user. There is no software state that can override a physical mute.

### 5. Visible Indicator
The indicator LED is designed to be noticeable to anyone in the conversation. It is not hidden under a shirt. The user is expected to explain the device if asked — Tizzy provides simple scripts for this ("It is a haptic coaching device, it does not record conversations"). The social transparency of the device is part of the design, not an afterthought.

### 6. No Clip-Sharing Virality
Tizzy will never build a feature that allows users to share conversation clips, funny moments, or "wins" with other people or on social media. The coaching data belongs to the user and to no one else. There is no viral loop built on other people's words.

---

## Privacy and Legal Posture

### COPPA (Children's Online Privacy Protection Act)
Tizzy V1 is for adults (18+). Under no circumstances does V1 accept users under 13. Between 13–17, parental consent is required and the data model is audited separately. The planned expansion to school settings (V3+) requires a full legal review and a separate privacy architecture before launch.

### Recording Consent Laws
The United States has a patchwork of one-party and two-party (all-party) consent laws for audio recording. Eleven states require all-party consent; the rest require one-party. Tizzy's legal posture in V1:

- Onboarding surfaces the user's state law at signup
- In all-party consent states, the app prompts the user to inform conversation partners before each session
- The "Tizzy On" indicator serves as a physical disclosure mechanism
- Tizzy does not provide legal advice; it provides tools that support compliance and user education

International expansion requires a separate legal review. GDPR in particular will require explicit consent receipts, right-to-erasure mechanisms, and data minimization documentation. These are planned for the EU expansion milestone (not in V1 scope).

### FERPA (Family Educational Rights and Privacy Act)
The college transition market overlaps with FERPA-covered settings (classrooms, advising sessions, tutoring). Tizzy's V1 position: the device is for personal use outside of educational records contexts. If a user chooses to use it during a class, that is their choice, subject to their institution's recording policies. Tizzy does not market toward in-class use.

University partnerships (disability services) will require FERPA compliance documentation before Tizzy can be formally recommended by or integrated with any university system.

### FTC and "Deceptive Practices"
The FTC has been increasingly aggressive about AI products that claim capabilities they do not have and about data practices that do not match privacy policies. Tizzy's commitment: the privacy policy is written in plain language, cross-referenced against the actual architecture, and reviewed externally before launch. Every claim made in marketing is reviewable against the technical implementation.

---

## Creative Consent Ideas (Under Consideration)

These are not committed features — they are design directions being explored:

**Self-Only Mode Default (Committed)**
By default, the coaching model attends only to the user's own voice, characterized during onboarding. Other speakers' audio is discarded at the feature extraction stage. No opt-in required to protect bystanders; opt-in required to include any cross-speaker signals (like turn overlap detection, which requires modeling both sides).

**Consent Flows as Etiquette, Not Legalese**
Rather than a modal that says "Recording Consent Required," explore framing consent as a social gesture: "Let the people you talk to know what Tizzy does. Here is a card you can hand them. Here is what to say." Make it feel like good manners, not legal CYA.

**Bystander QR / NFC (V2 Consideration)**
A small card or sticker with a QR code that links to a bystander information page explaining what Tizzy does and does not capture. Completely passive — no app required on the bystander's side. Allows a quick, low-friction way to answer "what is that thing?"

**Privacy Zones (V2 Consideration)**
Geofenced locations where the pendant automatically enters hard mute — medical offices, therapy rooms, legal settings, school classrooms. The user defines the zones. Automatic, so the user does not have to remember.

**Ask-to-Record Automation**
A pre-session notification on the phone: "You are about to enter a meeting. Would you like to start a Tizzy session?" Only activates on explicit confirmation. Opt-in per session type.

**One-Tap Deletion**
From the main dashboard, a single tap to delete any individual session or all sessions before a given date. No confirmation dialog maze. Deletion is immediate and irreversible. A short undo window (5 seconds) is the only friction.

---

## The Line That Matters

> "Do not hide recording. Hide stigma."

Every privacy design choice at Tizzy flows from this line. The goal is not to make the device invisible so no one knows it exists. The goal is to make using a coaching device feel ordinary, safe, and un-shameful — while being completely transparent about what the device does.

The indicator LED is always on. The coaching is always honest. The data always belongs to the user.
