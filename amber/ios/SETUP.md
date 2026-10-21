# Amber iOS App - Technical Setup Guide

This guide will help you set up the Amber iOS project in Xcode and get the app running on the simulator or a physical device.

---

## 📋 Prerequisites

### Required Software
- **macOS**: Ventura 13.0+ or Sonoma 14.0+
- **Xcode**: Version 15.0 or later
- **iOS Simulator**: iOS 17.0+ (included with Xcode)
- **Git**: For cloning the repository

### Recommended Tools
- **CocoaPods** or **Swift Package Manager**: For dependency management (future)
- **SF Symbols App**: For browsing system icons
- **Figma**: For viewing design files (if available)

---

## 🚀 Quick Start

### Option 1: Clone and Open (Recommended)

```bash
# Clone the repository
git clone https://github.com/sagartiw/amber.git
cd amber/AmberApp

# Open the Xcode project
open AmberApp.xcodeproj
```

Once Xcode opens:
1. Select **iPhone 15 Pro** simulator from the device menu
2. Press `Cmd+R` to build and run
3. Wait for the simulator to launch (first build may take 2-3 minutes)

### Option 2: Create New Project and Import Files

If you encounter project file issues, you can create a fresh Xcode project:

1. **Create New Project in Xcode**
   - Open Xcode → File → New → Project
   - Select **iOS → App**
   - Product Name: `Amber`
   - Organization Identifier: `com.amber`
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Storage: None
   - Testing: Uncheck all

