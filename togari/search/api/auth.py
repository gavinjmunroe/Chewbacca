"""Bearer token check against BLIND8_API_KEY env var."""
from __future__ import annotations

import os
from typing import Optional

from fastapi import HTTPException, Request, status


def check_bearer(request: Request) -> None:
    """Raise 401 if Authorization header is missing, malformed, or wrong."""
    expected = os.environ.get("BLIND8_API_KEY")
    if not expected:
        # Deploy-time misconfig. Refuse all traffic.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="BLIND8_API_KEY not configured on server",
        )
    header: Optional[str] = request.headers.get("authorization") or request.headers.get(
        "Authorization"
    )
    if not header or not header.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header",
        )
    token = header.split(" ", 1)[1].strip()
    if token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid bearer token",
        )
