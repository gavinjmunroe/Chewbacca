# Amber source aggregation and Muse evaluation

Checked October 4, 2026. This is a design and integration assessment, not a claim that Meta or automatic photo matching is connected.

## Product contract

Sagar Main is the interface over Amber ID, which remains the only writer. Sources shown to the user are Apple, Google, Meta, and Amber. People and Plans are the destinations; every plan belongs to its owner and may have confirmed participants. Places stay contextual attributes. One Add voice memo action attaches context to a person or plan; general memos enter the same review path. History is a direct header destination. The personal profile, public contact card, and source settings are separate destinations.

The user chose **suggest matches, then confirm** for imported photos and other data. A permission grant is not permission to attach an item to an arbitrary contact or to overwrite existing facts. Each proposed attachment needs source, original item identifier, owner, captured time, candidate person/plan IDs, and the proposed change. Confirmation must call the existing owner-scoped Amber ID writer with an idempotency key. Preserve conflicting facts and provenance rather than silently replacing them. Keep raw recordings and the original transcript available.

## Current sources and gaps

| Source | Available path | Remaining work |
| --- | --- | --- |
| Apple | Existing contacts import, device calendars, individually selected photos/files, optional device permissions; explicitly saved daily Health summaries belong to self | Photo-to-person/plan candidate matching and review; device acceptance for Health. Location permission is not a friend-location feed. |
| Google | Existing OAuth, Gmail/Calendar connection status, calendar sync and memo-driven calendar writes | Live acceptance of writes and review of identity matches before routing imported context. |
| Meta | No connected personal data feed; Muse evaluation below | Account-scoped authorization, provider approval and a narrowly scoped connector pilot. |
| Amber | Voice recordings, reviewed observations, contacts, plan participants and PeopleRank; existing MCP endpoint | Self-service, owner-bound MCP credentials and tool-level least-privilege enforcement before opening this to end users. |

Apple's published [Find My developer program](https://developer.apple.com/find-my/) covers locating accessories. No supported friends-location import API was found during this review. Do not label location permission as Find My access. Health read authorization is intentionally not fully observable by apps; use reviewed data, not permission-derived claims: [HealthKit authorization](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data).

## Where Muse fits

There are two distinct opportunities:

1. **Amber as a Muse connector.** Muse's platform accepts service API/MCP integrations, reviews tool scope, and distinguishes reads from writes. It calls for account isolation, minimum access, clear errors, and proper approval handling. Offer read-only access first. Submit only complete supported workflows and a dedicated test account. This is the best fit for making Amber available across interfaces. [Meta connector guidelines](https://muse.ai/platform/docs)
2. **Meta models behind Amber ID.** Muse Spark supports structured outputs and tool calling. It is an inference service; connecting it does not establish access to a user's Facebook, Instagram, or WhatsApp history. Keep the iOS UI provider-independent. Do not replace the current memo processor before comparing quality and latency on consented evaluation data. [Meta Model API](https://dev.meta.ai/docs/overview)

Muse Voice Transcribe supports file transcription and streaming, vocabulary biasing, and speaker labels. It offers push-to-talk and endpointing; diarization is not tuned for low-latency voice commands. For Amber's short memos, benchmark push-to-talk first. Speaker labels are not real-world identities and must not auto-select contacts. Compare final transcript latency, name accuracy, dropped words, extraction accuracy and duplicate-write behavior. [Voice Transcribe documentation](https://dev.meta.ai/docs/speech-to-text)

## Concrete pilot

Start with synthetic fixtures: one person note, two same-name contacts, a plan update with a time change, a photo with no identifiable person, and a retry after a timed-out write. Draft operations are `search_people`, `read_person`, `list_plans`, and `propose_context`; confirmed writes reuse existing person-note and plan-memo endpoints. These are a proposed contract, not newly implemented tools.

Repository audit: `src/mcp/index.js` mounts `/mcp`; `requireMcpKey` currently resolves provisioned environment keys. `/v1/me/api-keys` is a different per-user key system and is not automatically accepted by MCP. Several current MCP tools accept an explicit DID. Do not expose the existing unrestricted tool set as a public per-user connector. Bind the authenticated owner on the server, reject cross-owner arguments, classify tools, add revocation and enforce read/write scope before onboarding a Muse test account. An MCP URL alone is not a working authenticated connection.

Latency: open UI from local state immediately; load provider status only on the Connections page; run import/extraction asynchronously; stream progress only when useful; batch source deltas; retain source-item identifiers for deduplication. Do not put an LLM call in navigation or ordinary saved-network filtering. Benchmark p50/p95 per stage before changing model providers.

## Validation of this UI pass

Header uses the existing NativeWind-compatible Pressable so row layout and touch feedback apply. Voice history opens directly; the You rock opens the personal profile instead of the editor; a separate Amber contact card uses an explicit share allowlist. Permissions moved out of the avatar into Apple source settings. Removed duplicate Add a memory action. No backend writes or data migrations were performed by this UI change. Simulator navigation and layout checked; typecheck and existing mobile tests pass. These changes are not yet included in TestFlight build 4.
