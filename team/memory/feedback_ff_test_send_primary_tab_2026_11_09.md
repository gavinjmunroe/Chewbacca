---
name: feedback_ff_test_send_primary_tab_2026_11_09
description: Before a new sending domain's first cold email, send the exact batched email to a Gmail we can read and check the tab; List-Unsubscribe pushed FF's to Updates.
metadata:
  type: feedback
---

Before the first cold email from a new domain goes out, send that exact batched
email (built the way Dough builds it, only the To changed) from the sending
inbox to a Gmail we can read, and check where it lands. Dough's stress check
lists this as NOT CHECKED, and that counts as not done.

On 2026-11-09, firmfoundation.tech's first email (to Northview's Scott Harris)
went to Gavin's Gmail twice with one change. With Dough's mailto
List-Unsubscribe header it landed in the Updates tab; without it, Primary. Both
passed SPF, DKIM and DMARC. An earlier two-line test with no greeting landed in
spam, so content matters too. Gavin asked "will it end up in spam? we need to
make sure this doesnt happen."

**Why:** Gmail reads List-Unsubscribe as mailing-list mail. It only requires
one-click unsubscribe from senders doing 5,000+ a day, and the body's "reply
stop" line is the opt-out, so a low-volume own-inbox campaign doesn't need it.

**How to apply:** Dough's plan `sender.list_unsubscribe: false` turns the header
off (Dough e743e56); DFW has it off (ff-ledger 4c9cc19), every other client
keeps the default. One test per variant is n=1 into a personal Gmail, not a
guarantee for a Workspace inbox, and a 31-day-old domain with no history still
needs warmup before volume.
