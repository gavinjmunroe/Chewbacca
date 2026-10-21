"""
i_api/app.py
Tasks 78–83: FastAPI retrieval API with auth, tenant scoping, pagination,
DNC lookup endpoint, CSV export, and admin CLI.
"""

import csv
import hmac
import io
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Annotated, Optional

import jwt
import requests
import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from google.cloud import bigquery
from jwt.algorithms import RSAAlgorithm

from h_security.security import audit_read, DATA_USE_BANNER
from e_classifier.classifier import RELATIONSHIP_TYPES

logger  = logging.getLogger(__name__)
app     = FastAPI(title="Connection Graph API", version="1.0.0")
bearer  = HTTPBearer()

PROJECT_ID = os.environ["GCP_PROJECT_ID"]
DATASET_ID = "connection_graph"

# Feature flag for CSV export (Task 82)
CSV_EXPORT_ENABLED = os.environ.get("CSV_EXPORT_ENABLED", "false").lower() == "true"


# ---------------------------------------------------------------------------
# Auth + tenant resolution (Task 79)
# Auth0 RS256 JWT verification using JWKS, matching the TS service contract:
#   - Same Auth0 tenant + audience
#   - tenant_id pulled from a custom claim (default https://togari.app/client_id),
#     falling back to client_id / org_id for tokens issued before the Action
#     was deployed
#   - user_id pulled from sub
# ---------------------------------------------------------------------------

AUTH0_DOMAIN     = os.environ.get("AUTH0_DOMAIN", "bluemodern.us.auth0.com")
AUTH0_AUDIENCE   = os.environ.get("AUTH0_AUDIENCE", "https://mcp.bluemodern.ai")
CLIENT_ID_CLAIM  = os.environ.get("AUTH0_CLIENT_ID_CLAIM", "https://togari.app/client_id")
JWKS_URL         = f"https://{AUTH0_DOMAIN}/.well-known/jwks.json"
JWKS_CACHE_TTL_SECONDS = 3600

_jwks_cache: dict = {"keys": None, "fetched_at": 0.0}

# ---------------------------------------------------------------------------
# Consumer auth (Medha / amber-id) — UnifyNetwork port.
#
# In Medha, this engine is fronted by the Node consumer layer
# (connection-network/consumer/network-proxy.js) which has ALREADY verified
# the caller's medha-id-issued Privy JWT (the same token /api/ask/stream
# accepts) and resolved the caller's DID. That layer talks to this FastAPI
# app server-to-server, forwarding the resolved tenant via the
# X-Medha-Tenant / X-Medha-User headers, signed with MEDHA_NETWORK_SHARED_SECRET.
#
# This path is OFF by default (MEDHA_AUTH_ENABLED unset) so the original
# Auth0 contract — and tests/test_auth.py — keep verifying the CTO's engine
# unchanged. Flip MEDHA_AUTH_ENABLED=true on the Railway deploy to let the
# Node proxy authenticate consumer calls instead of Auth0.
# ---------------------------------------------------------------------------

MEDHA_AUTH_ENABLED = os.environ.get("MEDHA_AUTH_ENABLED", "false").lower() == "true"
MEDHA_NETWORK_SHARED_SECRET = os.environ.get("MEDHA_NETWORK_SHARED_SECRET", "")


def get_bq_client() -> bigquery.Client:
    return bigquery.Client(project=PROJECT_ID)


def _get_jwks() -> dict:
    now = time.time()
    if _jwks_cache["keys"] and (now - _jwks_cache["fetched_at"]) < JWKS_CACHE_TTL_SECONDS:
        return _jwks_cache["keys"]
    resp = requests.get(JWKS_URL, timeout=5)
    resp.raise_for_status()
    _jwks_cache["keys"]       = resp.json()
    _jwks_cache["fetched_at"] = now
    return _jwks_cache["keys"]


def _signing_key_for_kid(kid: str):
    jwks = _get_jwks()
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return RSAAlgorithm.from_jwk(key)
    raise HTTPException(status_code=401, detail="Unknown kid")


