# docs/tos_compliance_matrix.md
# Task 73: Per-platform ToS compliance matrix. Review quarterly (Task 90).

| Platform      | What We Ingest                                             | API Endpoint                                      | ToS Clause                                                                                       | Last Reviewed |
|---------------|-----------------------------------------------------------|---------------------------------------------------|--------------------------------------------------------------------------------------------------|---------------|
| LinkedIn      | Own 1st-degree connections, own message metadata          | `GET /v2/connections`, `GET /v2/messages`         | §8.2: May not scrape. 1st-party API access of own data is permitted.                            | 2025-01-01    |
| Instagram     | Mutual follows, DM conversation IDs (no content)          | Graph API `/me/follows`, `/me/conversations`      | Meta Platform Policy §3.2: No user data beyond what serves the authenticated user.              | 2025-01-01    |
| X / Twitter   | Following/followers list, DM conversation pairs           | `GET /2/users/:id/following`, `/2/dm_conversations` | Developer Agreement §II.C: Don't store data beyond 30 days unless user explicitly requests.   | 2025-01-01    |
| Email (Gmail) | SENT folder message metadata (To, Date, Subject headers)  | Gmail API `messages.list` (labelIds=SENT, metadata-only) | Gmail ToS / API Services User Data Policy: Must disclose data use; minimum necessary scopes. | 2025-01-01    |
| Email (Outlook)| SENT folder message metadata                             | Microsoft Graph `GET /me/mailFolders/SentItems/messages` | Microsoft API ToS §6: Data minimization, user consent required.                             | 2025-01-01    |
| GitHub        | Own following/followers, own repo collaborators           | `GET /user/following`, `/repos/:repo/collaborators` | GitHub ToS §D.5: Content license; no automated data collection for competitive purposes.      | 2025-01-01    |
| Reddit        | Own DM inbox/outbox                                       | `GET /message/messages`                           | Reddit API Terms: "Personal use" only. No user data aggregation.                               | 2025-01-01    |
| YouTube       | Own subscriptions, comments on own videos                 | `GET /youtube/v3/subscriptions`, `/commentThreads` | YouTube API Services ToS §III.J: No caching beyond stated limits.                             | 2025-01-01    |
| Substack      | Own subscriber CSV export (uploaded by user)             | No API — user-uploaded CSV export                 | Substack ToS: No third-party API. We use user's own first-party export only.                   | 2025-01-01    |
| Stack Overflow | Own questions/answers + respondents                      | Stack Exchange API v2.3 `/users/:id/questions`    | CC BY-SA 4.0 for public data. API ToS: Must not impersonate or harvest personal data.          | 2025-01-01    |

**Review cadence:** Quarterly. If a platform changes ToS, activate kill switch immediately (Task 74) and update this table within 48 hours.
