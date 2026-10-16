---
name: reference_clay_people_search_finds_buyers
description: How Clay's native people search finds the person who pays creators instead of the creators: identifiers_only beats the 20k read cap, buyer keywords, off-domain email check, Jev score floor (Sabo, 2026-10-16)
metadata:
  type: reference
---

Clay's "Find contacts at company" column (`cpj-find-lists-of-people-v2`) is the cheap way to find a brand's creator buyer, at about 0.5 credits a search. On 2026-10-16 four settings turned it from finding the wrong people to finding Alexa Kinoshita at Gymshark, Ava Paszkiewicz at Celsius and Scout Brown at Barebells, all with ZeroBounce-valid emails and no hand step. The code is `live_chain.py` in `~/Downloads/Sabo handoff/claude/`, with 18 tests in `test_live_chain.py`.

- Turn on `identifiers_only=true`. With full profiles a person runs 5,000 to 25,000 chars. Celsius at limit 2 came to 49,826 chars, and the engine's background row read refuses anything over 20,000, so that row could never be read again, not even to rerun it. With identifiers_only, 5 people came to about 2,800 chars for the whole row, and title, name and LinkedIn URL still come back. That leaves room for limit 5 to 10, which ranking and retry need.
- Use buyer words for the title keywords. With "influencer, creator, social, athlete, ambassador, community", all 5 Gymshark hits were people the brand pays: an Influencer, an Ambassador, a Content Creator and 2 Athletes. Includes that worked: influencer marketing, partnership, creator marketing, social media manager, brand manager, community manager, marketing manager. Add to the excludes: ambassador, athlete, content creator, model.
- A valid email at another company means you have the wrong person. The Gymshark search returned a "Social Media Ambassador" whose Findymail email was ryan@buckedup.com, and ZeroBounce called it valid. Check the email's domain against the brand domain and the parent domain. If it doesn't match, retry the runner-up the same way you would for an invalid email or for no email.
- Jev's choice question alone isn't a gate. Jev named a Celsius "Mentor" who scored 0.03. Give each candidate a 0 to 2 score and require the top one to be at least 0.5. Tell the rubric that someone the brand pays scores lowest. Use the same 0.5 floor for the runner-up retry; at 1.0 it skipped a 0.76.
- Clay leaves the old success cell readable for a moment after run-cells. Only accept a result after you've seen the cell running or the row's updatedAt has changed.
- The parent fallback works by writing the parent domain into the same row's domain cell and rerunning the search (parents.json `search_domain`, a free-text field, so regex every domain out of it).

Cost per brand as observed: 1.1 credits for a clean pick, up to about 1.6 with one fallback or retry. It took 30 to 45 s.
