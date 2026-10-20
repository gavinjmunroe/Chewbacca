# Structify Setup Guide

Structify is your primary data store - it's where all leads, companies, campaigns, and touchpoints are stored.

## What is Structify?

Structify is a structured data platform that lets you:
- Store entities (like people, companies) with flexible schemas
- Query data with filters and sorting
- Integrate with other tools (Clay, n8n, etc.)

## Step 1: Create a Structify Account

1. Go to https://structify.ai
2. Sign up for an account
3. Verify your email

**Note**: If Structify requires an invite or waitlist, you may need to:
- Request access on their website
- Or use their API documentation to set up a trial

## Step 2: Create a Dataset

A "dataset" in Structify is like a database for your project.

1. After logging in, look for **"Create Dataset"** or **"New Project"**
2. Name it: **"togari_dev"** (for development)
3. Choose region: US or closest to you
4. Create the dataset

## Step 3: Get Your API Key

1. Go to **Settings** or **API Keys** (check sidebar/menu)
2. Click **"Create API Key"** or **"Generate Key"**
3. Name it: "Togari Development"
4. Copy the API key (starts with something like `structify_` or similar)

⚠️ **Important**: Save this key immediately - you may not be able to see it again!

## Step 4: Get Your Dataset ID

1. In Structify dashboard, go to your dataset ("togari_dev")
2. Look for **Dataset ID** or **Project ID**
3. It might be in:
   - Settings page
   - URL bar (e.g., `https://app.structify.ai/datasets/abc123`)
   - Dataset overview

4. Copy this ID

## Step 5: Add to .env

Update your `.env` file:

```env
STRUCTIFY_API_KEY=structify_xxxxxxxxxxxxxxxxxxxxx
STRUCTIFY_DATASET_ID=abc123_your_dataset_id
```

## Step 6: Test the Connection

Let's verify Structify is working:

```bash
# Start the API server
pnpm --filter @togari/api dev
```

Then test with curl:
```bash
curl http://localhost:4000/health
```

Should return: `{"status":"ok","timestamp":"..."}`

## Understanding Structify Entities

Togari will create these entity types in Structify:

1. **People** - Leads and contacts (LinkedIn URL, name, company, scores)
2. **Companies** - Organizations (domain, industry, employee count)
3. **Campaigns** - Marketing campaigns (name, status, metrics)
4. **Touchpoints** - Activity log (emails, calls, meetings)
5. **Relationships** - Partner network connections

These are automatically created when you use the API!

## Structify API Example

Here's what happens when you submit a lead:

```typescript
// Togari API calls:
await structify.createPerson({
  linkedinUrl: "https://linkedin.com/in/johndoe",
  fullName: "John Doe",
  currentCompany: "Acme Health",
  vertical: "healthcare",
  organizationId: "org_xxx", // From Clerk
  // ... more fields
});

// Structify stores it in your dataset
// You can query it later:
await structify.listPeople(organizationId, {
  filters: [{ field: "vertical", operator: "eq", value: "healthcare" }]
});
```

## Alternative: Using Mock Data

If you're having trouble with Structify, you can temporarily use a mock client:

1. Create `packages/structify/src/mock-client.ts`:

```typescript
import type { Person, Company } from '@togari/core';

export class MockStructifyClient {
  private people: Person[] = [];

  async createPerson(data: any): Promise<Person> {
    const person = {
      ...data,
      personId: `per_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.people.push(person);
    return person;
  }

  async listPeople(orgId: string): Promise<Person[]> {
    return this.people.filter(p => p.organizationId === orgId);
  }

  // ... implement other methods
}
```

2. In `packages/api/src/context.ts`, swap:
```typescript
// const structify = new StructifyClient({ ... });
const structify = new MockStructifyClient();
```

This lets you develop without Structify while you wait for access!

## Pricing

Structify pricing varies:
- Free tier or trial usually available
- Contact their team for pricing details
- Perfect for development and testing

## Troubleshooting

**Issue**: "Invalid API key"
- Solution: Regenerate key in Structify dashboard, update `.env`

**Issue**: "Dataset not found"
- Solution: Double-check dataset ID, make sure it's the active dataset

**Issue**: Can't access Structify yet
- Solution: Use the Mock Client approach above temporarily

## Next Steps

Once Structify is connected:
1. Submit a test lead via the Amber endpoint
2. View it in Structify dashboard
3. Query it in the Togari web app at `/dashboard/sales`

## Need Help?

- Structify Docs: Check their API documentation
- Structify Support: Contact their team
- Mock Client: Use the temporary mock approach above
