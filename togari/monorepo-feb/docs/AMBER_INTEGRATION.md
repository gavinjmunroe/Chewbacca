# Amber Integration API

This document describes the API contract for integrating the external Amber mobile app with Togari.

## Overview

Amber is a mobile-first relationship assistant built in a separate workspace. It integrates with Togari via a webhook-style HTTP API to submit leads captured by users.

## Authentication

Amber uses API key authentication to submit leads to Togari.

### API Key Setup

1. Generate an API key for each organization in the Togari admin panel
2. Store the API key securely in Amber's environment configuration
3. Include the API key in the `X-API-Key` header for all requests

```bash
X-API-Key: your_api_key_here
```

## Endpoints

### 1. Submit Lead

Submit a new lead from Amber to Togari for processing.

**Endpoint:** `POST /api/v1/amber/submit`

**Headers:**
```http
Content-Type: application/json
X-API-Key: your_api_key_here
```

**Request Body:**
```typescript
{
  linkedinUrl: string;           // Required - LinkedIn profile URL
  submittedName?: string;        // Optional - Person's full name
  submittedCompany?: string;     // Optional - Company name
  submittedTitle?: string;       // Optional - Job title
  sourceChannel: string;         // Required - One of: warm_referral, event, linkedin_engagement, content, cold_outbound, partnership
  sourceCampaign?: string;       // Optional - Campaign identifier
  notes?: string;                // Optional - Additional context (max 1000 chars)
  submittedBy: string;           // Required - Email of the Amber user submitting
  organizationId: string;        // Required - Clerk organization ID
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "personId": "per_abc123",
  "message": "Lead submitted successfully"
}
```

**Response (Duplicate - 200):**
```json
{
  "success": true,
  "personId": "per_existing123",
  "message": "Lead already exists, updated with new information"
}
```

**Response (Error - 400):**
```json
{
  "success": false,
  "message": "Validation error: Invalid LinkedIn URL format"
}
```

**Response (Error - 401):**
```json
{
  "success": false,
  "message": "Unauthorized: Invalid API key"
}
```

**Response (Error - 500):**
```json
{
  "success": false,
  "message": "Internal server error"
}
```

### 2. Get Contacts (Future)

Retrieve a list of contacts submitted by a specific user.

**Endpoint:** `GET /api/v1/amber/contacts`

**Headers:**
```http
X-API-Key: your_api_key_here
```

**Query Parameters:**
- `submittedBy` (required) - Email of the user
- `organizationId` (required) - Clerk organization ID
- `limit` (optional) - Number of results (default: 50)
- `offset` (optional) - Pagination offset

**Response (Success - 200):**
```json
{
  "contacts": [
    {
      "personId": "per_abc123",
      "displayName": "John Doe",
      "company": "Acme Corp",
      "title": "CEO",
      "compositeScore": 85,
      "routingTier": "high_touch",
      "currentStatus": "contacted",
      "submittedAt": "2026-01-19T10:30:00Z"
    }
  ],
  "total": 42,
  "hasMore": true
}
```

## Data Flow

When Amber submits a lead, the following process occurs:

```
1. Amber App
   ↓ POST /api/v1/amber/submit

2. Togari API validates request
   - Check API key
   - Validate organization ID
   - Validate LinkedIn URL format
   - Validate required fields

3. Create/Update Person in Structify
   - Check for duplicate by LinkedIn URL
   - Create new person or update existing
   - Set source type = 'amber_form'
   - Set initial status = 'new'
   - Set initial scores = 0

4. Trigger Enrichment Workflow (n8n)
   - Push to Clay for data enrichment
   - Wait for enrichment completion

5. Calculate Scoring
   - Internal score (channel, budget, authority, GTM maturity)
   - External score (vertical-specific)
   - Composite score
   - Routing tier assignment

6. Update Structify with Results
   - Enriched profile data
   - Calculated scores
   - Assigned routing tier

7. Return Response to Amber
   - Success confirmation
   - Person ID for reference
```

## Example cURL Request

```bash
curl -X POST https://api.togari.com/api/v1/amber/submit \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_api_key_here" \
  -d '{
    "linkedinUrl": "https://linkedin.com/in/johndoe",
    "submittedName": "John Doe",
    "submittedCompany": "Acme Health",
    "submittedTitle": "Chief Medical Officer",
    "sourceChannel": "warm_referral",
    "sourceCampaign": "Q1-2026-referral-program",
    "notes": "Met at healthcare conference, very interested in our platform",
    "submittedBy": "sarah@togari.com",
    "organizationId": "org_abc123"
  }'
```

## Source Channel Options

Valid values for `sourceChannel`:

| Value | Description |
|-------|-------------|
| `warm_referral` | Lead from a referral or introduction |
| `event` | Lead met at an event or conference |
| `linkedin_engagement` | Lead engaged with content on LinkedIn |
| `content` | Lead came from content marketing |
| `cold_outbound` | Lead from cold outreach |
| `partnership` | Lead from a partnership or collaboration |

## Error Handling

Amber should handle the following error scenarios:

1. **Network Errors**: Retry up to 3 times with exponential backoff
2. **401 Unauthorized**: Prompt user to re-authenticate or contact admin
3. **400 Bad Request**: Show validation error to user, allow correction
4. **500 Server Error**: Retry once, then show user-friendly error message
5. **Rate Limiting (429)**: Wait and retry after specified delay

## Rate Limits

- **Per Organization**: 1000 requests per hour
- **Per User**: 100 requests per hour
- **Burst**: 10 requests per second

Rate limit headers are included in responses:
```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 995
X-RateLimit-Reset: 1642612800
```

## Webhooks (Future)

Togari can optionally send webhooks back to Amber when:
- Lead enrichment is complete
- Lead status changes
- Lead is assigned to a campaign

Configuration will be available in the Togari admin panel.

## Security Best Practices

1. **API Key Storage**: Store API keys securely (environment variables, secure storage)
2. **HTTPS Only**: All API requests must use HTTPS
3. **Key Rotation**: Rotate API keys every 90 days
4. **Logging**: Log all API requests for audit purposes
5. **PII Protection**: Never log sensitive user data

## Support

For integration support:
- Email: dev@togari.com
- Documentation: https://docs.togari.com
- Status Page: https://status.togari.com

## Changelog

### v0.1.0 (2026-01-19)
- Initial API specification
- POST /api/v1/amber/submit endpoint defined
