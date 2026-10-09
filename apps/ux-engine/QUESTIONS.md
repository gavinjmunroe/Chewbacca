# The interrogation

Caleb, 2026-09-20: *"You're gonna have to be creative with this in order to be
creative! What makes creativity? I am turning chewbacca into the first ever
agent to not just regurgitate."*

Questions for this repo to answer, by research or by measurement, because the
answers decide what gets built. Not rhetorical. Each one is marked with what it
would change, and with its status.

- `OPEN` nobody has answered it here
- `ANSWERED` with the finding and its source inline
- `MEASURED` answered by running something in this repo
- `UNANSWERABLE` asked, investigated, found to have no reliable answer

An `UNANSWERABLE` is a real result and gets recorded, because the alternative
is somebody confidently answering it later from a vibe.

---

## A. Mechanism: why does a model produce what it produces

1. `ANSWERED` Why does every generated landing page have the same six sections?
   The template is the conditional mode of P(page | "landing page"), and RLHF
   sharpens it: reward models overweight typical outputs, alpha-hat 0.57,
   p < 1e-14 (research/13). It is the mode of the mode.
2. `ANSWERED` Why did constraining colour leave the structure untouched?
   A model emits a token stream in document order and never represents the
   artifact as a set of decisions, so only the surface is a variable
   (tools/flow.py). Measured: colour stances changed the palette and left
   hero / three-card / testimonials / CTA intact.
3. `OPEN` Is the structural mode stronger or weaker than the visual mode? If a
   prompt forbids the six-section template by name, does the model find a
   genuinely different structure or produce a relabelled one?
   *Changes:* whether structural refusals are worth writing at all.
4. `OPEN` Does temperature affect structural variance, or only lexical variance?
   *Changes:* whether sampling parameters are a lever here or a distraction.
5. `OPEN` How many samples before a new structure appears at all? If it is 50,
   best-of-N is dead for structure no matter how it is scored.
6. `OPEN` Does asking the model to plan before generating change the structure,
   or only add a plan that the generation then ignores?
7. `OPEN` Is the mode different per framework? Does asking for plain HTML,
   React, or Svelte move the structural prior?
8. `OPEN` Does the model have a different mode for "app" than for "page"? The
   corpus census found 64 product components against 365 marketing ones, which
   suggests the training data does.
9. `OPEN` What does the model produce with NO adjectives in the brief at all,
   versus one adjective? Where does the aesthetic actually enter?
10. `OPEN` Is "make it look good" actively harmful? It may be the single token
    sequence that most reliably summons the mode.

## B. Where ideas come from

11. `ANSWERED` How does a designer get inspiration? Not from the category.
    Design-by-analogy research: cross-domain and biological analogies both
    significantly increase novelty. But the Conceptual Leap hypothesis holds
    that distant analogies produce breakthroughs at LOWER efficacy because of
    surface dissimilarity, and some studies find near-field analogies perform
    better. Distance buys novelty and costs hit rate.
    (Chan et al., *Cognitive Science*; arxiv 2106.01592)
    *Built:* nothing yet. This is the strongest unbuilt lead in the file.
12. `OPEN` What is the right analogical distance for interface design
    specifically? All the measured work is engineering design, not UI.
13. `OPEN` Which source domains actually transfer to interfaces? Candidates
    worth testing: signage, cockpits, menus, scores, maps, forms that predate
    computers, board games, libraries, kitchens, air traffic control.
14. `OPEN` Does the model know these domains well enough to transfer STRUCTURE,
    or does it only transfer surface decoration? A cockpit-inspired dashboard
    that is just dark with orange text learned nothing.
15. `OPEN` Can a distant analogy be evaluated before building it, or does it
    have to be built to know whether it worked?
16. `OPEN` What is the interface equivalent of a swipe file, and does keeping
    one help an agent that has already read everything?
17. `OPEN` Do constraints from a real physical medium (print, signage, a card
    that fits in a pocket) produce better interfaces than invented constraints?
18. `OPEN` Where do the best designers say their ideas come from, in their own
    words? Read primary sources, not summaries of them.
19. `OPEN` Is there value in deliberately designing for the wrong medium first,
    then porting? Design the page as a poster, then make it a page.

