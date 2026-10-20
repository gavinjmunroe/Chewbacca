#!/usr/bin/env bash
# ─── Togari GTM — GCP Monitoring & Pub/Sub Setup ────────────────────────────
#
# Run this once per GCP project to create:
#   1. Cloud Pub/Sub topic + dead-letter topic
#   2. Cloud Monitoring dashboard (request volume, errors, latency)
#   3. Alert policies (error rate > 5%, latency p99 > 10s)
#
# Prerequisites:
#   - gcloud CLI authenticated with project owner/editor
#   - APIs enabled: pubsub, monitoring, cloudrun
#
# Usage:
#   chmod +x infra/monitoring-setup.sh
#   GCP_PROJECT=midyear-glazing-485303-u3 ./infra/monitoring-setup.sh
#
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

PROJECT="${GCP_PROJECT:-midyear-glazing-485303-u3}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="togari-gtm"
TOPIC="togari-events"
DLQ_TOPIC="togari-events-dlq"
ALERT_EMAIL="${ALERT_EMAIL:-sagar@bluemodernadvisory.com}"

echo "── Project: ${PROJECT}"
echo "── Region:  ${REGION}"
echo "── Service: ${SERVICE}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 1. Enable required APIs
# ═══════════════════════════════════════════════════════════════════════════════

echo "── Enabling APIs..."
gcloud services enable \
  pubsub.googleapis.com \
  monitoring.googleapis.com \
  run.googleapis.com \
  --project="${PROJECT}" \
  --quiet

# ═══════════════════════════════════════════════════════════════════════════════
# 2. Cloud Pub/Sub — event topic + dead-letter queue
# ═══════════════════════════════════════════════════════════════════════════════

echo "── Creating Pub/Sub topics..."

# Main events topic
if gcloud pubsub topics describe "${TOPIC}" --project="${PROJECT}" &>/dev/null; then
  echo "   Topic ${TOPIC} already exists"
else
  gcloud pubsub topics create "${TOPIC}" \
    --project="${PROJECT}" \
    --message-retention-duration="7d" \
    --labels="service=${SERVICE},env=production"
  echo "   Created topic: ${TOPIC}"
fi

# Dead-letter topic (for failed deliveries)
if gcloud pubsub topics describe "${DLQ_TOPIC}" --project="${PROJECT}" &>/dev/null; then
  echo "   DLQ topic ${DLQ_TOPIC} already exists"
else
  gcloud pubsub topics create "${DLQ_TOPIC}" \
    --project="${PROJECT}" \
    --message-retention-duration="14d" \
    --labels="service=${SERVICE},env=production,role=dlq"
  echo "   Created DLQ topic: ${DLQ_TOPIC}"
fi

# Default subscription (for debugging / manual consumption)
SUB="${TOPIC}-debug"
if gcloud pubsub subscriptions describe "${SUB}" --project="${PROJECT}" &>/dev/null; then
  echo "   Subscription ${SUB} already exists"
else
  gcloud pubsub subscriptions create "${SUB}" \
    --project="${PROJECT}" \
    --topic="${TOPIC}" \
    --ack-deadline=60 \
    --message-retention-duration="7d" \
    --expiration-period="never" \
    --dead-letter-topic="${DLQ_TOPIC}" \
    --max-delivery-attempts=5 \
    --labels="service=${SERVICE},env=production"
  echo "   Created subscription: ${SUB}"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 3. Cloud Monitoring — Notification channel
# ═══════════════════════════════════════════════════════════════════════════════

echo "── Setting up notification channel..."

# Create email notification channel (idempotent — checks for existing)
EXISTING_CHANNEL=$(gcloud alpha monitoring channels list \
  --project="${PROJECT}" \
  --filter="type=email AND labels.email_address=${ALERT_EMAIL}" \
  --format="value(name)" 2>/dev/null | head -1 || true)

if [ -n "${EXISTING_CHANNEL}" ]; then
  CHANNEL_ID="${EXISTING_CHANNEL}"
  echo "   Using existing channel: ${CHANNEL_ID}"
