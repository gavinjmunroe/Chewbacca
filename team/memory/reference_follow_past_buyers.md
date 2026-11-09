---
name: reference_follow_past_buyers
description: Follow past buyers lane (tools/creator_gtm/follow_buyers.py): a brand person who paid a client's creators becomes a warm row at their new brand; Findymail returns old-employer inboxes, people search misses "influencer manager" titles, the watcher is a Clay JobChange signal (Sabo, 10/16)
type: reference
---

Follow past buyers is a creator-GTM lane in the kit, `tools/creator_gtm/follow_buyers.py` (landed a8f54457, docs in `library/gtm/follow-buyers/`, built on `tools/brand_buyer.py`). Seeds are brand-side people who already paid the client's creators, kept in a buyers.json next to the brand-buyer client file. A seed whose current domain isn't one they paid from gets a row for the new brand with Status "Warm: past buyer moved", a Why line naming them and the history, and the rest of the team from Clay's people search. The deal history is the client's own, so no data vendor has these leads.

What the first live run taught (Sydney Wild, NOCCO USA to Archer Meat Snacks, 2026-10-16, 1.7 credits):

- Findymail's LinkedIn lookup returned sydney.wild@vitaminwell.com, the inbox at the parent she left, and ZeroBounce called it valid. A live old-employer inbox is not a way in. The lane only counts an email at the new brand's domain and otherwise writes "needs work: off-domain" plus any verified teammate as the door.
- Clay's people search at archerjerky.com did not return her: "Social Media and Influencer Manager" matches none of the brand-buyer include keywords. Adding "influencer manager" and "social media" would catch that class of title. The seed is still pushed to first pick when the search does find them, since paying the client's creators beats any title score.
- Claygent research rows are a good seed source. The NOCCO row's evidence named her old remit and her current role with dates.

The recurring watcher must run on Clay's side, never on a Mac loop (Caleb, 2026-10-16). It's a Clay JobChange signal watching the seeds' LinkedIn URLs, billed per record checked, created Paused then resumed. Sabo has no Clay workspace. His table lives in Blue Modern Advisory's workspace (1149025), the one workspace Caleb is allowed to build Chewbacca work in, and Caleb said on 2026-10-16 that the spend is too small to disrupt BMA. BMA's own JobChange signal there (sig_0tin8nvtDe4y8YqKQUd) belongs to BMA and stays untouched. The watcher wasn't created on 10/16 because `chewbacca clay` has no signal-create op and the clay CLI's session was on Jonah's workspace. `chewbacca clay signal-list ws=<id>` reads every signal without the 20k cap.