def _verify_medha_consumer(request: Request) -> Optional[dict]:
    """
    UnifyNetwork consumer auth. When MEDHA_AUTH_ENABLED, trust the Node
    consumer proxy (network-proxy.js) which already verified the caller's
    medha-id Privy JWT and resolved their DID. The proxy proves itself with
    a shared secret in X-Medha-Proxy-Secret and forwards the resolved tenant.

    The Medha DID becomes BOTH tenant_id and user_id here: in Medha every
    caller is their own single-user tenant (per-tenant Pinecone namespace +
    per-DID BigQuery scope), unlike the CTO's multi-user-per-org Auth0 model.

    Returns the same dict shape as the Auth0 path, or None to fall through to
    Auth0 (so an Auth0 token still works even with the flag on).
    """
    if not MEDHA_AUTH_ENABLED:
        return None
    proxy_secret = request.headers.get("x-medha-proxy-secret", "")
    if not (MEDHA_NETWORK_SHARED_SECRET and proxy_secret):
        return None
    if not hmac.compare_digest(proxy_secret, MEDHA_NETWORK_SHARED_SECRET):
        raise HTTPException(status_code=401, detail="Invalid Medha proxy secret")
    did = request.headers.get("x-medha-tenant") or request.headers.get("x-medha-user")
    if not did:
        raise HTTPException(status_code=403, detail="Medha proxy missing tenant DID")
    return {"user_id": did, "tenant_id": did, "role": "owner"}


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    request: Request = None,
) -> dict:
    """
    Task 79: Verify the Auth0 RS256 bearer token, resolve user + tenant_id.
    Returns {"user_id": <sub>, "tenant_id": <client_id claim>, "role": ...}.
    Raises 401 on any verification failure, 403 on missing claims.

    UnifyNetwork: when MEDHA_AUTH_ENABLED and the request carries a valid
    Medha proxy secret, the resolved-DID identity from the Node consumer
    layer is used instead of Auth0. Auth0 remains the default and the only
    path tests/test_auth.py exercises (it calls get_current_user(creds)
    positionally, so credentials stays the first parameter).
    """
    if request is not None:
        medha_identity = _verify_medha_consumer(request)
        if medha_identity is not None:
            return medha_identity

    token = credentials.credentials

    try:
        unverified_header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as e:
        logger.warning("Invalid JWT header: %s", e)
        raise HTTPException(status_code=401, detail="Invalid token header")

    kid = unverified_header.get("kid")
    if not kid:
        raise HTTPException(status_code=401, detail="Token missing kid")

    signing_key = _signing_key_for_kid(kid)

    try:
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            audience=AUTH0_AUDIENCE,
            issuer=f"https://{AUTH0_DOMAIN}/",
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidAudienceError:
        raise HTTPException(status_code=401, detail="Invalid audience")
    except jwt.InvalidIssuerError:
        raise HTTPException(status_code=401, detail="Invalid issuer")
    except jwt.PyJWTError as e:
        logger.warning("JWT verification failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid token")

    tenant_id = (
        payload.get(CLIENT_ID_CLAIM)
        or payload.get("client_id")
        or payload.get("org_id")
    )
    if not tenant_id:
        raise HTTPException(
            status_code=403,
            detail=f"Token missing {CLIENT_ID_CLAIM} claim",
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=403, detail="Token missing sub claim")

    role = payload.get("role", "member")

    return {"user_id": user_id, "tenant_id": tenant_id, "role": role}


CurrentUser = Annotated[dict, Depends(get_current_user)]


# ---------------------------------------------------------------------------
# Task 78 — GET /identities
# ---------------------------------------------------------------------------