else
  CHANNEL_ID=$(gcloud alpha monitoring channels create \
    --project="${PROJECT}" \
    --display-name="Togari GTM Alerts — ${ALERT_EMAIL}" \
    --type=email \
    --channel-labels="email_address=${ALERT_EMAIL}" \
    --format="value(name)" 2>/dev/null || echo "")
  if [ -n "${CHANNEL_ID}" ]; then
    echo "   Created notification channel: ${CHANNEL_ID}"
  else
    echo "   WARNING: Could not create notification channel. Alerts will be created without email."
    CHANNEL_ID=""
  fi
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 4. Alert Policy — Error rate > 5%
# ═══════════════════════════════════════════════════════════════════════════════

echo "── Creating alert policies..."

CHANNEL_FLAG=""
if [ -n "${CHANNEL_ID}" ]; then
  CHANNEL_FLAG="--notification-channels=${CHANNEL_ID}"
fi

# Error rate alert — fires when >5% of Cloud Run requests return 5xx
cat > /tmp/togari-error-rate-alert.json <<ALERTJSON
{
  "displayName": "Togari GTM — Error Rate > 5%",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Cloud Run 5xx error rate > 5%",
      "conditionThreshold": {
        "filter": "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${SERVICE}\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code_class = \"5xx\"",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_RATE"
          }
        ],
        "denominatorFilter": "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${SERVICE}\" AND metric.type = \"run.googleapis.com/request_count\"",
        "denominatorAggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_RATE"
          }
        ],
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0.05,
        "duration": "300s",
        "trigger": {
          "count": 1
        }
      }
    }
  ],
  "alertStrategy": {
    "autoClose": "1800s"
  },
  "documentation": {
    "content": "The togari-gtm Cloud Run service is returning more than 5% 5xx errors over 5 minutes.\n\nCheck Cloud Run logs: https://console.cloud.google.com/run/detail/${REGION}/${SERVICE}/logs?project=${PROJECT}",
    "mimeType": "text/markdown"
  }
}
ALERTJSON

gcloud alpha monitoring policies create \
  --project="${PROJECT}" \
  --policy-from-file=/tmp/togari-error-rate-alert.json \
  ${CHANNEL_FLAG} \
  2>/dev/null && echo "   Created: Error Rate > 5% alert" || echo "   Error rate alert already exists or failed"

# ═══════════════════════════════════════════════════════════════════════════════
# 5. Alert Policy — Latency p99 > 10s
# ═══════════════════════════════════════════════════════════════════════════════

cat > /tmp/togari-latency-alert.json <<ALERTJSON
{
  "displayName": "Togari GTM — Latency p99 > 10s",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Cloud Run request latency p99 > 10s",
      "conditionThreshold": {
        "filter": "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${SERVICE}\" AND metric.type = \"run.googleapis.com/request_latencies\"",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_PERCENTILE_99"
          }
        ],
        "comparison": "COMPARISON_GT",
        "thresholdValue": 10000,
        "duration": "300s",
        "trigger": {
          "count": 1
        }
      }
    }
  ],
  "alertStrategy": {
    "autoClose": "1800s"
  },
  "documentation": {
    "content": "The togari-gtm Cloud Run service p99 latency exceeds 10 seconds.\n\nThis often indicates a slow external API (Exa, Clay, Anthropic) or BigQuery query.\n\nCheck the /health endpoint for provider status and Cloud Run logs for slow requests.",
    "mimeType": "text/markdown"
  }
}
ALERTJSON

gcloud alpha monitoring policies create \
  --project="${PROJECT}" \
  --policy-from-file=/tmp/togari-latency-alert.json \
  ${CHANNEL_FLAG} \
  2>/dev/null && echo "   Created: Latency p99 > 10s alert" || echo "   Latency alert already exists or failed"

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# 6. Cloud Monitoring Dashboard
# ═══════════════════════════════════════════════════════════════════════════════

echo "── Creating monitoring dashboard..."

