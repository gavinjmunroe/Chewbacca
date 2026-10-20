"""
a_foundation/bigquery_setup.py
Tasks 1–10: Create dataset, all tables, partitioning, clustering.
Run once during initial deployment (idempotent — uses CREATE TABLE IF NOT EXISTS).
"""

import os
import logging
from google.cloud import bigquery
from google.cloud.bigquery import SchemaField, TimePartitioning, RangePartitioning

logger = logging.getLogger(__name__)

PROJECT_ID   = os.environ["GCP_PROJECT_ID"]
DATASET_ID   = "connection_graph"
LOCATION     = os.environ.get("BQ_REGION", "us-central1")  # must match togari_data_lake


def get_client() -> bigquery.Client:
    return bigquery.Client(project=PROJECT_ID)


def create_dataset(client: bigquery.Client) -> None:
    """Task 1: Create dataset, region-locked."""
    dataset_ref = bigquery.DatasetReference(PROJECT_ID, DATASET_ID)
    dataset = bigquery.Dataset(dataset_ref)
    dataset.location = LOCATION
    dataset.description = "Unified connection graph — multi-tenant identity & relationship store."
    client.create_dataset(dataset, exists_ok=True)
    logger.info("Dataset %s.%s ready in %s", PROJECT_ID, DATASET_ID, LOCATION)


TABLE_SCHEMAS: dict[str, list[SchemaField]] = {

    # Task 2
    "tenants": [
        SchemaField("tenant_id",   "STRING",    mode="REQUIRED"),
        SchemaField("name",        "STRING",    mode="REQUIRED"),
        SchemaField("created_at",  "TIMESTAMP", mode="REQUIRED"),
        SchemaField("status",      "STRING",    mode="REQUIRED"),
        SchemaField("kms_key_ref", "STRING",    mode="REQUIRED"),
    ],

    # Task 3
    "users": [
        SchemaField("user_id",    "STRING",    mode="REQUIRED"),
        SchemaField("tenant_id",  "STRING",    mode="REQUIRED"),
        SchemaField("email",      "STRING",    mode="REQUIRED"),
        SchemaField("role",       "STRING",    mode="REQUIRED"),
        SchemaField("created_at", "TIMESTAMP", mode="REQUIRED"),
    ],

    # Task 4
    "identities": [
        SchemaField("identity_id",        "STRING",    mode="REQUIRED"),
        SchemaField("tenant_id",          "STRING",    mode="REQUIRED"),
        SchemaField("display_name",       "STRING",    mode="NULLABLE"),
        SchemaField("normalized_name",    "STRING",    mode="NULLABLE"),
        SchemaField("primary_email_hash", "STRING",    mode="NULLABLE"),
        SchemaField("confidence_score",   "FLOAT64",   mode="NULLABLE"),
        SchemaField("relationship_type",  "STRING",    mode="NULLABLE"),
        SchemaField("do_not_merge",       "BOOL",      mode="REQUIRED"),
        SchemaField("is_tombstone",       "BOOL",      mode="REQUIRED"),
        SchemaField("created_at",         "TIMESTAMP", mode="REQUIRED"),
        SchemaField("updated_at",         "TIMESTAMP", mode="REQUIRED"),
    ],

    # Task 5
    "platform_handles": [
        SchemaField("handle_id",    "STRING",    mode="REQUIRED"),
        SchemaField("tenant_id",    "STRING",    mode="REQUIRED"),
        SchemaField("identity_id",  "STRING",    mode="REQUIRED"),
        SchemaField("platform",     "STRING",    mode="REQUIRED"),
        SchemaField("handle_value", "STRING",    mode="REQUIRED"),
        SchemaField("profile_url",  "STRING",    mode="NULLABLE"),
        SchemaField("raw_metadata", "JSON",      mode="NULLABLE"),
        SchemaField("last_seen_at", "TIMESTAMP", mode="NULLABLE"),
        SchemaField("status",       "STRING",    mode="REQUIRED"),
    ],

    # Task 6
    "connection_events": [
        SchemaField("event_id",          "STRING",    mode="REQUIRED"),
        SchemaField("tenant_id",         "STRING",    mode="REQUIRED"),
        SchemaField("handle_id",         "STRING",    mode="REQUIRED"),
        SchemaField("event_type",        "STRING",    mode="REQUIRED"),
        SchemaField("event_timestamp",   "TIMESTAMP", mode="REQUIRED"),
        SchemaField("source",            "STRING",    mode="REQUIRED"),
        SchemaField("idempotency_key",   "STRING",    mode="REQUIRED"),
        SchemaField("payload",           "JSON",      mode="NULLABLE"),
    ],

    # Task 7
    "connections": [
        SchemaField("connection_id",      "STRING",    mode="REQUIRED"),
        SchemaField("tenant_id",          "STRING",    mode="REQUIRED"),
        SchemaField("identity_id",        "STRING",    mode="REQUIRED"),
        SchemaField("channel",            "STRING",    mode="REQUIRED"),
        SchemaField("status",             "STRING",    mode="REQUIRED"),
        SchemaField("first_connected_at", "TIMESTAMP", mode="NULLABLE"),
        SchemaField("last_signal_at",     "TIMESTAMP", mode="NULLABLE"),
        SchemaField("signal_count",       "INT64",     mode="REQUIRED"),
    ],

    # Task 8
    "match_review_queue": [
        SchemaField("review_id",             "STRING",    mode="REQUIRED"),
        SchemaField("tenant_id",             "STRING",    mode="REQUIRED"),
        SchemaField("candidate_identity_id", "STRING",    mode="REQUIRED"),
        SchemaField("candidate_handle_id",   "STRING",    mode="REQUIRED"),
        SchemaField("score",                 "FLOAT64",   mode="REQUIRED"),
        SchemaField("signals",               "JSON",      mode="NULLABLE"),
        SchemaField("status",                "STRING",    mode="REQUIRED"),
        SchemaField("reviewer_user_id",      "STRING",    mode="NULLABLE"),
        SchemaField("reviewed_at",           "TIMESTAMP", mode="NULLABLE"),
        SchemaField("created_at",            "TIMESTAMP", mode="REQUIRED"),
    ],

    # Task 9
    "audit_log": [
        SchemaField("audit_id",      "STRING",    mode="REQUIRED"),
        SchemaField("tenant_id",     "STRING",    mode="REQUIRED"),
        SchemaField("actor_user_id", "STRING",    mode="REQUIRED"),
        SchemaField("action",        "STRING",    mode="REQUIRED"),
        SchemaField("target_type",   "STRING",    mode="REQUIRED"),
        SchemaField("target_id",     "STRING",    mode="REQUIRED"),
        SchemaField("timestamp",     "TIMESTAMP", mode="REQUIRED"),
        SchemaField("ip",            "STRING",    mode="NULLABLE"),
        SchemaField("request_id",    "STRING",    mode="NULLABLE"),
    ],

    # Task 10 extras
    "do_not_merge_overrides": [
        SchemaField("override_id",   "STRING",    mode="REQUIRED"),
        SchemaField("tenant_id",     "STRING",    mode="REQUIRED"),
        SchemaField("identity_id_a", "STRING",    mode="REQUIRED"),
        SchemaField("identity_id_b", "STRING",    mode="REQUIRED"),
        SchemaField("set_by_user",   "STRING",    mode="REQUIRED"),
        SchemaField("created_at",    "TIMESTAMP", mode="REQUIRED"),
    ],

    "inclusion_rules": [
        SchemaField("rule_id",    "STRING",    mode="REQUIRED"),
        SchemaField("tenant_id",  "STRING",    mode="REQUIRED"),
        SchemaField("platform",   "STRING",    mode="REQUIRED"),
        SchemaField("rule_type",  "STRING",    mode="REQUIRED"),
        SchemaField("threshold",  "INT64",     mode="REQUIRED"),
        SchemaField("created_at", "TIMESTAMP", mode="REQUIRED"),
        SchemaField("updated_at", "TIMESTAMP", mode="REQUIRED"),
    ],

    "platform_kill_switches": [
        SchemaField("platform",   "STRING",    mode="REQUIRED"),
        SchemaField("tenant_id",  "STRING",    mode="NULLABLE"),
        SchemaField("is_killed",  "BOOL",      mode="REQUIRED"),
        SchemaField("killed_at",  "TIMESTAMP", mode="NULLABLE"),
        SchemaField("killed_by",  "STRING",    mode="NULLABLE"),
        SchemaField("reason",     "STRING",    mode="NULLABLE"),
        SchemaField("updated_at", "TIMESTAMP", mode="REQUIRED"),
    ],
}