@app.get("/identities")
async def list_identities(
    request: Request,
    current_user: CurrentUser,
    platform: Optional[str]          = Query(None),
    relationship_type: Optional[str] = Query(None),
    last_signal_after: Optional[str] = Query(None),  # ISO datetime
    confidence_min: Optional[float]  = Query(None, ge=0.0, le=1.0),
    confidence_max: Optional[float]  = Query(None, ge=0.0, le=1.0),
    cursor: Optional[str]            = Query(None),
    limit: int                       = Query(100, ge=1, le=1000),
):
    """
    Task 78: List identities with filters.
    Task 79: Auth required, tenant-scoped, audit-logged.
    Task 80: Cursor-based pagination, max 1000 rows.
    Task 45: relationship_type as first-class filter.
    """
    tenant_id = current_user["tenant_id"]
    bq        = get_bq_client()

    if relationship_type and relationship_type not in RELATIONSHIP_TYPES:
        raise HTTPException(400, f"relationship_type must be one of {RELATIONSHIP_TYPES}")

    # Build query
    filters = ["i.tenant_id = @tenant_id", "i.is_tombstone = FALSE"]
    params  = [bigquery.ScalarQueryParameter("tenant_id", "STRING", tenant_id)]

    if relationship_type:
        filters.append("i.relationship_type = @rel_type")
        params.append(bigquery.ScalarQueryParameter("rel_type", "STRING", relationship_type))

    if confidence_min is not None:
        filters.append("i.confidence_score >= @conf_min")
        params.append(bigquery.ScalarQueryParameter("conf_min", "FLOAT64", confidence_min))

    if confidence_max is not None:
        filters.append("i.confidence_score <= @conf_max")
        params.append(bigquery.ScalarQueryParameter("conf_max", "FLOAT64", confidence_max))

    if cursor:
        filters.append("i.updated_at < @cursor_ts")
        params.append(bigquery.ScalarQueryParameter("cursor_ts", "TIMESTAMP", cursor))

    where_clause = " AND ".join(filters)

    query = f"""
        SELECT
            i.identity_id, i.display_name, i.normalized_name,
            i.confidence_score, i.relationship_type,
            i.created_at, i.updated_at,
            ARRAY_AGG(STRUCT(ph.platform, ph.handle_value, ph.profile_url)) AS handles
        FROM `{PROJECT_ID}.{DATASET_ID}.identities` i
        LEFT JOIN `{PROJECT_ID}.{DATASET_ID}.platform_handles` ph
            ON ph.identity_id = i.identity_id AND ph.tenant_id = i.tenant_id
        {'JOIN `' + PROJECT_ID + '.' + DATASET_ID + '.connections` c ON c.identity_id = i.identity_id AND c.channel = @platform AND c.tenant_id = i.tenant_id' if platform else ''}
        WHERE {where_clause}
        GROUP BY 1,2,3,4,5,6,7
        ORDER BY i.updated_at DESC
        LIMIT @lim
    """
    params.append(bigquery.ScalarQueryParameter("lim", "INT64", limit + 1))
    if platform:
        params.append(bigquery.ScalarQueryParameter("platform", "STRING", platform))

    job_config = bigquery.QueryJobConfig(query_parameters=params)
    rows       = list(bq.query(query, job_config=job_config).result())

    has_more    = len(rows) > limit
    rows        = rows[:limit]
    next_cursor = rows[-1]["updated_at"].isoformat() if has_more and rows else None

    # Task 66: Audit log the read
    audit_read(
        bq, tenant_id, current_user["user_id"],
        target_type="identities_list", target_id="batch",
        ip=request.client.host if request.client else None,
        request_id=str(uuid.uuid4()),
    )

    return {
        "banner":      DATA_USE_BANNER,
        "data":        [dict(r) for r in rows],
        "next_cursor": next_cursor,
    }


# ---------------------------------------------------------------------------
# Task 78 — GET /identities/{id}
# ---------------------------------------------------------------------------

@app.get("/identities/{identity_id}")
async def get_identity(
    identity_id: str,
    request: Request,
    current_user: CurrentUser,
):
    """Task 78/79: Single identity fetch. Auth required. Tenant-scoped. Audit-logged."""
    tenant_id = current_user["tenant_id"]
    bq        = get_bq_client()

    query = f"""
        SELECT i.*, ARRAY_AGG(STRUCT(ph.platform, ph.handle_value, ph.profile_url)) AS handles
        FROM `{PROJECT_ID}.{DATASET_ID}.identities` i
        LEFT JOIN `{PROJECT_ID}.{DATASET_ID}.platform_handles` ph
            ON ph.identity_id = i.identity_id AND ph.tenant_id = @tenant_id
        WHERE i.tenant_id = @tenant_id AND i.identity_id = @identity_id
          AND i.is_tombstone = FALSE
        GROUP BY 1
        LIMIT 1
    """
    job_config = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("tenant_id",   "STRING", tenant_id),
        bigquery.ScalarQueryParameter("identity_id", "STRING", identity_id),
    ])
    rows = list(bq.query(query, job_config=job_config).result())

    if not rows:
        raise HTTPException(404, "Identity not found")

    audit_read(
        bq, tenant_id, current_user["user_id"],
        target_type="identity", target_id=identity_id,
        ip=request.client.host if request.client else None,
    )

    return {"banner": DATA_USE_BANNER, "data": dict(rows[0])}


