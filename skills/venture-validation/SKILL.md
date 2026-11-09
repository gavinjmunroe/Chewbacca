---
name: venture-validation
description: "Decide whether a product idea is real before building it: Why Now, Mom Test interviews, a paid ad test read with funnel math, then scale, pivot or kill. From Chris Swain's ACAD 185 at USC."
triggers: >-
  Decide whether a product or startup idea is worth building, the way USC ACAD 185 (Chris Swain, Iovine and Young Academy) teaches it. Use when the user asks if an idea is good, wants to validate a concept, compare several ideas, write customer interview questions, run or read a smoke test or ad test, judge CTR, lead or reservation rates, compute eROAS or CAC, decide whether to scale, pivot or kill, or check an idea against what VCs look for. Also use before any new product build, side project or pitch, so the idea is tested before code is written.
---

# venture-validation

An idea is a guess until a stranger acts on it. This skill runs the
validation order taught in ACAD 185 (Analytics and Marketing for
Challenge-Based Innovation, Prof. Chris Swain, USC Iovine and Young Academy,
Fall 2026): research and self validation, then qualitative validation with the
Mom Test, then quantitative validation with a paid test, then a decision.

Run the steps in order. Skipping to the ad test before the interviews wastes
money on the wrong audience, and skipping the interviews entirely is how a
team builds something nobody asked for.

## Step 1: self validation

Write the concept in the course's sentence: "We are making ___ for ___ so
they can ___." Then answer, in writing:

- Why Now. Name the inflection: what outside change enables new behavior,
  who desperately wants it, how it changes their lives, and when it crests.
  "Pursuing a startup without an inflection is like surfing without a wave."
  Too early is riskier than too late, and a late entrant picks a niche.
- Can it be advertised on Meta under Meta's ad policy? The paid test in step 4
  runs there, so a no here changes the plan.
- Can it use network effects? Write growth as Y = M x X^B, where X is
  usually time, Y usually revenue and M the product. B above 1 is superlinear
  growth, from network effects, compounding data or viral loops (referrals,
  notifications, loyalty tiers). 0 to 1 is diminishing returns, below 0 an
  inverse power law. Name which of NFX's 16 network effects apply: direct
  (physical, protocol, personal utility, personal, market network,
  hub-and-spoke), two-sided (marketplace, platform, asymptotic marketplace),
  data, tech performance, and social (language, belief, bandwagon, tribal),
  plus expertise. Direct ones are the strongest and physical the most
  defensible. Data effects tend to be weaker, social ones the hardest to hold
  long term, and asymptotic marketplaces are more open to competition.

Comparing several ideas: score each on Talent, Market Size, Why Now, Problem
Space, Desirability, Technical Feasibility, Competitive Feasibility and
Viability, 1 to 10 by default, 1 to 5 for less critical, 1 to 20 for the one
that matters most, and write why each weight is what it is. The test of the
dashboard: "could you make a decision from this?"

A pitch answers: the problem, the solution, why now, market size, the
initial audience against the eventual one, the revenue model, and the plan to
get superlinear growth. A project brief adds the target audience, the
qualitative validation argument and a competitive analysis.

Investor lens, when the idea will raise money: strong team, Why Now plus a
differentiated insight, a large market, a real business model with traction,
capital efficiency, and an exit. VCs need every deal to have 100x potential
because 85% fail. Bootstrapping and pre-sales (crowdfunding) come first,
because more traction means better terms.

## Step 2: pick the beachhead

Ask who feels the problem most acutely. Superfans have a high pain threshold,
already hack together their own fix, and adopt early. Expect heavy filtering:
the course example went from 57 respondents to 16 candidates to 5 hard core.
A beachhead is a segment you can name and reach this week.

Audit the offer against diffusion of innovation's five criteria before
messaging anyone: relative advantage, compatibility, complexity,
trialability, observability. Write to the stage you're targeting, innovators
and early adopters first.

## Step 3: the Mom Test

Before any call, write 1 to 3 Signs: answers that, if you hear them, validate
the idea. Then 3 to 5 questions that would surface those Signs. The rules:

- Past behavior, never future intent. Ask about the last time it happened.
- Real needs, not opinions. Facts, not hypotheticals.
- Never ask "Would you use this?", "Is this a good idea?" or "What would you
  pay?" Ask "How much have you spent trying to solve this?"
- Listen more than you talk. Don't lead.
- Be willing to walk away from the idea.
- Close by asking "Who else should I talk to about this?" and whether they
  want updates when it launches.