## C. What makes something good, cool, or tasteful

20. `ANSWERED` What makes something cool? Autonomy that reads as appropriate,
    and it needs all three conditions: divergence from a norm seen as
    UNNECESSARY or illegitimate, deviation that is BOUNDED (small or
    occasional, not large or perpetual), and a viewer who finds the norms
    repressive. Coolness is distinct from liking.
    (Warren & Campbell, *Journal of Consumer Research* 41(2), 2014)
    *Changed:* the stance prompts said "commit completely", which is perpetual
    total deviation and therefore the recipe for weird. Replaced with bounded
    deviation, 2026-09-20.
21. `OPEN` Which interface norms are "unnecessary" and which are functional?
    This is the whole game and the file currently answers it by assertion.
    Three equal cards feels arbitrary and a pressable-looking button feels
    functional, but is there evidence, or is that just my taste?
22. `ANSWERED` Is prettier better? No, and overshooting costs about 3x what
    undershooting costs: peak appeal at visual complexity 4.2/10, d=0.6 on the
    low side versus d=2.0 on the high side (Reinecke & Gajos 2014, N~40,000).
23. `ANSWERED` Do experts and novices want the same thing? No. Copying produces
    the maximally prototypical artifact, which novices prefer and experts
    reject (research/12, /13).
24. `OPEN` So which audience is a given page for, and does the tool ever ask?
    It currently does not, and that may be the largest single omission.
25. `OPEN` Is there measurable agreement on beauty at all, or only on function?
    Three designers agreed at kappa = 0.112 on whether a critique was accurate.
    What is the agreement on "which of these two is better"?
26. `OPEN` What is the difference between taste and class signalling in
    interfaces specifically? Bourdieu's objection is recorded in research/05
    and the linter enforces it, but the question is not closed.
27. `OPEN` Does "timeless" mean anything measurable, or is it survivorship?
28. `OPEN` What do people actually remember about an interface a day later?
29. `OPEN` Is delight real or is it a tax? What is the measured cost of a
    charming animation seen for the four hundredth time?

## D. Structure, flow, and interaction

30. `ANSWERED` Why is a page the wrong unit? Because the editable object is a
    graph of states and transitions, and a token stream cannot hold one
    (tools/flow.py). Built: `ux-flow`, with 10 structural transformations.
31. `OPEN` Is the transformation catalogue complete? Ten moves were written
    from experience. What is missing, and is there a principled way to
    enumerate them rather than listing what came to mind?
32. `OPEN` Where should commitment live in a flow, and is there evidence
    beyond "it depends"?
33. `OPEN` When is optimistic-plus-undo genuinely better than confirm-first,
    and what is the measured regret rate of each?
34. `OPEN` How many steps before abandonment, per context? A number exists in
    checkout research; does it transfer to anything else?
35. `OPEN` What is the real cost of showing a progress stepper? It causes
    abandonment that hiding the length would not, which is honest and
    expensive. Has anyone measured the trade?
36. `OPEN` Is a wizard ever right, or is it always a failure to infer?
37. `OPEN` What does a flow look like when the user is interrupted mid-way and
    returns in three days? Almost nothing in this repo handles resumption.
38. `OPEN` How should a flow behave when the network is slow rather than dead?
    Dead is handled everywhere. Slow is the common case and is handled nowhere.
39. `OPEN` What is the right structure for a task the user does 400 times a day
    versus once ever? The frequency rule exists for motion (research/03). Does
    it generalise to structure?
40. `OPEN` When should an interface be a single dense screen and when should it
    be many? Is there anything better than "it depends on the user"?

## E. What the viewer actually perceives

41. `MEASURED` Can a model report perception usefully if it cannot see the
    intent? Yes. On a page that lints clean, a blind probe found there was no
    call to action anywhere, and that the eye lands on the headline when the
    intent was the price. 9 gaps, each with a location.
42. `ANSWERED` Should the critic see the intent? Not for comprehension. UXBench
    lists "context blindness regarding design goals" as a FAILURE MODE of LLM
    critique, which is the opposite of this design, so the distinction has to
    be stated precisely: blindness is right for a viewer reporting what they
    perceive and wrong for a critic judging quality. (arxiv 2606.16262)
