---
name: feedback_ff_outbound_one_email_at_a_time
description: Firm Foundation outbound goes through Caleb one email at a time, never as a batch ok
metadata:
  type: feedback
---

Firm Foundation's cold emails (SoCal from caleb@firmfoundation.tech, DFW from gavin@firmfoundation.tech) are reviewed with Caleb one email at a time. Caleb, 2026-11-03: "For now on outbound I wanna go through each email manually w you 1 at a time". Gavin has said Caleb can send from any inbox, his included.

Show one email whole: the recipient and their role, the subject, the body, and today's audit evidence for every claim in its first line. Point out what's weak and propose a fix. Wait for his edits or his ok on that one email, then show the next one. Never ask for an ok on a whole batch.

Before showing an email, check its fix count against today's `audit_site.py --browser` run, counting the two service-time rows as one fix. On 11/3 West Valley's line said 5 fixes when the audit had 4.

Look at the site on a phone yourself before any claim about it goes in a line, by screenshot at 375 wide, the first 3 screens and every page the line names. The audit script reads text and counts pixels, and it can't judge a site. On 11/3 the batch for Legacy Church of Downey said their 10:30 time didn't show until the 8th screen. It sat on the 2nd screen in a flyer image, and Caleb wrote "the address being in the footer isn't the primary reason". Lead with what a guest notices first (a dead I'm New link, a homepage that never says what to do), not with whatever row the script failed first. FF commit 9dd329a now leaves the fold unchecked when a wide image sits above the first text time.
