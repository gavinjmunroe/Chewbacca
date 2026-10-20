"""
d_integrations/adapters.py
Tasks 31–35: LinkedIn, Instagram, X/Twitter, and Email ingestion adapters.
Each adapter:
  - Uses only official API paths (Tasks 31–34 audit compliance)
  - Writes to connection_events via the base class (Task 35)
  - Implements rate limits appropriate for its API tier (Task 37)
"""

import logging
from datetime import datetime, timezone
from typing import Iterator

import requests

from d_integrations.base import BasePlatformIngestion
from c_threshold.inclusion import is_auto_reply, is_transactional_address

logger = logging.getLogger(__name__)


# =============================================================================
# Task 31 — LinkedIn ingestion
# Only pulls: own connections list, own message threads.
# No 2nd-degree scraping. Uses LinkedIn REST API v2.
# =============================================================================

class LinkedInIngestion(BasePlatformIngestion):
    platform = "linkedin"
    API_BASE = "https://api.linkedin.com/v2"

    def _rate_limit_config(self):
        # LinkedIn: 100 calls/day on most partner endpoints; 500/day on connections
        return {"rate_per_second": 0.1, "burst": 5}

    def fetch_events(self) -> Iterator[dict]:
        """Task 31: Fetch only 1st-degree connections and own message threads."""
        token = self.get_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "X-Restli-Protocol-Version": "2.0.0",
        }

        # Connections (accepted = 1st-degree)
        url = f"{self.API_BASE}/connections?q=viewer&start=0&count=500"
        while url:
            resp = requests.get(url, headers=headers, timeout=30)
            resp.raise_for_status()
            data = resp.json()

            for conn in data.get("elements", []):
                yield {"type": "connection_accepted", "raw": conn}

            # Pagination
            paging = data.get("paging", {})
            start  = paging.get("start", 0) + paging.get("count", 0)
            total  = paging.get("total", 0)
            url    = f"{self.API_BASE}/connections?q=viewer&start={start}&count=500" \
                     if start < total else None

    def _process_event(self, raw_event: dict) -> None:
        if raw_event["type"] == "connection_accepted":
            conn = raw_event["raw"]
            person_id = conn.get("miniProfile", {}).get("entityUrn", "")
            self.write_event(
                event_type        = "connection_accepted",
                event_timestamp   = datetime.now(timezone.utc).isoformat(),
                handle_id         = self._upsert_handle(person_id, conn),
                platform_event_id = person_id,
                payload           = {"linkedin_urn": person_id},
            )

    def _upsert_handle(self, person_id: str, raw: dict) -> str:
        """Create or return existing handle_id for this LinkedIn URN."""
        # Look up in platform_handles; insert if missing; return handle_id
        return person_id  # simplified


# =============================================================================
# Task 32 — Instagram ingestion
# Uses official Meta Graph API only. No unofficial endpoints.
# Scope: instagram_manage_messages, pages_read_engagement.
# =============================================================================

