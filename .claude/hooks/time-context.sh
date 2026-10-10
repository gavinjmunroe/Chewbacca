#!/bin/bash
# UserPromptSubmit: tell the model what time it is now, every prompt.
#
# The harness states the date once, when a session starts. A tab that stays
# open across midnight keeps that date: on 2026-10-09 to 10-10 one session ran
# from Friday morning into Saturday, and the coursework plan, the memory dates
# and "due in 3 days" all leaned on whatever date it was told at the start.
# From the 2026-10-10 creator distill: Dhravya Shah's claude-timestamp and a
# second independent hook both inject `date` on every prompt for this reason.
# One line, no model call, nothing cached beyond the message itself.
now=$(date "+%A %B %-d %Y, %-I:%M %p %Z")
printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Current local time: %s."}}\n' "$now"
