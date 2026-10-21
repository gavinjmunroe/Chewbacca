# People search and Updates — implementation sequence

## Current frontend slice
Both development home screens now use PeopleSearchExperience for Community search: short context, people cards, Amber / Perplexity modes, per-person Clay enrichment review, and follow-up text filters. Calendar has My calendar / Updates and an optional people-search view for its query. Day people results explicitly do not assert availability. Topics can be followed/unfollowed for the current session and survive switching tabs. No live news, model inference, Perplexity or Clay request is claimed or made by these components.

## Three explicit operations
1. Amber: retrieve only the signed-in user's permitted dataset, then rank people with Amber Search. “Local dataset” does not imply on-device model inference. The current phone implementation is a text filter. Label where processing occurs accurately.
2. Perplexity: explicit submission to an authenticated Amber ID adapter; send the query and approved minimal context, never the whole address book. Use Sonar for web-grounded context/citations. Return structured people candidates plus evidence; validate citation links and identity matches before presenting a candidate as a known contact. Do not confuse Sonar with Perplexity Computer.
3. Clay: explicit enrichment for selected candidates/contacts, selected fields, and an agreed credit budget. Treat as an asynchronous job. Display pending, succeeded, partial, failed, canceled and unconfigured states. Review field-level differences and provenance before saving. Never bulk-export contacts because someone selected Web search.

## Repository evidence
Amber ID registers GET/PUT/DELETE /v1/me/clay/destination and POST /v1/me/clay/push in src/index.js. The push route exports contacts to a configured Clay webhook; it is not a synchronous enrichment response endpoint. POST /v1/ingest/contacts supports the inbound path. src/enrichment/providers/enrichment-provider.js resolves CLAY_API_KEY and can fall back to a stub; the new experience must reject stub output as live enrichment. A Perplexity search adapter for this UI was not found. Existing web-search.js explicitly removed the previous Perplexity dependency.

Before wiring calls, verify development configuration, route contracts, field selection, owner isolation, deployed revision and the actual Clay workspace workflow. No backend source was changed in this slice.

## Proposed API contracts, not existing routes
- Search request: query, scope (network or day with local date and IANA timezone), mode, conversation id, explicit approved context ids. Owner is derived exclusively from authenticated session.
- Search response: request id, short summary, ranked people (stable contact/candidate id, display name, real image if available, relevance reason, field provenance, citation URLs), processing location, configured state, freshness and follow-up suggestions.
- Enrichment job: selected id(s), allowlisted fields, idempotency key; server resolves permitted source records. No arbitrary destination URLs from model output. Return job status and proposed field changes; a separate confirmed write applies selected differences.
- Subscription: owner-scoped topic, optional user-chosen region, source preferences; persistence and ingestion job required. Topic text is not precise-location permission.

## Feed quality
My calendar contains actual events. Updates contains sourced news, network activity, and opportunities with involved people, why relevant, publication time, source and last refresh. Suggestions never masquerade as booked plans or confirmed availability. Respect source access/terms; don't scrape private social feeds. Use timestamps, canonical URLs and source ids for deduplication. Identity matching is separate from article deduplication.

Follow-ups keep structured query history and scope. Cancel stale requests and reject old responses after query/user/mode changes. Cache keys include tenant, scope, authorization version, source revision and query; logout, revocation and erasure invalidate them. Source content is untrusted data, never tool authorization. No auto-messages or automatic enrichment spend.

## Delivery order
1. Review the card-first interface and Calendar/Updates split.
2. Connect authenticated Amber retrieval/ranking, with contract and cross-tenant tests.
3. Add Perplexity streaming, citations, timeout/cancel/retry, and query disclosure.
4. Add Clay jobs, selected fields, cost controls and review-before-save tests.
5. Persist subscriptions, ingest permitted feeds, and add fresh ranked opportunities.

## Official references checked
- https://docs.perplexity.ai/docs/sonar/quickstart
- https://docs.perplexity.ai/docs/sonar/filters
- https://university.clay.com/docs/webhook-integration-guide
- https://university.clay.com/docs/http-api-integration-overview

Clay's HTTP API enrichment feature calls other APIs from Clay; it should not be mistaken for a universal public Clay enrichment endpoint.

## Revised direction: Daily Digest
Calendar/Updates tabs removed. Each calendar day has a Daily Digest entry. Web extension is a globe switch in the shared search bar; vendor naming is removed from search controls. Web processing remains unconfigured and does not imply a completed external request.

Digest opens an honest source-unconnected state and supports date-specific request drafts. No fabricated social posts or opportunity scores. Drafts are session-only, not background jobs. Production opportunities need explainable relevance, timing, relationship context, source confidence, dated citations, and a user action. Score the opportunity rather than assigning a value to a person. Separate inferred relevance from facts, and never imply that inferred availability is confirmed. A future dated request needs a persisted owner-scoped schedule, timezone, permitted sources, cancellation and execution status before it can claim to be scheduled.

## Search-led digest revision
Replaced the daily accordion with a full results surface activated by Calendar's Web toggle. The selected date and Today control remain above results. Web off returns to the agenda; Web on shows a short context paragraph, opportunity cards, saved-example state, relevance details and a fixed follow-up composer. Search/refinement and date changes reset the example result context. Examples are explicitly labeled and are not sourced findings. Live mode offers opt-in example preview instead of fabricated results. No network requests, scoring or scheduled jobs were added.