# ---------------------------------------------------------------------------
# Task 78 — GET /connections
# ---------------------------------------------------------------------------

@app.get("/connections")
async def list_connections(
    request: Request,
    current_user: CurrentUser,
    platform: Optional[str]          = Query(None),
    relationship_type: Optional[str] = Query(None),
    last_signal_after: Optional[str] = Query(None),
    cursor: Optional[str]            = Query(None),
    limit: int                       = Query(100, ge=1, le=1000),
):
    """Task 78: List active connections with optional filters."""
    tenant_id = current_user["tenant_id"]
    bq        = get_bq_client()

    filters = ["c.tenant_id = @tenant_id", "c.status = 'active'"]
    params  = [bigquery.ScalarQueryParameter("tenant_id", "STRING", tenant_id)]

    if platform:
        filters.append("c.channel = @platform")
        params.append(bigquery.ScalarQueryParameter("platform", "STRING", platform))

    if relationship_type:
        filters.append("i.relationship_type = @rel_type")
        params.append(bigquery.ScalarQueryParameter("rel_type", "STRING", relationship_type))

    if last_signal_after:
        filters.append("c.last_signal_at > @last_signal_after")
        params.append(bigquery.ScalarQueryParameter("last_signal_after", "TIMESTAMP", last_signal_after))

    if cursor:
        filters.append("c.last_signal_at < @cursor_ts")
        params.append(bigquery.ScalarQueryParameter("cursor_ts", "TIMESTAMP", cursor))

    where_clause = " AND ".join(filters)
    params.append(bigquery.ScalarQueryParameter("lim", "INT64", limit + 1))

    query = f"""
        SELECT c.connection_id, c.identity_id, c.channel, c.status,
               c.first_connected_at, c.last_signal_at, c.signal_count,
               i.display_name, i.relationship_type
        FROM `{PROJECT_ID}.{DATASET_ID}.connections` c
        JOIN `{PROJECT_ID}.{DATASET_ID}.identities` i
          ON i.identity_id = c.identity_id AND i.tenant_id = c.tenant_id
        WHERE {where_clause}
        ORDER BY c.last_signal_at DESC
        LIMIT @lim
    """
    job_config = bigquery.QueryJobConfig(query_parameters=params)
    rows       = list(bq.query(query, job_config=job_config).result())

    has_more    = len(rows) > limit
    rows        = rows[:limit]
    next_cursor = rows[-1]["last_signal_at"].isoformat() if has_more and rows else None

    audit_read(
        bq, tenant_id, current_user["user_id"],
        target_type="connections_list", target_id="batch",
    )

    return {"banner": DATA_USE_BANNER, "data": [dict(r) for r in rows], "next_cursor": next_cursor}


# ---------------------------------------------------------------------------
# Task 81 — "Is this person in my network?" DNC lookup
# ---------------------------------------------------------------------------

# TODO(caleb): align /network/check shape with TOF channel pre-flight needs.
# Sagar's next-sprint TOF channels (Smartlead auto-email, iMessage loop,
# Retell auto-call) will call this as their "should we contact?" pre-flight.
# Required contract:
#   query params: email | linkedin_url | phone (at least one, 400 if all missing)
#   response:     {
#                   "in_network":        bool,
#                   "is_dnc":            bool,
#                   "last_contacted_at": ISO-8601 timestamp | null,
#                   "relationship_type": "first_degree" | ...,
#                 }
# Current shape diverges: accepts email + generic `handle` (no split linkedin_url
# vs phone), returns {in_network, platform, relationship_type} with no is_dnc or
# last_contacted_at, and relationship_type values are the e_classifier set
# (personal/professional/mixed/unknown), not first_degree-style. Confirming the
# gap today; building the consumers + reshaping this route is a next-sprint task.

