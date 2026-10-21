# Tizzy Mobile App

A React Native mobile application for the Tizzy platform, providing real-time device connectivity, biometric coaching, and session management capabilities.

## Overview

Tizzy Mobile is a cross-platform mobile application built with React Native and Expo that enables users to:
- Connect to Bluetooth Low Energy (BLE) devices for biometric data collection
- Access personalized coaching programs
- Track and manage training sessions
- Monitor real-time audio feedback and biometric indicators

## Features

### Authentication
- **User Registration & Login**: Secure authentication with JWT tokens
- **Persistent Sessions**: Automatic session management with AsyncStorage
- **Protected Routes**: Auth-gated navigation using Expo Router

### Device Management (Devices Tab)
- **BLE Device Discovery**: Scan and connect to Bluetooth Low Energy devices
- **Real-time Connection Status**: Monitor device connectivity
- **Device Pairing**: Seamless pairing workflow for biometric sensors
- **Connection Management**: Automatic reconnection and state persistence

### Coaching (Coaching Tab)
- **Interactive Coaching Programs**: Access guided training modules
- **Progress Tracking**: Monitor coaching milestones and achievements
- **Personalized Content**: Tailored coaching based on user profile

### Sessions (Sessions Tab)
- **Session History**: View past training sessions
- **Real-time Session Monitoring**: Live biometric data display during active sessions
- **Session Analytics**: Performance metrics and insights

### Additional Features
- **User Profile Management**: View and edit user settings
- **Audio Processing**: Real-time audio analysis with Meyda
- **Responsive UI**: Safe area handling for all device types
- **Gesture Support**: Native gesture handling with react-native-gesture-handler

## Technology Stack

### Core Framework
- **React Native**: 0.81.5
- **Expo**: ~54.0.33 (SDK 54)
- **Expo Router**: ^6.0.23 (File-based routing)
- **React**: 19.1.0
- **TypeScript**: ~5.9.2
- **New Architecture**: Enabled (Fabric & TurboModules)

### State Management & Data Fetching
- **Zustand**: ^5.0.11 (Lightweight state management)
- **React Query**: ^5.90.21 (@tanstack/react-query for server state)
- **AsyncStorage**: ^2.2.0 (Local persistence)

### Navigation & UI
- **Expo Router**: File-based routing with native navigation
- **React Native Screens**: ~4.16.0
- **React Native Safe Area Context**: ^5.6.2
- **React Native Gesture Handler**: ^2.30.0
- **React Native Reanimated**: ^4.2.1

### Device Integration
- **React Native BLE PLX**: ^3.5.0 (Bluetooth Low Energy)
- **Expo AV**: ^16.0.8 (Audio/Video playback)

### Audio & Signal Processing
- **Meyda**: ^5.6.3 (Audio feature extraction)
- **React Native Worklets**: ^0.7.3 (High-performance audio processing)

### Networking & Utilities
- **Axios**: ^1.13.5 (HTTP client)
- **JWT Decode**: ^4.0.0 (Token decoding)
- **Expo Linking**: ^8.0.11 (Deep linking)
- **Expo Constants**: ^18.0.13 (Environment configuration)

### Graphics
- **React Native SVG**: ^15.15.3 (Vector graphics support)

## Prerequisites

Before you begin, ensure you have the following installed:

### Required
- **Node.js**: 18.x or higher (LTS recommended)
- **npm**: 9.x or higher (comes with Node.js)
- **Expo CLI**: Installed globally or via npx
- **Git**: For version control

### iOS Development
- **macOS**: Required for iOS development
- **Xcode**: 14.x or higher (from Mac App Store)
- **CocoaPods**: 1.12.x or higher (`sudo gem install cocoapods`)
- **Xcode Command Line Tools**: `xcode-select --install`
- **iOS Simulator**: Installed via Xcode

### Android Development
- **Android Studio**: Latest stable version
- **Android SDK**: API Level 33 (Android 13) or higher
- **Java Development Kit (JDK)**: 17 or higher
- **Android Virtual Device (AVD)**: Configured emulator or physical device

## Setup Instructions

### 1. Clone the Repository
```bash
git clone <repository-url>
cd tizzy/mobile-app
```

### 2. Install Dependencies
```bash
# Install npm packages (use --legacy-peer-deps due to React 19)
npm install --legacy-peer-deps
```

