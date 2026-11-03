---
name: project_ff_outbound_eye_review_2026_11_03
description: Firm Foundation's 11/3 outbound list, 104 churches checked by eye from 1,297 audited, and the rules it set
metadata:
  type: project
---

Firm Foundation's 11/3 outbound list came from re-auditing all 1,297 in-band churches (688 SoCal, 609 DFW) with phone screenshots, then having reviewer agents check every claim by eye and live. 685 had a reachable email. 104 scored 4 or 5 (48 SoCal, 56 DFW, 21 fives). The pipeline is in the FF repo at ops/review (632b0e8), and the working files are in ~/code/ff-reaudit-1103.

Rules that came out of it:

- The audit script can't judge a site. On 11/3 it told Legacy Church of Downey their 10:30 time was 8 screens down when it sat on screen 2 in a flyer image. Caleb: "Bro I hva. feeling ur being rlly stupid with how you go abt grading a church's site". Every line gets checked on the screenshot and live before it goes out, and the line leads with what a guest notices first.
- No LDS, no LGBT-affirming churches, no cults or heresy (Oneness, Unity, Christian Science, UBF, Celestial and other Aladura churches and the like). Caleb, 11/3: "No LDS or woke ahh LGBT churches!!!!!", "Or other heresy", "Wack theology and whatnot". exclude.py keeps the church's own phrase as proof.
- Every email gets reviewed with Caleb one at a time (feedback_ff_outbound_one_email_at_a_time).
- The email's "one of N fixes" comes from that church's fix list, never typed by hand. 8 of the first 61 lists confirmed fewer items than the line promised.

Open as of 11/3: whether HFF DFW (Saturday Sabbath, feast pages) stays, three progressive-denomination churches with no explicit affirming statement, and Spanish or Portuguese emails for Iglesia CAFE, IBFH and ADMES.
