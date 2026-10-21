# App Store Submission Checklist for Amber iOS

This document tracks everything that must be done outside the Xcode project before submitting to App Store Review. Items in the checklist map to the gap-list issued during the 100-item audit.

## Apple Developer portal (manual)

- [ ] Enroll Caleb's Apple Developer account under an organization entity (required for multi-seat provisioning)
- [ ] Create App ID `com.amber.AmberApp` with capabilities: Push Notifications, HealthKit, Sign in with Apple, Associated Domains, App Groups (if shared containers are added later)
- [ ] Generate Apple Push Notification Auth Key (`.p8`) and save key ID plus team ID into CI secrets
- [ ] Provision Associated Domains for deep linking (`applinks:amberorg.ai`)
- [ ] Register `amber://` and `amberapp://` URL schemes under the app entitlement

## App Store Connect

- [ ] Create app record (bundle ID `com.amber.AmberApp`, primary language en-US, SKU `amber-ios`)
- [ ] Upload app icon 1024x1024, five required screenshot sizes (6.9", 6.7", 6.5", 5.5", 12.9" iPad)
- [ ] Fill in `fastlane/metadata/en-US/*.txt` contents into App Information and What's New
- [ ] Age rating questionnaire: adults (contacts, health, user-generated content)
- [ ] Category: Social Networking (primary), Lifestyle (secondary)
- [ ] Content rights: confirms the app does not contain third-party content
- [ ] Export compliance: `ITSAppUsesNonExemptEncryption = NO` (already set in Info.plist)
- [ ] App Privacy: map each data type to what Amber collects. Matches `PrivacyInfo.xcprivacy`
- [ ] Sign in Information (review account): create Privy + amber-id test account with mock graph
- [ ] Contact information: Caleb Newton, calebsnewton@gmail.com

## Required assets

- [ ] App icon set: 1024, 180, 167, 152, 120, 87, 80, 76, 60, 58, 40, 29, 20 pt at 1x/2x/3x. Place in `Assets.xcassets/AppIcon.appiconset`
- [ ] Launch screen storyboard or SwiftUI view
- [ ] Five screenshot captures per device size (Contacts, Amber answer, Profile, Notifications, Settings)
- [ ] Optional: preview video (15-30s)

## Privacy and legal

- [ ] Draft privacy policy and host at `amberorg.ai/privacy`
- [ ] Draft terms of service and host at `amberorg.ai/terms`
- [ ] Support page at `amberorg.ai/support` with contact email
- [ ] Confirm GDPR and CCPA data-subject request flows exist (tied to Settings > Data export + Delete account)
- [ ] Third-party SDK privacy manifests (Privy, Composio, Exa) colocated under their packages

## Build configurations

- [ ] Add Release xcconfig pointing `AmberAgentBaseURL` and `AmberIDBaseURL` at production Railway URLs
- [ ] Add Staging xcconfig pointing at staging Railway URLs
- [ ] Enable Bitcode: off (Apple dropped support)
- [ ] Enable App Sandbox if shipping macOS Catalyst target
- [ ] Set data protection class: `NSFileProtectionCompleteUntilFirstUserAuthentication` for the container
- [ ] Inject `WEBHOOK_SECRET`, `PRIVY_APP_ID`, `COMPOSIO_PROJECT_ID`, `EXA_API_KEY` via `.xcconfig` with a `.env.release` fallback. Never commit secrets.

## Release pipeline

- [ ] Run `bundle exec fastlane ios test` locally before every PR
- [ ] Set up GitHub Actions workflow that runs `fastlane test` on pull requests
- [ ] Set up Xcode Cloud or fastlane `beta` workflow triggered from `main`
- [ ] Store fastlane match certs in a private repo; never in `amber-ios-dev`
- [ ] Confirm `fastlane/Appfile` has correct team_id and itc_team_id before first build

## Pre-submission smoke test

- [ ] Run the simulator build against the live amber-agent Railway URL
- [ ] Sign in with a real Privy session, mint an identity, and ask "who should I talk to about X"
- [ ] Verify Composio OAuth flow end-to-end for GCal and Gmail
- [ ] Verify Exa people-search surfaces results and "Add" writes a contact
- [ ] Force-kill the app mid-stream and confirm no crash on relaunch
- [ ] Cycle airplane mode and confirm the offline banner appears
- [ ] Enable VoiceOver and sweep Contacts, Amber, and Profile. Every action must be announced.
- [ ] Bump font to XXL Dynamic Type and confirm no clipped text
- [ ] Run `xcrun simctl spawn booted log collect` to verify no noisy logs leak secrets

## After submission

- [ ] Wait up to 48h for first review
- [ ] If rejected, paste reviewer feedback verbatim into `REJECTION_HISTORY.md` and respond with a fix PR
- [ ] After approval, do not auto-release. Flip the release toggle manually after a 24h TestFlight gate
