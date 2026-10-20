# Developer Documentation
## Connection Graph — Unified Identity & Relationship System

---

## Data Model Overview

```
tenants (1)
  └─ users (N)
  └─ identities (N) ─────── one resolved person per row
       └─ platform_handles (N) ── many platform accounts per identity
            └─ connection_events (N) ── append-only source of truth
       └─ connections (N) ── derived/materialized from events
  └─ match_review_queue ── borderline identity pairs awaiting human review
  └─ audit_log ── every read AND write (immutable)
  └─ inclusion_rules ── per-tenant per-channel thresholds
  └─ do_not_merge_overrides ── user-declared separate identities
  └─ platform_kill_switches ── emergency stops
```

**Golden rule:** `connection_events` is the source of truth. `connections` is derived from it.
**Security rule:** Every query must include `WHERE tenant_id = @tenant_id`. No exceptions.

---

## How to Add a New Platform

### Step 1: Write the one-pager
Create `f_platforms/docs/<platform>_onepager.md`:
- Official API URL
- Rate limits (requests/hour or requests/day)
- OAuth scopes needed (minimum necessary)
- What "connection" means on this platform
- ToS data-use clauses (cite section numbers)
- Known gaps or limitations

### Step 2: Add to the ToS compliance matrix
Update `docs/tos_compliance_matrix.md` with the new row before writing any code.

### Step 3: Create the ingestion adapter
```python
# f_platforms/adapters.py (add to the file)

class MyPlatformIngestion(BasePlatformIngestion):
    platform = "myplatform"  # lowercase, no spaces

    def _rate_limit_config(self):
        return {"rate_per_second": 1.0, "burst": 10}  # match platform docs

    def fetch_events(self) -> Iterator[dict]:
        token = self.get_token()  # fetches from Secret Manager
        # ... make API calls ...
        yield {"type": "connection_event_type", "raw": raw_data}

    def _process_event(self, raw_event: dict) -> None:
        raw = raw_event["raw"]
        self.write_event(          # idempotent — safe to re-run
            event_type        = "connection_accepted",  # or other type
            event_timestamp   = raw["timestamp"],
            handle_id         = self._upsert_handle(raw["user_id"]),
            platform_event_id = raw["id"],              # platform's own ID
            payload           = {"user_id": raw["user_id"]},
        )
```

### Step 4: Add inclusion rules
In `c_threshold/inclusion.py`, add to `DEFAULT_INCLUSION_RULES`:
```python
"myplatform": {
    "rule_type": "mutual_follow_or_dm",
    "threshold": 1,
    "description": "Must be mutual follow OR DM exchange.",
},
```

### Step 5: Add relationship classifier rules
In `e_classifier/classifier.py`, update `classify_identity()` with platform-specific signals.

### Step 6: Add to Secret Manager
```bash
gcloud secrets create myplatform-oauth-token-{tenant_id} --data-file=token.txt
```

### Step 7: Write tests with realistic fixtures
```python
# tests/test_myplatform.py
class TestMyPlatformIngestion(unittest.TestCase):
    def test_connection_event_written(self):
        # ... mock API, mock BQ, verify write_event called with correct params ...
```

### Step 8: Add to platform_kill_switches table
Insert a row with `is_killed=FALSE` as the default state.

### Step 9: Deploy Cloud Run service
Add to `terraform/main.tf` following the existing pattern.

---

## Local Testing with Fixtures

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables
export GCP_PROJECT_ID=your-project-id
export GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json

# Run all tests
pytest tests/ -v

# Run a specific section
pytest tests/test_all.py::TestNameNormalization -v

# Seed synthetic test tenant (against real BQ — use sandbox project)
python -c "
from google.cloud import bigquery
from j_observability.observability import seed_synthetic_tenant
bq = bigquery.Client()
seed_synthetic_tenant(bq)
"

# Run admin CLI
python -m i_api.admin_cli --tenant-id tenant-synthetic-test-001 audit-log --limit 10

# Trigger manual refresh
python -m i_api.admin_cli --tenant-id your-tenant reingest --platform linkedin
```

---

## Idempotency Contract

**Every ingestion run must be safe to re-run without duplicating data.**

The idempotency key is `platform:platform_event_id`. Before writing any event, the
system checks for an existing row with this key. If found, the write is skipped.

When adding a platform:
1. Always use the platform's own stable event/user ID as `platform_event_id`.
2. Never use timestamps or random values as `platform_event_id`.
3. Test by running ingestion twice and verifying event count doesn't double.

```python
# ✅ Correct
platform_event_id = f"gh:{github_user['id']}"

# ❌ Wrong — timestamp changes every run
platform_event_id = f"gh:{datetime.now().isoformat()}"
```

---

## PR Checklist (enforced in code review)

Before merging any connection graph PR, confirm:

- [ ] Every new query includes `WHERE tenant_id = @tenant_id`
- [ ] No outbound calls to a contact's machine (read-only API consumers only)
- [ ] All secrets fetched from Secret Manager (no env vars, no hardcoded values)
- [ ] `platform_event_id` is a stable, platform-issued ID
- [ ] New platform has a ToS one-pager and compliance matrix row
- [ ] Unit tests with realistic fixtures for any new ingestion code
- [ ] Kill switch row added for any new platform
- [ ] Rate limits set to ≤80% of documented platform limit (leave headroom)
- [ ] No `min-instances > 0` for ingestion workers (Task 61)
