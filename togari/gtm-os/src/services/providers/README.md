# ToolProvider Abstraction Layer

## Overview

The ToolProvider abstraction layer decouples external API dependencies from tool implementations in the MCP server. This allows tools to execute operations through a consistent interface without directly importing or managing API clients.

## Architecture

### Core Interface

```typescript
interface ToolProvider {
  name: string;
  execute<T>(operation: string, params: Record<string, any>): Promise<T>;
  healthCheck(): Promise<HealthCheckResult>;
  fallback<T>(operation: string, params: Record<string, any>): Promise<T>;
}
```

### Providers

Five providers are implemented:

#### 1. **ExaProvider** — Web Search & Research
- **Operations:**
  - `search(query, num_results, use_autoprompt, include_domains, exclude_domains)`
  - `findSimilar(url, num_results)`
  - `getContents(ids)`
- **Rate Limit:** 100 calls/day
- **Environment:** `EXA_API_KEY`

#### 2. **ClayProvider** — Company & Contact Enrichment
- **Operations:**
  - `enrich_company(domain)`
  - `enrich_contact(email, name)`
  - `find_companies(query, limit)`
- **Rate Limit:** 10 calls/minute
- **Environment:** `CLAY_API_KEY`

#### 3. **StructifyProvider** — Data Normalization
- **Operations:**
  - `structure(data, instructions)` — Unstructured data with optional instructions
  - `apply_schema(data, schema)` — Apply a specific schema to data
- **Environment:** `STRUCTIFY_API_KEY`

#### 4. **GmailProvider** — Email Operations
- **Operations:**
  - `send(to, subject, body, html, cc, bcc)` — Send email immediately
  - `draft(to, subject, body, html)` — Save as draft
  - `schedule(to, subject, body, send_at, html)` — Schedule for future send
- **Rate Limit:** 1000 emails/day (soft limit)
- **Environment:** `GMAIL_ACCESS_TOKEN`, `GMAIL_REFRESH_TOKEN`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`

#### 5. **CalendarProvider** — Calendar Operations
- **Operations:**
  - `events(calendarId, timeMin, timeMax, maxResults, q)` — List events
  - `freebusy(calendars, timeMin, timeMax)` — Query freebusy data
- **Environment:** `GOOGLE_CALENDAR_ACCESS_TOKEN`, `GOOGLE_CALENDAR_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

## ToolRegistry

The `ToolRegistry` is a singleton that:
- Tracks all provider instances
- Executes operations with automatic fallback
- Health checks all providers
- Exposes provider statistics

### Usage

```typescript
import { getToolRegistry } from '@togari/services/providers';

// Get the singleton registry
const registry = getToolRegistry();

// Execute an operation
const results = await registry.execute<SearchResult>('Exa', 'search', {
  query: 'latest healthcare funding',
  num_results: 10,
});

// Health check all providers
const health = await registry.healthCheck();
console.log(`Healthy: ${health.providers.size - health.failedProviders.length}/${health.providers.size}`);

// Check if a specific provider is healthy
const exaHealthy = registry.isProviderHealthy('Exa');
```

## Health Check Endpoint

The MCP server exposes a `/health` endpoint that includes provider health:

```bash
GET /health

# Response:
{
  "status": "ok",  // "ok" or "degraded"
  "service": "togari-gtm",
  "version": "1.0.0",
  "timestamp": "2026-03-30T12:00:00.000Z",
  "providers": {
    "healthy": 5,
    "total": 5,
    "failed": [],
    "details": {
      "Exa": { "healthy": true, "latency_ms": 145 },
      "Clay": { "healthy": true, "latency_ms": 98 },
      // ... more providers
    }
  },
  "averageLatency_ms": 112
}
```

## Fallback Strategy

Each provider implements a `fallback()` method that returns degraded results when the primary service fails:

- **Exa:** Returns empty results array
- **Clay:** Returns `null` for missing data
- **Structify:** Returns unstructured input as-is
- **Gmail:** Returns queued/pending status
- **Calendar:** Returns empty events/freebusy

## Rate Limiting

Providers enforce built-in rate limits:

| Provider   | Limit         | Window    |
|-----------|---------------|-----------|
| Exa       | 100 calls     | Per day   |
| Clay      | 10 calls      | Per minute|
| Structify | None          | -         |
| Gmail     | 1000 emails   | Per day   |
| Calendar  | None          | -         |

## Integration with Tools

To use a provider in a tool:

```typescript
import { getToolRegistry } from '@togari/services/providers';

server.tool('my_tool', 'Tool description', { params }, async (params) => {
  const registry = getToolRegistry();

  try {
    // Execute with automatic fallback on failure
    const result = await registry.execute('Exa', 'search', {
      query: params.query,
      num_results: 10,
    });

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});
```

## Configuration

All providers are configured via environment variables:

```bash
# Exa
EXA_API_KEY=sk_...

# Clay
CLAY_API_KEY=bearer_...

# Structify
STRUCTIFY_API_KEY=sk_...

# Gmail
GMAIL_ACCESS_TOKEN=ya29_...
GMAIL_REFRESH_TOKEN=1//...
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...

# Calendar
GOOGLE_CALENDAR_ACCESS_TOKEN=ya29_...
GOOGLE_CALENDAR_REFRESH_TOKEN=1//...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

## Metrics & Monitoring

Access provider metrics:

```typescript
const registry = getToolRegistry();
const stats = registry.getStatistics();

console.log(`Total providers: ${stats.totalProviders}`);
console.log(`Healthy: ${stats.healthyProviders}`);
console.log(`Failed: ${stats.failedProviders.join(', ')}`);

// Get a specific provider
const exa = registry.getProvider('Exa');
const avgLatency = exa?.getAverageLatency('search');
console.log(`Exa search average latency: ${avgLatency}ms`);
```

## Error Handling

Providers throw errors when operations fail after fallback attempts:

```typescript
try {
  await registry.execute('Exa', 'search', { query: 'test' });
} catch (error) {
  // Handle error — either primary or fallback failed
  console.error(`Operation failed: ${error.message}`);
}
```

## Testing & Development

### Test a provider directly:

```typescript
import { ExaProvider } from '@togari/services/providers';

const exa = new ExaProvider('test-key');
const health = await exa.healthCheck();
console.log(health);
```

### Mock a provider for testing:

```typescript
import { ToolProvider } from '@togari/services/providers';
import { resetToolRegistry } from '@togari/services/providers';

class MockProvider implements ToolProvider {
  name = 'MockExa';
  async execute<T>() { return {} as T; }
  async healthCheck() { return { healthy: true, latency_ms: 0 }; }
  async fallback<T>() { return {} as T; }
}

// Register mock
const registry = getToolRegistry();
registry.registerProvider(new MockProvider());

// Tests run...

// Reset after tests
resetToolRegistry();
```

## Future Enhancements

- [ ] Redis-backed provider state for distributed deployments
- [ ] Per-provider configuration (rate limits, timeouts, retry policies)
- [ ] Provider-specific middleware (logging, tracing, transformation)
- [ ] Circuit breaker pattern for cascading failures
- [ ] Metrics export to Prometheus/DataDog