43. `OPEN` What is the false positive rate of the blind probe? Unmeasured, and
    it is criterion two of the eight that decide whether a gate survives.
44. `OPEN` Does the probe agree with actual humans? Nothing here has been
    checked against a person yet. N=1 trial, 0 human overrules.
45. `OPEN` Does the squint test add anything the probe does not already catch?
    It already exists as a product (blurtest.com) and as standard craft (NN/g),
    so the question is marginal value, not novelty.
46. `OPEN` Should the probe be run under degraded conditions: three seconds
    only, phone width, low vision, a viewer who does not know the category?
    Each is a different viewer and their disagreement is the signal.
47. `OPEN` Can a model predict where the eye goes, or only rationalise it after
    the fact? There is saliency literature; is any of it usable here?
48. `OPEN` What does a screenshot miss entirely? Everything temporal: latency,
    transition, scroll, focus order, what the thing feels like under a thumb.
49. `OPEN` How do you probe a flow rather than a screen? Screenshot every state
    and ask what just changed?
50. `OPEN` Is a screen reader transcript a better probe than a screenshot for
    some questions? It is the actual reading order, which a screenshot only
    implies.

## F. Content and language

51. `OPEN` How much of "this looks AI" is actually the WORDS, not the pixels?
    The Postly page had a gradient headline and also said "Grow every channel"
    and "Trusted by 14,000+". Which one did the eye object to?
    *Changes:* whether the visual detector is even attacking the main problem.
52. `OPEN` Can prose-check, which already exists and works, be pointed at UI
    copy directly? The two halves of the kit have never been connected.
53. `OPEN` What is the measured reading level of good product copy versus
    generated product copy?
54. `OPEN` Do real products use headline-plus-subhead at all, or is that a
    marketing-site artifact that leaked into every app?
55. `OPEN` What does a button label look like when it is good? Is there
    anything better than "name the outcome, not the mechanism"?
56. `OPEN` How should an error message be written when the cause is unknown?
57. `OPEN` What is the right amount of text on a first screen, measured?
58. `OPEN` Is there a detector for invented specificity, the fake precision of
    "14,000+ marketers" and "4.7% engagement"? Partly built, worth extending.

## G. Time, state, and failure

59. `OPEN` What are all the states a component can be in? Presets cover
    loading, empty and error. What about stale, partial, offline, unauthorized,
    rate-limited, degraded, conflicted, and too-much-data?
60. `OPEN` Which of those does a generated component ever include unprompted?
    *Changes:* this is a cheap, high-value measurement and nothing blocks it.
61. `OPEN` What does good look like when the data is 10x bigger than expected?
62. `OPEN` What does good look like when a field is empty but not zero?
63. `OPEN` How should an interface show that it is out of date rather than
    wrong?
64. `OPEN` What is the correct behaviour on a failed write the user cannot see?
65. `OPEN` Does anything here handle a destructive action performed by mistake
    on a shared account?

## H. Constraint and refusal

66. `MEASURED` Do refusals work? Partly, and the honest answer is worse than
    expected. Stance-guided pages averaged 7.8 blocking findings against 7.5
    for unguided. No separation. 83 of all blocking findings were one rule,
    emoji-as-icon, and no stance mentioned emoji.
67. `MEASURED` Why did that happen? Per-stance refusals are craft decisions;
    universal bans are not, and have to ride on every prompt or none.
    BASELINE_REFUSE added 2026-09-20 and re-measured the same night: the same
    brief, same stance and same model went from 26 emoji and 26 blocking
    findings to 0 and 0. n=1, but nothing else varied, so it is causal.
68. `OPEN` How many refusals can a prompt carry before the model starts
    dropping them? There is a limit and nobody here knows it.
69. `OPEN` Do refusals stated as consequences outperform refusals stated as
    bans? "A screen reader reads this aloud as 'high voltage sign'" versus
    "no emoji".
70. `OPEN` Does the model comply better with a refusal it can verify itself?
71. `OPEN` Is a deny list in the prompt better or worse than a deny list
    enforced by a hook after the fact? Both exist here and they have never been
    compared.