cat > /tmp/togari-dashboard.json <<'DASHJSON'
{
  "displayName": "Togari GTM — Production",
  "gridLayout": {
    "columns": "2",
    "widgets": [
      {
        "title": "Request Volume (req/s)",
        "xyChart": {
          "dataSets": [
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"PLACEHOLDER_SERVICE\" AND metric.type = \"run.googleapis.com/request_count\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_RATE",
                    "crossSeriesReducer": "REDUCE_SUM"
                  }
                }
              },
              "plotType": "LINE"
            }
          ],
          "timeshiftDuration": "0s",
          "yAxis": { "label": "req/s", "scale": "LINEAR" }
        }
      },
      {
        "title": "Error Rate (5xx %)",
        "xyChart": {
          "dataSets": [
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"PLACEHOLDER_SERVICE\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code_class = \"5xx\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_RATE",
                    "crossSeriesReducer": "REDUCE_SUM"
                  }
                }
              },
              "plotType": "LINE"
            }
          ],
          "yAxis": { "label": "%", "scale": "LINEAR" }
        }
      },
      {
        "title": "Latency p50 / p95 / p99",
        "xyChart": {
          "dataSets": [
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"PLACEHOLDER_SERVICE\" AND metric.type = \"run.googleapis.com/request_latencies\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_PERCENTILE_50"
                  }
                }
              },
              "plotType": "LINE",
              "legendTemplate": "p50"
            },
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"PLACEHOLDER_SERVICE\" AND metric.type = \"run.googleapis.com/request_latencies\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_PERCENTILE_95"
                  }
                }
              },
              "plotType": "LINE",
              "legendTemplate": "p95"
            },
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"PLACEHOLDER_SERVICE\" AND metric.type = \"run.googleapis.com/request_latencies\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_PERCENTILE_99"
                  }
                }
              },
              "plotType": "LINE",
              "legendTemplate": "p99"
            }
          ],
          "yAxis": { "label": "ms", "scale": "LINEAR" }
        }
      },
      {
        "title": "Instance Count",
        "xyChart": {
          "dataSets": [
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"PLACEHOLDER_SERVICE\" AND metric.type = \"run.googleapis.com/container/instance_count\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_MEAN",
                    "crossSeriesReducer": "REDUCE_SUM"
                  }
                }
              },
              "plotType": "LINE"
            }
          ],
          "yAxis": { "label": "instances", "scale": "LINEAR" }
        }
      },
      {
        "title": "Pub/Sub Event Volume",
        "xyChart": {
          "dataSets": [
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type = \"pubsub_topic\" AND resource.labels.topic_id = \"PLACEHOLDER_TOPIC\" AND metric.type = \"pubsub.googleapis.com/topic/send_message_operation_count\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_RATE",
                    "crossSeriesReducer": "REDUCE_SUM"
                  }
                }
              },
              "plotType": "LINE"
            }
          ],
          "yAxis": { "label": "events/s", "scale": "LINEAR" }
        }
      },
      {
        "title": "Pub/Sub Unacked Messages",
        "xyChart": {
          "dataSets": [
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type = \"pubsub_subscription\" AND resource.labels.subscription_id = \"PLACEHOLDER_TOPIC-debug\" AND metric.type = \"pubsub.googleapis.com/subscription/num_undelivered_messages\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_MEAN"
                  }
                }
              },
              "plotType": "LINE"
            }
          ],
          "yAxis": { "label": "messages", "scale": "LINEAR" }
        }
      }
    ]
  }
}
DASHJSON

# Replace placeholders with actual values
sed -i.bak "s/PLACEHOLDER_SERVICE/${SERVICE}/g; s/PLACEHOLDER_TOPIC/${TOPIC}/g" /tmp/togari-dashboard.json
rm -f /tmp/togari-dashboard.json.bak

gcloud monitoring dashboards create \
  --project="${PROJECT}" \
  --config-from-file=/tmp/togari-dashboard.json \
  2>/dev/null && echo "   Created dashboard: Togari GTM — Production" || echo "   Dashboard already exists or failed"

# ═══════════════════════════════════════════════════════════════════════════════
# Cleanup
# ═══════════════════════════════════════════════════════════════════════════════

rm -f /tmp/togari-error-rate-alert.json /tmp/togari-latency-alert.json /tmp/togari-dashboard.json

echo ""
echo "── Setup complete!"
echo ""
echo "   Pub/Sub topic:    projects/${PROJECT}/topics/${TOPIC}"
echo "   DLQ topic:        projects/${PROJECT}/topics/${DLQ_TOPIC}"
echo "   Dashboard:        https://console.cloud.google.com/monitoring/dashboards?project=${PROJECT}"
echo "   Alerts:           https://console.cloud.google.com/monitoring/alerting?project=${PROJECT}"
echo ""
echo "   Next steps:"
echo "   1. Set SENTRY_DSN in your .env / Cloud Run env vars"
echo "   2. npm install @google-cloud/pubsub @sentry/node"
echo "   3. Deploy and verify events flow: gcloud pubsub subscriptions pull ${TOPIC}-debug --project=${PROJECT} --auto-ack --limit=5"
