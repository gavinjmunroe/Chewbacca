# Unified Connection Graph

A multi-tenant system that maintains a live, de-duplicated graph of your connections across LinkedIn, Instagram, X/Twitter, Email, GitHub, Reddit, YouTube, Substack, and Stack Overflow — stored in BigQuery on GCP, with event-driven ingestion via Cloud Run + Pub/Sub.

> **The network IS the Do-Not-Contact list.** If someone is in your graph, you're already connected — no separate DNC system needed.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Connection Graph System                              │
│                                                                              │
│  Platform APIs              Ingestion Layer           Storage Layer           │
│  ─────────────              ───────────────           ─────────────           │
│  LinkedIn API  ──────────►  Cloud Run Worker  ──────► connection_events      │
│  Instagram API ──────────►  Cloud Run Worker  ──────► (append-only BQ)       │
│  Twitter API   ──────────►  Cloud Run Worker  ──────►       │                 │
│  Gmail OAuth   ──────────►  Cloud Run Worker  ──────►       │                 │
│  GitHub API    ──────────►  Cloud Run Worker  ──────►       │                 │
│  Reddit API    ──────────►  Cloud Run Worker  ──────►       │                 │
│  YouTube API   ──────────►  Cloud Run Worker  ──────►       │                 │
│  Substack CSV  ──────────►  Cloud Run Worker  ──────►       │                 │
│  Stack Overflow──────────►  Cloud Run Worker  ──────►       │                 │
│                                                              │                 │
│                           Pub/Sub Topic                      │                 │
│                           connection.events.v1 ◄────────────┘                 │
│                                │                                              │
│                    ┌───────────┴──────────────┐                               │
│                    ▼           ▼              ▼                               │
│             Identity      Classifier      Audit Logger                        │
│             Resolver      (E→F)           (H)                                 │
│             (B)                                                                │
│                    │                                                          │
│                    ▼                                                          │
│             identities + connections tables (BigQuery)                        │
│                    │                                                          │
│                    ▼                                                          │
│             Retrieval API (FastAPI / Cloud Run)                               │
│             GET /identities  GET /connections  GET /network/check             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Task Coverage Index

