"""
f_platforms/adapters.py
Tasks 47–56: GitHub, Reddit, YouTube, Substack, Stack Overflow ingestion.
Each adapter includes the one-pager (Task 47) as a docstring.
"""

import logging
from datetime import datetime, timezone
from typing import Iterator

import requests

from d_integrations.base import BasePlatformIngestion

logger = logging.getLogger(__name__)


# =============================================================================
# Task 48 — GitHub
# =============================================================================

class GitHubIngestion(BasePlatformIngestion):
    """
    Task 47 one-pager:
      API: GitHub REST v3 + GraphQL v4
      Rate limits: 5000 req/hour (OAuth); GraphQL 5000 points/hour
      ToS: Data use limited to features providing direct value to the authenticated user.
           No bulk downloading or building competitive products.
      OAuth scopes: read:user, read:org (for org repos) — no write scopes.
      Connection = mutual follow OR shared-repo collaborator
                   OR commented on each other's PRs/issues ≥2x.
    """
    platform = "github"
    API_BASE = "https://api.github.com"

    def _rate_limit_config(self):
        # 5000 req/hr → ~1.4/sec; keep under with headroom
        return {"rate_per_second": 1.0, "burst": 20}

    def fetch_events(self) -> Iterator[dict]:
        token   = self.get_token()
        headers = {"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}

        # Mutual follows
        for endpoint, label in [("/user/following", "following"), ("/user/followers", "follower")]:
            page = 1
            while True:
                resp = requests.get(
                    f"{self.API_BASE}{endpoint}",
                    headers=headers, params={"per_page": 100, "page": page}, timeout=30,
                )
                resp.raise_for_status()
                users = resp.json()
                if not users:
                    break
                for user in users:
                    yield {"type": label, "raw": user}
                page += 1

        # Shared-repo collaborators
        repos_resp = requests.get(
            f"{self.API_BASE}/user/repos", headers=headers,
            params={"affiliation": "owner,collaborator", "per_page": 100}, timeout=30,
        )
        if repos_resp.ok:
            for repo in repos_resp.json():
                collabs_resp = requests.get(
                    f"{self.API_BASE}/repos/{repo['full_name']}/collaborators",
                    headers=headers, timeout=30,
                )
                if collabs_resp.ok:
                    for collab in collabs_resp.json():
                        yield {"type": "repo_collaborator", "raw": collab, "repo": repo["full_name"]}

    def _process_event(self, raw_event: dict) -> None:
        raw = raw_event["raw"]
        etype_map = {
            "following":          "mutual_follow",
            "follower":           "mutual_follow",
            "repo_collaborator":  "repo_collaboration",
            "pr_comment":         "cross_pr_comment",
            "issue_comment":      "cross_issue_comment",
        }
        self.write_event(
            event_type        = etype_map.get(raw_event["type"], raw_event["type"]),
            event_timestamp   = datetime.now(timezone.utc).isoformat(),
            handle_id         = str(raw.get("id")),
            platform_event_id = f"gh:{raw.get('id')}:{raw_event['type']}",
            payload           = {"github_login": raw.get("login"), "github_id": raw.get("id")},
        )


# =============================================================================
# Task 49 — Reddit
# =============================================================================

class RedditIngestion(BasePlatformIngestion):
    """
    Task 47 one-pager:
      API: Reddit OAuth2 REST API (reddit.com/api/v1/*)
      Rate limits: 60 req/min (OAuth)
      ToS: Reddit data may only be used to improve the user's Reddit experience.
           No bulk user data harvesting. Very limited social graph exposure.
      OAuth scopes: privatemessages, identity
      Connection = DM exchange only.
      SCOPE EXPECTATION: Reddit exposes almost nothing of the social graph
      via API. Friend lists are deprecated. This integration captures DM pairs only.
      Known gap: no follower/following list available via API.
    """
    platform = "reddit"
    API_BASE = "https://oauth.reddit.com"

    def _rate_limit_config(self):
        return {"rate_per_second": 0.8, "burst": 15}  # stay under 60/min

    def fetch_events(self) -> Iterator[dict]:
        token   = self.get_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "User-Agent": "ConnectionGraph/1.0 by YourApp",
        }

        # Private messages (DMs)
        after = None
        while True:
            params = {"limit": 100, "where": "messages"}
            if after:
                params["after"] = after
            resp = requests.get(
                f"{self.API_BASE}/message/messages",
                headers=headers, params=params, timeout=30,
            )
            resp.raise_for_status()
            data     = resp.json()["data"]
            children = data.get("children", [])
            if not children:
                break
            for child in children:
                msg = child["data"]
                yield {"type": "dm_message", "raw": msg}
            after = data.get("after")
            if not after:
                break

    def _process_event(self, raw_event: dict) -> None:
        msg  = raw_event["raw"]
        author = msg.get("author", "")
        self.write_event(
            event_type        = "dm_exchange",
            event_timestamp   = datetime.fromtimestamp(
                msg.get("created_utc", 0), tz=timezone.utc
            ).isoformat(),
            handle_id         = author,
            platform_event_id = f"reddit:{msg.get('id')}",
            payload           = {"reddit_username": author, "subject": msg.get("subject", "")},
        )