72. `OPEN` What is the false positive rate of every blocking rule, on real good
    pages? Still unmeasured. This is the most overdue item in the file.

## I. Genre and context

73. `MEASURED` Does this tool generalise across genres? No. All 12 corpus
    briefs are seed-stage SaaS marketing pages. Caleb: "Would a Fortune 500's
    website look like this? Don't think so."
74. `OPEN` What are the actual genres, and how do their rules differ?
    Candidates: enterprise, government, healthcare, finance, internal tooling,
    education, commerce, editorial, portfolio, developer tools, consumer
    mobile, embedded and kiosk.
75. `OPEN` What does a Fortune 500 site actually do differently, measured
    rather than assumed? Nav depth, page weight, photography, legal surface,
    language count, accessibility conformance.
76. `OPEN` Which of this repo's rules are genre-specific and are currently
    stated as universal? Almost certainly several.
77. `OPEN` Does the log-odds prior need to be per-genre? A prior trained on
    startup marketing pages will call a government form slop.
78. `OPEN` What changes when the interface is regulated? Accessibility
    conformance, disclosure, retention, consent.
79. `OPEN` What changes at 40 languages? Layout that assumes English length
    breaks, and nothing here considers it.
80. `OPEN` What changes when the user is not choosing to be there? A DMV form,
    a compliance training, a required portal.

## J. Selection: choosing between options

81. `ANSWERED` Can a model pick the best of several designs? Not reliably. The
    same typicality bias means it returns the most median candidate, so no LLM
    aesthetic judgement is load-bearing anywhere in this repo.
82. `OPEN` What can a model reliably rank? Comprehension, probably. Fit to a
    declared intent, probably. Beauty, no. Where exactly is the line?
83. `OPEN` Does the learned log-odds prior beat a coin flip on HTML? AUC is
    written and has never been run with enough n on both sides.
84. `OPEN` Is a human classification trial actually teaching the system
    anything? One trial exists, zero human overrules. Untested.
85. `OPEN` How many trials before the memory changes a generation? That is the
    single number that decides whether the loop compounds.
86. `OPEN` Should selection be per-dimension rather than overall? Best
    comprehension, best structure, best restraint, and let them be different
    candidates.
87. `OPEN` Is there value in keeping the losing variants and showing them?

## K. About this tool

88. `OPEN` Is any of this better than a good designer with a style guide? The
    honest answer is probably no, and the interesting question is which part
    gets closest.
89. `OPEN` What would falsify the whole thesis? If stance-guided output scores
    no better than unguided after the baseline fix, that is most of it.
90. `MEASURED` Does the tool catch its own output? Sometimes. One stance output
    scored 26 blocking findings, worse than half the unguided corpus.
91. `OPEN` What does this repo do that a person could not do faster by hand?
92. `OPEN` Who is the budget owner who would be afraid if this did not run?
    Criterion seven of eight, and the current answer is nobody.
93. `OPEN` What is the smallest version of this that is genuinely useful today?
94. `OPEN` What should be deleted? Removal is free, and the rule applies to the
    repo itself, which has never had a removal pass.

## L. Creativity as such

95. `ANSWERED` What is the standard definition? Not the textbook pair. Boden
    requires THREE: novelty, value and SURPRISE. Surprise needs an expectation
    to violate, which means it is only definable against a model of what was
    expected. ("Creativity in a nutshell")
    *Changed:* the repo had treated its prior and its viewer as rivals pulling
    in opposite directions. They are the two required axes. bin/ux-boden.
96. `ANSWERED` Boden's taxonomy verified: combinational (unfamiliar
    combinations of familiar ideas, the least interesting), exploratory
    (search within a fixed conceptual space), transformational (alter the
    rules of the space, the most radical surprise).
    Where this repo sits: stances and tensions are EXPLORATORY. The flow
    transformations are the only TRANSFORMATIONAL thing here, because they
    change what the artifact is rather than what it looks like. Nothing is
    combinational yet; distant-domain analogy (Q11) would be.
97. `OPEN` Can a system be creative if it cannot be surprised? Is there any
    mechanism here that can be surprised by its own output?