### 3. iOS Setup
```bash
# Navigate to iOS directory
cd ios

# Install CocoaPods dependencies
pod install

# Return to mobile-app root
cd ..
```

### 4. Configuration
Create necessary configuration files if not present:
```bash
# Ensure app.json is properly configured
# Verify bundle identifiers match your Apple Developer account
```

## Running the Application

### Development Server
```bash
# Start the Expo development server
npm start
# or
npx expo start
```

### iOS
```bash
# Run on iOS simulator
npm run ios
# or
npx expo run:ios

# Run on specific simulator
npx expo run:ios --simulator="iPhone 15 Pro"

# Run on physical device
npx expo run:ios --device
```

### Android
```bash
# Run on Android emulator/device
npm run android
# or
npx expo run:android

# Run on specific device
npx expo run:android --device <device-id>
```

### Web (Development Only)
```bash
npm run web
# or
npx expo start --web
```

## Demo Mode

**Demo Mode** allows you to explore the app without needing a backend server or API connection. This is perfect for:
- Testing the UI and user experience
- Demonstrating app features
- Development when the backend is unavailable
- Quick prototyping and iteration

### Using Demo Mode

1. **Launch the app** on iOS simulator or Android emulator
2. On either the **Login** or **Signup** screen, tap the **"Try Demo Mode"** button
3. You'll be automatically logged in as a demo user with mock data
4. Explore all app screens and features

### Demo User Details

When using Demo Mode, you'll be logged in as:
- **User ID**: `demo-user-123`
- **Email**: `demo@tizzy.app`
- **Name**: `Demo User`
- **Auth Token**: Auto-generated demo token

### Features in Demo Mode

- ✅ **Full UI Navigation**: Access all screens and tabs
- ✅ **Mock Authentication**: Bypasses real API authentication
- ✅ **Local Storage**: Uses AsyncStorage for demo session persistence
- ⚠️ **No Real Data**: All data is mock/local only
- ⚠️ **No API Calls**: API requests will fail (expected behavior)
- ⚠️ **No BLE Connectivity**: Cannot connect to real devices

### Exiting Demo Mode

To exit Demo Mode:
1. Navigate to the **Profile** tab
2. Tap **Logout**
3. Your demo session will be cleared
4. You'll return to the login screen

### Implementation Details

Demo Mode works by:
- Storing a `demo_mode: true` flag in AsyncStorage
- Bypassing API authentication calls in `useAuth.loginDemo()`
- Creating mock user data locally
- Allowing normal app navigation without backend connectivity

**Note**: Demo Mode is intended for development and demonstration purposes only. For production use, connect to a real backend API.

## Project Structure

```
mobile-app/
├── app/                          # Expo Router file-based routing
│   ├── (auth)/                   # Auth group (not in tabs)
│   │   ├── login.tsx             # Login screen
│   │   ├── login-simple.tsx      # Simplified login
│   │   ├── signup.tsx            # Registration screen
│   │   └── _layout.tsx           # Auth layout
│   ├── (tabs)/                   # Main tab navigation
│   │   ├── index.tsx             # Home/Dashboard tab
│   │   ├── devices.tsx           # BLE device management
│   │   ├── coaching.tsx          # Coaching programs
│   │   ├── sessions.tsx          # Session history
│   │   ├── profile.tsx           # User profile
│   │   └── _layout.tsx           # Tab layout with icons
│   ├── coaching/                 # Coaching-related screens
│   ├── _layout.tsx               # Root layout
│   └── index.tsx                 # App entry redirect
├── src/
│   ├── api/                      # API client configuration
│   │   └── client.ts             # Axios instance with interceptors
│   ├── config/                   # App configuration
│   │   └── constants.ts          # Environment variables & constants
│   ├── features/                 # Feature modules (domain-driven)
│   │   ├── auth/                 # Authentication feature
│   │   │   ├── components/       # Auth-specific components
│   │   │   ├── hooks/            # Auth hooks (useLogin, useSignup)
│   │   │   └── types.ts          # Auth type definitions
│   │   ├── devices/              # BLE device feature
│   │   │   ├── components/       # Device UI components
│   │   │   ├── hooks/            # Device hooks (useBLE, useDevices)
│   │   │   └── types.ts          # Device type definitions
│   │   ├── coaching/             # Coaching feature
│   │   │   ├── components/       # Coaching components
│   │   │   ├── hooks/            # Coaching hooks
│   │   │   └── types.ts          # Coaching types
│   │   └── audio/                # Audio processing feature
│   │       ├── processors/       # Audio processing logic
│   │       └── types.ts          # Audio types
│   ├── services/                 # External service integrations
│   │   ├── ble/                  # Bluetooth service
│   │   └── audio/                # Audio service
│   ├── shared/                   # Shared resources
│   │   ├── components/           # Reusable UI components
│   │   ├── hooks/                # Shared custom hooks
│   │   ├── types/                # Common type definitions
│   │   ├── utils/                # Utility functions
│   │   ├── constants/            # Shared constants
│   │   └── contexts/             # React contexts
│   └── store/                    # Zustand stores
│       ├── authStore.ts          # Authentication state
│       ├── deviceStore.ts        # Device state
│       └── sessionStore.ts       # Session state
├── assets/                       # Static assets
│   ├── icon.png                  # App icon
│   ├── splash-icon.png           # Splash screen
│   └── adaptive-icon.png         # Android adaptive icon
├── ios/                          # Native iOS code
├── App.tsx                       # Legacy entry point
├── index.ts                      # App entry
├── app.json                      # Expo configuration
├── package.json                  # Dependencies
├── tsconfig.json                 # TypeScript configuration
└── metro.config.js               # Metro bundler config
```

