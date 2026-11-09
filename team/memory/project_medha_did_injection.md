---
name: project_medha_did_injection
description: "medha-id MCP tools (search_people/people_rank/upsert_contact) now default `did` to the API-key-bound owner DID; shipped to main + prod 2026-06-05"
metadata:
  node_type: memory
  type: project
  originSessionId: 60d318af-1836-48a6-9a3f-6b46bd61aeb3
---

medha-id MCP CRM tools no longer force the caller to pass a `did`. An API key can be bound to an owner DID; the tool defaults `did` to it so a non-technical key-holder (e.g. a CEO) never needs to know their DID. Shipped to amber-organization/medha-id `main` (commit 5742cf2, authored Sagar Tiwari) and live on medha-id-production 2026-06-05.

How it works: `AMBER_ID_API_KEYS` JSON entries take an optional `did` field; a global `DEFAULT_OWNER_DID` env is the fallback. `requireApiKey` stamps `request.ownerDid`; `createMcpServer({ownerDid})` injects it as the default `did` for tools that `export const requiresOwnerDid = true` (search_people, people_rank, upsert_contact). Explicit `did` still wins (back-compat). When neither resolves, tools return a clean `missing_did` isError (not a crash). Verified in prod: a key bound to a DID resolves both tools with no `did` arg passed.

To make the CEO handoff turnkey, mint a named key bound to the CEO's DID (need their phone → resolve DID via lookup_person / ensureTenantForPhone), set it in `AMBER_ID_API_KEYS`. Handoff doc: ~/Downloads/MEDHA_MCP_CEO_HANDOFF.md (Claude Desktop via mcp-remote --header). The shared admin key (value in Railway) is the legacy `AMBER_ID_API_KEY` and is NOT bound to a DID. See [[reference_mcp_user_scope_setup]], [[reference_amber_mcp]], a private note.

STILL OPEN: (1) Togari pipeline reporting is unfaithful (drops closed-won, miscounts), patch written for Karthik at ~/Downloads/TOGARI_PIPELINE_REPORTING_FIX_for_Karthik.md, NOT deployed (his prod). (2) Perplexity/Clay still blocked: medha MCP is static-header auth with no OAuth, so Perplexity's connector UI and Clay (no native MCP) can't consume it as a drop-in, needs an OAuth shim / REST for Clay. (3) Cleaned 3 test deals from togari_data_lake.togari_structured_deals on 6/5 (backup at ~/Downloads/togari_test_rows_backup_20260605.json); real pipeline = 23 deals / $93,750 / $58k closed-won.
