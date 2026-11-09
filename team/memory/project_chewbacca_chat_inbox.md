---
name: project_chewbacca_chat_inbox
description: chewbacca chat is the one-inbox layer (CHW-202): Synapse plus 11 mautrix bridges on 127.0.0.1, rows into people.db, people send --via any network; what each of 23 networks gets and why.
metadata:
  type: project
---

`chewbacca chat` (bin/chewbacca-chat) runs Synapse v1.162.0 and one pinned
mautrix bridge per network in the Docker Compose project `chewbacca-chat`,
data in ~/.chewbacca/matrix (0700). Built 2026-10-10 for CHW-202 after Caleb
asked for a Beeper-style inbox ("we gotta mog").

- Bridged: Signal, Telegram, Discord, Instagram, Messenger, X DMs, Google
  Messages, Google Chat, Google Voice, LinkedIn, Bluesky. All AGPL-3.0, run
  unmodified from upstream images; the kit never links their code.
- Existing paths kept as primary: iMessage and SMS relay (chat.db), WhatsApp
  (wacli), Slack (slacrawl), email (gws, chewbacca office; replies stay
  drafts), GroupMe (read-only tab), Teams (office chat list only), calls
  (CallHistory, `people calls`), Brightspace and Handshake (chewbacca api).
- Skipped, no maintained open bridge: Snapchat, LINE, WeChat.
- Synapse over continuwuity: mautrix documents and tests against Synapse.
- Telegram needs an api_id/api_hash from my.telegram.org on his own account;
  the container waits for it instead of crash-looping.
- Identity: a ghost is filed by the network-verified number
  (com.beeper.bridge.identifiers) or its Matrix id, never a display name.
- Measured idle on 2026-10-10: about 400 MB RAM for the whole stack, about
  3 GB of images.

The full verdict per network lives in config/chat/networks.json.
