# Reply lifecycle

The October 2026 incident exposed three independent failures: incomplete feeder intake, results marked done before delivery, and follow-up failures left outside the runnable queue.

## Required outcomes

- Intake identifies each inbound message separately. A second message in the same conversation is new work.
- A callback claims processing before side effects. Empty drafts remain needs_draft. Posted cards remain awaiting_review.
- Zeutara delivery requires a new matching SENT message in provider history. HTTP acceptance alone remains delivery_unknown and must not invite a resend.
- A confirmed send receives an idempotent follow-up task before its reply result becomes done. Here done means this inbound was answered, not that the investor relationship is closed.
- Follow-up work checks current thread history before sending. A newer inbound or outbound cancels the obsolete task.
- The initial policy schedules two nudges separated by two business days. This is unmeasured and requires outcome evaluation. Exhaustion remains handoff_required rather than disappearing.
- Pre-transport failures retry twice. Ambiguous transport remains delivery_unknown for reconciliation and explicit attention rather than blind retries.
- Recovery reads actual provider history, restores missing follow-through, and preserves the attempt budget within the current inbound conversation.
- Failed, ambiguous, exhausted and overdue follow-ups appear in the existing outcome digest even when the original reply was handled by autopilot.

## Unfinished external integration

The deployed service had no VANTAGE_CREATURE_TOKEN when inspected on October 14. Context and sent-log calls are therefore unavailable in that environment. The documented integration exposes context and sent endpoints only. No booking mutation or confirmed-booking read contract has been verified.

This repair does not certify calendar availability, create calendar invitations, confirm bookings, handle no-shows, or report those stages as complete. Those stages require the real Vantage credential and a verified booking/calendar contract. A conversation awaiting that integration remains open work. Never invent times or claim a meeting was booked.

## Validation

Regression tests cover empty drafts, failed card posts, database failure before transport, uncertain delivery without resend controls, new matching provider SENT messages, retry classification, distinct inbound identity, recovery ordering, missing durable follow-through, weekend scheduling, attempt-budget restoration, and stale-task cancellation.

On the original 792a88f baseline, the repository suite already had five failing tests and one missing-module suite. Compare failures to that baseline rather than describing the whole suite as passing. There is no lint script. The build emits an upstream googleapis sideEffects metadata warning.
