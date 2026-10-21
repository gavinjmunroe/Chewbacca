"""
tests/test_auth.py
Auth0 JWT verification tests for i_api.app.get_current_user.

Verifies the real-auth contract that replaced the placeholder which
returned hardcoded "tenant_placeholder" for any non-empty token:
  - Invalid / missing JWT header => 401
  - Expired token => 401
  - Wrong audience => 401
  - Wrong issuer => 401
  - Missing client_id custom claim => 403
  - Missing sub claim => 403
  - Valid token => returns the real tenant_id and user_id from the token
  - Falls back to client_id / org_id claims when the custom claim is absent
"""

import os
import sys
from unittest.mock import patch

# Ensure required env vars exist before importing i_api.app (which reads
# os.environ["GCP_PROJECT_ID"] at module import time).
os.environ.setdefault("GCP_PROJECT_ID", "test-project")
os.environ.setdefault("AUTH0_DOMAIN", "bluemodern.us.auth0.com")
os.environ.setdefault("AUTH0_AUDIENCE", "https://mcp.bluemodern.ai")

# Make connection_network importable when running this file directly via pytest.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import jwt
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from i_api.app import (
    CLIENT_ID_CLAIM,
    _jwks_cache,
    get_current_user,
)


@pytest.fixture(autouse=True)
def clear_jwks_cache():
    _jwks_cache["keys"]       = None
    _jwks_cache["fetched_at"] = 0.0
    yield
    _jwks_cache["keys"]       = None
    _jwks_cache["fetched_at"] = 0.0


def _creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


# A minimal fake "signing key" — the real key is bytes from a JWK; for these
# tests we mock jwt.decode so the key never has to actually verify anything.
_FAKE_KEY = object()


@pytest.mark.asyncio
async def test_invalid_jwt_header_rejected():
    creds = _creds("not.a.jwt")
    with pytest.raises(HTTPException) as exc:
        await get_current_user(creds)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_missing_kid_rejected():
    with patch("i_api.app.jwt.get_unverified_header", return_value={"alg": "RS256"}):
        creds = _creds("header.payload.sig")
        with pytest.raises(HTTPException) as exc:
            await get_current_user(creds)
    assert exc.value.status_code == 401
    assert "kid" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_unknown_kid_rejected():
    """JWKS lookup returns no key for the given kid => 401."""
    with patch("i_api.app.jwt.get_unverified_header", return_value={"kid": "missing-kid"}), \
         patch("i_api.app._get_jwks", return_value={"keys": [{"kid": "other-kid"}]}):
        creds = _creds("header.payload.sig")
        with pytest.raises(HTTPException) as exc:
            await get_current_user(creds)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_expired_token_rejected():
    with patch("i_api.app.jwt.get_unverified_header", return_value={"kid": "k1"}), \
         patch("i_api.app._signing_key_for_kid", return_value=_FAKE_KEY), \
         patch("i_api.app.jwt.decode", side_effect=jwt.ExpiredSignatureError("expired")):
        creds = _creds("header.payload.sig")
        with pytest.raises(HTTPException) as exc:
            await get_current_user(creds)
    assert exc.value.status_code == 401
    assert exc.value.detail == "Token expired"


@pytest.mark.asyncio
async def test_wrong_audience_rejected():
    with patch("i_api.app.jwt.get_unverified_header", return_value={"kid": "k1"}), \
         patch("i_api.app._signing_key_for_kid", return_value=_FAKE_KEY), \
         patch("i_api.app.jwt.decode", side_effect=jwt.InvalidAudienceError("bad aud")):
        creds = _creds("header.payload.sig")
        with pytest.raises(HTTPException) as exc:
            await get_current_user(creds)
    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid audience"


@pytest.mark.asyncio
async def test_wrong_issuer_rejected():
    with patch("i_api.app.jwt.get_unverified_header", return_value={"kid": "k1"}), \
         patch("i_api.app._signing_key_for_kid", return_value=_FAKE_KEY), \
         patch("i_api.app.jwt.decode", side_effect=jwt.InvalidIssuerError("bad iss")):
        creds = _creds("header.payload.sig")
        with pytest.raises(HTTPException) as exc:
            await get_current_user(creds)
    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid issuer"


@pytest.mark.asyncio
async def test_generic_jwt_error_rejected():
    with patch("i_api.app.jwt.get_unverified_header", return_value={"kid": "k1"}), \
         patch("i_api.app._signing_key_for_kid", return_value=_FAKE_KEY), \
         patch("i_api.app.jwt.decode", side_effect=jwt.InvalidSignatureError("bad sig")):
        creds = _creds("header.payload.sig")
        with pytest.raises(HTTPException) as exc:
            await get_current_user(creds)
    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid token"