## Development Guidelines

### Code Style
- **TypeScript**: Use strict mode, avoid `any` types
- **Naming Conventions**:
  - Components: PascalCase (`UserProfile.tsx`)
  - Hooks: camelCase with `use` prefix (`useAuth.ts`)
  - Files: kebab-case for non-components (`api-client.ts`)
- **Imports**: Use absolute imports where configured
- **Formatting**: Follow project ESLint/Prettier settings

### Component Development
- **Functional Components**: Use functional components with hooks
- **TypeScript Props**: Always type component props
- **Hooks**: Extract complex logic into custom hooks
- **Memoization**: Use `React.memo`, `useMemo`, `useCallback` for performance

### State Management
- **Local State**: Use `useState` for component-local state
- **Shared State**: Use Zustand stores for cross-component state
- **Server State**: Use React Query for API data (caching, refetching)
- **Form State**: Use controlled components or form libraries

### API Integration
- **React Query**: Use for all API calls
  ```typescript
  const { data, isLoading, error } = useQuery({
    queryKey: ['users', userId],
    queryFn: () => fetchUser(userId)
  });
  ```
- **Error Handling**: Always handle loading and error states
- **Authentication**: JWT tokens managed via authStore + AsyncStorage

### BLE Development
- **Permissions**: Always check and request BLE permissions
- **Connection Management**: Handle disconnections gracefully
- **State Updates**: Use device store for BLE state
- **Error Recovery**: Implement retry logic for failed connections

### Testing
- **Unit Tests**: Test utility functions and hooks
- **Integration Tests**: Test feature workflows
- **E2E Tests**: Test critical user paths
- **Manual Testing**: Test on real devices for BLE/audio features

### Performance
- **New Architecture**: Leverage Fabric and TurboModules
- **Lazy Loading**: Use dynamic imports for large screens
- **Image Optimization**: Use appropriate image formats and sizes
- **List Performance**: Use `FlashList` for large lists
- **Audio Worklets**: Offload audio processing to worklets

## Common Development Tasks

### Adding a New Screen
1. Create file in `app/` directory following Expo Router conventions
2. Add necessary navigation logic in `_layout.tsx`
3. Implement screen component with proper types
4. Add API hooks in relevant feature directory
5. Update types if needed

### Adding a New Feature
1. Create feature directory in `src/features/`
2. Add components, hooks, and types subdirectories
3. Implement feature logic with proper TypeScript types
4. Create Zustand store if needed for state management
5. Add API integration with React Query

### Updating Dependencies
```bash
# Check for outdated packages
npm outdated

# Update specific package
npm install <package>@latest --legacy-peer-deps

# Update CocoaPods (iOS)
cd ios && pod update && cd ..
```

## Environment Variables

Configuration is managed through `src/config/constants.ts`. Update this file for environment-specific settings:

