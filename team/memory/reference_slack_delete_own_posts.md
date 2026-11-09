---
name: reference_slack_delete_own_posts
description: slackcli has no delete; delete the user's own Slack posts with chat.delete using slackcli's keychain browser tokens, after a dry-run list and a local backup
metadata:
  type: reference
---

slackcli 0.14 can send, edit and react but cannot delete. On 2026-10-12 Caleb
asked to delete the automated posts from his account in #zeutara-cold-replies,
and the working path was the Slack Web API with slackcli's own stored session:

- tokens: `security find-generic-password -s slackcli -a <TEAM_ID>:xoxc -w` and
  the same with `:xoxd`; never print either
- call `https://<workspace>.slack.com/api/<method>` with `token=<xoxc>` in the
  form body and the header `Cookie: d=<xoxd, URL-encoded>`; without the
  encoding Slack answers `invalid_auth`
- `conversations.history` plus `conversations.replies` for threads, filter to
  the user's own messages, print the list, save it to a local JSON backup,
  then `chat.delete` one at a time with about a second between calls
- read the channel again afterward and count what is left

17 posts were deleted that night and the backup is
zeutara-data/slack-deleted-2026-10-12.json (private data repo).

Related: [[feedback_client_channels_are_togari]].
