---
name: reference_amber_mcp
description: "The Amber/Medha MCP server (medha-id /mcp), endpoint, auth, current tools, and the unified-Amber-MCP plan"
metadata:
  node_type: memory
  type: reference
  originSessionId: 7fb8f02d-9120-440d-b667-55a18c527cb7
---

The Medha/Amber MCP is the medha-id MCP server (extend it, don't build a new one, it owns identity + relationship data + per-key auth).

- **Endpoint:** `https://medha-id-production.up.railway.app/mcp` (Streamable HTTP). Auth header `x-api-key: <AMBER_ID_API_KEY>` (value in medha-id Railway). Toggle env `MCP_HTTP_ENABLED` (default on). Code: `medha-id/src/mcp/` (index.js mount, server.js registry, tools/\*.js).
- **Verified live 2026-06-04:** authed `initialize` returns serverInfo `medha-id 1.0.0` with tools capability; unauthed = 401.
- **Current tools (5):** lookup-person, list-groups, list-events, log-interaction, get-dashboard-url. **No people-rank yet.**
- **Added to Claude** via `/Users/joelnewton/code/archive/2026-code-root/.mcp.json` as server `medha` (url + x-api-key). Same config works in Claude Desktop, Perplexity, and Clay (all take a remote MCP URL + header).
- **Sagar wants (6/4):** a unified "Amber MCP" = people-rank + medha-id functionality, used in Perplexity + Clay + Amber iOS, serving like a CRM (learn the field-mapping/write-back pattern from how Maggie+Sagar wire HubSpot into Clay). Plan + timeline: `medha/AMBER_MCP_PLAN.md` (+ ~/Downloads). v1 this week = add people_rank (wraps Karthik's togari-search engine) + search_people + get_person + upsert_contact.

Related: Karthik 6/4 wanted Medha able to call Togari, shipped `ask_togari` tool in medha-platform (e536fb6): relays NL to togari-platform `/api/v1/message` (x-togari-key), the agent-to-agent gate (decision #14). See [[project_medha_tenancy_architecture]], a private note.