```typescript
export const API_URL = __DEV__
  ? 'http://localhost:3000/api'
  : 'https://api.tizzy.app';
```

## Build & Deployment

### iOS Build
```bash
# Development build
npx expo run:ios

# Production build (requires EAS)
eas build --platform ios --profile production
```

### Android Build
```bash
# Development build
npx expo run:android

# Production build (requires EAS)
eas build --platform android --profile production
```

### App Store Submission
1. Update version in `app.json`
2. Create production build via EAS
3. Test build thoroughly
4. Submit via App Store Connect (iOS) or Play Console (Android)

## Troubleshooting

### Common Issues

#### Installation Errors
**Problem**: `npm install` fails with peer dependency errors
```bash
# Solution: Use legacy peer deps flag
npm install --legacy-peer-deps
```

**Problem**: CocoaPods installation fails
```bash
# Solution: Clean and reinstall
cd ios
rm -rf Pods Podfile.lock
pod install --repo-update
cd ..
```

#### Build Errors

**Problem**: "Could not find iPhone simulator"
```bash
# Solution: List available simulators
xcrun simctl list devices

# Open Xcode to download simulators
open -a Xcode
```

**Problem**: Android build fails with "SDK location not found"
```bash
# Solution: Create local.properties in android/
echo "sdk.dir=/Users/YOUR_USERNAME/Library/Android/sdk" > android/local.properties
```

**Problem**: Metro bundler issues
```bash
# Solution: Clear cache and restart
npx expo start --clear
# or
rm -rf node_modules/.cache
```

#### Runtime Errors

**Problem**: "Invariant Violation: Native module cannot be null"
```bash
# Solution: Rebuild native modules
cd ios && pod install && cd ..
npx expo run:ios
```

**Problem**: BLE not working on iOS
- Check `Info.plist` for Bluetooth permissions:
  - `NSBluetoothAlwaysUsageDescription`
  - `NSBluetoothPeripheralUsageDescription`
- Ensure Location permissions are granted (required for BLE scanning)

**Problem**: Audio processing not working
```bash
# Solution: Verify react-native-reanimated setup
# Check that babel plugin is configured in babel.config.js
# Restart Metro with cache clearing
npx expo start --clear
```

#### Development Server Issues

**Problem**: "Cannot connect to Metro"
```bash
# Solution: Check firewall settings, restart server
npx expo start --tunnel  # Use tunnel mode if local network fails
```

**Problem**: Changes not reflecting in app
```bash
# Solution: Force reload
# iOS: Cmd + R in simulator
# Android: R + R in terminal or Shake device
# Clear Metro cache: npx expo start --clear
```

### Platform-Specific Issues

#### iOS
- **Code Signing**: Ensure proper provisioning profiles in Xcode
- **Simulator vs Device**: Some features (BLE, camera) require physical devices
- **Xcode Version**: Keep Xcode updated for latest SDK support

#### Android
- **USB Debugging**: Enable Developer Options and USB debugging
- **ADB Issues**: Restart ADB: `adb kill-server && adb start-server`
- **Gradle**: Clear Gradle cache: `cd android && ./gradlew clean`

### Getting Help

1. **Check Logs**:
   ```bash
   # View Metro bundler logs
   npx expo start

   # View native logs
   # iOS: Xcode > Window > Devices and Simulators > Open Console
   # Android: adb logcat
   ```

2. **Expo Documentation**: https://docs.expo.dev
3. **React Native Docs**: https://reactnative.dev
4. **Community**: Expo Discord, Stack Overflow

### Debug Mode

Enable debug logging:
```typescript
// In src/config/constants.ts
export const DEBUG_MODE = __DEV__;

// In code
if (DEBUG_MODE) {
  console.log('Debug info:', data);
}
```

## Resources

- **Expo Documentation**: https://docs.expo.dev
- **React Native Docs**: https://reactnative.dev
- **Expo Router**: https://docs.expo.dev/router/introduction/
- **React Query**: https://tanstack.com/query/latest
- **Zustand**: https://github.com/pmndrs/zustand
- **BLE PLX**: https://github.com/dotintent/react-native-ble-plx
- **Meyda**: https://meyda.js.org

## License

[Add your license information here]

## Contributors

[Add contributor information here]

---

**Built with ❤️ for Tizzy**
