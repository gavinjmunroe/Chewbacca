---
name: reference_mcp_user_scope_setup
description: medha (Amber) + github MCP servers registered at user scope so they load in every Claude Code session; github npx-cache fix
metadata:
  node_type: memory
  type: reference
  originSessionId: 60d318af-1836-48a6-9a3f-6b46bd61aeb3
---

The `medha` (Amber) MCP server is now registered at **user scope** in `~/.claude.json` (not just `code/archive/2026-code-root/.mcp.json`), so it loads as a native tool in EVERY Claude Code session including from `/Users/joelnewton`. URL `https://medha-id-production.up.railway.app/mcp`, header `x-api-key`. Tools: lookup_person, log_interaction, get_dashboard_url, list_groups, list_events, people_rank, search_people, upsert_contact.

`search_people` and `upsert_contact` both REQUIRE the owner `did`; `upsert_contact` nests fields under a `contact` object: `{did, contact:{name, company, ...}}` (name required). There is NO delete tool on the MCP, to remove a contact, run a one-off Firestore script from the medha-id repo via `railway run node ...` (path `users/{did}/contacts/{contactId}`; creds `GOOGLE_APPLICATION_CREDENTIALS_JSON` + `GCP_PROJECT_ID=midyear-glazing-485303-u3` come from Railway). See [[reference_medha_id_storage]] and [[reference_amber_mcp]].

The `github` MCP server kept failing to connect, root cause was a **corrupted npx cache** (`ENOTEMPTY` on the zod dir), NOT the deprecation warning. Fix: `rm -rf ~/.npm/_npx/<hash>` then re-add with `claude mcp add github -s user -e GITHUB_PERSONAL_ACCESS_TOKEN=$(gh auth token) -- npx -y @modelcontextprotocol/server-github`. If any other npx-based MCP fails to connect, suspect the npx cache first.

As of 2026-11-02 github and supabase run through the MCP hub with their tokens in the Keychain, and medha answers 404. See [[project_mcp_hub_2026_11_02]].
