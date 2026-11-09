---
name: reference_usc_mobile_order_transact
description: USC mobile order is Transact Mobile Ordering (campus 155); its web build reads every spot's live wait and menu as a guest; ordering and balances need a USC password session; bin/usc-food never places an order
metadata:
  type: reference
---

USC mobile order runs on Transact Mobile Ordering, the "USC Campus Dining" app (hospitality.usc.edu/mobile-ordering, 18 locations, pay by card, USCard Discretionary, Dining Dollars or Campus Center Meal Swipes at select RTCC venues). Balances live in Transact eAccounts at usc-sp.transactcampus.com (mycard.usc.edu/login).

**What reads as a guest (2026-10-13):** Transact's web build, weborder.transactcampus.com, posts to mobileorderprodapi.transactcampus.com/api_weborder/. `loginforweb` with campusid 155 returns all 32 USC locations with is_currently_takeout_open, estimated_wait_time (min), order_queue_count, busy flag and hours. `getmenu` returns sections, items with price_display in cents, dietary tags, the tenders each spot takes, ASAP minutes and pickup slots. Each request carries an HMAC-SHA256 hash of endpoint+uuid+campusid+locationid+userid+token, keyed by Constants.loginHashKey in the public bundle. api-anything can't replay that (the hash changes per location), so `bin/usc-food` signs it itself.

**What needs a sign-in:** calculatecart, the order endpoints (processorderstaged, processorderstatuscheck) and balances. Transact signs in through samllogin to Shibboleth to login.usc.edu, and so does eAccounts. Chrome's USC Shibboleth session lasts hours, not days: at 8 hours old it stopped on login.usc.edu's password page. Entra's persistent cookies (what usc-parking rides) don't reach it.

**How to apply:** `chewbacca usc food` (bin/usc-food) is the entry: now, spots, menu, hall, lunch, cart, place, balance. Placing is not built: transact() refuses everything but loginforweb and getmenu, and `place` needs the owner's press through send_approval.take(always_press=True), which ignores the agents-send-by-default mode, because spending is always a press. Don't add an order call without a signed-in session and that press in front of it. Halls have no busy signal from any source. Related: [[project_chewbacca_usc_stack_wedge]], [[feedback_agents_send_by_default]].