@pytest.mark.asyncio
async def test_missing_client_id_claim_rejected():
    payload = {"sub": "auth0|abc123"}  # no tenant claim at all
    with patch("i_api.app.jwt.get_unverified_header", return_value={"kid": "k1"}), \
         patch("i_api.app._signing_key_for_kid", return_value=_FAKE_KEY), \
         patch("i_api.app.jwt.decode", return_value=payload):
        creds = _creds("header.payload.sig")
        with pytest.raises(HTTPException) as exc:
            await get_current_user(creds)
    assert exc.value.status_code == 403
    assert CLIENT_ID_CLAIM in exc.value.detail


@pytest.mark.asyncio
async def test_missing_sub_claim_rejected():
    payload = {CLIENT_ID_CLAIM: "tenant-bma"}  # tenant present, sub missing
    with patch("i_api.app.jwt.get_unverified_header", return_value={"kid": "k1"}), \
         patch("i_api.app._signing_key_for_kid", return_value=_FAKE_KEY), \
         patch("i_api.app.jwt.decode", return_value=payload):
        creds = _creds("header.payload.sig")
        with pytest.raises(HTTPException) as exc:
            await get_current_user(creds)
    assert exc.value.status_code == 403
    assert "sub" in exc.value.detail


@pytest.mark.asyncio
async def test_valid_token_returns_real_tenant():
    payload = {
        CLIENT_ID_CLAIM: "tenant-bma",
        "sub":           "auth0|user-789",
        "role":          "admin",
    }
    with patch("i_api.app.jwt.get_unverified_header", return_value={"kid": "k1"}), \
         patch("i_api.app._signing_key_for_kid", return_value=_FAKE_KEY), \
         patch("i_api.app.jwt.decode", return_value=payload):
        creds = _creds("header.payload.sig")
        result = await get_current_user(creds)

    assert result == {
        "user_id":   "auth0|user-789",
        "tenant_id": "tenant-bma",
        "role":      "admin",
    }
    # Crucially, NOT the placeholder values from the old impl:
    assert result["tenant_id"] != "tenant_placeholder"
    assert result["user_id"]   != "user_placeholder"


@pytest.mark.asyncio
async def test_tenant_falls_back_to_client_id_claim():
    """Before the Auth0 Action ships the custom claim, tokens may only
    carry client_id — accept it as the tenant for backward compatibility."""
    payload = {"client_id": "tenant-from-client-id", "sub": "auth0|u1"}
    with patch("i_api.app.jwt.get_unverified_header", return_value={"kid": "k1"}), \
         patch("i_api.app._signing_key_for_kid", return_value=_FAKE_KEY), \
         patch("i_api.app.jwt.decode", return_value=payload):
        creds = _creds("header.payload.sig")
        result = await get_current_user(creds)
    assert result["tenant_id"] == "tenant-from-client-id"


@pytest.mark.asyncio
async def test_tenant_falls_back_to_org_id():
    payload = {"org_id": "org_xyz", "sub": "auth0|u1"}
    with patch("i_api.app.jwt.get_unverified_header", return_value={"kid": "k1"}), \
         patch("i_api.app._signing_key_for_kid", return_value=_FAKE_KEY), \
         patch("i_api.app.jwt.decode", return_value=payload):
        creds = _creds("header.payload.sig")
        result = await get_current_user(creds)
    assert result["tenant_id"] == "org_xyz"


@pytest.mark.asyncio
async def test_role_defaults_to_member_when_absent():
    payload = {CLIENT_ID_CLAIM: "tenant-bma", "sub": "auth0|u1"}
    with patch("i_api.app.jwt.get_unverified_header", return_value={"kid": "k1"}), \
         patch("i_api.app._signing_key_for_kid", return_value=_FAKE_KEY), \
         patch("i_api.app.jwt.decode", return_value=payload):
        creds = _creds("header.payload.sig")
        result = await get_current_user(creds)
    assert result["role"] == "member"


def test_jwks_cache_respects_ttl():
    """Two calls inside the TTL hit the network only once."""
    from i_api.app import _get_jwks
    fake_jwks = {"keys": [{"kid": "k1", "kty": "RSA"}]}

    with patch("i_api.app.requests.get") as mock_get:
        mock_get.return_value.json.return_value = fake_jwks
        mock_get.return_value.raise_for_status.return_value = None

        first  = _get_jwks()
        second = _get_jwks()

    assert first is fake_jwks
    assert second is fake_jwks
    assert mock_get.call_count == 1


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
