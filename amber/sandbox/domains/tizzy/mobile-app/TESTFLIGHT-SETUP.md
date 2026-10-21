# TestFlight Setup Guide for Tizzy

Your app is almost ready for TestFlight! I've configured everything except the Apple Developer credentials (which require your Apple ID and password).

## ✅ What's Already Done

- ✅ EAS project created and linked
- ✅ Build configuration set up ([eas.json](eas.json))
- ✅ App Store encryption compliance configured
- ✅ Bundle identifier set: `com.calebsnewton.tizzy`
- ✅ Project linked to Expo: https://expo.dev/accounts/calebsnewton/projects/tizzy

## 🚀 Next Step: Run the Build

### Option 1: Automated Script (Easiest)

Open Terminal and run:

```bash
cd /Users/joelnewton/Desktop/2026-Code/tizzy/mobile-app
./build-and-submit.sh
```

This script will:
1. Guide you through Apple Developer credential setup
2. Build your iOS app on Expo's servers
3. Optionally submit to TestFlight

### Option 2: Manual Commands

If you prefer to run commands manually:

```bash
# Navigate to project
cd /Users/joelnewton/Desktop/2026-Code/tizzy/mobile-app

# Build for production
eas build --platform ios --profile production

# After build completes, submit to TestFlight
eas submit --platform ios --latest
```

## 📋 What You'll Need

During the build process, EAS will ask for:

1. **Apple ID** - Your Apple Developer account email
2. **Apple Team ID** - Found at [developer.apple.com/account](https://developer.apple.com/account) under "Membership"
3. **App-specific password** (optional) - For automated submissions

### Finding Your Apple Team ID:

1. Go to https://developer.apple.com/account
2. Sign in with your Apple Developer account
3. Look for "Team ID" under the Membership section
4. It's a 10-character code (like `AB12CD34EF`)

## 🔐 Credentials Setup

The first time you build, EAS will:
- Ask for your Apple ID
- Help you create/manage signing certificates
- Set up provisioning profiles
- Store credentials securely on Expo's servers

All subsequent builds will use these stored credentials automatically.

## ⏱️ Build Time

- Initial build: 15-30 minutes (Expo builds your app in the cloud)
- You can close the terminal - you'll get an email when it's done
- Or track progress at: https://expo.dev/accounts/calebsnewton/projects/tizzy/builds

## 📱 After Build Completes

1. **TestFlight submission** happens automatically if you used the script
2. Go to [App Store Connect](https://appstoreconnect.apple.com)
3. Navigate to: My Apps → Tizzy → TestFlight
4. Add yourself as an internal tester
5. Install TestFlight app on your iPhone
6. Accept the invite and test your app!

## 🆘 Troubleshooting

### "No app record found"
- You'll need to create an app record in App Store Connect first
- Go to: https://appstoreconnect.apple.com → My Apps → + (New App)
- Use bundle ID: `com.calebsnewton.tizzy`
- Name: Tizzy
- Language: English

### "Invalid credentials"
- Make sure you're using your Apple Developer account (not just regular Apple ID)
- You may need an app-specific password: https://appleid.apple.com

### Build taking too long?
- Check status: `eas build:list`
- View logs: `eas build:view --latest`
- Builds run on Expo servers, so you can close Terminal safely

## 📚 Useful Commands

```bash
# Check build status
eas build:list

# View latest build logs
eas build:view --latest

# Check project info
eas project:info

# Manage credentials
eas credentials
```

## 🎉 You're All Set!

Just run the build script and follow the prompts. The entire process is automated after you provide your Apple Developer credentials.

Questions? Check out:
- [EAS Build docs](https://docs.expo.dev/build/introduction/)
- [TestFlight docs](https://docs.expo.dev/submit/introduction/)
- [Expo project page](https://expo.dev/accounts/calebsnewton/projects/tizzy)
