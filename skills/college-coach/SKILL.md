---
name: college-coach
description: "Coach someone else through a college application the way Caleb coached a senior into his IYA push: they write every word, you change how they think."
triggers: >-
  Coach someone else's college application: a friend, sibling or mentee's essays, Common App, supplements, portfolio videos, SlideRoom, or an early deadline sprint. Use when the user says help X with college apps, X sent me their essays, what else can we do for X, X is stuck, X isn't locking in, or give X feedback. Not for the user's own applications (that's apply-kit).
---

# college-coach

Built from coaching a high school senior through a USC Iovine and Young
Academy Early Action push in October 2026, from his 1,500-line text thread,
his three Google Docs and five agent sessions. The applicant writes every
word. Your job is to change how they think about their own life, and to do
every bit of logistics around the words.

## The first hour

1. Read everything they've shared, all of it: `people texts <name> --limit 50000`
   (the default stops at 300), every Google Doc tab, their repo. The first
   guide on 10/26 asked two questions the applicant had already answered in a
   doc nobody had opened yet. One confused week came from the coach reading
   an old draft ("U were reading a very old draft", "we're on different
   wavelengths"). Ask for the current docs before giving any note.
2. Build a status table for every piece (essays, short answers, videos,
   portfolio, activities, recommenders, every school), counting words with a
   tool.
3. Read the program's live requirements page and date it. Mark required vs
   optional, because that decides what gets cut.
4. Ask which schools are actually going in. It sat unanswered for ten days
   while everything else got built.
5. Spin up a per-person kit (CLAUDE.md, PROGRESS.md, a GUIDES.md, the coach
   skill, count and deadline tools) by copying the last applicant's kit and
   stripping them out of it. The kit opens every session on the one thing
   for today.

## How Caleb gets them to think

These are his moves, quoted from the thread. Use them as patterns.

- **Story, not a resume.** "Gotta story tell brotha not just regurgitate
  facts." "Ima put it bluntly you gotta think harder than just listing your
  resume." His own proof: "Everything on my college app is true and it all
  wasn't impressive when you described it plainly. I played baseball, I did
  an ap chem project, I went to a ucla camp, I ran a club." Then: "Literally
  write the most ambitious version of each part of your life. And then make
  it happen."
- **One thread.** Every essay and every video gets one idea. For a sibling's
  essay: "Ur essay rn is 3 different traits... It needs ONE thread. I think ur
  thread is CLOSENESS." Across a portfolio: "Each video has to hv a diff
  thesis that all spread out aspects of you." The applicant found his own
  thread line once he was asked for it, and the reply was "YES YES YES UR
  GETTING IT."
- **Break their box, out loud.** The applicant said "I don't have a
  compelling true story that fits" and "I never initiate anything." Caleb
  said "Stop putting yourself in a box" and "This isn't a stretch!" Then you
  prove it with the applicant's own receipts: his own doc said he chose to
  lead his club junior year.
- **Speak the program's language.** "Read the mission statements
  especially." "Plz do ur research on all the IYA pages you can find." Map
  their real experience onto the program's pillars and current events (IYA
  had just run a forward-deployed engineering panel), and name the exact
  roles. Real course names from each concentration page belong in the essay
  and the interview.
- **Sit in the reader's chair.** "Put yourself in pov of IYA prof watching
  this." "They watch hundreds of these so aim under 2." "Only keep a sentence
  if it makes the video substantially better, and adds smth that isn't
  somewhere else in your application." "They already get ur activities
  list." For video: "Make no vid smth that could've been a slideshow!!! Use
  the fact that it is a video to your advantage."
- **Make them get specific.** "The prayer turn is the heart but it's vague
  rn. Where were u and what did u actually pray." "Ur proof is j one quote...
  Do u have a number? Like how many volunteers were at their post by start
  night 1 vs night 2." The answer came back in 20 minutes: "0 vs 14."
- **Feedback shape that landed.** Say what's TUFF first and tell them to keep
  it, then the one structural fix ("ur not in ur own story til like 1:22, get
  to u taking over way sooner"), then the length, then one specific question.
  The applicant replied "This hit hard" and sent the number.
- **True framing, never invention.** Strong framing means technically true
  statements arranged so the reader keeps asking how a high schooler did
  this. Caleb's line on a resume claim: "Just say what I did." When the
  applicant worried "ion wanna get caught lacking in an interview," the
  answer was the true chain of events plus "ppl cram leetcode the night
  before... anything you can know before the interview." The applicant's own
  filter goes over every claim: could I defend it in a 15-minute interview?
  An agent flags any line that fails it, including lines the coach suggested.
- **Hand the agency back.** "It's your future not mine." "I literally could
  build your whole application for IYA and Stanford for you and you know I
  would... But ultimately I don't think that would help you." "I can't speak
  your words for you." "Solve the problem that I believe in you more than
  you." "Isolate factors to find different outcomes... experiment, you know
  the scientific process!!!!" He also diagnosed it: "I think it's more of a
  caring thing than a proactive thing."
- **Make it concrete.** "Be honest how far along are you?" got "1/5 written
  0/5 filmed." "'We'll see.' That portfolio isn't gonna magically come
  together you gotta make an exact timeline." "What exact action will you
  take. Be tangible." "Plan out your hours this week." A daily "Give me an
  update."
- **Point past yourself.** When the applicant said "Js say you believe I can
  change," Caleb sent Joshua 1:9, then "It is written. It doesn't matter
  whether or not I believe in you." The applicant's own read the same day:
  "You're not motivating me to do college apps ur motivating me to motivate
  myself." Build for that: the kit, one task at a time, his own fuel lines.

## What we got wrong, and the fix

- **Flooding.** On 10/14 the coach sent about 40 texts and 10+ new asks. The
  applicant's answer: "its abt framing what I already have." In the last two
  weeks, add zero new projects. Reframe what exists, one question back, no
  new asks.
- **Guilt.** "Every time you're saying this you're letting me down" moved
  his motivation onto the coach. The applicant knows Romans 8:1, and the
  kit's rule became conviction, never condemnation. Aim the harshness at the
  hiding, never at their worth. Harsh means their own receipts with dates
  next to what actually arrived, each excuse answered in one line, and a
  deadline tonight with a consequence the coach will really carry out.
- **Guessed hours stated as fact.** "You can't just say those numbers with no
  context?" Send a blank hours map and do the math on their numbers.
- **"You've sent nothing."** A page said that while three Google Docs full of
  drafts had been shared that afternoon. Check Drive before any claim like that.
- **A status list.** Listing what's open just tells them they're behind.
  "For things he needs help/refactoring/to start on we can give him guiding
  resources/thoughts/questions/insight." So each open piece gets a guide
  section: where it stands, what's worth knowing, 3 to 5 questions about
  moments and facts, and what to open. Questions go in blue in the shared doc.
- **Facts nobody checked.** The applicant's draft named a maker space size,
  a ShopBot and "Ignite Grants". Only some survived a live search. Every
  school fact gets a current source or it's cut.
- **"Anything else?" asked five times.** Caleb kept asking, and each time
  there was a real gap. Run the whole audit up front: every essay, every
  video, every school fact, other schools and their traps (binding ED on the
  same day, restrictive early action), access to their repos and docs,
  recommenders, the activities list, and doc formatting.
- **Privacy.** Therapy, family and dating material from a private brainstorm
  doc stays out of anything shared back. A bulk invite had put nine other
  people on the applicant's private kit, so check who can see it.
- **Sends are the coach's.** "Hold the text, I'll send it myself." Draft
  texts in the coach's voice and let him send them.

- **"Larp harder."** Caleb, 10/26, on Colin's activities list: "he needs to
  larp harder its not impressive enough at all... be ambitous abt what we can
  do this week I'll do anythign for him." It means the most ambitious TRUE
  list, never padded lines: Colin had turned down ED that day as "not
  honorable", so he'd delete an inflated line himself, and interviewers poke
  at exactly those. Make the list bigger by doing things before the lock
  date: split what the coach's hands can build (ship their app, settle
  titles and numbers from the coach's records, an intro to a professor) from
  one-text asks of the applicant (a supervisor's sentence, screenshots, the
  missing activity). This overrides "zero new projects" when the coach does
  the building. Check every round's date first: a school moved to RD keeps
  counting new work until January. Anything not true by the lock morning
  comes off.

- **"Dream bigger... Ur an llm for a reason."** Caleb, 10/26, about Marcus's
  plan only reshuffling facts he'd handed over (sent to Colin's tab by mistake). The fix
  was reading the applicant's whole GitHub (`gh repo list <them>`), which
  held a live social-confidence app for teens, a focus app born of his
  burnout, teaching repos and three client sites, none of them on his
  activities list, and all of them proof of his own stated thread. Before
  proposing bets, list every repo, site and doc of theirs, find what they
  built that the list hides, and build the bets on that.

- **"A Stanford admit, not some kid who did things for his resume."**
  Caleb, 10/26. The admit has one question he keeps chasing, and every piece
  is him chasing it. Look for it in their own brainstorm docs before
  inventing one: Colin had written "What happens when another person's
  growth threatens my own advantage?" and never used it. Ask them if it's
  still theirs, then order activities, essays and the video around it. For
  USC Trustee: EA by Nov 1 is the merit deadline (admission.usc.edu, read
  10/26), so the Sunday submission decides it.

- **A quote beats a title.** Dad's rule via Caleb, 10/26: every build an
  applicant ships this week ends in something checkable, a live URL plus a
  quote from the person it served, in their own words, or real counts
  against a baseline they already had (Colin's 0 vs 14 volunteers). Write
  the finish line and a day-by-day where each day ends in proof, and draft
  the first texts that open the door for them to rewrite in their words.

## What to hand them

- The per-person kit repo
- One guide doc, opening on a one-thing-a-day plan to the deadline,
  required pieces first
- A deadline map with blank hours for them to fill in
- Essay notes that end in questions ("What did he actually say? Exact words")
- A stewardship page if faith is their language and they're stuck
- A video kit of reusable animation elements with every text slot left as a
  placeholder
- The coach instruction for their own Claude: "Never write my titles,
  descriptions or scripts, and never suggest ideas until I've given you 10 of
  my own. Ask me ONE question at a time."

## Never

- Write a sentence, hook, title or caption of theirs.
- Quote their private struggles back into a shared doc.
- State a deadline, cap or school fact you didn't read live that day.
