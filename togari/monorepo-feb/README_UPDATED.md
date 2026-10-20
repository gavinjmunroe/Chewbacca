# Togari

**AI-native enterprise operating system for health & wellness practitioners**

🔗 **Powered by Amber ID** - Single authentication layer for consumer and B2B apps

---

## 🚀 Quick Start (No Auth Needed!)

```bash
# Start API
pnpm --filter @togari/api dev

# Start Web (in another terminal)
pnpm --filter @togari/web dev
```

Open http://localhost:3000 - Ready to use! ✨

---

## ✅ Status

- ✅ **Structify Connected** - Real data storage
- ✅ **Auth Bypassed** - Dev mode, ready for Amber ID
- ✅ **All Builds Passing** - TypeScript, Next.js, tRPC
- ✅ **Amber Superprompt Ready** - See `AMBER_AGENT_SUPERPROMPT.md`

---

## 📚 Essential Docs

1. **`START_HERE.md`** ⭐ - Quick start guide
2. **`AMBER_AGENT_SUPERPROMPT.md`** 🤖 - Complete context for Amber agent
3. **`docs/ARCHITECTURE.md`** - System design
4. **`docs/AMBER_INTEGRATION.md`** - API contract

---

## 🏗️ Architecture

```
Amber (Consumer + Auth)
  ↓
Togari API (Backend)
  ↓
Structify (Data Store)
  ↓
Clay (Enrichment) + n8n (Workflows)
  ↓
Togari Dashboard (Practitioner View)
```

**Key Insight**: Amber ID = Single auth layer. No Clerk needed.

---

## 📦 Monorepo Structure

- `packages/core` - Shared types, schemas, utilities
- `packages/structify` - Structify API client + mock
- `packages/api` - Express + tRPC backend
- `packages/web` - Next.js 14 dashboard

---

## 🔑 Environment

Your `.env` is configured with:
- ✅ Structify API key
- ✅ Structify dataset ID
- 🔄 Ready for Amber ID integration

---

## 🎯 What Works Now

- ✅ Dashboard at http://localhost:3000/dashboard
- ✅ Sales pipeline (create/view leads)
- ✅ Marketing campaigns
- ✅ AI Prompt Runner (Claygent-style)
- ✅ Amber webhook: `POST /api/v1/amber/submit`
- ✅ Data persists to Structify

---

## 🔗 Amber Integration

### Lead Submission Endpoint:
```bash
POST http://localhost:4000/api/v1/amber/submit
Headers: X-API-Key, Content-Type
Body: { linkedinUrl, submittedName, sourceChannel, ... }
```

### Future: Amber ID Auth
- Amber sends JWT → Togari verifies
- Single sign-on for practitioners
- Organization management via Amber

---

## 📄 License

Proprietary - All rights reserved

---

**Get Started**: Open `START_HERE.md` for detailed instructions!
