# Perplexity Computer MCP — OAuth endpoints (step 01)

Discovery output for the Perplexity x Togari x Clay reply loop. Step 05 (signing
Togari in and keeping it signed in) needs these four values; they are recorded
here so nobody has to re-derive them, and so a change is visible in a diff.

Captured 2026-09-11 by the two documented curls, which need no auth:

```bash
curl -s https://www.perplexity.ai/.well-known/oauth-protected-resource/rest/computer/mcp
```

```bash
curl -s https://www.perplexity.ai/.well-known/oauth-authorization-server/rest/computer/mcp
```

Note where `.well-known` sits — straight after the domain, with the rest of the
path after it, not at the end.

## The four values step 05 needs

| Value | |
|---|---|
| `authorization_endpoint` | `https://www.perplexity.ai/rest/computer/mcp/authorize` |
| `token_endpoint` | `https://www.perplexity.ai/rest/computer/mcp/token` |
| `registration_endpoint` | `https://www.perplexity.ai/rest/computer/mcp/register` |
| `scopes_supported` | `asi:query` (the only scope) |

**There is a `registration_endpoint`**, so step 05 stands as written: Togari
registers itself via Dynamic Client Registration. Nobody has to create an app by
hand inside Perplexity's settings.

## The rest of the discovery response, and what it settles

Protected resource (`oauth-protected-resource`):

```json
{
  "resource": "https://www.perplexity.ai/rest/computer/mcp",
  "authorization_servers": ["https://www.perplexity.ai/rest/computer/mcp"],
  "scopes_supported": ["asi:query"],
  "bearer_methods_supported": ["header"]
}
```

Authorization server (`oauth-authorization-server`):

```json
{
  "issuer": "https://www.perplexity.ai/rest/computer/mcp",
  "authorization_endpoint": "https://www.perplexity.ai/rest/computer/mcp/authorize",
  "token_endpoint": "https://www.perplexity.ai/rest/computer/mcp/token",
  "registration_endpoint": "https://www.perplexity.ai/rest/computer/mcp/register",
  "scopes_supported": ["asi:query"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"],
  "code_challenge_methods_supported": ["S256"]
}
```

Four things worth carrying into step 05, beyond the four values:

- **The permission name is `asi:query`**, confirming the plan. It is the only
  scope offered, so there is nothing to choose.
- **PKCE is S256 and it is the only method listed.** Build the sign-in with a
  code challenge from the start.
- **`refresh_token` is in `grant_types_supported`**, which is what makes step
  05(f) — refresh before expiry, never wait for a 401 — possible at all. The
  plan's warning still applies: register with *both* `authorization_code` and
  `refresh_token`, or omit `grant_types` entirely. Sending only
  `authorization_code` is rejected with a 400.
- **The token goes in the `Authorization` header** (`bearer_methods_supported`),
  not a query parameter.
- `resource=https://www.perplexity.ai/rest/computer/mcp` is still required on
  the authorize and token requests even though nothing above mentions it. That
  is step 05(d) and it does not show up in discovery.
