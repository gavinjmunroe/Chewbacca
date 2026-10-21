# Amber iOS App - Quick Start for Contractors

## 🎯 Overview

**Purpose**: This guide provides contractors with a clear understanding of what's been built and the structured roadmap for implementing the next 6 phases of development.

**Status**: ✅ MVP Complete - Full-featured iOS app with mock data
**Lines of Code**: ~4,800 Swift LOC
**Architecture**: MVVM + SwiftUI + Combine
**Current Phase**: Preparing for Phase 1 (Service Layer)

---

## 📱 What's Currently Built

### Four-Tab Navigation (Bottom Tab Bar)

1. **Contacts** (Default/Home)
   - Liquid glass search bar with voice input
   - Contact list view with avatars
   - Add contact flow (multi-step form)
   - Apple Contacts integration toggles

2. **Network** (Discover/Visualizations)
   - Three network visualization modes:
     - **Amber Network**: Interactive bubble chart with connections
     - **Family Network**: Hierarchical relationship tree
     - **Find My Friends**: Geographic map with location pins
   - Network source filters (8 data sources)
   - Network context input bar (app-level positioned)
   - Perplexity-style AI chat integration

3. **Journey** (Timeline)
   - Vertical timeline of daily interactions
   - Journey entry cards with photos, emotions, people
   - Add journey entry wizard (7-step flow):
     - People selection
     - Photos/videos
     - Activities
     - Location
     - Interaction type
     - Mood/emotions
     - Notes
   - Mock entries with rich metadata

4. **Profile** (Amber ID)
   - Identity card with avatar and connection count
   - Personal details section:
     - Birthday, zodiac (sun/moon/rising)
     - Myers-Briggs, Enneagram
     - Primary nature, social type, thinking style
     - Cycle tracking (phase + day count)
   - Daily Check-In card:
     - 9 emotion tags (selectable 3x3 grid)
     - Cycle started toggle
     - Energy level (1-5 scale)
     - Sleep quality (1-5 scale)
     - Save button
   - Enhance Your Profile section:
     - 6 personality test cards in 2x3 grid
   - 6 Daily Digest cards (health dimensions):
     - Spiritual, Emotional, Physical
     - Financial, Intellectual, Social
     - Each with score, trend, and AI chat
   - Data sources integration toggles:
     - Apple (Contacts, Health, Location, Activity)
     - Google (Calendar, Gmail)
     - Meta (Instagram, Facebook)
     - Social (TikTok, LinkedIn, X, Substack)
     - AI (Claude, ChatGPT)

---

## 🎨 Design System

### Colors
- Background: `#0A0A0A` (near black)
- Cards: `.regularMaterial`, `.ultraThinMaterial` (glass effects)
- Accent Blue: `#4A90D9` (.amberBlue)
- Health Dimensions:
  - Spiritual: `#9B59B6` (purple)
  - Emotional: `#E74C3C` (red)
  - Physical: `#27AE60` (green)
  - Intellectual: `#F39C12` (orange)
  - Social: `#3498DB` (blue)
  - Financial: `#1ABC9C` (teal)

### Key Components
- **LiquidGlassSearchBar**: Frosted glass search with voice input
- **NetworkInputBar**: Context input bar (similar to search bar)
- **CustomTabBar**: 4-tab bottom navigation
- **ContactAvatar**: Circular avatars with initials fallback
- **HealthBadge**: Colored badges for health dimensions
- **DailyTestCard**: Full-width daily check-in card
- **PersonalityTestCard**: Test cards in grid layout

---

## 🏗️ Current Architecture

