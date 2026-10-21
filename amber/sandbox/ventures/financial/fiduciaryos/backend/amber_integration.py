"""
Amber Integration — FiduciaryOS Python Backend

Pushes financial health signals to Amber from the FastAPI backend.
Call push_amber_signal() after key portfolio/tax/cash-flow computations.

Usage:
    from backend.amber_integration import push_amber_signal
    await push_amber_signal(amber_user_id, {
        "type": "portfolio_snapshot",
        "netWorth": 250000,
        ...
    })
"""

from __future__ import annotations

import os
import logging
from typing import Any

import httpx

AMBER_API_URL = os.getenv("AMBER_API_URL", "https://api.amber.health")
AMBER_WEBHOOK_SECRET = os.getenv("AMBER_WEBHOOK_SECRET")

logger = logging.getLogger(__name__)


async def push_amber_signal(amber_user_id: str | int, signal: dict[str, Any]) -> None:
    """
    Push a financial health signal to Amber. Non-blocking — exceptions are caught and logged.
    """
    headers = {
        "Content-Type": "application/json",
        "X-Amber-User-Id": str(amber_user_id),
    }
    if AMBER_WEBHOOK_SECRET:
        headers["X-Amber-Webhook-Secret"] = AMBER_WEBHOOK_SECRET

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.post(
                f"{AMBER_API_URL}/integrations/fiduciaryos/signal",
                json=signal,
                headers=headers,
            )
            if res.status_code >= 400:
                logger.warning("[amber] signal push failed: %s %s", res.status_code, res.text)
    except Exception as exc:
        logger.warning("[amber] signal push error: %s", exc)