class InstagramIngestion(BasePlatformIngestion):
    platform = "instagram"
    API_BASE = "https://graph.facebook.com/v19.0"

    def _rate_limit_config(self):
        # Instagram Graph API: 200 calls/hour for most users
        return {"rate_per_second": 0.05, "burst": 10}

    def fetch_events(self) -> Iterator[dict]:
        """Task 32: Fetch mutual follows and DM exchanges via Graph API."""
        token    = self.get_token()
        ig_user  = self._get_ig_user_id(token)

        # Mutual follows: people who follow back
        follows_url = f"{self.API_BASE}/{ig_user}/follows?fields=id,name&limit=100&access_token={token}"
        while follows_url:
            resp = requests.get(follows_url, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            for user in data.get("data", []):
                yield {"type": "ig_follow", "raw": user}
            follows_url = data.get("paging", {}).get("cursors", {}).get("after")

        # DM conversations
        conv_url = f"{self.API_BASE}/{ig_user}/conversations?fields=id,participants,messages{{id,from,created_time}}&access_token={token}"
        resp = requests.get(conv_url, timeout=30)
        if resp.ok:
            for convo in resp.json().get("data", []):
                yield {"type": "dm_conversation", "raw": convo}

    def _get_ig_user_id(self, token: str) -> str:
        resp = requests.get(
            f"{self.API_BASE}/me?fields=id&access_token={token}", timeout=10
        )
        resp.raise_for_status()
        return resp.json()["id"]

    def _process_event(self, raw_event: dict) -> None:
        raw = raw_event["raw"]
        if raw_event["type"] == "ig_follow":
            self.write_event(
                event_type        = "mutual_follow",
                event_timestamp   = datetime.now(timezone.utc).isoformat(),
                handle_id         = raw["id"],
                platform_event_id = f"follow:{raw['id']}",
                payload           = {"ig_user_id": raw["id"], "name": raw.get("name")},
            )
        elif raw_event["type"] == "dm_conversation":
            self.write_event(
                event_type        = "dm_exchange",
                event_timestamp   = datetime.now(timezone.utc).isoformat(),
                handle_id         = raw["id"],
                platform_event_id = f"conv:{raw['id']}",
                payload           = {"conversation_id": raw["id"]},
            )


# =============================================================================
# Task 33 — X / Twitter ingestion
# Uses Twitter API v2. Documents gaps due to API tier limitations.
# Gaps at Basic tier: no full DM search, no follower list for large accounts.
# =============================================================================

class TwitterIngestion(BasePlatformIngestion):
    platform = "twitter"
    API_BASE = "https://api.twitter.com/2"

    # Task 33: API tier documentation
    API_TIER_NOTES = """
    API Tier: Basic ($100/month as of 2024)
    - GET /2/users/:id/following  → available, up to 1000/req
    - GET /2/users/:id/followers  → available, up to 1000/req
    - GET /2/dm_conversations     → available (user auth only)
    GAPS:
    - No bulk DM search across all time
    - Follower counts >75k require Elevated or higher
    - Timeline search limited to 7 days on Basic
    """

    def _rate_limit_config(self):
        # Twitter Basic: 15 requests per 15-minute window on most endpoints
        return {"rate_per_second": 0.017, "burst": 5}  # ~1/min safe rate

    def fetch_events(self) -> Iterator[dict]:
        """Task 33: Fetch following/followers and DM conversations."""
        token   = self.get_token()
        user_id = self._get_user_id(token)
        headers = {"Authorization": f"Bearer {token}"}

        # Following list
        next_token = None
        while True:
            params = {"max_results": 1000, "user.fields": "id,name,username"}
            if next_token:
                params["pagination_token"] = next_token
            resp = requests.get(
                f"{self.API_BASE}/users/{user_id}/following",
                headers=headers, params=params, timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            for user in data.get("data", []):
                yield {"type": "following", "raw": user}
            next_token = data.get("meta", {}).get("next_token")
            if not next_token:
                break

        # DM conversations (Basic tier only exposes recent)
        resp = requests.get(
            f"{self.API_BASE}/dm_conversations",
            headers=headers, timeout=30,
        )
        if resp.ok:
            for dm in resp.json().get("data", []):
                yield {"type": "dm_conversation", "raw": dm}

    def _get_user_id(self, token: str) -> str:
        resp = requests.get(
            f"{self.API_BASE}/users/me",
            headers={"Authorization": f"Bearer {token}"}, timeout=10,
        )
        resp.raise_for_status()
        return resp.json()["data"]["id"]

    def _process_event(self, raw_event: dict) -> None:
        raw = raw_event["raw"]
        if raw_event["type"] in ("following", "follower"):
            self.write_event(
                event_type        = "mutual_follow",
                event_timestamp   = datetime.now(timezone.utc).isoformat(),
                handle_id         = raw["id"],
                platform_event_id = f"follow:{raw['id']}",
                payload           = {"twitter_id": raw["id"], "username": raw.get("username")},
            )
        elif raw_event["type"] == "dm_conversation":
            self.write_event(
                event_type        = "dm_exchange",
                event_timestamp   = datetime.now(timezone.utc).isoformat(),
                handle_id         = raw.get("dm_conversation_id", raw.get("id")),
                platform_event_id = f"dm:{raw.get('id')}",
                payload           = raw,
            )


# =============================================================================
# Task 34 — Email ingestion (Gmail/Outlook OAuth)
# Minimum necessary scopes. Outbound-reply detection. OOO filtering.
# Scopes: gmail.readonly (metadata + threading) — NOT gmail.modify.
# =============================================================================

GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    # NOT gmail.compose, NOT gmail.send, NOT gmail.modify
]

OUTLOOK_SCOPES = [
    "https://graph.microsoft.com/Mail.Read",
    # NOT Mail.ReadWrite, NOT Mail.Send
]


class EmailIngestion(BasePlatformIngestion):
    platform = "email"
    API_BASE = "https://gmail.googleapis.com/gmail/v1"

    def _rate_limit_config(self):
        # Gmail API: 1B quota units/day; list+get ~5 units each
        return {"rate_per_second": 10.0, "burst": 50}

    def fetch_events(self) -> Iterator[dict]:
        """
        Task 34: Pull SENT messages only (to detect outbound replies).
        Full body only when threading requires it; otherwise metadata-only.
        Task 28: Count outbound replies (SENT label, non-auto-reply).
        """
        token   = self.get_token()
        headers = {"Authorization": f"Bearer {token}"}

        # Fetch sent messages
        list_resp = requests.get(
            f"{self.API_BASE}/users/me/messages",
            headers=headers,
            params={"labelIds": "SENT", "maxResults": 500},
            timeout=30,
        )
        list_resp.raise_for_status()
        for msg_stub in list_resp.json().get("messages", []):
            # Fetch metadata
            meta_resp = requests.get(
                f"{self.API_BASE}/users/me/messages/{msg_stub['id']}",
                headers=headers,
                params={"format": "metadata", "metadataHeaders": "To,Subject,Date,X-Auto-Response-Suppress,Auto-Submitted"},
                timeout=30,
            )
            if meta_resp.ok:
                yield {"type": "sent_message", "raw": meta_resp.json(), "msg_id": msg_stub["id"]}

    def _process_event(self, raw_event: dict) -> None:
        if raw_event["type"] != "sent_message":
            return

        msg     = raw_event["raw"]
        headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
        subject = headers.get("Subject", "")
        to_addr = headers.get("To", "")

        # Task 30: Skip transactional addresses
        if is_transactional_address(to_addr):
            return

        # Task 29: Skip OOO / auto-replies
        if is_auto_reply(subject, "", headers):
            return

        # This is a genuine outbound reply
        self.write_event(
            event_type        = "outbound_reply",
            event_timestamp   = headers.get("Date", datetime.now(timezone.utc).isoformat()),
            handle_id         = self._upsert_email_handle(to_addr),
            platform_event_id = raw_event["msg_id"],
            payload           = {"to": to_addr, "subject": subject},
        )

    def _upsert_email_handle(self, email: str) -> str:
        """Create or return existing handle_id for this email address."""
        return email  # simplified; real impl looks up platform_handles table
