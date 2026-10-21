![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-38bdf8?style=flat-square&logo=tailwindcss)
![React Native](https://img.shields.io/badge/React_Native-Expo_52-61dafb?style=flat-square&logo=expo)
![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-black?style=flat-square&logo=vercel)

# Tizzy: The conversation coach you can actually trust.

An always-wearable conversation coach starting with autism support. A discreet necklace-form device that captures real-world conversations, analyzes the acoustic and social signals that make conversations succeed or fail, and delivers coaching through haptic feedback, post-conversation review, and long-term trend dashboards.

**Live demo:** [tizzy-psi.vercel.app](https://tizzy-psi.vercel.app)

> Screenshot

## Features

- **iOS-Style Interactive Web Demo:** floating iPhone mockup with a full navigable app shell, scale-adaptive to any viewport
- **Full App Screen Set:** Login, Onboarding, Home, Device Connection, Live Session, Coaching, Session Detail, Session Complete, Sessions history, Profile, and Chat screens
- **Haptic Coaching Language:** in-the-moment guidance delivered through subtle haptic patterns during live conversations (device layer)
- **Post-Conversation Review:** timeline replay with turn-by-turn breakdown, prosody signals, and coaching annotations
- **Progress Trend Dashboards:** long-term tracking of target skills (turn-taking, topic maintenance, reciprocity, anxiety reduction)
- **Privacy-First Architecture:** on-device local processing, transparent data handling, and consent-forward design baked into the onboarding flow

## Tech Stack

| Layer | Choice |
|-------|--------|
| Web Demo Framework | Next.js 15 (App Router) |
| Mobile App | React Native + Expo SDK 52 |
| Language | TypeScript 5 (strict) |
| Styling | Tailwind CSS 3 |
| Voice Understanding | Modulate ELM (Ensemble Listening Model) |
| Fonts | System default |
| Deployment | Vercel (web demo) |

## Getting Started

**Web demo:**
```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), floating iPhone mockup with Tizzy's app.

**Mobile app (React Native / Expo):**
```bash
cd mobile-app && npm install --legacy-peer-deps
npx expo run:ios
```

See [mobile-app/README.md](mobile-app/README.md) for full setup instructions.

## Documentation

| Doc | Contents |
|-----|----------|
| [01: Overview](docs/01-OVERVIEW.md) | What Tizzy is, mission, wedge, 30-day promise |
| [02: Product](docs/02-PRODUCT.md) | V1 loop, coaching taxonomy, haptic language, timeline review |
| [03: Privacy & Trust](docs/03-PRIVACY-TRUST.md) | Trust model, consent, COPPA/FERPA/FTC posture |
| [04: Technical](docs/04-TECHNICAL.md) | Hardware spec, 3-layer architecture, conversation output schema |
| [05: Business](docs/05-BUSINESS.md) | Revenue streams, GTM waves, competitive landscape |
| [06: Roadmap](docs/06-ROADMAP.md) | 0-24 month plan, ambiguity log, positioning statement |

## Current Status

**Phase:** Pre-launch planning and architecture &nbsp;|&nbsp; **Version:** Master Doc v1.0 (Feb 2026)
**Next Milestone:** Prototype hardware and capture pipeline MVP

## Related Projects

- **[Story](https://github.com/calebnewtonusc/story):** Verified-human social platform
- **[Silo](https://github.com/calebnewtonusc/silo):** Pickup-first home kitchen marketplace

## Author

**Caleb Newton.** [calebnewton.me](https://calebnewton.me)