@app.get("/network/check")
async def network_check(
    request: Request,
    current_user: CurrentUser,
    email: Optional[str]  = Query(None),
    handle: Optional[str] = Query(None),
):
    """
    Task 81: Sales DNC check. Input: email or platform handle.
    Output: in_network (bool) + which platform + relationship_type.
    This IS the "do not cold-email" check — no separate DNC system needed.
    """
    if not email and not handle:
        raise HTTPException(400, "Provide email or handle")

    tenant_id = current_user["tenant_id"]
    bq        = get_bq_client()

    from h_security.security import hash_email_for_tenant

    if email:
        email_hash = hash_email_for_tenant(email, tenant_id)
        query = f"""
            SELECT i.identity_id, c.channel, i.relationship_type
            FROM `{PROJECT_ID}.{DATASET_ID}.identities` i
            JOIN `{PROJECT_ID}.{DATASET_ID}.connections` c
              ON c.identity_id = i.identity_id AND c.tenant_id = i.tenant_id
            WHERE i.tenant_id = @tenant_id
              AND i.primary_email_hash = @email_hash
              AND i.is_tombstone = FALSE
              AND c.status = 'active'
            LIMIT 1
        """
        params = [
            bigquery.ScalarQueryParameter("tenant_id",  "STRING", tenant_id),
            bigquery.ScalarQueryParameter("email_hash", "STRING", email_hash),
        ]
    else:
        query = f"""
            SELECT i.identity_id, c.channel, i.relationship_type
            FROM `{PROJECT_ID}.{DATASET_ID}.platform_handles` ph
            JOIN `{PROJECT_ID}.{DATASET_ID}.identities` i
              ON i.identity_id = ph.identity_id AND i.tenant_id = ph.tenant_id
            JOIN `{PROJECT_ID}.{DATASET_ID}.connections` c
              ON c.identity_id = i.identity_id AND c.tenant_id = i.tenant_id
            WHERE ph.tenant_id = @tenant_id
              AND ph.handle_value = @handle
              AND i.is_tombstone = FALSE
              AND c.status = 'active'
            LIMIT 1
        """
        params = [
            bigquery.ScalarQueryParameter("tenant_id", "STRING", tenant_id),
            bigquery.ScalarQueryParameter("handle",    "STRING", handle),
        ]

    job_config = bigquery.QueryJobConfig(query_parameters=params)
    rows       = list(bq.query(query, job_config=job_config).result())

    audit_read(
        bq, tenant_id, current_user["user_id"],
        target_type="dnc_check", target_id=email or handle or "unknown",
    )

    if rows:
        row = dict(rows[0])
        return {
            "in_network":        True,
            "platform":          row["channel"],
            "relationship_type": row["relationship_type"],
        }
    return {"in_network": False}


# ---------------------------------------------------------------------------
# Task 82 — CSV export (feature-flagged, audit-logged, rate-limited)
# ---------------------------------------------------------------------------

from fastapi import Header
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@app.get("/export/connections.csv")
@limiter.limit("5/hour")
async def export_csv(
    request: Request,
    current_user: CurrentUser,
):
    """Task 82: CSV export — feature-flagged, rate-limited, audit-logged."""
    if not CSV_EXPORT_ENABLED:
        raise HTTPException(403, "CSV export is not enabled for this account.")

    tenant_id = current_user["tenant_id"]
    bq        = get_bq_client()

    query = f"""
        SELECT i.display_name, i.relationship_type, c.channel,
               ph.handle_value, c.first_connected_at, c.last_signal_at, c.signal_count
        FROM `{PROJECT_ID}.{DATASET_ID}.identities` i
        JOIN `{PROJECT_ID}.{DATASET_ID}.connections` c ON c.identity_id = i.identity_id AND c.tenant_id = i.tenant_id
        JOIN `{PROJECT_ID}.{DATASET_ID}.platform_handles` ph ON ph.identity_id = i.identity_id AND ph.tenant_id = i.tenant_id AND ph.platform = c.channel
        WHERE i.tenant_id = @tenant_id AND i.is_tombstone = FALSE AND c.status = 'active'
        ORDER BY c.last_signal_at DESC
        LIMIT 50000
    """
    job_config = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("tenant_id", "STRING", tenant_id)
    ])
    rows = list(bq.query(query, job_config=job_config).result())

    audit_read(
        bq, tenant_id, current_user["user_id"],
        target_type="csv_export", target_id="all_connections",
    )

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=[
        "display_name", "relationship_type", "channel",
        "handle_value", "first_connected_at", "last_signal_at", "signal_count",
    ])
    writer.writeheader()
    for row in rows:
        writer.writerow(dict(row))

    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=connections.csv"},
    )


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
