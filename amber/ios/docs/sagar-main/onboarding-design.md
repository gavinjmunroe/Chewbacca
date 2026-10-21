# Amber onboarding — design review

Implemented in the development-only preview entry, September 16, 2026. Production authentication and onboarding remain unchanged.

## Review sequence
1. **Your mutual friend.** Amber's original mark, serif wordmark, relationship-focused introduction. Meet Amber advances.
2. **It starts with you.** A single name field; blank input cannot advance. Back preserves the name. The name appears on the preview's own profile.
3. **Bring your people together.** Existing integration circles open Updates / Connect / Add data sheets. Sample mode prevents account linking; file review retains its existing local behavior. Continue opens the sample Community experience.

The home footer restarts onboarding. This walkthrough creates no account or verification claim, and persists no identity. The existing network remains synthetic and is labeled as a design review.

## Production wiring after design approval
- Insert existing account authentication before persistent imports. Login, human verification, and wallet ownership must have separate states and copy.
- Save the name through a confirmed profile response; do not silently treat failed saves as completed onboarding.
- Ask contacts/calendar permissions only after selecting the relevant source. Support refusal and later connection.
- Distinguish device contacts from Apple account sign-in and calendar access. These are separate permissions and data paths.
- Request narrowly scoped Gmail authorization for the feature selected. Show connection success only after backend confirmation.
- Show imported source counts and possible duplicate review before populating the real network. Never present sample relationships as an import result.
- Land in Community with an honest empty state if imports are skipped. Teach Speak in context; request microphone permission only on use, then review proposed writes.
- Remove city and repeat phone confirmation from the critical path unless backend requirements justify them. Replace unverified “local-only” privacy promises with accurate storage and access descriptions.
- Review push permission timing in the gated layout; entry to onboarding must not itself trigger unrelated consent prompts.

This is the frontend review slice, not completion of the authentication, verification, or connected-data infrastructure.

## Follow-up: complete onboarding and a shared discovery feed
The preview now includes an explicit account-verification checkpoint, source selection, permission explanations, and an illustrative graph. The checkpoint does not send or validate an SMS. Permission copy is a design specification; native consent and import are not wired into this isolated preview.

Production sequence: welcome → existing sign-in and code verification → name → select sources → source-specific authorization/import → review duplicates → graph → contextual web discovery. Code entry must support resend cooldown, expiry, wrong code, delivery failure, and changing the number. A code does not establish verified-human identity.

Contacts access is not publication of an address book. Photo selection should use individual selections before asking for broad library access. Location is optional and requested for a nearby action; do not default to continuous tracking or publish precise whereabouts. Calendar access is separate from account login. Source selection alone must never imply a successful connection.

### Shared activity and opportunity model
Community and Calendar should consume one tenant-scoped activity layer, with different scopes. The existing preview search is still a local filter, not this proposed feed.

An activity needs: stable id, owner/tenant, involved contact ids, source record id, source name, occurrence and ingestion timestamps, visibility, freshness, and deletion linkage. An opportunity additionally needs a reason, supporting evidence, relevant time window, and proposed action. Inferred relevance must be labeled separately from source facts.

Community: graph remains the spatial view. A compact “From your network” sheet shows recent updates and opportunities; typing narrows people, updates, and opportunities together. Example only: a contact's published event is relevant to an interest the user chose to share with Amber. Show source and reason before offering to save it or draft outreach.

Calendar: the selected day scopes confirmed events and relevant opportunities. Keep suggestions visually separate from booked events. An open slot plus a shared interest can support a suggestion, but never imply the other person is available. Creating an event or sending an invitation requires an explicit action.

Pipeline: authorized source adapters → Amber ID normalized people/activities and provenance → tenant-filtered retrieval → Amber Search ranking → evidence-backed UI. External content remains untrusted input; it cannot authorize tool calls or messages. Web research receives only the minimum user-approved context. Logout, revoked connections, and deletion must invalidate cached feed/search entries.

Build in order: (1) confirmed contacts + calendar activities, (2) source-labelled unified results, (3) cited suggestions and saved opportunities, (4) refresh/streaming updates, (5) permissioned agent actions. Avoid fake activity, fabricated availability, or an engagement feed unrelated to actual relationships.
