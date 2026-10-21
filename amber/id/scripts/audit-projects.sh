#!/usr/bin/env bash
# Read-only audit of which GCP project each piece of Amber's infrastructure
# lives in. Prints no secrets — keys and passwords show as SET/EMPTY.
#
#   bash scripts/audit-projects.sh 2>&1 | tee /tmp/audit.txt
#
# Needs: railway (linked to amber_id), gcloud + bq (authenticated).
set -uo pipefail

# NEVER PROMPT. gcloud asks "API [datastream.googleapis.com] not enabled on
# project X. Would you like to enable and retry?" and then waits forever on a
# piped stdin -- which is exactly how this script hung at the last section.
# A read-only audit must never enable an API either.
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

OLD="midyear-glazing-485303-u3"   # Togari
NEW="amber-489122"                # Amber

line() { printf '\n========== %s ==========\n' "$1"; }

# ---------------------------------------------------------------- preflight
# gcloud's token expires and then every single call prints the same ten-line
# reauth notice. Fourteen copies of it buries the one block that matters, so
# this checks once and stops.
line "PREFLIGHT"
if ! command -v gcloud >/dev/null 2>&1; then
  echo "  gcloud is not on PATH. Install the Google Cloud SDK, then re-run."
  GCLOUD_OK=no
elif ! gcloud projects list --limit=1 --format="value(projectId)" >/dev/null 2>&1; then
  echo "  gcloud is installed but NOT AUTHENTICATED (or the token expired)."
  echo
  echo "    Run this, then re-run this script:"
  echo "      gcloud auth login"
  echo
  echo "  Continuing to the Railway section, which does not need gcloud."
  GCLOUD_OK=no
else
  echo "  gcloud authenticated as: $(gcloud config get-value account 2>/dev/null)"
  GCLOUD_OK=yes
fi

# ------------------------------------------------- what the API points at
# THE PARSER GOES IN ITS OWN FILE ON PURPOSE. `python3 - <<'PY'` makes the
# heredoc the program AND stdin, so a pipe into it is silently discarded and
# json.load(sys.stdin) reads the program text. That is the bug that made the
# first version of this script print "Expecting value: line 1 column 1".
PARSER="$(mktemp -t amber-audit-parser)"
trap 'rm -f "$PARSER"' EXIT
cat > "$PARSER" <<'PY'
import sys, json

raw = sys.stdin.read().strip()
if not raw:
    print("  railway returned nothing. Is this directory linked? Try: railway link")
    sys.exit(0)
try:
    d = json.loads(raw)
except Exception as e:
    print(f"  could not parse railway output: {e}")
    print(f"  first 200 chars: {raw[:200]!r}")
    sys.exit(0)

# The values that decide which project the data lands in.
SHOW = [
    "AMBER_SQL_CONNECTION_NAME", "AMBER_SQL_DB", "AMBER_SQL_USER",
    "GCS_NOTE_AUDIO_BUCKET", "GCS_BUCKET", "AMBER_BQ_PROJECT", "AMBER_BQ_DATASET",
    "BIGQUERY_PROJECT", "GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT",
    "AMBER_API_BASE_URL", "AMBER_WEB_BASE_URL",
]
print("  THE ONES THAT DECIDE WHERE DATA GOES:")
for k in SHOW:
    if k in d:
        print(f"    {k} = {d[k]}")
    else:
        print(f"    {k} = (not set)")

creds = d.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
if creds:
    try:
        c = json.loads(creds)
        print(f"\n    service account      = {c.get('client_email')}")
        print(f"    credentials project  = {c.get('project_id')}")
    except Exception as e:
        print(f"\n    credentials JSON unparseable: {e}")

print("\n  SECRETS PRESENT (values hidden):")
for k in sorted(d):
    if any(w in k.upper() for w in ("KEY", "SECRET", "PASSWORD", "TOKEN", "CREDENTIALS")):
        print(f"    {k} = {'SET' if d[k] else 'EMPTY'}")

print("\n  EVERY OTHER VARIABLE NAME (names only):")
for k in sorted(d):
    if k not in SHOW and not any(w in k.upper() for w in ("KEY","SECRET","PASSWORD","TOKEN","CREDENTIALS")):
        print(f"    {k}")
PY

line "WHAT THE RUNNING API IS POINTED AT"
railway variables --json 2>/dev/null | python3 "$PARSER"

# ------------------------------------------------------------ the projects
if [ "$GCLOUD_OK" != "yes" ]; then
  line "SKIPPED"
  echo "  Everything below needs gcloud. Run 'gcloud auth login' and re-run."
  exit 0
fi

for P in "$OLD" "$NEW"; do
  label=$([ "$P" = "$OLD" ] && echo "TOGARI (old)" || echo "AMBER (new)")

  line "$label $P — CLOUD SQL"
  gcloud sql instances list --project="$P" \
    --format="table(name, databaseVersion, region, state)" 2>&1 | sed 's/^/  /'

  line "$label $P — DATABASES IN EACH INSTANCE"
  for I in $(gcloud sql instances list --project="$P" --format="value(name)" 2>/dev/null); do
    echo "  instance: $I"
    gcloud sql databases list --instance="$I" --project="$P" \
      --format="value(name)" 2>&1 | sed 's/^/    /'
  done

  line "$label $P — BIGQUERY DATASETS"
  bq --project_id="$P" ls --format=pretty 2>&1 | sed 's/^/  /'

  line "$label $P — GCS BUCKETS"
  gcloud storage buckets list --project="$P" --format="value(name)" 2>&1 | sed 's/^/  /'

  line "$label $P — SERVICE ACCOUNTS"
  gcloud iam service-accounts list --project="$P" \
    --format="table(email, disabled)" 2>&1 | sed 's/^/  /'

  line "$label $P — DATASTREAM STREAMS (Cloud SQL -> BigQuery)"
  gcloud datastream streams list --project="$P" --location=us-west2 \
    --format="table(name, state)" 2>&1 | sed 's/^/  /' || echo "  (datastream API not enabled here)"
done

# --------------------------------------------- does the live SA have access
line "ROLES HELD BY THE SERVICE ACCOUNT THE API IS ACTUALLY USING"
SA="amber-firestore@${OLD}.iam.gserviceaccount.com"
echo "  $SA"
for P in "$OLD" "$NEW"; do
  echo "  --- in $P ---"
  OUT=$(gcloud projects get-iam-policy "$P" \
    --flatten="bindings[].members" \
    --filter="bindings.members:${SA}" \
    --format="value(bindings.role)" 2>&1)
  if [ -z "$OUT" ]; then
    echo "    (no roles at all — this account has NO access to this project)"
  else
    echo "$OUT" | sed 's/^/    /'
  fi
done

line "NEXT: ROW COUNTS, once we know which instance is live"
cat <<'SQL'
  gcloud sql connect <INSTANCE> --user=<USER> --project=<PROJECT> --database=<DB>

    SELECT 'users' t, count(*) FROM users
    UNION ALL SELECT 'contacts', count(*) FROM contacts
    UNION ALL SELECT 'organizations', count(*) FROM organizations
    UNION ALL SELECT 'org_members', count(*) FROM org_members
    UNION ALL SELECT 'observations', count(*) FROM observations
    ORDER BY 1;

    SELECT max(filename) AS latest_migration FROM schema_migrations;
SQL