```
AmberApp/
├── AmberApp.swift              # App entry, tab state, app-level components
├── Extensions/
│   ├── Color+Amber.swift       # Color design system
│   └── Font+Amber.swift        # Typography system
├── Models/
│   ├── AmberUser.swift         # User profile with personality data
│   ├── Connection.swift        # Contact/connection model
│   ├── Insight.swift           # Insight cards
│   ├── AmberStory.swift        # Story cards
│   ├── JourneyEntry.swift      # Journey/interaction entries
│   ├── DailyDigest.swift       # Health dimension digests
│   ├── HealthDimension.swift   # Health scoring
│   └── PersonalityTypes.swift  # MBTI, Enneagram, etc.
├── Components/
│   ├── LiquidGlassSearchBar.swift
│   ├── NetworkInputBar.swift   # NEW: Network context input
│   ├── ContactAvatar.swift
│   ├── HealthBadge.swift
│   └── CustomTabBar.swift
├── Views/
│   ├── ConnectionsView.swift   # Contacts + search
│   ├── AddContactView.swift    # Multi-step contact form
│   ├── DiscoverView.swift      # Network visualizations
│   ├── JourneyView.swift       # Timeline view
│   ├── AddJourneyEntrySheet.swift  # Journey entry wizard
│   └── AmberIDView.swift       # Profile (1,400+ lines - needs split)
└── ViewModels/
    ├── ConnectionsViewModel.swift
    ├── AmberIDViewModel.swift
    └── JourneyViewModel.swift
```

---

## 🚧 Proposed 6-Phase Refactoring Plan

### **Phase 1: Service Layer Foundation** (2-3 hours)

**Goal**: Create protocol-based services to replace mock data and prepare for backend integration.

**Tasks**:
1. Create `Core/Services/DatabaseService.swift`
   - Protocol-based design for testing
   - CRUD operations for all models
   - Initially in-memory, ready for Supabase/Core Data

2. Create `Core/Services/APIService.swift`
   - Network request handling
   - Auth token management
   - Error handling and retry logic

3. Create `Core/Services/AuthService.swift`
   - Phone-based authentication
   - Session management
   - Onboarding state tracking

4. Create `Core/Services/MessageService.swift`
   - iMessage AI integration preparation
   - Daily prompt scheduling
   - Response parsing and data extraction

5. Create `Core/Utils/MockDataProvider.swift`
   - Centralize all mock data from ViewModels
   - Enable easy switching between mock/real data

**Files to Create**:
- `Core/Services/DatabaseService.swift`
- `Core/Services/APIService.swift`
- `Core/Services/AuthService.swift`
- `Core/Services/MessageService.swift`
- `Core/Utils/MockDataProvider.swift`

---

### **Phase 2: Component Consolidation** (2-3 hours)

**Goal**: Reduce duplication by creating reusable components (~600-800 lines saved).

**Tasks**:
1. Create `Components/Input/GlassInputBar.swift`
   - Merge LiquidGlassSearchBar + NetworkInputBar (~300 lines saved)
   - Configurable: placeholder, icons, actions
   - Props: `style` (search/chat), `showCamera`, `showVoice`, `showPlus`

2. Create `Components/Cards/MaterialCard.swift`
   - Reusable wrapper for glass backgrounds
   - Props: `cornerRadius`, `borderColor`, `shadowIntensity`
   - Used by: DailyDigest, PersonalityTest, DataSource cards

3. Create `Components/Selection/SelectableGridItem.swift`
   - Consolidate all selection button patterns
   - Props: `icon`, `label`, `isSelected`, `columns`, `action`
   - (~150 lines saved)

4. Create `Components/Rows/InfoRow.swift`
   - Consolidate ContactInfoRow, PersonalityRow patterns
   - Props: `icon`, `label`, `value`, `accessory`, `showDivider`
   - (~100 lines saved)

**Files to Create**:
- `Components/Input/GlassInputBar.swift`
- `Components/Cards/MaterialCard.swift`
- `Components/Selection/SelectableGridItem.swift`
- `Components/Rows/InfoRow.swift`

---

### **Phase 3: Feature Extraction** (3-4 hours)

**Goal**: Reorganize into feature-based architecture with clear domain boundaries.

**Tasks**:
1. **Profile Feature** (`Features/Profile/`)
   - Split AmberIDView.swift (1,400+ lines → 8-10 files)
   - Extract components:
     - `Views/AmberIDView.swift` (main container, ~200 lines)
     - `Views/PersonalDetailsView.swift`
     - `Components/DailyTestCard.swift`
     - `Components/StoryCard.swift`
     - `Components/PersonalityTestCard.swift`
     - `Components/DataSourceRow.swift`

