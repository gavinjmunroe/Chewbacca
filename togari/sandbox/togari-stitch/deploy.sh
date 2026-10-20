#!/usr/bin/env bash
# ============================================================================
# Togari Healthcare MCP Server — Cloud Run Deployment
# Usage: ./deploy.sh
# ============================================================================
set -euo pipefail

PROJECT_ID="midyear-glazing-485303-u3"
REGION="us-central1"
SERVICE="togari-healthcare-mcp"
SA_EMAIL="togari-mcp-sa@${PROJECT_ID}.iam.gserviceaccount.com"
IMAGE="us-central1-docker.pkg.dev/${PROJECT_ID}/togari-healthcare/${SERVICE}"

echo "=== Building container image ==="
gcloud builds submit \
  --project="${PROJECT_ID}" \
  --tag="${IMAGE}" \
  --timeout=600s

echo ""
echo "=== Deploying to Cloud Run ==="
# Firestore uses Application Default Credentials (ADC) — no API key needed.
# Required IAM: roles/datastore.user on ${SA_EMAIL} (run once):
#   gcloud projects add-iam-policy-binding ${PROJECT_ID} \
#     --member="serviceAccount:${SA_EMAIL}" --role="roles/datastore.user"
# To use a named Firestore database, add FIRESTORE_DATABASE_ID=<name> to --set-env-vars.
gcloud run deploy "${SERVICE}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --service-account="${SA_EMAIL}" \
  --platform=managed \
  --allow-unauthenticated \
  --min-instances=1 \
  --max-instances=10 \
  --memory=1Gi \
  --cpu=1 \
  --timeout=300 \
  --concurrency=80 \
  --port=8080 \
  --vpc-connector="togari-connector" \
  --vpc-egress=private-ranges-only \
  --set-env-vars="NODE_ENV=production,GCP_PROJECT_ID=${PROJECT_ID},GCS_BUCKET=togari-healthcare-files" \
  --set-secrets="\
ANTHROPIC_API_KEY=anthropic-api-key:latest,\
STRUCTIFY_API_KEY=structify-api-key:latest,\
REDIS_URL=redis-url:latest,\
AUTH0_DOMAIN=auth0-domain:latest,\
AUTH0_AUDIENCE=auth0-audience:latest,\
AUTH0_CLIENT_ID=auth0-client-id:latest,\
AUTH0_CLIENT_SECRET=auth0-client-secret:latest,\
CLAY_TABLE_ID=clay-table-id:latest,\
GCP_STORAGE_BUCKET=gcp-storage-bucket:latest,\
SENTRY_DSN=sentry-dsn:latest"

echo ""
echo "=== Deployment complete ==="
URL=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(status.url)")

echo "Service URL: ${URL}"
echo "Health check: ${URL}/health"
echo "Status: ${URL}/api/status"
