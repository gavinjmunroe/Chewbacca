# my.lucasmuseum.org (Lucas Museum of Narrative Art tickets)

Checked 2026-10-10.

- Ticket page: https://my.lucasmuseum.org/production/timed-entry/86,205. The first load can stop at an ALTCHA "waiting room" captcha. Load it again and it lets you through.
- Flow: "Get tickets" (non-member), then `button.btn-increment` per price type (the first one is Adult $25), then Next, then a jQuery UI calendar (`a[data-date="16"]`), then time buttons `button.zone-button`.
- Slot state is in the class: `zone--unavailable` (disabled), `zone--members-only` (enabled, but only for members). Anything else is open.
- A date with no `a[data-date]` link (only a span in a `ui-state-disabled` td) is fully sold out.
- Prices: Adult $25, Senior $21. Free for anyone 17 or under, members, active military and the 90037 zip (LM37). There's no college student price as of 10/10.
- Hours: Mon/Wed/Thu 10-5, Fri 10-9, Sat 9-9, Sun 9-5, closed Tue. The last slot on a 5pm-close day is 3:30.
