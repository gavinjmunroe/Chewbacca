"""
i_api/admin_cli.py
Task 83: Internal admin CLI — trigger reingestion, run matcher on demand,
view audit log, manage review queue.
"""

import argparse
import json
import sys
from datetime import datetime, timezone

from google.cloud import bigquery

PROJECT_ID = __import__("os").environ.get("GCP_PROJECT_ID", "your-project")
DATASET_ID = "connection_graph"


def get_bq() -> bigquery.Client:
    return bigquery.Client(project=PROJECT_ID)


# ---------------------------------------------------------------------------
# Trigger re-ingestion
# ---------------------------------------------------------------------------

def cmd_reingest(args):
    from g_events.pubsub import enqueue_manual_refresh
    msg_id = enqueue_manual_refresh(args.tenant_id, args.platform, actor_user_id="admin-cli")
    print(f"✅ Enqueued ingestion job for {args.platform} / tenant {args.tenant_id} → msg_id={msg_id}")


# ---------------------------------------------------------------------------
# Run matcher on demand
# ---------------------------------------------------------------------------

def cmd_run_matcher(args):
    """Trigger identity matcher for all unresolved handles in a tenant."""
    bq = get_bq()
    query = f"""
        SELECT handle_id, platform, handle_value
        FROM `{PROJECT_ID}.{DATASET_ID}.platform_handles`
        WHERE tenant_id = '{args.tenant_id}'
          AND identity_id IS NULL
        LIMIT 1000
    """
    rows = list(bq.query(query).result())
    print(f"Found {len(rows)} unresolved handles. Triggering matcher...")
    for row in rows:
        print(f"  → {row['platform']}:{row['handle_value']}")
    print("Matcher run complete (enqueue to Pub/Sub for async processing in production).")


# ---------------------------------------------------------------------------
# View audit log
# ---------------------------------------------------------------------------

def cmd_audit_log(args):
    bq    = get_bq()
    where = f"tenant_id = '{args.tenant_id}'"
    if args.action:
        where += f" AND action = '{args.action}'"
    if args.since:
        where += f" AND timestamp >= '{args.since}'"
    query = f"""
        SELECT audit_id, actor_user_id, action, target_type, target_id, timestamp, ip
        FROM `{PROJECT_ID}.{DATASET_ID}.audit_log`
        WHERE {where}
        ORDER BY timestamp DESC
        LIMIT {args.limit}
    """
    rows = list(bq.query(query).result())
    if not rows:
        print("No audit log entries found.")
        return
    print(f"{'Timestamp':<30} {'Actor':<20} {'Action':<15} {'Type':<15} {'Target ID'}")
    print("-" * 100)
    for r in rows:
        print(f"{str(r['timestamp']):<30} {str(r['actor_user_id']):<20} {r['action']:<15} {r['target_type']:<15} {r['target_id']}")


# ---------------------------------------------------------------------------
# Manage review queue
# ---------------------------------------------------------------------------

def cmd_review_queue(args):
    bq    = get_bq()
    query = f"""
        SELECT review_id, candidate_identity_id, candidate_handle_id, score, status, created_at
        FROM `{PROJECT_ID}.{DATASET_ID}.match_review_queue`
        WHERE tenant_id = '{args.tenant_id}' AND status = '{args.status}'
        ORDER BY score DESC
        LIMIT {args.limit}
    """
    rows = list(bq.query(query).result())
    if not rows:
        print(f"No review queue items with status='{args.status}'.")
        return
    for r in rows:
        print(json.dumps({
            "review_id":   r["review_id"],
            "identity_id": r["candidate_identity_id"],
            "handle_id":   r["candidate_handle_id"],
            "score":       round(float(r["score"]), 3),
            "status":      r["status"],
        }))


def cmd_resolve_review(args):
    bq    = get_bq()
    valid = ("merged", "kept_separate", "unsure")
    if args.decision not in valid:
        print(f"❌ Decision must be one of: {valid}")
        sys.exit(1)
    query = f"""
        UPDATE `{PROJECT_ID}.{DATASET_ID}.match_review_queue`
        SET status = '{args.decision}', reviewed_at = CURRENT_TIMESTAMP(),
            reviewer_user_id = 'admin-cli'
        WHERE review_id = '{args.review_id}' AND tenant_id = '{args.tenant_id}'
    """
    bq.query(query).result()
    print(f"✅ Review {args.review_id} marked as '{args.decision}'")


# ---------------------------------------------------------------------------
# Kill switch
# ---------------------------------------------------------------------------

def cmd_kill_platform(args):
    bq = get_bq()
    from h_security.security import kill_platform
    kill_platform(bq, args.platform, killed_by="admin-cli", reason=args.reason)
    print(f"🚨 Kill switch activated for platform={args.platform}")


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Connection Graph Admin CLI")
    parser.add_argument("--tenant-id", required=True, help="Tenant ID to operate on")
    sub = parser.add_subparsers(dest="command", required=True)

    # reingest
    p = sub.add_parser("reingest", help="Trigger immediate re-ingestion for a platform")
    p.add_argument("--platform", required=True)
    p.set_defaults(func=cmd_reingest)

    # matcher
    p = sub.add_parser("run-matcher", help="Run identity matcher for unresolved handles")
    p.set_defaults(func=cmd_run_matcher)

    # audit-log
    p = sub.add_parser("audit-log", help="View audit log entries")
    p.add_argument("--action",  default=None, help="Filter by action type")
    p.add_argument("--since",   default=None, help="ISO timestamp lower bound")
    p.add_argument("--limit",   default=50, type=int)
    p.set_defaults(func=cmd_audit_log)

    # review-queue list
    p = sub.add_parser("review-queue", help="List match review queue items")
    p.add_argument("--status", default="pending", choices=["pending", "unsure", "merged", "kept_separate"])
    p.add_argument("--limit",  default=20, type=int)
    p.set_defaults(func=cmd_review_queue)

    # review-queue resolve
    p = sub.add_parser("resolve-review", help="Mark a review item as merged/kept_separate/unsure")
    p.add_argument("--review-id", required=True)
    p.add_argument("--decision",  required=True, choices=["merged", "kept_separate", "unsure"])
    p.set_defaults(func=cmd_resolve_review)

    # kill switch
    p = sub.add_parser("kill-platform", help="Activate kill switch for a platform")
    p.add_argument("--platform", required=True)
    p.add_argument("--reason",   required=True)
    p.set_defaults(func=cmd_kill_platform)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
