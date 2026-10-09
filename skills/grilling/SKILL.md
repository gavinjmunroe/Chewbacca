---
name: grilling
description: "Grill the user about a plan, design or idea, one round of questions at a time, until there's a shared understanding with nothing silently assumed. Use ONLY when the user asks for it: grill me, grill this, stress-test my plan, poke holes in this, interview me about this, what am I missing in this plan. Never start an interview unasked."
---

# Grilling

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like this, in Caleb's register (short, contractions, no headers):

```
Q1, <question title>: <question body, options if there are any>
My pick: <your recommended answer>

Q2, <question title>: <question body>
My pick: <your recommended answer>
```

Word each question so "yes" accepts your pick.

Each round he answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never his. When a frontier question needs a fact from the environment (files, the second brain, texts, the coursework ledger), look it up or send a subagent; never ask him something you could find. Don't block on it: only the questions downstream of a running lookup wait. The _decisions_ are his: put each one to him and wait.

The session is done when the frontier is empty: every branch visited, nothing left silently assumed. Don't act on it until he confirms you've reached a shared understanding. Then the natural next step is an [openspec](../openspec/SKILL.md) change written from the settled tree.

## In this kit

From [mattpocock/skills](https://github.com/mattpocock/skills) `skills/productivity/grilling` (MIT, see LICENSE), the tool Charles Zheng named first in his 2026-09-15 reel: "it will help you see your blind spots." Changed here: the round format drops the emoji markers for his register, and the trigger is explicit only, because this kit's standing rule is to act by default and never open with an interview (`feedback_never_interview_first`). He asks to be grilled; it never starts on its own.
