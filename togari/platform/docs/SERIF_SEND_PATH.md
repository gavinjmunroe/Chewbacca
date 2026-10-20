# Serif reply sending — where it stands and what the DWD grant would buy

Internal note. Not for Serif.

## Resolved: Clay sends the replies

Approved replies POST back to Clay, which sends them with its "reply to lead in
a campaign" action out of the campaign's own Smartsenders mailbox. The prospect
gets an answer from the address and the name they wrote to, threaded natively.
We never touch the 30 inboxes and no delegation is involved.

This makes the whole persona problem disappear — no domain switch, no
per-persona `serifhealth.com` addresses, no handoff line on Rafiq threads, and
Arham and Whitney approve from Slack instead of logging into anything.

Wiring: `sendMethods` includes `'clay'` and `clayReplyWebhookUrlEnv` names the
env var holding the Clay webhook URL (`REPLYBOT_SERIF_CLAY_REPLY_URL`). The URL
carries a UUID and is itself the credential.

The one hard requirement is that **lead id and campaign id reach the click**.
Clay's action is keyed on them, and they have to survive the inbound payload,
the card's button value, the review thread's rebuilt confirm button, and the
edit modal's private_metadata. Each of those hops builds its own value rather
than forwarding the last, which is exactly how they get dropped —
`__tests__/clay-reply-send.test.ts` covers each hop for that reason.

The route is stamped on the card as `sendVia` at mint time rather than inferred
from the ids being present. Inferring would mean a reply that lost `lead_id`
silently falls back to Gmail and mails the prospect from the wrong mailbox
under the wrong persona. Stamped, a missing id throws at send time instead.
First-touch outreach (website form fills) has no campaign to reply into, so
those cards stamp nothing and keep using `sendMethods[0]`, which stays `gmail`.

## Historical: what a domain-wide delegation grant would have bought

Kept because the question comes up for every client, and because it's the
fallback if Clay's reply action ever proves unreliable.

## What domain-wide delegation actually does

Worth separating from the webhook, because they're unrelated mechanisms.

DWD is a grant in a Google Workspace admin console that lets our GCP service
account **impersonate any user in that workspace** for a named set of scopes.
Once granted, we mint a token with `subject: <mailbox>` and call Gmail as that
mailbox:

```
POST https://gmail.googleapis.com/gmail/v1/users/rafiq@serif-outreach.com/messages/send
```

The mail genuinely originates from that mailbox: its SPF/DKIM, its Sent folder,
native threading. This is exactly what `sendReplyEmail` in
`smartlead-responder/slack-actions.ts` already does — the only thing hardcoded
is *which* address it impersonates (`client.sender.email`).

Two properties that matter:

- **The grant is per workspace, not per mailbox.** One grant on the workspace
  holding the sending domains covers all 30 inboxes. Nobody logs in to
  anything, and no passwords are ever handled. That's the whole appeal.
- **It's a broad grant.** It authorizes impersonation of *every* user in that
  workspace for those scopes. Admins reasonably push back on it, so expect the
  question and scope it to `gmail.send` + `gmail.compose` only.

## The webhook question

The webhook has nothing to do with the grant. To send from the right mailbox we
need exactly two things, and only one of them is in question:

1. **The Message-ID** of the prospect's reply, for `In-Reply-To` / `References`.
   We have this — it's already in the payload and already drives threading.
2. **The mailbox address that received the reply**, as the impersonation
   subject. This is the open item.

So the concern isn't that a Message-ID is too little to send with. It's that a
Message-ID alone doesn't say *which mailbox to send from*.

That's very likely already solved: BMA's Clay column maps `from_email` to
`{{sending_mailbox}}` (see `docs/BMA_REPLYBOT_CLAY_COLUMN.md`), so Clay holds
the sending mailbox as a column. Our `normalizePayload` has always read it
(`from_email`, `email_account`, `sending_email`, `from_account`) and simply
never used it downstream — until now, since the Slack card prints it.

**Next step: capture one real Serif webhook payload and look.** If the mailbox
is in there under any of those names, the remaining work is small — resolve the
impersonation subject from `reply.sendingEmail` instead of `client.sender.email`,
falling back to the configured sender. If it isn't, add it as a Clay column,
which is a Clay-side change and not an engineering one.

## No longer blocking

The fork that used to matter — whose Google Workspace holds the 30 Smartsenders
domains — is moot now that Clay does the sending. Same for DWD on
`serifhealth.com`: still ungranted, still blocks Gmail sends, and Serif's reply
path no longer depends on it. It's only needed if we want website form-fill
outreach to send, which is the one Serif path still on `sendMethods[0]`.

## Still outstanding

- `REPLYBOT_SERIF_CLAY_REPLY_URL` needs the real Clay webhook URL set in
  Railway. Until it is, Send fails loudly rather than sending wrongly.
- Confirm Clay's reply action accepts the field names we POST (`lead_id`,
  `campaign_id`, `email`, `subject`, `body`, `in_reply_to`). Adjust
  `sendViaClay` if Clay expects different ones.
- `demoCalendarUrl` (the rosettafest Calendly link) is out of reply drafts but
  still injected into every website form-fill outreach draft by `draftOutreach`
  in `classifier.ts`. The link name suggests it may be event-stale. Undecided.
