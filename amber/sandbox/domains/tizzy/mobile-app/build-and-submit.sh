#!/bin/bash

# Tizzy TestFlight Build & Submit Script
# This script will build your app and submit it to TestFlight

echo "🚀 Building Tizzy for TestFlight..."
echo ""
echo "This will:"
echo "  1. Set up your Apple Developer credentials"
echo "  2. Create a production iOS build"
echo "  3. Submit to TestFlight"
echo ""
echo "You'll need:"
echo "  - Your Apple ID (developer account email)"
echo "  - Your Apple Team ID (from developer.apple.com/account)"
echo ""
read -p "Press Enter to continue..."

cd /Users/joelnewton/Desktop/2026-Code/tizzy/mobile-app

# Build for iOS
echo ""
echo "📦 Starting iOS build..."
eas build --platform ios --profile production

# Check if build succeeded
if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Build completed successfully!"
  echo ""
  read -p "Would you like to submit to TestFlight now? (y/n) " -n 1 -r
  echo ""

  if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "📤 Submitting to TestFlight..."
    eas submit --platform ios --latest

    if [ $? -eq 0 ]; then
      echo ""
      echo "🎉 Successfully submitted to TestFlight!"
      echo ""
      echo "Next steps:"
      echo "  1. Go to App Store Connect: https://appstoreconnect.apple.com"
      echo "  2. Select your app 'Tizzy'"
      echo "  3. Go to TestFlight tab"
      echo "  4. Add yourself as an internal tester"
      echo "  5. Install TestFlight on your iPhone"
      echo "  6. Accept the invite and start testing!"
    else
      echo ""
      echo "❌ Submission failed. You can submit manually later with:"
      echo "   eas submit --platform ios --latest"
    fi
  else
    echo ""
    echo "Skipped submission. You can submit later with:"
    echo "   eas submit --platform ios --latest"
  fi
else
  echo ""
  echo "❌ Build failed. Please check the errors above."
fi