2. **Delete Default Files**
   - Delete `ContentView.swift`
   - Delete `AmberApp.swift` (Xcode's default)

3. **Add Source Files**
   - Right-click the Amber folder → Add Files to "Amber"
   - Navigate to `/path/to/amber/AmberApp/AmberApp/`
   - Select all folders and files
   - Check "Copy items if needed"
   - Click Add

4. **Configure Build Settings** (see below)

---

## ⚙️ Build Configuration

### iOS Deployment Target
1. Click the **Amber project** in the navigator
2. Select the **Amber target**
3. Go to **General** tab
4. Set **Minimum Deployments → iOS** to `17.0`

### Bundle Identifier
- Should be: `com.amber.AmberApp` or `com.amber.Amber`
- Located in: **General → Identity → Bundle Identifier**

### Signing & Capabilities
1. Go to **Signing & Capabilities** tab
2. Select your **Team** (Apple Developer account)
3. Check **Automatically manage signing**

### Supported Orientations
1. Go to **General → Deployment Info**
2. Check only: **Portrait**
3. Uncheck: Landscape Left, Landscape Right, Upside Down

### Privacy Permissions (for future features)

Add these to `Info.plist` when implementing integrations:

```xml
<key>NSContactsUsageDescription</key>
<string>Amber needs access to your contacts to help you build your network.</string>

<key>NSHealthShareUsageDescription</key>
<string>Amber tracks your activity and sleep to provide health insights.</string>

<key>NSHealthUpdateUsageDescription</key>
<string>Amber updates your health data based on tracked activities.</string>

<key>NSLocationWhenInUseUsageDescription</key>
<string>Amber uses your location to show connections on the map.</string>

<key>NSPhotoLibraryUsageDescription</key>
<string>Amber needs access to your photos for your profile and shared content.</string>

<key>NSCameraUsageDescription</key>
<string>Amber uses the camera to capture photos for your profile.</string>

<key>NSCalendarsUsageDescription</key>
<string>Amber integrates with your calendar to suggest interactions.</string>
```

---

## 📂 Project Structure

```
AmberApp/
├── AmberApp.xcodeproj          # Xcode project file
├── AmberApp/                   # Main source code
│   ├── AmberApp.swift          # App entry point
│   ├── Extensions/
│   │   ├── Color+Amber.swift   # Color palette
│   │   └── Font+Amber.swift    # Typography
│   ├── Models/
│   │   ├── AmberUser.swift
│   │   ├── Connection.swift
│   │   ├── Insight.swift
│   │   ├── AmberStory.swift
│   │   ├── DailyDigest.swift
│   │   ├── HealthDimension.swift
│   │   └── PersonalityTypes.swift
│   ├── Components/
│   │   ├── LiquidGlassSearchBar.swift
│   │   ├── NetworkInputBar.swift
│   │   ├── ContactAvatar.swift
│   │   ├── HealthBadge.swift
│   │   └── CustomTabBar.swift
│   ├── Views/
│   │   ├── ConnectionsView.swift
│   │   ├── AddContactView.swift
│   │   ├── DiscoverView.swift
│   │   └── AmberIDView.swift
│   ├── ViewModels/
│   │   ├── ConnectionsViewModel.swift
│   │   ├── AmberIDViewModel.swift
│   │   └── DigestChatViewModel.swift
│   └── Assets.xcassets/        # App icons, images
├── QUICK_START.md              # Contractor guide
├── README.md                   # Project overview
└── SETUP.md                    # This file
```

---

## 🔧 Running the App

### Using iOS Simulator

1. In Xcode, select a simulator from the device menu:
   - **iPhone 15 Pro** (recommended)
   - iPhone 15
   - iPhone 14 Pro
   - Any iOS 17.0+ device

2. Press `Cmd+R` or click the Play button

3. Simulator will launch and install the app

### Using Physical Device

1. Connect iPhone/iPad via USB
2. Trust the computer if prompted on device
3. Select device from Xcode's device menu
4. Press `Cmd+R` to build and install
5. If you see "Untrusted Developer":
   - Go to Settings → General → VPN & Device Management
   - Trust your developer certificate

---

## 🧪 Testing Features

### Contacts Tab (Default Home)
- ✅ Tap search bar → type to filter contacts
- ✅ Tap voice icon → voice input (placeholder)
- ✅ Tap + button (top right) → opens add contact form
- ✅ Scroll through 7 mock contacts
- ✅ Tap contact row → opens detail view

### Network Tab
- ✅ Tap segment control → switch between Amber/Family/Friends views
- ✅ Tap filter icon → toggle data sources
- ✅ Tap context bar → add network context (bottom of screen)
- ✅ View interactive bubble chart (Amber Network)
- ✅ View hierarchical tree (Family Network)
- ✅ View geographic map with pins (Find My Friends)

### Profile Tab
- ✅ View identity card with avatar
- ✅ Scroll to Personal Details section
- ✅ View Daily Check-In card → tap emotion tags → adjust sliders → save
- ✅ View Enhance Your Profile → 6 personality test cards
- ✅ Scroll to Daily Digest cards (6 health dimensions)
- ✅ Tap digest card → opens AI chat interface
- ✅ View data source integration toggles

---

## 🐛 Troubleshooting

### Build Errors

**Error**: `No such module 'SwiftUI'`
- **Fix**: Make sure iOS Deployment Target is set to 17.0+

**Error**: `Cannot find 'Color' in scope`
- **Fix**: Make sure `Color+Amber.swift` is added to the target
- Check File Inspector → Target Membership → Amber is checked

**Error**: `Ambiguous reference to member` in components
- **Fix**: Clean build folder (`Cmd+Shift+K`), then rebuild

**Error**: Multiple definition errors
- **Fix**: Make sure you didn't add files twice
- Check each file only appears once in the navigator

### Simulator Issues

**White screen on launch**
- **Fix**: Make sure `AmberApp.swift` is set as the main entry point
- Check `@main` attribute exists on `AmberApp` struct

**Simulator won't open**
- **Fix**: Restart Xcode, or manually open Simulator app
- Try different simulator device

**App crashes on launch**
- **Fix**: Check console for error messages
- Make sure all mock data is valid
- Reset simulator: Device → Erase All Content and Settings

### Performance Issues

**Slow build times**
- Enable Parallelize Build: Build Settings → Build Options → Parallelize Build
- Close other apps to free up memory
- Use incremental builds (don't clean unless necessary)

**Laggy UI**
- Make sure Debug build configuration is selected
- Release builds are optimized but take longer to compile

---

## 🎨 Working with the Design System

### Colors

All colors are defined in `Color+Amber.swift`:

```swift
.amberBlue          // Primary accent color
.healthSpiritual    // Purple for spiritual dimension
.healthEmotional    // Red for emotional dimension
.healthPhysical     // Green for physical dimension
.healthIntellectual // Orange for intellectual dimension
.healthSocial       // Blue for social dimension
.healthFinancial    // Teal for financial dimension
```

### Typography

Fonts are defined in `Font+Amber.swift`:

```swift
.amberTitle         // Large titles
.amberHeadline      // Section headers
.amberBody          // Body text
.amberCaption       // Small labels
```

### Components

Reusable components in `Components/`:
- **LiquidGlassSearchBar**: Frosted glass search with blur
- **NetworkInputBar**: Context input for network tab
- **ContactAvatar**: Circular avatar with initials fallback
- **HealthBadge**: Colored pill badges for health dimensions
- **CustomTabBar**: Bottom navigation with 3 tabs

---

## 📦 Dependencies (Future)

Currently, the app has **zero external dependencies** and uses only native iOS frameworks:

- SwiftUI (UI framework)
- Combine (reactive programming)
- Foundation (data structures)
- UIKit (bridging for certain features)

### Planned Dependencies

These will be added in future phases:

```ruby
# Swift Package Manager (SPM)
dependencies: [
  .package(url: "https://github.com/supabase/supabase-swift", from: "2.0.0"),
  .package(url: "https://github.com/Alamofire/Alamofire", from: "5.8.0"),
  .package(url: "https://github.com/onevcat/Kingfisher", from: "7.10.0")
]
```

---

## 🔐 Environment Variables (Future)

When backend is integrated, create `.env` file:

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# Claude AI
CLAUDE_API_KEY=sk-ant-...

# ChatGPT
OPENAI_API_KEY=sk-...

# Environment
ENVIRONMENT=development
```

**Security**: Never commit `.env` to git. Add to `.gitignore`.

---

## 🧹 Clean Build

If you encounter persistent issues:

1. **Clean Build Folder**: `Cmd+Shift+K`
2. **Delete Derived Data**:
   ```bash
   rm -rf ~/Library/Developer/Xcode/DerivedData
   ```
3. **Restart Xcode**: `Cmd+Q` then reopen
4. **Rebuild**: `Cmd+B`

---

## 📱 Supported Devices

### Minimum Requirements
- iOS 17.0+
- iPhone 8 or later (screen size optimization)
- iPad support: Not yet optimized

### Recommended Devices
- iPhone 15 Pro / Pro Max
- iPhone 14 Pro / Pro Max
- iPhone 13 Pro / Pro Max

### Screen Size Support
- **Optimized**: 6.1" - 6.7" displays
- **Compatible**: 4.7" - 6.7" displays
- **iPad**: Not optimized, but functional

---

## 🚧 Development Workflow

### Making Changes

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make changes in Xcode

3. Test thoroughly:
   - Run on multiple simulators
   - Test all three tabs
   - Verify no console errors

4. Commit with descriptive message:
   ```bash
   git add -A
   git commit -m "Add feature: detailed description"
   ```

5. Push and create pull request:
   ```bash
   git push origin feature/your-feature-name
   ```

### Code Style

- Use **SwiftLint** for consistent formatting (to be added)
- Follow Apple's Swift API Design Guidelines
- Use `// MARK: -` to organize code sections
- Add comments for complex logic
- Keep files under 400 lines (split if larger)

---

## App Store Build and Signing

To archive and ship this app from your own machine/account:

1. Open `AmberApp/AmberApp.xcodeproj` in Xcode.
2. Select the `AmberApp` target.
3. In **Signing & Capabilities**:
   - Enable **Automatically manage signing**
   - Pick your Apple Developer **Team**
   - Ensure the bundle identifier is unique in your account (default: `com.amber.AmberApp`)
4. Product -> Archive, then upload via Organizer.

Command-line archive (same signing requirements):

```bash
xcodebuild \
  -project AmberApp/AmberApp.xcodeproj \
  -scheme AmberApp \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/AmberApp.xcarchive \
  -allowProvisioningUpdates \
  archive
```

### Testing

Currently using manual testing. Future additions:
- Unit tests for ViewModels
- UI tests for critical flows
- Snapshot tests for visual regression

---

## 💾 Mock Data

All mock data is currently in ViewModels:

- **AmberUser.placeholder**: Sample user profile
- **ConnectionsViewModel.loadMockData()**: 7 contacts
- **AmberIDViewModel.loadMockData()**: Stories and digests

To customize mock data:
1. Open respective ViewModel file
2. Edit the mock data arrays
3. Rebuild the app

**Note**: Mock data will be moved to `Core/Utils/MockDataProvider.swift` in Phase 1 refactoring.

---

## 🔄 Git Workflow

### Branches
- `main`: Production-ready code
- `develop`: Development branch (to be created)
- `feature/*`: Feature branches
- `fix/*`: Bug fix branches

### Commit Messages

Follow conventional commits:
```
feat: Add daily digest chat interface
fix: Resolve network input bar overlap
refactor: Extract DailyTestCard component
docs: Update SETUP.md with new instructions
```

---

## 📊 Performance Monitoring

### Build Time Optimization
- Use `xcodebuild` for measuring build times
- Enable **Build Timing Summary**: Xcode → Preferences → General → Show build timing summary

### Runtime Monitoring
- Use **Instruments** for profiling
- Monitor memory usage in Debug navigator
- Check for retain cycles with Memory Graph Debugger

---

## 🎯 Next Steps

After setting up the project:

1. **Read QUICK_START.md** for contractor roadmap
2. **Review README.md** for product overview
3. **Explore the codebase** and run the app
4. **Review the 6-phase refactoring plan** in QUICK_START.md
5. **Start with Phase 1** if contributing to refactoring

---

## 📚 Additional Resources

### Apple Documentation
- [SwiftUI Tutorials](https://developer.apple.com/tutorials/swiftui)
- [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [Swift Language Guide](https://docs.swift.org/swift-book/)

### Community Resources
- [Hacking with Swift](https://www.hackingwithswift.com)
- [Swift by Sundell](https://www.swiftbysundell.com)
- [Ray Wenderlich Tutorials](https://www.raywenderlich.com)

---

## 🤝 Getting Help

If you encounter issues:

1. **Check this guide** first
2. **Search Xcode console** for error messages
3. **Clean and rebuild** as described above
4. **Ask the team** in Slack or email
5. **Create an issue** on GitHub with:
   - Xcode version
   - macOS version
   - Error messages
   - Steps to reproduce

---

## ✅ Setup Checklist

Before starting development, verify:

- [ ] Xcode 15.0+ installed
- [ ] Project opens without errors
- [ ] iOS Deployment Target set to 17.0
- [ ] App builds successfully (`Cmd+B`)
- [ ] App runs on simulator (`Cmd+R`)
- [ ] All 3 tabs are accessible
- [ ] Search bar works on Contacts tab
- [ ] Network input bar shows on Network tab
- [ ] Daily Check-In saves emotion tags
- [ ] No console errors or warnings

---

**Last Updated**: February 11, 2026

Built with SwiftUI ❤️

Happy coding! 🚀
