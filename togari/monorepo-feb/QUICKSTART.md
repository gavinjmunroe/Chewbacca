# 🚀 Togari Quick Start

Get up and running in **under 5 minutes** with mock data!

## Prerequisites

- Node.js 18+ installed
- pnpm installed (`npm install -g pnpm`)

## Step 1: Install Dependencies

```bash
pnpm install
```

## Step 2: Set Up Environment Variables

Copy the example environment file:

```bash
cp .env.local.example .env
```

## Step 3: Get Clerk Credentials (Required)

Togari uses Clerk for authentication. You'll need to create a free account:

1. Go to https://clerk.com and sign up
2. Create a new application (choose "Next.js" as framework)
3. Enable **Organizations** in the Clerk dashboard:
   - Go to "Organizations" in the sidebar
   - Click "Enable Organizations"
4. Copy your API keys from the dashboard:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (starts with `pk_test_`)
   - `CLERK_SECRET_KEY` (starts with `sk_test_`)

5. Add them to your `.env` file:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxx
CLERK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxx
```

**That's it!** You can now start developing with mock data.

See `docs/CLERK_SETUP.md` for detailed instructions with screenshots.

## Step 4: Start Development Servers

Open two terminal windows:

### Terminal 1: Start API Server

```bash
pnpm --filter @togari/api dev
```

You should see:
```
⚠️  Using Mock Structify Client (development mode)
✅ Togari API Server running on http://localhost:4000
```

### Terminal 2: Start Web App

```bash
pnpm --filter @togari/web dev
```

You should see:
```
✓ Ready on http://localhost:3000
```

## Step 5: Access the App

1. Open http://localhost:3000
2. Sign in with Clerk (create a test account)
3. Create or select an organization
4. Start exploring the dashboard!

## What You Can Do Now

With mock mode enabled, you can:

- ✅ Create and manage people (leads/contacts)
- ✅ Create companies
- ✅ Set up campaigns
- ✅ Log touchpoints (activities)
- ✅ View sales pipeline
- ✅ Test the AI Prompt Runner
- ✅ Explore all six pillars (Marketing, Sales, Clients, Partners, Workflows, Assets)

**All data is stored in-memory** - it will reset when you restart the API server.

## When You're Ready: Connect Real Structify

Once you have access to Structify:

1. Get your Structify credentials (see `docs/STRUCTIFY_SETUP.md`)
2. Update your `.env` file:

```env
USE_MOCK_STRUCTIFY=false
STRUCTIFY_API_KEY=your_real_api_key
STRUCTIFY_DATASET_ID=your_dataset_id
```

3. Restart the API server

Now your data will persist in Structify!

## Next Steps

- **Read the architecture docs**: `docs/ARCHITECTURE.md`
- **Set up Clay integration**: Add `CLAY_API_KEY` to `.env`
- **Set up n8n workflows**: Add `N8N_BASE_URL` and `N8N_API_KEY`
- **Configure Amber integration**: See `docs/AMBER_INTEGRATION.md`
- **Add LLM providers**: Add `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for AI features

## Troubleshooting

### API server won't start

- Check that port 4000 is available
- Verify your `.env` file has valid Clerk keys

### Web app shows "Unauthorized"

- Make sure you've created an organization in Clerk
- Check that both CLERK keys are in your `.env` file
- Try signing out and signing back in

### Mock data isn't persisting

- This is expected! Mock mode uses in-memory storage
- Data resets when you restart the API server
- To persist data, connect to real Structify

## Need Help?

- 📖 Full documentation: `docs/`
- 🔧 Setup guides: `docs/CLERK_SETUP.md`, `docs/STRUCTIFY_SETUP.md`
- 🏗️ Architecture: `docs/ARCHITECTURE.md`
- 🔗 API reference: `docs/API.md`

---

**Happy building! 🎉**
