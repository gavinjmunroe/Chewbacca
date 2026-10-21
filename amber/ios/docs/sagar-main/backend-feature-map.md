# Amber backend feature map — sagar-main

15 September 2026. Code inventory for front-end integration, not a production availability guarantee. Both primary amber-id and amber-ios checkouts are on sagar-main. Existing edits remain uncommitted; no push or deployment performed. Temporary execution copies use the same branch name.

## People model

- `users` / `amber_id`: canonical account owner; session subject and legacy Privy DID resolve to it.
- `user_identities`: linked provider identities; phone verification and Apple/Google reconciliation are separate from data-source consent.
- `contacts`: an owner's address-book view of another person. A contact need not have an Amber account.
- `contact_identity_keys`: normalized, hashed match keys scoped to the owner; resolution and field-union merging in `src/db/contact-identity.js`.
- `contact_sources`: provenance from imports/providers; retain source disagreements and review uncertain identity matches.
- `observations`: consolidated facts, notes, experiences, memories and transcripts, with participants, source, confidence, temporal validity, status and dimensions. Subject can be a contact, circle or owner.
- `observation_participants`, tags and dimensions: one memory can reference several people without copying its text into every card.
- Six dimensions: spiritual, emotional, physical, intellectual, social and financial. These are relationship-context classifications, not medical diagnoses.
- Contact scores, interaction statistics and dimension state: derived summaries for relevance, relationship warmth and cadence.
- `circles`, memberships and favorites: user-owned groups and pinned people.
- Connections, requests and introductions: cross-account social graph, separate from imported contacts.
- Shares, permissions and viewer policy: what another account can see; imported details are not inherently public.
- Conversations, messages and media assets: original voice/text history, distinct from extracted observations.

## Registered Amber ID capabilities and possible UI

- Authentication: phone OTP, Apple/Google identity reconciliation, refresh rotation, device sessions -> onboarding/account settings.
- Profile: self profile, public profile, username share page, voice bio -> My card and share preview.
- Contacts: list/create/update/delete, batch/sync paths, identity linking, Google import -> Community and source import review.
- Enrichment: contact summaries, person enrichment, resolve candidate -> Review proposed profile changes.
- Notes/voice: contact note capture, contact voice note, transcription, dictation -> Speak, transcript and destination confirmation.
- Memories: conversations, experiences, note media -> Memory history and provenance drill-down.
- Search/chat: `/v1/chat` with streamed answers/people, SQL retrieval and optional Togari engine -> Search this network with tappable citations.
- Favorites and circles -> the network's focus set and community filters.
- Calendar accounts, agenda, events, reminders, parse and completion -> Calendar, date navigation, voice-created proposals.
- Connection requests and intros -> Ask for an introduction, with controlled contact release.
- Share ledger and shared feeds -> selected card/note sharing and revoke access.
- DMs, reactions, comments, blocks and reports -> optional future social screens, not required to make the rolodex work.
- Wall, Q&A and answers -> optional relationship context capture.
- Pipelines, partnerships, personal-life records and content seeds -> existing broader workflow modules, not all relevant to first-launch UI.
- OAuth: Google, LinkedIn, Microsoft, Slack, Notion, Twitter, GitHub, Railway -> provider-specific connections; configuration/approval must be checked.
- API keys and Clay ingest/push -> controlled external import/export.
- iMessage link, Photon inbound and sender -> message Amber with separate inbound consent and outbound settings.
- Push tokens and notification preferences -> permission-led notification setup.
- Privacy tiers, permissions, audit and account deletion -> settings and erasure progress. Prior audit found storage failure reporting gaps.
- MCP and internal agent APIs -> agent access through authenticated server contracts; never direct unrestricted mobile access.
- Reminder and rollup workers -> scheduled delivery and derived relationship summaries; runtime flags/configuration matter.

## Microservices versus modules

Amber ID is a Fastify/Node service with many internal route/store modules. Those modules are not each separately deployed microservices. Its data foundation is Cloud SQL/Postgres, with GCS media handling and tenant secrets code. Current code removed active Privy/Solana dependencies despite older architecture documents.

