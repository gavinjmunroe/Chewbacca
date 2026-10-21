# Privy Authentication Setup

## Overview

Amber uses Privy for authentication, providing wallet-based and social login capabilities. All API routes (except `/health`) require authentication.

## Environment Variables

```bash
PRIVY_APP_ID=your-privy-app-id
PRIVY_APP_SECRET=your-privy-app-secret
```

Get these from [Privy Dashboard](https://dashboard.privy.io/)

## Authentication Flow

1. **Client obtains Privy access token** (via Privy SDK)
2. **Client sends token** in `Authorization: Bearer <token>` header
3. **Server verifies token** and loads/creates user in database
4. **Request proceeds** with `userId` attached

## API Endpoints

### Public Endpoints
- `GET /health` - Health check (no auth)

### Auth Endpoints
- `POST /auth/verify` - Verify Privy token, get user info
- `GET /auth/me` - Get current authenticated user

### Protected Endpoints (require `Authorization: Bearer <token>`)
- All `/persons/*` routes
- All `/relationships/*` routes
- All `/insights/*` routes
- All `/pipelines/*` routes
- All `/anchor/*` routes
- All `/identity/*` routes
- `GET /ai/stream`

## Usage Example

```typescript
// Client-side (Swift/JavaScript)
const token = await privy.getAccessToken();
const response = await fetch('https://api.amber.app/persons', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
});
```

## User Isolation

All data is automatically scoped to the authenticated user:
- Users can only see/modify their own persons, relationships, insights
- Database queries include `WHERE userId = ?` automatically
- No cross-user data leakage possible

## Error Responses

```json
{
  "error": "unauthorized",
  "message": "Missing or invalid authorization header"
}
```

Status codes:
- `401` - Unauthorized (missing/invalid token)
- `404` - Not found (resource doesn't exist or belongs to another user)
- `400` - Bad request (validation error)