From the assigned Mom Test reading: talk about their life, never your idea,
or you drift into pitching. Bring a second person to catch pitching and bad
questions. "You want facts and commitments, not compliments." Questions that
work: "Talk me through the last time that happened," "Why do you bother?",
"What are the implications of that?" Instead of asking about price, ask what
they do now or ask for money. Instead of "is this a good idea," ask them to
show how they handle it now, what they love and hate about it, what they've
tried, and whether they're looking for a replacement. Take notes with their
exact words and mark the emotion.

When he's running interviews live (friends in the room, Granola on), the
reply is the question list and nothing else. Open on questions they can answer
in two seconds, about a specific fact: "Who's your top artist right now, would
your friends guess it?", "Who'd you last send a song to?" A broad memory
question gets "I have no idea" and stalls the interview. On 2026-11-09 the
SoundCheck opener "Last time music came up with your friends, what happened?"
got exactly that, and Caleb wrote "1st questions are trash". Pitch a concept
with one vivid example ("you're on PCH at sunset, what song?"), never an
abstract description: the friend he was interviewing re-explained the scenario
mode himself because the written one "explained it horribly". Ask questions one
person at a time, because a second friend in earshot answers for them.

Run at least 3 recorded 15 minute calls, 5 is better, and log every outreach.
Set the bar before the calls, then score each call against it. The course's
gate (A8) is that a majority of the team has a recorded conversation that
validates the project; the Kyber team wrote theirs as "4 of 7 show signs 1
and 2." A yes from someone whose workaround "works fine" is a false
positive.

Fail: change the audience, iterate the idea, or table it, then run step 3
again. Caleb's Kyber team is the worked example: club officers met the bar 2
of 7 times, the pain belonged only to whoever fronted the money, and the team
pivoted to friend groups.

## Step 4: the paid test

Traffic (an ad or a post) goes to a landing page with a lead offer (email for
a discount), then a reservation ($1 deposit). Read the result with the tool,
never by hand:

```bash
F="$(chewbacca where)/skills/venture-validation/bin/funnel.py"
python3 "$F" --spend 2000 --impressions 89898 --clicks 6176 --leads 1791 \
  --reservations 161 --price 97 --cogs 24.25
```

It prints CTR, L-CR, R-CR, CPL, CPR, CAC, three eROAS scenarios, break-even,
profit per unit, the verdict, and, on a fail, the one change that clears the
bar with everything else held. The course numbers it uses:

- Stage floors: CTR above 3%, L-CR above 20%, R-CR above 5%. "4% CTR is
  reasonable."
- eRev = reservations x 30% x price + leads x 1% x price (pessimistic 20% and
  0.5%, optimistic 40% and 2%). eROAS = eRev / spend.
- Pass: realistic eROAS of 300% or more ("$1 spent on marketing yields $3+")
  and price minus COGS minus CAC above zero. CAC = CPR / 30%. Break-even
  eROAS = 1 / (1 - COGS share). `--bar 2.0` reproduces the older 200% bar.

## Step 5: diagnose, then decide

Fix the first stage under its floor before touching anything later:

- Low CTR or high CPM: audience, placement, quality of the creative.
- Low L-CR: audience, how well the ad matches the page, the landing page,
  product details.
- Low R-CR: price, discount, conversion design.
- Every stage passes and eROAS still fails: the problem is price. In Caleb's
  A10 set, the best funnel in the class returned 89 cents per dollar at a $30
  price and needed $67 to pass.
- A big eROAS on a few dozen reservations needs a bigger test before scaling.

Pass: spend on marketing, and run awareness, consideration, conversion and
loyalty KPIs from here on ("operating the funnel is operating the company").
Fail after fixes: pivot (back to step 2 or 3) or kill.

## Never

- Never call an idea validated from friends' enthusiasm, a survey of
  hypotheticals, or the founder's own conviction.
- Never write interview questions about the product before questions about
  their last real experience of the problem.
- Never quote an eROAS, CAC or pass/fail from mental math. Run funnel.py.
- Never recommend scaling off a small sample without saying so. House rule,
  not a course number: under about 50 reservations is thin. In Caleb's A10
  set, 767% on 23 reservations was the riskier bet than 321% on 161.
- Never call a name clear off a USPTO zero you didn't control. On
  2026-10-23 (Mudcub) `https://tmsearch.uspto.gov/search/search-results?query=` URLs
  showed "No results found" for MUDBUGS, which has live registrations, and the
  API answers plain POSTs with 405. Type the term into the page's search box,
  run a known registered mark first as the control, then check the goods
  class (diapers sit in 005). Say "knockout search, not clearance" every time.

## References

`references/course-map.md` lists every ACAD 185 lecture, what it teaches and
which Chewbacca skill carries it. The original decks, briefs and templates
are private to Caleb's brain at `raw/acad185/` (paid course material, never
copied into the kit).

Related: [[launch-funnel]] builds the page and ads this test runs on, and
[[community-content]] builds the free traffic.
