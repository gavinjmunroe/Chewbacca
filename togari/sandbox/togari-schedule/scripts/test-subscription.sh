#!/bin/bash
# Test the subscription + clay-results notification flow end-to-end.
# Run from the repo root: bash scripts/test-subscription.sh

set -e

# Load .env — handles inline comments and values with spaces
if [ -f .env ]; then
  while IFS= read -r line; do
    # Skip blank lines and comment lines
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    # Strip inline comment (everything after first unquoted #)
    line="${line%%#*}"
    # Strip trailing whitespace
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" ]] && continue
    # Export KEY=VALUE
    export "$line" 2>/dev/null || true
  done < .env
else
  echo "ERROR: .env not found. Run from repo root."
  exit 1
fi

BASE="http://localhost:3000"
SECRET="${FRAMER_WEBHOOK_SECRET}"
CHANNEL="${ADMIN_SLACK_CHANNEL_ID}"

if [ -z "$CHANNEL" ]; then
  echo "ERROR: ADMIN_SLACK_CHANNEL_ID is not set in .env"
  exit 1
fi

# ─── Step 1: Create subscription ─────────────────────────────────────────────

echo ""
echo "=== Step 1: Creating subscription ==="

RESPONSE=$(curl -s -X POST "$BASE/webhooks/framer-subscription" \
  -H "Content-Type: application/json" \
  -H "x-framer-secret: $SECRET" \
  -d "{
    \"email\": \"maggie@bluemodernadvisory.com\",
    \"name\": \"Maggie\",
    \"plan\": \"starter\",
    \"monitor_frequency\": \"weekly\",
    \"job_titles\": [\"VP of Sales\", \"Head of RevOps\"],
    \"notification_channels\": [\"slack\"],
    \"slack_channel_id\": \"$CHANNEL\"
  }")

echo "$RESPONSE" | jq .

SUB_ID=$(echo "$RESPONSE" | jq -r '.subscription_id // empty')

if [ -z "$SUB_ID" ]; then
  echo "ERROR: No subscription_id in response. Check errors above."
  exit 1
fi

echo ""
echo "Subscription ID: $SUB_ID"
echo "Check your admin Slack channel for the setup alert."

# ─── Step 2: Wait for BigQuery streaming buffer ───────────────────────────────

echo ""
echo "=== Waiting 90 seconds for BigQuery streaming buffer to clear... ==="
echo "(This prevents an UPDATE error on the new subscription row)"
for i in $(seq 90 -10 10); do
  echo -ne "  $i seconds remaining...\r"
  sleep 10
done
echo ""

# ─── Step 3: Send mock Clay results ──────────────────────────────────────────

echo ""
echo "=== Step 2: Sending mock Clay results → triggers Slack notification ==="

CLAY_RESPONSE=$(curl -s -X POST "$BASE/webhooks/clay-results" \
  -H "Content-Type: application/json" \
  -H "x-clay-secret: ${CLAY_RESULTS_WEBHOOK_SECRET}" \
  -d "{
    \"subscription_id\": \"$SUB_ID\",
    \"results\": [
      {
        \"job_title\": \"VP of Sales\",
        \"company\": \"Acme SaaS\",
        \"company_domain\": \"acme.com\",
        \"job_url\": \"https://linkedin.com/jobs/view/123\",
        \"posted_date\": \"2026-04-16\",
        \"seniority\": \"director\",
        \"employment_type\": \"full_time\",
        \"location\": \"San Francisco, CA\",
        \"recruiter_name\": \"Jane Recruiter\",
        \"recruiter_title\": \"Head of Talent\",
        \"recruiter_email\": \"jane@acme.com\",
        \"recruiter_linkedin\": \"https://linkedin.com/in/jane\"
      },
      {
        \"job_title\": \"Head of RevOps\",
        \"company\": \"Beta Corp\",
        \"company_domain\": \"beta.com\",
        \"job_url\": \"https://linkedin.com/jobs/view/456\",
        \"seniority\": \"director\"
      }
    ]
  }")

echo "$CLAY_RESPONSE" | jq .

STATUS=$(echo "$CLAY_RESPONSE" | jq -r '.notification_status // empty')

echo ""
if [ "$STATUS" = "sent" ]; then
  echo "SUCCESS: Notification sent. Check Slack channel $CHANNEL."
elif [ "$STATUS" = "skipped" ]; then
  echo "SKIPPED: No matches met the threshold (check clay-results logic)."
else
  echo "WARNING: notification_status=$STATUS — check server logs for details."
fi

echo ""
echo "=== Done ==="
echo "Subscription ID: $SUB_ID"
echo "Verify in BigQuery:"
echo "  SELECT subscription_id, status, last_notification_at, total_matches_found"
echo "  FROM \`midyear-glazing-485303-u3.togari_data_lake.opportunity_subscriptions\`"
echo "  WHERE subscription_id = '$SUB_ID'"