2. **Contacts Feature** (`Features/Contacts/`)
   - Move: ConnectionsView, ContactListView, AddContactView
   - Keep: ConnectionsViewModel in same folder

3. **Network Feature** (`Features/Network/`)
   - DiscoverView as main container
   - Extract visualizations:
     - `Components/FamilyNetworkView.swift`
     - `Components/AmberNetworkView.swift`
     - `Components/GeographyNetworkView.swift`
     - `Components/NetworkFilterSheet.swift`

4. **Journey Feature** (`Features/Journey/`)
   - Move existing Journey files
   - Extract step components from AddJourneyEntrySheet

5. **Chat Feature** (`Features/Chat/`)
   - Extract DigestChat components
   - Prepare for iMessage AI integration

**Files to Move/Split**: 15+ files reorganized

---

### **Phase 4: Onboarding Feature** (4-6 hours)

**Goal**: Create multi-step onboarding wizard to collect user data.

**Tasks**:
1. Create `Features/Onboarding/Models/OnboardingState.swift`
   - Track progress through steps
   - Steps: Welcome, Profile, Personality, Contacts, Integrations, Complete

2. Create `Features/Onboarding/ViewModels/OnboardingViewModel.swift`
   - Step progression logic
   - Input validation
   - Save to DatabaseService

3. Create Onboarding Views (7 views):
   - `OnboardingContainerView.swift` (step navigation)
   - `WelcomeView.swift` (intro + value prop)
   - `ProfileSetupView.swift` (name, phone, email, birthday, photo)
   - `PersonalityTestsView.swift` (MBTI, Enneagram, Zodiac)
   - `ContactsImportView.swift` (Apple Contacts import + manual add)
   - `IntegrationsView.swift` (app permissions: Health, Location, Calendar)
   - `CompletionView.swift` (celebration + CTA to app)

4. Create Onboarding Components:
   - `ProgressIndicator.swift` (step dots)
   - `FeatureCard.swift` (showcase features)
   - `PermissionCard.swift` (request permissions)

**Data Collected**:
- User profile: name, phone, email, birthday, photo
- Personality: MBTI (16 questions), Enneagram (36 questions), Zodiac
- Contacts: 3-5 key people from Apple Contacts or manual
- Permissions: Health, Location, Calendar
- Baseline health scores: 6-question survey

**Files to Create**: 12+ new onboarding files

---

### **Phase 5: iMessage AI Integration** (3-4 hours)

**Goal**: Enable daily text-based data collection through iMessage prompts.

**Tasks**:
1. Create `Features/Chat/Models/DailyPrompt.swift`
   - Prompt types: Emotion, Interaction, Energy, Sleep, Cycle, Health
   - Scheduling: morning, afternoon, evening
   - Response parsing logic

2. Create `Features/Chat/ViewModels/MessageAIViewModel.swift`
   - Send/receive message handling
   - Claude/ChatGPT API integration
   - Context awareness (user profile, recent interactions)
   - Response-to-data mapping

3. Create Message UI:
   - `MessageHistoryView.swift` (chat transcript)
   - `PromptConfigView.swift` (customize frequency/types)
   - Reuse: DigestChatBubble, GlassInputBar, MaterialCard

4. Update Services:
   - MessageService: Schedule prompts, send messages
   - APIService: Add Claude/ChatGPT endpoints
   - DatabaseService: Store message history and extracted data

**Daily Prompts**:
- Morning: "How are you feeling today?" → Emotion tags
- Afternoon: "Who did you interact with?" → Journey entry
- Evening: "Energy + Sleep rating" → Health data
- Weekly: "How was your week with [person]?" → Relationship health
- Cycle: "Did your cycle start?" → Phase tracking

**Files to Create**: 5+ new chat/message files

---

### **Phase 6: Root App Integration** (1-2 hours)

**Goal**: Wire up all features with proper routing and navigation.