Amber Search is a separately runnable Python FastAPI ranking service. The checked-in Dockerfile/Railway configuration runs `uvicorn api.main:app`.

Photon/Spectrum, Clay, Google and other OAuth providers are external integrations. Composio and Privy restoration are proposed work, not established live integrations. Perplexity Computer is also not wired to the current preview. Deployment topology and credentials were not inspected.

## How amber-search fits

Intended active code path:

    iOS search -> Amber ID authenticated /v1/chat
       -> load this owner's allowed contacts + observations
       -> enrichment/togari-search-rank.js
       -> amber-search FastAPI ranking endpoint
       -> ranked people + reasons + [[p:CONTACT_ID]] citations
       -> Amber ID stream -> iOS result cards -> contact profile

Amber ID adapter requires `PEOPLERANK_ENGINE=togari`, `TOGARI_SEARCH_URL`, and `TOGARI_SEARCH_KEY`. Search validates its service key using `BLIND8_API_KEY`. Never expose these service credentials in iOS. Their deployed values/enabled state were not checked.

Search endpoints in source:
- `GET /health`
- `POST /v1/me/people-rank`
- `POST /v1/me/people-rank/stream`
- `POST /v1/match/community-event`

Capabilities: query/contact semantic relevance, fact-level temporal context, structured proximity, staged filtering/ranking, grounded answers/citations, streaming, attendee pairing/grouping, and cached scoring/rationales. Proximity is not evidence of friendship; display explanations and evidence rather than making social or clinical certainty claims.

Search ranks a supplied contact projection. It does not replace Amber ID's canonical owner/contact database or tenant authorization. The service uses a shared service bearer rather than authenticating individual mobile users; Amber ID must enforce the tenant boundary before dispatching data.

The repo also has a separate Node/TypeScript MCP application with health and natural-language BigQuery contacts queries, optional deals querying, and supporting Gmail/DNC code. The checked-in Dockerfile does not run that Node entrypoint. Do not assume its global/admin data access is appropriate for consumer Community search.

### Wiring gaps to fix before integration

1. New ConnectedRolodex currently uses a local string filter over fetched contacts. It is not using the ranking engine.
2. Mobile `lib/peoplerank.ts` references `/v1/me/people-rank`; no corresponding handler registration was found in current Amber ID source. `/v1/chat` is registered and calls the Togari adapter. Establish one supported contract and cover it with an integration test.
3. Search availability/fallback must be explicit. A missing engine configuration or timeout can yield null/empty results; do not label that "nobody in your network" without distinguishing service failure.
4. Search has memory and disk caches. Event-match cache uses runId. Before multiple tenants share the service, verify tenant/content keying, collision isolation and erasure of cached data. Current account deletion does not establish cross-service cache erasure.
5. Old Firestore/Privy/standalone ranking comments conflict with current code; update docs as contracts are confirmed.

## Recommended front-end order

1. Source selection and contact import; show progress, failure and duplicate review.
2. Real contact profiles: facts, sources, experiences, rank summaries and selective sharing.
3. Community search through the supported Amber ID stream: immediate name matching, then ranked explanations/citations, cancellation and error state.
4. Calendar/agenda and event editing with real accounts.
5. Speak: record -> transcript -> proposed contact/event/reminder changes -> confirm -> show actual saved result.
6. Clay enrichment and user-confirmed identity resolution.
7. Photon linking and constrained external Computer tasks after consent and erasure paths are covered.

Core code references:
- amber-id/src/index.js (registered surface)
- amber-id/src/db/contact-identity.js and observations-store.js (people/memory)
- amber-id/src/routes/chat.js (orchestration)
- amber-id/src/enrichment/togari-search-rank.js (service boundary)
- amber-search/api/main.py, people_rank.py, schemas.py and auth.py (ranking contract)
- amber-search/Dockerfile and src/index.ts (two runtime surfaces)
- amber-ios/apps/mobile/components/ConnectedRolodex.tsx (current local search)

No application behavior changed in this inventory/branch-management step. Prior passing checks were not rerun for branch names or this documentation.
