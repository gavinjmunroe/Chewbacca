# AMBER-TOGARI-BOUNDARY.md

A clean break between **Amber** (the consumer product) and **Togari** (B2B /
shared capability infrastructure). Post PR #46, this is the canonical
statement of which surfaces are on the current core app path and which are
not.

If you are picking up work in this repo and a task seems to want Togari on
the core path, stop and re-read this doc.

---

## Active Amber product scope

The app a real user can use today is exactly three pieces:

| Piece            | Role                                                            |
| ---------------- | --------------------------------------------------------------- |
| `amber-id`       | Shared backend: Privy auth, per-user knowledge graphs, secrets  |
| `amber-imessage` | iMessage / SMS agent in front of amber-id (this repo)           |
| `amber-ios-dev`  | SwiftUI app in front of amber-id                                |

These three are the core consumer product. Everything else — Togari
services, B2B activation surfaces, shared-corpus experiments — is **out
of scope for the current core app path**.

Both `amber-imessage` and `amber-ios-dev` authenticate users through the
same shared `amber-id` and read/write that user's data over the consumer
contract documented in
[`ARCHITECTURE-NAMING.md`](ARCHITECTURE-NAMING.md#amber-id-contract-consumer-path).
There is one shared amber-id deployment; tenants are records inside it.

---

## What Togari is (and isn't)

Togari is **separate B2B / shared capability infrastructure**. It is not
a consumer product, not part of the iMessage surface, and not on the
critical path for any user-visible feature in `amber-imessage` or
`amber-ios-dev` today.

Togari is **not**:

- a runtime dependency of `amber-imessage` or `amber-ios-dev`
- something a consumer flow should fall back to when other paths fail
- where consumer identity, secrets, or knowledge live
- something a doc-only PR should rewire

A regression in any Togari capability must not be able to break a
consumer Amber flow. If a code path makes that statement false, that
path is the bug — not the boundary.

The legacy `amber-rytual-prod` artifact is **not** part of Amber's
architecture. It should not appear as a repo, a Railway service, a
secret bag, or a doc reference. Any such mention is residue and should
be removed.

---

## The boundary rule

The boundary between Amber and Togari is one-way and explicit:

1. **Amber surfaces may, in the future, call Togari capabilities through
   explicit adapters.** Each adapter has a named module, an explicit
   permission check, and a tenant-scoped entitlement gate. No
   capability is reached "by default" or by ambient state.
2. **The core user experience does not depend on Togari.** Removing or
   regressing every Togari service should not break a consumer
   check-in, a voice memo round-trip, an iMessage reply, or any
   amber-ios-dev screen.
3. **Togari does not call back into the consumer app path.** If Togari
   needs identity, it goes through `amber-id` like any other surface.

That is the whole break. Direction (Amber → adapter → Togari), gating
(explicit per-tenant entitlement), and independence (no consumer
dependency) are the three properties to preserve.

---

## Allowed integration shape (for the future)

When a feature on the core app path eventually warrants a Togari call,
the integration must look like this:

- A named adapter module under `Newton/agent/lib/` (or the equivalent
  iOS surface), e.g. a wrapper that converts a tenant-scoped intent
  into a Togari request.
- An explicit permission/entitlement check on the resolved tenant
  before the adapter is reached. Activation policy already lives in
  [`TOGARI-ACCESS-POLICY.md`](TOGARI-ACCESS-POLICY.md); reuse it.
- A bounded failure mode: the consumer flow degrades to its non-Togari
  behavior when the adapter is unavailable. No timeouts that block a
  reply. No silent ambient dependencies.
- A test that exercises the consumer path with the Togari adapter
  stubbed out and verifies the feature still works.

If a proposed integration cannot meet all four, it does not belong on
the core app path yet.

Until such an adapter is wired, prefer the minimum direct integration
through amber-id, the LLM, or the per-tenant context-repo. Do not
reimplement Togari behavior inside `amber-imessage`, and do not rewire
Tiwari submodules in doc-only or scope-creep PRs (see
[`Tiwari/TOGARI-SYNC.md`](../Tiwari/TOGARI-SYNC.md)).

---

## Future integrations: Togari trio

The Togari services that may eventually be reached through adapters are:

- **`togari-search`** — corpus / lookup capability for shared B2B data.
- **`togari-stitch`** — cross-source enrichment / stitching.
- **`togari-schedule`** — long-running scheduling and orchestration
  outside the conversational loop.

These are listed here so they have a single canonical home. They are
**future** integrations from the consumer surface's point of view. Do
not assume any of them are wired into the current app path. If you find
code that quietly assumes one is, that is a boundary violation worth
flagging.

For activation rules around the Togari enterprise tier (which, when
active, is governed entirely from the iMessage surface and never from
iOS), see [`TOGARI-ACCESS-POLICY.md`](TOGARI-ACCESS-POLICY.md). That
policy and this boundary doc are consistent: activation is gated, the
core consumer flow does not depend on it, and iOS is never an
activation channel.

---

## See also

- [`ARCHITECTURE-NAMING.md`](ARCHITECTURE-NAMING.md) — repo vs Railway
  service precedence; the canonical core-architecture table
- [`TOGARI-ACCESS-POLICY.md`](TOGARI-ACCESS-POLICY.md) — who can
  activate Togari enterprise and where the gate lives
- [`../Tiwari/TOGARI-SYNC.md`](../Tiwari/TOGARI-SYNC.md) — Togari
  submodule sync discipline (do not modify as part of doc PRs)
- [`../CLAUDE.md`](../CLAUDE.md) — project conventions and integration
  contract with amber-id