# =============================================================================
# Task 50 — YouTube
# =============================================================================

class YouTubeIngestion(BasePlatformIngestion):
    """
    Task 47 one-pager:
      API: YouTube Data API v3
      Rate limits: 10,000 quota units/day (each list call = 1–100 units)
      ToS: Must not store data beyond caching. No building of user profiles
           beyond the authenticated user's own data.
      OAuth scopes: https://www.googleapis.com/auth/youtube.readonly
      Connection = channel subscriptions + commenters who replied ≥2x to tenant content.
      KNOWN GAP: YouTube does NOT expose subscriber lists to channel owners via API.
                 Only the authenticated user can see who they subscribe to, not who
                 subscribes to them. Commenter-based connections fill this gap.
    """
    platform = "youtube"
    API_BASE = "https://www.googleapis.com/youtube/v3"

    def _rate_limit_config(self):
        # 10,000 quota units/day → ~0.12/sec conservatively
        return {"rate_per_second": 0.1, "burst": 5}

    def fetch_events(self) -> Iterator[dict]:
        token   = self.get_token()
        headers = {"Authorization": f"Bearer {token}"}

        # Subscriptions (channels the tenant subscribes to)
        page_token = None
        while True:
            params = {"part": "snippet", "mine": "true", "maxResults": 50}
            if page_token:
                params["pageToken"] = page_token
            resp = requests.get(
                f"{self.API_BASE}/subscriptions", headers=headers, params=params, timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            for sub in data.get("items", []):
                yield {"type": "subscription", "raw": sub}
            page_token = data.get("nextPageToken")
            if not page_token:
                break

        # Comments on tenant's videos (commenters who replied ≥2x tracked via events)
        channel_resp = requests.get(
            f"{self.API_BASE}/channels?part=id&mine=true", headers=headers, timeout=10,
        )
        if channel_resp.ok:
            channels = channel_resp.json().get("items", [])
            if channels:
                channel_id = channels[0]["id"]
                # Get recent videos
                search_resp = requests.get(
                    f"{self.API_BASE}/search?part=id&channelId={channel_id}&type=video&maxResults=50",
                    headers=headers, timeout=30,
                )
                if search_resp.ok:
                    for item in search_resp.json().get("items", []):
                        video_id = item["id"]["videoId"]
                        comments_resp = requests.get(
                            f"{self.API_BASE}/commentThreads?part=snippet&videoId={video_id}&maxResults=100",
                            headers=headers, timeout=30,
                        )
                        if comments_resp.ok:
                            for thread in comments_resp.json().get("items", []):
                                comment = thread["snippet"]["topLevelComment"]["snippet"]
                                yield {"type": "video_comment", "raw": comment, "video_id": video_id}

    def _process_event(self, raw_event: dict) -> None:
        raw = raw_event["raw"]
        if raw_event["type"] == "subscription":
            snippet   = raw.get("snippet", {})
            channel   = snippet.get("resourceId", {}).get("channelId", "")
            self.write_event(
                event_type        = "channel_subscription",
                event_timestamp   = snippet.get("publishedAt", datetime.now(timezone.utc).isoformat()),
                handle_id         = channel,
                platform_event_id = f"yt_sub:{channel}",
                payload           = {"channel_id": channel, "title": snippet.get("title")},
            )
        elif raw_event["type"] == "video_comment":
            author_id = raw.get("authorChannelId", {}).get("value", "")
            self.write_event(
                event_type        = "content_comment",
                event_timestamp   = raw.get("publishedAt", datetime.now(timezone.utc).isoformat()),
                handle_id         = author_id,
                platform_event_id = f"yt_comment:{raw.get('id', author_id)}",
                payload           = {
                    "author_channel": author_id,
                    "video_id":       raw_event.get("video_id"),
                    "author_name":    raw.get("authorDisplayName"),
                },
            )


# =============================================================================
# Task 51 — Substack
# =============================================================================

class SubstackIngestion(BasePlatformIngestion):
    """
    Task 47 one-pager:
      API: Substack does not have a public API as of 2024.
      Available via: unofficial endpoints used at user's own risk (ToS grey area),
                     or by the author's own dashboard export.
      ToS: No official third-party API access permitted. All ingestion here
           uses the authenticated user's own session cookie (first-party export).
      Scopes: N/A — session-cookie based.
      Connection = paid subscribers (if tenant is publisher) via dashboard export,
                   and publications the tenant subscribes to.
      KNOWN GAP: No official API. This integration uses the Substack dashboard
                 export CSV. Webhook/real-time updates not available.
                 Re-evaluate when Substack releases a public API.
    """
    platform = "substack"

    def _rate_limit_config(self):
        return {"rate_per_second": 0.5, "burst": 5}

    def fetch_events(self) -> Iterator[dict]:
        """
        Substack: ingestion via CSV export (subscriber list downloaded by the user
        and uploaded to the system). No live API calls to Substack servers.
        """
        # In practice, the user uploads their subscriber CSV.
        # The worker reads from a GCS bucket path written by the upload flow.
        from google.cloud import storage
        import csv, io

        gcs = storage.Client()
        bucket_name = f"tenant-exports-{self.tenant_id}"
        blob_name   = "substack/subscribers.csv"

        try:
            blob    = gcs.bucket(bucket_name).blob(blob_name)
            content = blob.download_as_text()
            reader  = csv.DictReader(io.StringIO(content))
            for row in reader:
                yield {"type": "paid_subscriber", "raw": row}
        except Exception as exc:
            logger.warning("Substack CSV not found for tenant %s: %s", self.tenant_id, exc)

    def _process_event(self, raw_event: dict) -> None:
        raw = raw_event["raw"]
        email = raw.get("email", "")
        if not email:
            return
        self.write_event(
            event_type        = "paid_subscriber",
            event_timestamp   = raw.get("created_at", datetime.now(timezone.utc).isoformat()),
            handle_id         = email,
            platform_event_id = f"substack_sub:{email}",
            payload           = {"email": email, "name": raw.get("name")},
        )


# =============================================================================
# Task 52 — Stack Overflow
# =============================================================================

class StackOverflowIngestion(BasePlatformIngestion):
    """
    Task 47 one-pager:
      API: Stack Exchange API v2.3 (stackexchange.com/docs/v2.3)
      Rate limits: 10,000 requests/day (with key); 300 req/sec burst
      ToS: Data is CC BY-SA 4.0. No scraping beyond the API. User data is public.
      OAuth scopes: no_expiry, private_info (to get own user data)
      Connection = users who answered/commented on the tenant's questions
                   AND vice versa ≥2x (bi-directional interaction).
    """
    platform = "stackoverflow"
    API_BASE = "https://api.stackexchange.com/2.3"

    def _rate_limit_config(self):
        return {"rate_per_second": 2.0, "burst": 30}

    def fetch_events(self) -> Iterator[dict]:
        token   = self.get_token()
        app_key = self.get_secret_static("stackoverflow-app-key")

        user_id = self._get_user_id(token)

        # Questions tenant asked
        q_resp = requests.get(
            f"{self.API_BASE}/users/{user_id}/questions",
            params={"site": "stackoverflow", "key": app_key, "filter": "withbody", "pagesize": 100},
            timeout=30,
        )
        if q_resp.ok:
            for q in q_resp.json().get("items", []):
                # Answers on tenant's questions
                a_resp = requests.get(
                    f"{self.API_BASE}/questions/{q['question_id']}/answers",
                    params={"site": "stackoverflow", "key": app_key, "pagesize": 100},
                    timeout=30,
                )
                if a_resp.ok:
                    for answer in a_resp.json().get("items", []):
                        yield {
                            "type": "answer_on_my_question",
                            "raw":  answer,
                            "question_id": q["question_id"],
                        }

        # Answers tenant gave
        a_resp = requests.get(
            f"{self.API_BASE}/users/{user_id}/answers",
            params={"site": "stackoverflow", "key": app_key, "pagesize": 100},
            timeout=30,
        )
        if a_resp.ok:
            for answer in a_resp.json().get("items", []):
                yield {"type": "my_answer", "raw": answer}

    def _get_user_id(self, token: str) -> str:
        resp = requests.get(
            f"{self.API_BASE}/me",
            params={"site": "stackoverflow", "access_token": token},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()["items"][0]["user_id"]

    def get_secret_static(self, name: str) -> str:
        from d_integrations.base import get_secret
        return get_secret(name)

    def _process_event(self, raw_event: dict) -> None:
        raw = raw_event["raw"]
        owner = raw.get("owner", {})
        user_id = str(owner.get("user_id", ""))
        if not user_id:
            return
        self.write_event(
            event_type        = "cross_qa_interaction",
            event_timestamp   = datetime.fromtimestamp(
                raw.get("creation_date", 0), tz=timezone.utc
            ).isoformat(),
            handle_id         = user_id,
            platform_event_id = f"so:{raw_event['type']}:{raw.get('answer_id', user_id)}",
            payload           = {
                "so_user_id":   user_id,
                "display_name": owner.get("display_name"),
                "link":         owner.get("link"),
                "event_type":   raw_event["type"],
            },
        )
