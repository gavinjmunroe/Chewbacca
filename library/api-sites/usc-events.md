# usc-events

USC's official events calendar at calendar.usc.edu runs on Localist, and both ops call Localist's public JSON API (/api/2/events) directly, with no login. Use them to see what is happening on campus in a date window, or to find talks, panels and arts events by keyword before planning a club event around them.

- upcoming(start, end) -> title, start, end, location, room, organizer, url
- searchEvents(q) -> title, start, end, location, room, organizer, url

Caveats:
- Both answered on tier 1 (plain HTTP), about 2 s per call. No rate limiting seen at this volume.
- start and end are dates as YYYY-MM-DD. Each call returns at most 100 events (pp=100) and does not page, so keep windows short; one week returned 66 events.
- A recurring event comes back once per occurrence in the window, and start/end are that occurrence's times (checked: an Oct 20 instance of a weekly Religious Life event matched its page).
- searchEvents only searches current and future events, and the index is narrow: "film" and "robotics" returned nothing while "lecture" returned 4.
- end is null for all-day events. organizer is the first Localist department, which can be empty. location is often blank for online or unlisted events.