98. `OPEN` Is the ability to abandon an idea part of creativity? Nothing here
    ever kills a variant for being boring rather than broken.
99. `OPEN` What does a creative person do that an agent structurally cannot?
    Answer honestly and write it down, so the limit is known rather than
    bumped into.
100. `OPEN` Does creativity require having something at stake?
101. `OPEN` Where does taste come from if not from exposure? And if it is
     exposure, has a model that read everything already got it and simply
     cannot access it?
102. `OPEN` Is the bottleneck generation or selection? If the good design is
     already in the sample at N=20 and the selector cannot find it, then every
     hour spent on generation is wasted.
     *Changes:* the entire priority order of this repo.

---

## How to use this file

Answer one question properly, with a source or a measurement, and write the
answer inline with its status changed. Do not answer from memory and do not
leave a question marked `ANSWERED` without something citable next to it.

Question 102 is the one to answer first, because the answer reorders
everything else.

---

# M. The questions that could overturn the frame

Caleb, 2026-09-20: *"You're not being creative or outside of the box enough to
create high enough leverage questions."* Correct. Sections A through L ask for
parameters inside an assumed frame: what is the false positive rate, how many
steps before abandonment. Every one of them takes for granted that the frame is
right. None could overturn anything.

The test that should have been used from the start: **a high-leverage question
is one whose answer would make most of the other work irrelevant.**

103. `OPEN` **Is there a design that only an agent could make?**
     Every line in this repo tries to make a model match a human designer, and
     matching is by definition regurgitation with extra steps. A human cannot
     hold ten thousand constraints, cannot regenerate the layout when the data
     changes shape, cannot produce a different interface per viewer, cannot
     re-derive the whole system when one token moves. Those are not weaker
     versions of human design; they are things humans structurally cannot do.
     *If the answer is yes:* the entire goal is wrong, and the target is not
     "as good as a designer" but a category of artifact that has no human
     equivalent. Everything in this repo becomes a subroutine.
     **This is the highest-leverage question in the file.**

104. `OPEN` **Is slop a property of the artifact, or only of its position in
     time?** If every site looked like Stripe's, Stripe's would read as slop.
     The gradient headline was a good idea before it was everywhere. If slop is
     purely positional, then a detector trained today decays predictably, the
     corpus has a half-life, and the right architecture is continuous
     retraining rather than a rule list.
     *If yes:* every hand-written rule in ux-lint is a dated artifact and
     should carry an expiry.

105. `OPEN` **Is slop a property of the output, or of the process?**
     Two identical pages, one produced by a designer who considered and
     rejected twenty alternatives. Is there any respect in which those are
     different objects? If a reader cannot tell, then all process-based
     defences of this repo are vanity. If they can, the thing to capture and
     ship is the rejected alternatives, not the winner.

106. `OPEN` **Why is the deliverable a page?**
     The agent produces HTML, which is the least reusable thing it could
     produce. The alternative deliverable is a constraint file plus a
     generator, so the artifact regenerates when anything changes. A page is a
     photograph of a decision; the decision is the asset.
     *If right:* `ux-gen` outputs the wrong object.

107. `OPEN` **Should the tool argue with the brief?**
     A designer's first real move is often rejecting the brief. This whole
     pipeline treats the brief as ground truth and optimises inside it. The
     highest-value output might be "you asked for a pricing page and the
     problem is that nobody trusts the pricing, so build the calculator."
     Nothing here can ever say that.

108. `OPEN` **Can a system exceed its own evaluator?**
     Every selection here is capped by what the blind probe can perceive.
     Quality is therefore bounded above by the probe, forever. Is there any
     mechanism by which a generator produces something its own judge cannot
     recognise as good, and survives? If not, the ceiling is fixed and should
     be stated out loud.

109. `OPEN` **Whose taste?**
     Three designers agreed at kappa = 0.112. If there is no consensus, then
     every design decision is a choice of WHOSE taste, and this tool silently
     picks one and calls it quality. It has never asked. Naming the person
     whose judgement is being encoded may be the only honest version of this.

110. `OPEN` **Who is the design for when the viewer and the buyer are different
     people?** Most interfaces are paid for by someone who will not use them.
     The tool models one viewer and no conflict. A dark pattern is not a
     failure of taste; it is a correct solution to a different objective
     function. Does this repo have any way to represent that the objective is
     contested?

