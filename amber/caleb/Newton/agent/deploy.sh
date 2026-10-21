#!/bin/bash
set -e
# amber-caleb Railway deploy — service already created, use for re-deploys
# Run: railway login && bash deploy.sh

echo "=== Deploying amber-caleb to Railway ==="

railway up --service amber-caleb-agent --detach

echo "=== Deployed! ==="
echo "Service: https://amber-caleb-agent-production.up.railway.app"
echo "Webhook: https://amber-caleb-agent-production.up.railway.app/webhook"
echo "Set the webhook URL above in your Loop Message dashboard."
