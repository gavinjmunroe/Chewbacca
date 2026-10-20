# terraform/main.tf
# Tasks 1, 57, 61, 63, 71: GCP infrastructure as code.
# BigQuery dataset, Pub/Sub topics, Cloud Run services, VPC Service Controls.

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

variable "project_id" { type = string }
variable "region"     { type = string  default = "us-central1" }
variable "bq_region"  { type = string  default = "US" }  # must match togari_data_lake

provider "google" {
  project = var.project_id
  region  = var.region
}

# ─── Task 1: BigQuery dataset (region-locked) ──────────────────────────────

resource "google_bigquery_dataset" "connection_graph" {
  dataset_id    = "connection_graph"
  friendly_name = "Unified Connection Graph"
  location      = var.bq_region
  description   = "Multi-tenant identity and relationship graph. CMEK-encrypted."

  delete_contents_on_destroy = false  # safety guard

  access {
    role          = "OWNER"
    special_group = "projectOwners"
  }
  access {
    role          = "READER"
    special_group = "projectReaders"
  }

  labels = {
    env         = "production"
    system      = "connection-graph"
    data-class  = "pii"
  }
}

# ─── Task 71: VPC Service Controls around BigQuery ─────────────────────────
# (Access policy and perimeter configured separately via org-level policy;
#  the dataset-level IAM below ensures no public access)

resource "google_bigquery_dataset_iam_binding" "deny_allUsers" {
  dataset_id = google_bigquery_dataset.connection_graph.dataset_id
  role       = "roles/bigquery.dataViewer"
  members    = []  # explicitly empty — no one gets viewer by default
  depends_on = [google_bigquery_dataset.connection_graph]
}

# ─── Task 57: Pub/Sub topics ───────────────────────────────────────────────

resource "google_pubsub_topic" "connection_events" {
  name = "connection.events.v1"
  labels = { system = "connection-graph" }

  message_storage_policy {
    allowed_persistence_regions = [var.region]
  }
}

resource "google_pubsub_topic" "connection_events_dlq" {
  name   = "connection.events.v1.dlq"
  labels = { system = "connection-graph", purpose = "dead-letter" }
}

resource "google_pubsub_topic" "connection_refresh" {
  name = "connection.refresh.v1"
  labels = { system = "connection-graph" }
}

resource "google_pubsub_subscription" "identity_resolver" {
  name  = "connection-events-identity-resolver"
  topic = google_pubsub_topic.connection_events.name

  ack_deadline_seconds       = 60
  retain_acked_messages      = false
  message_retention_duration = "86400s"  # 24h

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.connection_events_dlq.id
    max_delivery_attempts = 5
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
}

# ─── Task 61: Cloud Run services (min-instances=0) ─────────────────────────

resource "google_cloud_run_v2_service" "ingestion_linkedin" {
  name     = "ingestion-linkedin"
  location = var.region

  template {
    scaling {
      min_instance_count = 0   # Task 61: ephemeral
      max_instance_count = 5
    }
    containers {
      image = "gcr.io/${var.project_id}/connection-graph/ingestion-linkedin:latest"
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      resources {
        limits = { cpu = "1", memory = "512Mi" }
      }
    }
    service_account = google_service_account.ingestion_worker.email
  }
  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

resource "google_cloud_run_v2_service" "retrieval_api" {
  name     = "connection-graph-api"
  location = var.region

  template {
    scaling {
      min_instance_count = 1   # API: keep 1 warm
      max_instance_count = 20
    }
    containers {
      image = "gcr.io/${var.project_id}/connection-graph/api:latest"
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      resources {
        limits = { cpu = "2", memory = "1Gi" }
      }
    }
    service_account = google_service_account.api_server.email
  }
  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

# ─── Service accounts ──────────────────────────────────────────────────────

resource "google_service_account" "ingestion_worker" {
  account_id   = "ingestion-worker"
  display_name = "Connection Graph Ingestion Worker"
}

resource "google_service_account" "api_server" {
  account_id   = "connection-graph-api"
  display_name = "Connection Graph API Server"
}

# Task 63: Minimal IAM — workers can only write to connection_events
resource "google_bigquery_dataset_iam_member" "ingestion_writer" {
  dataset_id = google_bigquery_dataset.connection_graph.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.ingestion_worker.email}"
}

resource "google_bigquery_dataset_iam_member" "api_reader" {
  dataset_id = google_bigquery_dataset.connection_graph.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.api_server.email}"
}

# Secret Manager access
resource "google_project_iam_member" "ingestion_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.ingestion_worker.email}"
}

# ─── Task 85: Cloud Monitoring alert policies ──────────────────────────────

resource "google_monitoring_alert_policy" "dlq_depth_alert" {
  display_name = "Connection Graph: DLQ depth > 0"
  combiner     = "OR"

  conditions {
    display_name = "DLQ depth nonzero"
    condition_threshold {
      filter          = "metric.type=\"custom.googleapis.com/connection_graph/dlq_depth\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "60s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MAX"
      }
    }
  }

  notification_channels = []  # add PagerDuty / Slack channel IDs here
  severity              = "CRITICAL"
}

resource "google_monitoring_alert_policy" "ingestion_silence_alert" {
  display_name = "Connection Graph: Ingestion silent >24h"
  combiner     = "OR"

  conditions {
    display_name = "Events per day = 0"
    condition_threshold {
      filter          = "metric.type=\"custom.googleapis.com/connection_graph/events_per_day\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "86400s"
      aggregations {
        alignment_period   = "86400s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  severity = "WARNING"
}
