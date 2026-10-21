# amber-ios

**The Amber health network mobile app.** Your health is shaped by the people around you. Amber makes that visible.

The active mobile client lives in `apps/mobile/` and is built with **React Native + Expo**. The previous SwiftUI client has been moved to `legacy-ios/AmberApp/` and is retained for reference only — it is not the path to App Store submission.

---

## Architecture

amber-ios is the **mobile client** that talks to two Amber backend services deployed on Railway:

```
┌─────────────────────────────────────────────────────────┐
│                       amber-ios                         │
│              (apps/mobile — React Native + Expo)        │
│                                                         │
│  Contacts · Network Viz · Profile · Amber AI · Messaging│
│  Health Dimensions · Onboarding · Privacy Tiers         │
└──────────────────────┬───────────────────┬──────────────┘
                       │                   │
                       ▼                   ▼
                ┌──────────────┐   ┌────────────────────┐
                │   amber-id   │   │    amber-agent     │
                │   (Railway)  │   │     (Railway)      │
                │              │   │                    │
                │ Auth (Privy) │   │ AI chat            │
                │ Profile data │   │ iMessage bot       │
                │ Privacy tier │   │ Health dim. infer  │
                │ Knowledge DB │   │ Tools              │
                └──────────────┘   └────────────────────┘
```

### Service Responsibilities

| Service          | Repo                                  | Railway service       | Responsibilities                                                                                       |
| ---------------- | ------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| **amber-id**     | `amberintelligence/medha-id`         | `amber-id`            | Privy auth, user profiles, privacy tiers, knowledge base (Pinecone vectors + wiki).                    |
| **amber-agent**  | `amberintelligence/amber-imessage`\* | `amber-agent`         | AI agent engine, iMessage/SMS via Loop Message, health-dimension inference, AI tools, daily check-ins. |

\* The iMessage / agent code lives in the `amber-imessage` repo, but the live Railway service it deploys is named `amber-agent`. Treat **`amber-imessage`** as the repo name and **`amber-agent`** as the deployed service.

### How the mobile app connects

```ts
// 1. Auth through amber-id (via Privy in apps/mobile)
const token = await privy.getAccessToken();

// 2. Query the AI agent via amber-agent
await fetch(`${AMBER_AGENT_URL}/api/chat`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: JSON.stringify({ message: "How's my social health?" }),
});
```

**The mobile app is a pure client.** Zero API keys in the app bundle. All intelligence lives in the Railway services.

---

## Branching Strategy

```
main ──────────────────────────────── production
  │
  └── dev ─────────────────────────── staging / TestFlight
        │
        ├── sagar/feat/xxx ────────── feature branches
        ├── angela/feat/xxx
        ├── kaitlyn/feat/xxx
        └── caleb/feat/xxx
```

- **`main`** = Production. Protected. Only accepts PRs from `dev`.
- **`dev`** = Active development. All feature branches merge here via PR.
- **Feature branches** = `{name}/feat/{description}`. Merge into `dev` via PR with review.

---

## Repo Structure

```
amber-ios/
├── apps/
│   └── mobile/                      — React Native + Expo app (active)
│       ├── app/                     — Expo Router screens
│       ├── components/              — Shared UI components
│       ├── lib/                     — Clients for amber-id / amber-agent
│       └── package.json
│
├── packages/
│   └── amberkit/                    — Shared Swift package (retained for legacy iOS)
│
├── services/
│   └── app/                         — TypeScript backend used by Railway (see railway.toml)
│
├── legacy-ios/
│   └── AmberApp/                    — Previous SwiftUI iOS app (reference only)
│
├── .github/
│   ├── CODEOWNERS                   — PR review requirements
│   └── workflows/                   — GitHub Actions (ci, ios, static)
│
└── turbo.json                       — Turborepo config
```

> Note: `services/app/` and `railway.toml` are still present and deployed to Railway today. They are out of scope for this docs cleanup; treat them as in-place legacy until they are explicitly retired.

---

## Share Amber Card (Friday MVP)

A minimal living contact card surface lives on the Profile screen. Sagar can hand a USC grad / EDC / Lightning in a Bottle acquaintance a single tap that shares his Amber card URL and a "Text Samber" phone number.

**Using it on Friday**

1. Open the app → **Profile** tab.
2. Scroll to **Share** (below the amber-id / cNFT card).
3. Pick a mode: **Default**, **USC**, or **Festival**. Each rephrases the payload.
4. Tap **Share Amber Card** to open the iOS share sheet, or **Copy payload** / **Text Samber** to grab just the text or just the number.

**Configuring the payload**

The card URL (`https://www.sagartiwari.com`) and Amber phone number (`+15550100007`) are driven by Expo config (`apps/mobile/app.json` → `expo.extra.amberCardUrl` / `amberCardPhone`) and surfaced via `apps/mobile/lib/config.ts`. Override per-build as needed.

**Out of scope for this MVP** — explicitly not in this PR:

- Bitchat
- Blockchain payments
- Map overlay / background location
- Network citations
- A full festival "Signal / where I am" view (the center pane stays as-is — Ask Amber)

---

## Six Dimensions of Health

| Dimension    | Color  | What It Tracks                           |
| ------------ | ------ | ---------------------------------------- |
| Spiritual    | Purple | Inner peace, purpose, mindfulness        |
| Emotional    | Red    | Mood, feelings, emotional regulation     |
| Physical     | Green  | Activity, sleep, exercise, movement      |
| Intellectual | Orange | Learning, curiosity, mental engagement   |
| Social       | Blue   | Connection quality, community, belonging |
| Financial    | Teal   | Career health, professional networking   |

---

## Development

### Prerequisites

- Node.js 20+ and pnpm 9
- Expo CLI (`pnpm dlx expo`) and an iOS Simulator or Android emulator for device testing
- Xcode 16+ only required if building a native iOS dev client

### Setup

```bash
git clone https://github.com/amberintelligence/amber-ios.git
cd amber-ios
git checkout dev          # Always work on dev
pnpm install              # Install workspace deps
pnpm --filter mobile start  # Launch the Expo dev server
```

### Environment

The mobile app reads its backend URLs from Expo config / `.env`. Point at the live Railway services:

```env
AMBER_ID_URL=https://amber-id-production.up.railway.app
AMBER_AGENT_URL=https://amber-agent-production.up.railway.app
```

---

## CI/CD

| Workflow                         | Trigger              | What it does                                                |
| -------------------------------- | -------------------- | ----------------------------------------------------------- |
| `.github/workflows/ci.yml`       | Push / PR to `main`  | Workspace `pnpm typecheck`, `lint`, `build`.                |
| `.github/workflows/static.yml`   | Push / PR to `main`  | Workflow YAML lint and credential hygiene checks.           |
| `.github/workflows/ios.yml`      | Manual (disabled)    | Legacy SwiftUI build under `legacy-ios/AmberApp/`. Off by default; re-enable only if you intentionally need the old app to compile. |
