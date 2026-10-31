---
name: find-email
description: "Find a real email address for someone the user knows: a friend, mentor, classmate or old teammate. Use when building a cc or bcc list, an update email, or when the user asks what someone's email is."
---

# Find an email

Most friends only ever text from a phone number, so the obvious places come back
empty. The address is usually sitting in one of seven places. Check all of them
before telling the user it can't be found, and never fill the gap with a guess.

## Never

- Never give an address you didn't see. On 2026-10-31 a guessed
  `jtlu-morris@icloud.com` went into a list; the real ones were in his texts all
  along (`jt.lumorris@gmail.com`, `lumorris@usc.edu`). A guess is a bounce, or a
  stranger.
- Never reuse an address because it showed up once in some cc line. Joel George's
  church-network address came from one cc on someone else's email, and Caleb
  said "that isn't joel georges email we messed up last time".
- Never send someone who left a school to their school address. Taylan finished
  at Caltech, so `@caltech.edu` was dead (Caleb: "Taylan is no longer at caltech").
  High school `@student.smusd.us` addresses are dead after graduation too.
- Never match on a first name. "Ruchir" got added as "Ruchi Goat USC", and that
  turned out right only because Caleb said so. Ask, or run `people brief`.

## The seven places, in order

1. Contacts with an email: the AddressBook databases under
   `~/Library/Application Support/AddressBook/Sources/*/AddressBook-v22.abcddb`,
   table `ZABCDEMAILADDRESS` joined to `ZABCDRECORD`.
2. iMessage threads that run on an email address. People who iMessage from an
   Apple ID show up as `handle.id` with an `@`. On 10/31 this found 152 handles,
   most not saved to any contact. Needs `RAW_MESSAGES_OK=1` past chatdb-guard.
3. Their own texts: `people texts "<name>" --limit 5000 | grep -o <email regex>`.
   People paste their email when someone asks.
4. Gmail headers: `search_threads` with the name, then read `to`, `cc` and
   `bcc`. Calendar invites land here too, with every attendee's address.
5. Git commit authors across `~/code`, only in repos the user also committed
   to (otherwise you get every open source author). Nathan Chan's only email on
   earth was one commit on christlete.
6. GitHub: `gh api "search/commits?q=author:<login>"` for anyone who's a
   collaborator. Otis's CMU address and Brian's gmail came from here.
7. Group chats: list a chat's members (`chat_handle_join`) to get everyone in a
   friend group at once, then run steps 1 to 6 on each.

Whatever's left after all seven only texts from a phone. Say so in one line and
give the user a "what's ur email" text to send.

## Keep the result

When the list is people the user wants to stay close to, save it to the brain
(one row per person, name, email, relationship) and put them in a `people` circle,
so the next update doesn't start from scratch. On 10/31 that's
`domains/relationships/inner-circle.md` and the "Inner Circle" circle.
