# Living network design pass

15 September 2026; sagar-main. Mobile changes only.

- Amber mark is the self node, without an enclosing avatar circle.
- Removed bottom-center card button; tap a focused node to open its profile.
- Recenter control moved to bottom left.
- Independent node pan gestures update shared offsets and SVG strands; canvas pan remains separate. Position changes are session-local. Gentle ambient drift stops under Reduced Motion. No additional social edges are invented.
- Source circles open Updates / Connect / Add data. Updates accept source-tagged records, sort by recency and offer manual story navigation; no real feed is wired yet and empty sources show an honest empty state. Login and export limitations remain as documented.
- Calendar has bottom-right quick add, a glass composer, date/duration and optional pasted FaceTime link. Live mode uses existing Amber create-event API; preview mode stores events in the preview parent state. Creating an event does not send invites or generate a FaceTime link.
- Calendar day changes crossfade; existing date picker, Today and haptic day traversal retained.
- Actual meeting URLs in Amber event place/description now survive agenda mapping; regression test covers FaceTime and ordinary non-meeting URLs.

Visual checks: self mark, removed card button, accent locations, source tabs, event composer, and a saved synthetic preview event. Automated node drags were interpreted as taps in Simulator, so manual device/simulator drag validation remains necessary. Live account creation and social ingestion were not tested. This pass does not add identity verification or institutional assurance, and does not redesign the full onboarding flow.