111. `OPEN` **What is the measured cost of being boring?**
     Everyone treats conventional as the safe default, including this repo's
     entire deny-list architecture. If boring has a real and large cost, then
     refusal-first is backwards and the whole thing should be inverted.

112. `OPEN` **Does the agent need a portfolio?**
     A designer's taste comes from having made things, shipped them, and lived
     with what went wrong. This agent starts empty every session. Would an
     accumulated body of its own work, with its own recorded regrets, produce
     different output than a rule file? That is a testable difference between
     memory and instruction.

113. `OPEN` **What if it is forbidden from repeating itself?**
     Design the same brief fifty times, each forbidden from reusing any
     structural decision from the previous forty-nine. OuLiPo constraint. Does
     output 40 get good, get insane, or get good THEN insane? The shape of that
     curve says more about where creativity lives than any rule list.

114. `MEASURED, AND THE ANSWER WAS NONE OF THEM.` **Is the bottleneck
     generation, selection, or the brief?**
     Six stances, one notification-settings brief, 2026-09-20. Structural
     divergence 0.634 against 0.371 for repeated sampling, so generation is
     producing genuinely different artifacts. Misreads came back 0, 0, 0, 0,
     1, 2 and blocking findings were 0 across all six. Four of six tied on the
     hard metric. The only separation was friction count, 3 to 7.

     Generation works. Selection can rank, barely. But there was almost
     nothing to rank, because all six were equally competent.

     THE THIRD ANSWER, which was not in this file: every instrument built here
     measures the ABSENCE of defects. Zero blocking, zero misreads, low
     friction. None of them carries a positive signal for good. So the whole
     stack converges on fine, and "value" in the Boden sense is implemented
     here as nothing more than "not broken."

     *Changes everything:* the work is not a better generator or a better
     ranker. It is an instrument that can tell competent from remarkable, and
     nothing in this repo is one. See Q108, which asked whether a system can
     exceed its own evaluator. It cannot, and this one tops out at no-defects.

115. `OPEN` **Does interface design have reliable devices, the way music has a
     key change?** Music has a small set of moves that produce a predictable
     effect on almost anyone. If interfaces have those, they are enumerable and
     worth more than any amount of style guidance. If they do not, that is a
     real and interesting negative result about the medium.

116. `PARTLY BUILT` **Can the agent be surprised by its own output?**
     Boden lists surprise alongside novelty and value. Surprise requires an
     expectation to violate. `data/prior.json` IS an expectation model, so
     surprise is mechanically available here: low probability under the prior,
     high value under the probe. bin/ux-boden now computes both axes and
     refuses to average them, because averaging reproduces exactly the
     judgement the typicality bias already makes for free. What is still
     missing is the agent ACTING on its own surprise rather than reporting it.

117. `OPEN` **What would this repo look like if it were designed for an agent
     with no aesthetic sense at all?** Possibly identical, which would be
     damning, and worth knowing.

118. `OPEN` **Is imitating a human designer's PROCESS a mistake?**
     Tension-naming, stances, critique loops: all of it reverse-engineers how a
     person works, and a person works that way because of working memory
     limits, a career's worth of exposure, and one pair of eyes. An agent has
     none of those constraints. Copying the workarounds of a different
     substrate may be the deepest error in the whole design.

119. `OPEN` **What happens if the user is shown the losing variants?**
     Every tool ships the winner. The rejected five may be worth more, because
     they show the space and let the person pick against a real alternative
     instead of judging one thing in isolation.

120. `OPEN` **Is "looks AI-generated" going to stop mattering?**
     If in two years most interfaces are generated, the tell stops being a
     tell, and a detector for it becomes a period piece. What is the thing that
     still matters then, and is this repo building any of it?

---

## The honest ranking

103 first, because a yes reframes everything else as a subroutine.
Then 114, because if the brief is the bottleneck, tonight's work was aimed at
the wrong stage.
Then 116, because it is cheap, the machinery already exists, and Boden says
surprise is not optional.
Then 104, because if slop is positional every rule here needs an expiry date.