# Task 10: partitioning + clustering config
TABLE_CONFIG: dict[str, dict] = {
    "users":              {"partition_field": "created_at",    "cluster_fields": ["tenant_id"]},
    "identities":         {"partition_field": "created_at",    "cluster_fields": ["tenant_id"]},
    "platform_handles":   {"partition_field": "last_seen_at",  "cluster_fields": ["tenant_id", "platform"]},
    "connection_events":  {"partition_field": "event_timestamp","cluster_fields": ["tenant_id", "source"]},
    "connections":        {"partition_field": "first_connected_at", "cluster_fields": ["tenant_id", "channel"]},
    "match_review_queue": {"partition_field": "created_at",    "cluster_fields": ["tenant_id", "status"]},
    "audit_log":          {"partition_field": "timestamp",     "cluster_fields": ["tenant_id", "action"]},
}


def create_table(client: bigquery.Client, table_name: str) -> None:
    table_id = f"{PROJECT_ID}.{DATASET_ID}.{table_name}"
    schema   = TABLE_SCHEMAS[table_name]
    table    = bigquery.Table(table_id, schema=schema)

    cfg = TABLE_CONFIG.get(table_name, {})
    if pf := cfg.get("partition_field"):
        table.time_partitioning = TimePartitioning(field=pf)
    if cf := cfg.get("cluster_fields"):
        table.clustering_fields = cf

    client.create_table(table, exists_ok=True)
    logger.info("Table %s ready", table_id)


def bootstrap_all() -> None:
    """Idempotent: run on every deploy; safe to re-run."""
    client = get_client()
    create_dataset(client)
    for table_name in TABLE_SCHEMAS:
        create_table(client, table_name)
    logger.info("All tables bootstrapped successfully.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    bootstrap_all()
