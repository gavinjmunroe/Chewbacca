# Amber Apple permissions

A local Expo iOS module, automatically discovered under `apps/mobile/modules` by Expo autolinking. JavaScript loads it with `requireOptionalNativeModule` so the current development client stays usable before a rebuild. Missing native code reports **Unavailable in this build**.

## Beta availability

The Sagar TestFlight beta does not integrate Health data. The native module returns
`unavailable` for health status and requests, and does not link HealthKit or declare
a HealthKit entitlement. The connected UI hides the permission-only setup surface.
Reintroduce HealthKit only with a functional data integration and complete Apple
privacy descriptions, provisioning, and device acceptance.

## Historical Health prototype configuration (not enabled in this beta)

Add `ios.entitlements["com.apple.developer.healthkit"] = true` and these `ios.infoPlist` strings to Expo config, keeping the existing Contacts usage string:

- `NSLocationWhenInUseUsageDescription`: Amber uses your location while the app is open to show nearby people when you choose to share.
- `NSPhotoLibraryUsageDescription`: Amber lets you choose photos to attach to your relationship memories.
- `NSHealthShareUsageDescription`: Amber reads the steps and workouts you choose to share for your daily activity context.
- `NSMotionUsageDescription`: Amber uses motion and fitness activity to add context to your day.

Run prebuild/pod install as appropriate for the existing native project, then rebuild the app. When native directories are checked in, apply the same strings/HealthKit entitlement to the native Info.plist/entitlements rather than assuming Expo config alone changes an Xcode build. HealthKit capability must also be allowed in the distribution provisioning profile. No background location, Health write access, or clinical health permissions are requested.

## Contract

`getStatus(kind)` is read only. `request(kind)` asks only for that selected permission. Supported kinds: location (when in use), photos (read/write authorization supporting limited selection), health (read steps/workouts), fitness (motion activity). Existing `expo-contacts` handles contacts and preserves limited access status. The component routes denied/restricted/already granted permissions to Settings and refreshes after the app becomes active.

Health returns `reviewed` when the authorization sheet completes; this is **not** a claim of read access. Apple intentionally does not disclose read grants. HealthKit errors remain errors. No photo, location, motion or health data is uploaded or ingested by this module. The zero-width motion query is used only to present the iOS authorization request; its returned records are discarded. Location manager never calls startUpdatingLocation.

Demo controls persist simulated choices in the demo session and never call this module or iOS permission prompts. Contacts import and source connection are separate actions.

## Required acceptance testing

On a rebuilt physical iPhone, test each control separately in not-requested/allowed/limited/denied states, relaunch and Settings return. In the simulator, Motion may be unavailable; Health has privacy-preserving status behavior even when all reads are denied. Do not label this full data integration: permission support precedes the photo/health/location enrichment ingestion flows.

## Primary references

- [Expo local modules/autolinking](https://docs.expo.dev/modules/autolinking/)
- [Expo module config](https://docs.expo.dev/modules/module-config/)
- [HealthKit authorization](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)
- [HealthKit cannot reveal read grants](https://developer.apple.com/documentation/healthkit/hkhealthstore/authorizationstatus(for:))
- [Configure HealthKit access](https://developer.apple.com/documentation/xcode/configuring-healthkit-access)
- [Core Motion authorization status](https://developer.apple.com/documentation/coremotion/cmmotionactivitymanager/authorizationstatus())
