# Amber LinkedIn Extension: Manual Test Checklist
# Run through this once after deploying. Takes about 5 minutes.
# Nothing technical required beyond having Chrome open.

BACKEND_URL="https://medha-id-production.up.railway.app"
FRONTEND_URL="https://medha-frontend-production-5f4f.up.railway.app"

echo ""
echo "============================================================"
echo "  Amber LinkedIn: Extension Test Checklist"
echo "============================================================"
echo ""
echo "Step 1: Load the extension in Chrome"
echo "  Open Chrome"
echo "  Go to chrome://extensions"
echo "  Enable 'Developer mode' (top right toggle)"
echo "  Click 'Load unpacked'"
echo "  Select the amber-chrome/ folder (the repo root)"
echo "  Note the Extension ID shown (looks like: abcdefghijklmnopqrstuvwxyz123456)"
echo ""
read -p "Paste the Extension ID here: " EXTENSION_ID

echo ""
echo "Step 2: Set AMBER_LINKEDIN_EXTENSION_ID in Railway"
echo "  Go to Railway, medha-frontend service, Variables"
echo "  Add: AMBER_LINKEDIN_EXTENSION_ID=$EXTENSION_ID"
echo "  (medha-frontend is the one that calls chrome.runtime.sendMessage; medha-id only needs it if you want telemetry)"
echo ""
read -p "Done? Press Enter to continue..."

echo ""
echo "Step 3: Verify backend is reachable"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/health")
if [ "$STATUS" = "200" ]; then
  echo "  Backend reachable ($BACKEND_URL)"
else
  echo "  Backend returned HTTP $STATUS, check Railway deployment"
  echo "  URL: $BACKEND_URL/health"
fi

echo ""
echo "Step 4: Test extension ping from browser console"
echo "  Open $FRONTEND_URL in Chrome"
echo "  Open DevTools (F12), Console"
echo "  Paste this and press Enter:"
echo ""
echo "    chrome.runtime.sendMessage('$EXTENSION_ID', {action:'ping'}, r => console.log(r))"
echo ""
echo "  Expected output: {installed: true, version: '1.0.0'}"
echo "  If you see 'Could not establish connection', the extension is not loaded correctly"
echo ""
read -p "Did ping return {installed: true}? (y/n): " PING_OK

if [ "$PING_OK" != "y" ]; then
  echo "  Go back to chrome://extensions and make sure the extension is enabled"
  echo "  Check that the Extension ID matches what you pasted above"
fi

echo ""
echo "Step 5: Test set_auth_token from the frontend"
echo "  Still on $FRONTEND_URL, in DevTools Console, paste (replacing YOUR_JWT):"
echo ""
echo "    chrome.runtime.sendMessage('$EXTENSION_ID', {"
echo "      action: 'set_auth_token',"
echo "      authToken: 'YOUR_JWT',"
echo "      backendUrl: '$BACKEND_URL'"
echo "    }, r => console.log(r))"
echo ""
echo "  Expected: {success: true}"
echo ""
read -p "Press Enter to continue..."

echo ""
echo "Step 6: Test the sync flow"
echo "  Make sure you're logged into LinkedIn in Chrome"
echo "  Click the Amber LinkedIn icon in the toolbar"
echo "  Click 'Sync now'"
echo ""
echo "  Expected: green dot, 'Synced just now' subline, optional connection count"
echo ""
read -p "Did the sync succeed? (y/n): " SYNC_OK

echo ""
echo "Step 7: Test re-sync"
echo "  Click the extension icon again"
echo "  Click 'Re-sync now'"
echo "  Expected: same green-state result, lastSyncAt updates"
echo ""
read -p "Did re-sync succeed? (y/n): " RESYNC_OK

echo ""
echo "============================================================"
echo ""
if [ "$PING_OK" = "y" ] && [ "$SYNC_OK" = "y" ] && [ "$RESYNC_OK" = "y" ]; then
  echo "  All manual checks passed"
  echo "  Extension is working end-to-end"
  echo ""
  echo "  Next steps:"
  echo "  Publish to Chrome Web Store (run ./build.sh, upload the zip)"
  echo "  Add AMBER_LINKEDIN_STORE_URL to Railway env"
  echo "  Share the store listing link with users"
else
  echo "  Some checks failed, see notes above"
fi
echo ""
