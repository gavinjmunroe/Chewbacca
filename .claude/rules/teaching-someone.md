# Teaching someone to build with AI

Always on. When Caleb asks for a guide, repo or kit that teaches a person to
build with AI (a friend, a teammate, his dad), this is the bar.

- **Teach the engineer, not just the steps.** A setup walkthrough plus "here's
  how we built X" is the floor. The repo also carries a leveled track (think
  with AI without losing your thinking, ship, read and verify, context, your
  own setup, parallel agents), each level with a checkpoint they do without
  help. Caleb, 2026-11-03, on a first version for Ryan Rimando that only covered
  setup and the Anchored story: "Bro we gotta tell him way more and teach him
  how to rlly be an ai native engineer".
- **Give them real pieces of Chewbacca.** Port rules, hooks, skills and
  subagents into a `kit/` they can install, rewritten so nothing depends on the
  chewbacca CLI. Same day: "We gotta give him a ton of our setup bro so much of
  chewbs".
- **Scrub before it ships.** Chewbacca's files carry real names, incidents,
  home paths and team memory. A public kit is grep-gated for teammates,
  clients, phone numbers, emails and `/Users/` paths, and fixed until clean.
- **The spine is agency.** Caleb, same day: "Knowing how to be resourceful,
  efficient, iterative, creative with ai - it can all be learned - by default
  ppl make slop and lose their cognitive abilities and agency - I'm building
  towards the opposite!" Every level pairs what the AI does with what the
  person keeps doing themself (predict, decide, explain back, reps without AI).
- **Build it general when others will use it.** "This could be useful for a
  ton of ppl including my Dad": a playbook for one person gets a thin personal
  front page over a general body, not their name on every page.
- **Two tiers, one ladder.** Caleb, 2026-11-03: "The ai playbook should get
  someone to be at my level, and the stuff I'm making for myself will be added
  to get to the carlton level once I'm there". So the public playbook
  (calebnewtonusc/ai-playbook) tops out at what Caleb does today: ship a
  product like Anchored in a day, run his own setup and parallel agents, and
  catch the AI being wrong. His private engineer-track picks up from there
  toward the Carlton bar, and each piece of it moves into the playbook only
  once he's done it himself.
- **The setup we hand out is already top tier.** Same night: "chewebs/the ai
  setup we give out should alr be at that level of goatedness". The person
  climbs the levels, but the kit they install ships at the Carlton bar from day
  one: guards, reviewers, verification and hook tests at full strength. Where
  that pulls against the agency spine, the kit does checking and catching, and
  the person still does the predicting, deciding and explaining.
- **A handoff means their accounts.** When the thing you built for someone becomes theirs, the repo transfers to their GitHub, the host runs on their account, and the domain record is changed with their login. The proof is their own push going live with your accounts out of the path. Keep your old deploy up until theirs holds, and grep the repo for your hosts first (the Parker site hard-coded the old Railway URL in `build.py`). Caleb, 2026-11-06: "We wanna fully handoff the site to him". The first plan only added Parker as a collaborator.
- **What you tell them about a tool is checked in its code.** A README that says "it only reads" gets a grep for write commands before it ships. On 2026-11-06 a Hall README for Parker said that, and `bin/brightspace` installs `submit` and `post`.
- **A private repo invite shows them everything.** On a personal account a collaborator gets write access and every file, including plans and notes about other people. For a one-person trial, give a zip from `git archive` with those left out, then rerun its install test on the zip.
- **Rehearse a handoff on bare-Mac tools.** Build their project with `/usr/bin/python3` and a clean PATH, and walk every login they'll need, before they sit down. On 2026-11-06 Caleb's "Stress tests it plz" found Parker's site only compiled on Python 3.12, the setup never logged his Mac into GitHub, and `gh auth login` hung silently with no terminal.
