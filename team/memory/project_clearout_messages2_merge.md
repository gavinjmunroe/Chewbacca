---
name: clearout-messages2-merge
description: Long-term vision for ClearOut, Messages2 (Apple-grade base) will be folded into amber-organization/ClearOut as the conversational AI triage layer for texts; reference when reasoning about either codebase
metadata:
  node_type: memory
  type: project
  originSessionId: e2ef3551-2ec4-4878-9c56-cfedab9fd44e
---

Messages2 (calebnewtonusc → amber-organization/Messages2) is being built as the **foundation** for [[clearout-product-vision]], not as a standalone app. Long-term, Messages2 gets folded into `amber-organization/ClearOut` once both are ready.

## The full vision (Caleb's words, 2026-05-14)

> "The whole idea is to conversationally knock out all of your texts. Imagine 1 by 1 texts appear in the ui, and you can talk or swipe to decide whether to not reply at all, save for later, and reply then, without the annoying need to click between people. You have the option to go into the individual chat, or in clearout mode you quickly clear out all your texts, and it in a wispr flow/willow type of way knows how to talk trained based on how you talk to that person. It also has a super power gcp vector db that knows contextually all the important info from your texts: eg 'Still need to order what Mom said to order' and has a task list based on texts auto gen."

## Core product pillars

1. **ClearOut mode**, Tinder-style swipe-or-talk triage. Each unread message appears full-screen; user decides: skip / save-for-later / reply-now. No clicking between people. Voice-driven via Wispr Flow / Willow type UX.
2. **Per-person AI style transfer**, Replies are auto-suggested in the user's voice, _as it sounds when texting that specific person_. Trained on their historical messages with each contact (sister gets short caps-lock chaos; boss gets full sentences).
3. **GCP vector DB of all texts**, Semantically queryable history. "Still need to order what Mom said to order" → finds the relevant message, surfaces it as a task.
4. **Auto-extracted task list**, Texts containing actionable items become Todoist-style entries automatically. Connects to Caleb's existing Todoist workflow.
5. **Two modes coexist:** ClearOut (sweep mode) vs. classic per-chat view (Messages.app parity). Messages2 is the classic view.

## Roadmap & how to apply

- **First milestone (now):** get Messages2 to Apple-Messages parity. Phases 1–10 from the audit are the plan.
- **Second milestone:** ship ClearOut as a separate Swift app (already exists at `/Users/joelnewton/code/ClearOut/ClearOut.swift`, voice-first foundation).
- **Convergence:** merge repos at `amber-organization/ClearOut`. Messages2 becomes the "classic" tab; ClearOut becomes the default conversational triage mode.
- **Beat Beeper:** start macOS-only (iMessage scrape is easiest there), expand to full multi-platform (WhatsApp / Telegram / Signal / SMS) like beeper.com. Beeper has _no_ AI triage layer, that's the wedge.

## Why this matters when reasoning about Messages2 architecture

- **Don't over-couple Messages2's UI to chat.db.** The data layer needs to be swap-out-able for a multi-source aggregator later.
- **The IPC contract (`window.messages`) is the right abstraction.** Keep all SDK + DB knowledge in main; renderer should only see DTOs. This makes the renderer reusable inside ClearOut's larger app shell.
- **Contacts + per-person message history are load-bearing for ClearOut's style transfer.** Phase 1 (real Contacts integration) isn't just polish, it's the foundation for "trained on how you talk to _this_ person."
- **Vector DB integration will need a per-message embedding pipeline.** Plan a hook point in the watcher (`onMessage`) where ClearOut can intercept and embed.

## Cross-refs

- [[project_togari_imessage_live]], Togari's messaging infrastructure may share the AppleScript send-pipeline patterns.
- [[project_amber_vision]], Amber is for health; ClearOut is the messaging side of the same "your digital life, organized by an agent that knows you" thesis.
