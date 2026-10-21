# Expo EAS Build Support Ticket

## Issue Summary
EAS iOS builds consistently fail at "Install dependencies" phase with error:
```
Unknown error. See logs of the Install dependencies build phase for more information.
```

## Project Details
- **Project:** @calebsnewton/tizzy
- **Bundle ID:** com.calebsnewton.tizzy
- **Expo SDK:** 54.0.33
- **React Native:** 0.81.5
- **Node Version (EAS):** 20.18.0
- **Build Profile:** production
- **Resource Class:** m-medium

## Build History
- **Total Failed Builds:** 10+
- **All failures:** Same "Install dependencies" error
- **Latest Build ID:** 0511bfcf-d56c-433b-8b15-fb727d8f1356
- **Build URL:** https://expo.dev/accounts/calebsnewton/projects/tizzy/builds/0511bfcf-d56c-433b-8b15-fb727d8f1356

## Troubleshooting Steps Completed

### 1. Fixed Package Versions ✓
Ran `npx expo install --fix` to align all packages with SDK 54:
- ✓ `react-native-worklets@0.5.1` (was 0.7.3)
- ✓ `@sentry/react-native@~7.2.0` (was 8.0.0)
- ✓ `react-native-reanimated@~4.1.1` (was 4.2.1)
- ✓ `react-native-gesture-handler@~2.28.0` (was 2.30.0)
- ✓ `react-native-svg@15.12.1` (was 15.15.3)
- ✓ `@react-native-community/netinfo@11.4.1` (was 11.5.2)

### 2. Removed .easignore ✓
Deleted `.easignore` file that was interfering with prebuild process

### 3. Removed Environment Variable Overrides ✓
Removed LANG, LC_ALL, LANGUAGE from eas.json to use EAS defaults

### 4. Removed Build Hooks ✓
Deleted `eas-build-pre-install.sh` that was trying to modify build environment

### 5. Cleared Build Cache ✓
Used `--clear-cache` flag on all recent build attempts

### 6. Verified Configuration ✓
- eas.json: Valid, minimal configuration
- app.json: Valid SDK 54 configuration
- package.json: All dependencies now match SDK 54 requirements

## Local Build Success
- ✓ `npm install` completes successfully
- ✓ `LANG=en_US.UTF-8 npx expo prebuild` works locally
- ✓ `pod install` succeeds with UTF-8 locale set
- ✓ All 102 CocoaPods dependencies install correctly locally

## Known Issues Researched
1. **CocoaPods UTF-8 Bug:** https://github.com/CocoaPods/CocoaPods/issues/11891
   - Affects CocoaPods 1.11.0+
   - Requires UTF-8 locale (LANG=en_US.UTF-8)
   - Our Gemfile specifies CocoaPods ~> 1.15

2. **EAS Build Environment:** May not have UTF-8 locale set for Ruby/CocoaPods subprocess

## Configuration Files

### eas.json
```json
{
  "cli": {
    "version": ">= 14.1.1",
    "appVersionSource": "remote"
  },
  "build": {
    "production": {
      "node": "20.18.0",
      "ios": {
        "resourceClass": "m-medium",
        "simulator": false
      }
    }
  }
}
```

### Gemfile
```ruby
source 'https://rubygems.org'
gem 'cocoapods', '~> 1.15'
```

### package.json (key dependencies)
```json
{
  "expo": "~54.0.33",
  "react": "19.1.0",
  "react-native": "0.81.5",
  "react-native-worklets": "0.5.1",
  "@sentry/react-native": "~7.2.0",
  "expo-symbols": "~1.0.8"
}
```

## Questions for Expo Team

1. **Does EAS Build set UTF-8 locale for CocoaPods?**
   - If not, can we configure it?
   - Is there a known workaround?

2. **Are there known issues with Expo SDK 54 + specific packages?**
   - expo-symbols + CocoaPods?
   - Sentry SDK 7.2?
   - react-native-worklets 0.5.1?

3. **Can we access detailed install dependency logs?**
   - The error message is too generic
   - Need to see actual CocoaPods error output

4. **Should we try a different approach?**
   - Different resource class?
   - Custom build image?
   - Different Node version?

## Request
Please help us:
1. Identify the root cause of the "Install dependencies" failure
2. Provide a working configuration for our setup
3. Or advise if there's a known bug we should wait for

## Contact
- Expo Username: calebsnewton
- Project URL: https://expo.dev/accounts/calebsnewton/projects/tizzy
- Priority: High (blocking production deployment)
