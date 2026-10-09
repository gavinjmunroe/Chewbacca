---
name: openspec
description: "Turn a settled plan into an OpenSpec change (proposal, requirements with WHEN/THEN scenarios, design, tasks) before any code, then build from the tasks and archive the change when it ships. Use when a feature or idea is about to be built and the plan is clear enough to write down, after a grilling session, when the user says spec it, write the spec, openspec, opsx, plan this feature before building, or when several agents will build one feature in parallel and need tasks that don't step on each other."
requires: [openspec]
---

# OpenSpec

Spec first, then code. The spec is plain Markdown in the repo, so the plan gets reviewed before anything is built and every agent reads the same plan.

## Setup, once per repo

`command -v openspec || brew install openspec`, then `openspec init` in the repo root. That creates `openspec/` (specs and changes) and writes the `/opsx:*` skills into `.claude/skills/`. Existing repo instructions stay; read the diff after init.

## The loop

1. **Explore** (`/opsx:explore`) when the approach isn't settled yet. If the user wants to be pushed on it, [grilling](../grilling/SKILL.md) comes first and the settled tree feeds the proposal.
2. **Propose** (`/opsx:propose <change-name>`) writes `openspec/changes/<name>/` with `proposal.md` (why and what), `specs/` (requirements with WHEN/THEN scenarios), `design.md` (approach) and `tasks.md` (checklist). Read every file before building.
3. **Validate**: `openspec validate <name>` must pass. `openspec show <name>` prints it.
4. **Apply** (`/opsx:apply`): build task by task and tick `tasks.md`. Each task should name the test or check that proves it, so parallel agents can each take a task and the checks keep them honest. Build it the [ponytail](../ponytail/SKILL.md) way: the smallest change that fully works.
5. **Archive** (`openspec archive <name>`) once it's merged. The change's specs fold into `openspec/specs/`, which is the living record of what the system does.

## When not to

A one-line fix or a typo doesn't need a spec. If the plan fits in one sentence and touches one file, just build it.

## In this kit

[Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) (MIT, see LICENSE), v1.14.1 installed 2026-10-10 via Homebrew. It's the second tool in Charles Zheng's 2026-09-15 reel, chosen because each task carries its own tests and QA, "so you can easily get an agent swarm to one-shot it without having to worry about agents stepping on top of each other." Its author is Tabish Bidiwale (@0xTab, YC W26), who is also in the dev-creator graph.