| Task | File | Description |
|------|------|-------------|
| 1–10 | `a_foundation/` | BigQuery dataset + all table schemas |
| 11 | `b_identity/resolver.py` | Name normalization |
| 12 | `b_identity/resolver.py` | pHash profile photo matching |
| 13–14 | `b_identity/resolver.py` | Probabilistic matcher + thresholds |
| 15–16 | `b_identity/resolver.py` | Merge + unmerge functions |
| 17 | `tests/test_all.py` | Name-only never auto-merges (enforced by test) |
| 18 | `b_identity/resolver.py` | Enqueue to review queue |
| 19 | `b_identity/resolver.py` | Nightly rescore of unsure items |
| 20 | `b_identity/resolver.py` | Backfill matcher (sandbox staging) |
| 21–22 | `b_identity/resolver.py` | do_not_merge override + audit logging |
| 23–24 | `c_threshold/inclusion.py` | Per-channel inclusion rules |
| 25–27 | `c_threshold/inclusion.py` | Promotion job, quarantine, bulk dismiss |
| 28–30 | `c_threshold/inclusion.py` | Outbound reply counting, OOO filter, transactional exclusion |
| 31–34 | `d_integrations/adapters.py` | LinkedIn, Instagram, Twitter, Email adapters |
| 35 | `d_integrations/adapters.py` | Migrated to connection_events model |
| 36 | `d_integrations/base.py` | Idempotency keys on every event write |
| 37 | `d_integrations/base.py` | Token-bucket rate limiter (Redis/Memorystore) |
| 38 | `d_integrations/base.py` | Per-platform health check |
| 39 | `d_integrations/base.py` | Secret Manager token retrieval |
| 40 | `d_integrations/base.py` | Reconnect flow for expired tokens |
| 41–46 | `e_classifier/classifier.py` | Relationship-type classifier |
| 47–52 | `f_platforms/adapters.py` | GitHub, Reddit, YouTube, Substack, Stack Overflow one-pagers + adapters |
| 53–55 | `f_platforms/adapters.py` | Cloud Run ingestion services, matcher integration |
| 56 | `tests/test_all.py` | Unit tests with realistic fixtures |
| 57 | `g_events/pubsub.py` | Pub/Sub topic creation |
| 58–59 | `g_events/pubsub.py` | Subscriber dispatch + idempotency |
| 60 | `g_events/pubsub.py` | Dead-letter topic + DLQ alert |
| 61 | `terraform/main.tf` | Cloud Run min-instances=0 |
| 62 | `g_events/pubsub.py` | Manual refresh endpoint |
| 63 | `h_security/security.py` | Tenant isolation (query + app layer) |
| 64 | `h_security/security.py` | KMS-CMEK field encryption |
| 65 | `h_security/security.py` | Tenant-scoped email hashing |
| 66 | `h_security/security.py` | Audit on read |
| 67 | `docs/tos_compliance_matrix.md` | GDPR/CCPA legal basis documentation |
| 68 | `h_security/security.py` | Per-identity delete-me (GDPR erasure) |
| 69 | `h_security/security.py` | Per-tenant export (DSAR) |
| 70 | `h_security/security.py` | Token redaction from error traces |
| 71 | `terraform/main.tf` | VPC Service Controls (BigQuery isolation) |
| 72 | `docs/developer_guide.md` | IDOR pen-test checklist |
| 73 | `docs/tos_compliance_matrix.md` | ToS compliance matrix |
| 74 | `h_security/security.py` | Per-platform kill switch |
| 75 | `h_security/security.py` | Avatar malware scan + no SVG/HTML execution |
| 76 | `h_security/security.py` | No outbound calls to contacts (architectural rule) |
| 77 | `h_security/security.py` | Internal UI data-use banner |
| 78 | `i_api/app.py` | GET /identities, /identities/{id}, /connections |
| 79 | `i_api/app.py` | Auth required, tenant-scoped, audit-logged |
| 80 | `i_api/app.py` | Cursor pagination, max 1k rows |
| 81 | `i_api/app.py` | GET /network/check (DNC lookup) |
| 82 | `i_api/app.py` | CSV export (feature-flagged, rate-limited) |
| 83 | `i_api/admin_cli.py` | Admin CLI (reingest, matcher, audit log, queue) |
| 84 | `j_observability/observability.py` | Structured JSON logging |
| 85 | `j_observability/observability.py` | Cloud Monitoring custom metrics |
| 86 | `j_observability/observability.py` | Alert condition definitions |
| 87 | `j_observability/observability.py` | Runbooks (token, ToS, leak, merge rollback) |
| 88 | `docs/developer_guide.md` | Data model, new-platform guide, local testing |
| 89 | `j_observability/observability.py` | Synthetic test tenant + fixtures |
| 90 | `j_observability/observability.py` | Quarterly review checklist |

---

## Operating Principles (Non-Negotiable)

1. **Connections-only** — We only resolve people the tenant already knows. No open-web hunting.
2. **ToS-compliant ingestion** — Official APIs and first-party exports only. No scraping.
3. **Multi-tenant by default** — Every row has `tenant_id`. Every query is scoped. No exceptions.
4. **Event-driven, ephemeral compute** — Pull, write, exit. Cloud Run `min-instances=0` for workers.
5. **PII encrypted at rest** — KMS-CMEK. Secrets in Secret Manager only. Never in env files.
6. **Default deny cross-tenant** — Defense in depth: view layer AND app layer both enforce `tenant_id`.

---

## Quick Start

```bash
# 1. Deploy infrastructure
cd terraform && terraform apply -var="project_id=YOUR_PROJECT"

# 2. Bootstrap BigQuery tables
python -m a_foundation.bigquery_setup

# 3. Seed synthetic test tenant
python -c "
from google.cloud import bigquery
from j_observability.observability import seed_synthetic_tenant
seed_synthetic_tenant(bigquery.Client())
"

# 4. Run tests
pytest tests/ -v

# 5. Start the API locally
uvicorn i_api.app:app --reload --port 8080

# 6. Test the DNC check
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/network/check?email=alice@acmecorp.com"
```