**Tasks**:
1. Modify `AmberApp.swift`
   - Add onboarding state check
   - Route to OnboardingContainerView if not completed
   - Route to ContentView if completed

2. Update `ContentView.swift`
   - Keep 4-tab structure
   - Add iMessage AI access point (could be 5th tab, profile button, or floating action)

3. Update Navigation:
   - Deep link support for iMessage responses
   - Background message notification handling

**Files to Modify**: 2-3 files

---

### **Verification & Testing** (Throughout all phases)

**After Each Phase**:
1. Compile check - ensure all imports resolve
2. Run app - verify features still work
3. Test new components/features
4. Update mock data if needed

**End-to-End Flows**:
1. Fresh install → Onboarding → Add contact → Log interaction → View in Profile
2. Receive iMessage prompt → Respond → Data appears in Daily Digest
3. Complete personality test → View result in Personal Details

---

## 📊 Success Criteria

- ✅ Codebase reduced from ~4,800 to ~4,200 lines (consolidation savings)
- ✅ No file exceeds 400 lines (AmberIDView split into 8+ files)
- ✅ All duplicate code consolidated (600-800 lines saved)
- ✅ Feature-based organization with clear boundaries
- ✅ Service layer ready for backend integration
- ✅ Onboarding flow functional and data-collecting
- ✅ iMessage AI can send prompts and parse responses
- ✅ All existing features still work correctly
- ✅ Clear patterns for adding future features

---

## ⏱️ Timeline Estimate

- **Phase 1** (Services): 2-3 hours
- **Phase 2** (Components): 2-3 hours
- **Phase 3** (Feature extraction): 3-4 hours
- **Phase 4** (Onboarding): 4-6 hours
- **Phase 5** (iMessage AI): 3-4 hours
- **Phase 6** (Integration): 1-2 hours

**Total**: 15-22 hours of focused development

---

## 🔧 Getting Started

### Prerequisites
- Xcode 15.0+
- iOS 17.0+
- Swift 5.9+

### Opening the Project
```bash
cd AmberApp
open AmberApp.xcodeproj
```

### Running the App
1. Select iPhone 15 Pro simulator
2. Press `Cmd+R`
3. App launches to Contacts tab

### Navigation
- **Contacts tab**: Tap search bar, add contacts
- **Network tab**: Switch visualizations, filter sources, add context
- **Journey tab**: View timeline, add entries
- **Profile tab**: View/edit profile, complete daily check-in, take personality tests

---

## 💡 Development Tips

### Working with Mock Data
- All mock data is in ViewModels (will move to MockDataProvider in Phase 1)
- AmberUser.placeholder: Sample user profile
- ConnectionsViewModel: 7 sample contacts
- JourneyViewModel: 5 sample entries
- AmberIDViewModel: Stories, digests, integration states

### Common Patterns
- ViewModels use `@MainActor` for thread safety
- All colors use Color+Amber.swift extensions
- Glass effects: `.ultraThinMaterial`, `.regularMaterial`
- Navigation: NavigationStack with NavigationLink

### Testing Features
- Add contact: Tap + in Contacts, fill multi-step form
- Add journey: Tap + in Journey, complete 7-step wizard
- Daily check-in: Tap emotion tags, adjust sliders, save
- Network context: Type in bottom bar (only on Network tab)
- Search contacts: Type in search bar (only on Contacts tab)

---

## 📚 Additional Resources

- **README.md**: General overview of Amber platform
- **SETUP.md**: Technical setup instructions
- **Plan File**: `/Users/sagartiwari/.claude/plans/immutable-weaving-stallman.md`
  - Detailed architecture proposal
  - Data collection strategy
  - Implementation notes

---

## 🤝 Contractor Workflow

1. **Read this guide** to understand current state
2. **Review the plan file** for detailed technical specs
3. **Set up the project** using SETUP.md
4. **Start with Phase 1** and work sequentially
5. **Commit after each phase** with descriptive messages
6. **Test thoroughly** before moving to next phase
7. **Ask questions** if architecture decisions are unclear

---

**Last Updated**: February 11, 2026

Built with SwiftUI ❤️
