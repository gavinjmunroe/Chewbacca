---
name: order-for-me
description: "Order things for the user by a date: costumes, gifts, supplies, anything off a list. Use for order these, buy this, get this here by Friday, or a shopping list they texted themselves."
triggers: >-
  The user wants physical things bought and delivered by a deadline. Use for "order these", "order all of them", "buy this", "get it here by Friday", "we need them for the party", "pay extra for faster delivery", a shopping list they texted themselves or pasted from ChatGPT, a costume, a gift, or when someone else (a parent, a roommate) will pay and place the order.
---

# Order for me

Getting it ordered isn't the job. The job is having the right thing in their hands
before the date. Every lesson here comes from one night, 2026-10-26, ordering an
Adventure Time Finn and Jake costume for a Friday party, over five rounds of
corrections.

## Before anything else, in one message

1. **Find the list.** "What I texted myself" is the iCloud self thread, not his
   phone number, and `people texts me` resolves "me" to a roommate. A ChatGPT
   share reads as "unsupported content", so decode its attributedBody before
   saying the thread is empty (team memory `feedback_self_text_rich_message_unread`).
2. **Ask every fact you'll need in ONE line:** sizes for anything sized, the
   delivery address, and whose account pays. That night sizes came a round late,
   then "My Mom has amazon prime" came after a sign-in dead end.
3. **Name the deadline as a date** ("Friday 10/30 night" means in hand by Thu 10/29).

## Check every item, not one

- **Read the delivery date on EVERY item for the real ZIP before calling the list
  orderable.** One shirt said "Prime tomorrow" and got reported as the whole list.
  The 3-piece hat set shipped after Halloween and he caught it: "Oh shoot some of
  them arrive after halloween". Amazon search results show the date logged out
  (`[data-cy=delivery-recipe]` per result, default ZIP shown in the header), so
  read them in one script per search and keep only dates before the deadline.
- **A list from ChatGPT is a lead, not a cart.** Its four items had a seller that
  had stopped Halloween orders, a dead product page, and a shirt shipping from
  China (7 to 9 days express). Check stock, size and ship origin for each one.
- **Rank the options by arrival date first and price second.**

## Match the thing he pictured

- Name what the item looks like, not just its title. A costume piece has to read
  as the character. "Bro the ears are so gay" killed a dog-ears headband, and "I
  need one with the jake face on it" killed a plain yellow beanie. Look at the
  product image before you suggest it.
- **Search every store before saying it doesn't exist:** Amazon, then Hot Topic
  and BoxLunch for licensed character gear, then Target, Walmart and Spirit
  Halloween. "Ok check other sites bruh" came after Amazon alone was reported. The
  real Jake face hat was at Hot Topic, with same-day pickup.

## Who actually buys

- The agent can't sign in or type a password. If Chrome isn't signed into the
  store, that's a `BLOCKED:` line, and the useful deliverable is a text the buyer
  can act on.
- When a parent pays, hand over paste-ready lines in his voice: one item per
  line, its link at the end, size in the line, and "ship it all to me at USC".
  Never use a colon list like "Item: link". Measured from his texts, he doesn't
  write that way.
- When the agent does place the order, confirm the items and the total in one
  line first, then place it. "Full permission" means he wants it bought, and he
  still sees the total before it's charged.

## Never

- Never report a delivery date you read for a different item.
- Never send the anti-pattern from the brief silently. If the item he named can't
  arrive in time, say so and give the swap that can.
- Never end on "lmk" or "say the word". Do the next check yourself.
