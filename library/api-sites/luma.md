# luma

Luma (luma.com, formerly lu.ma) is where most LA startup, founder and AI community events are posted. These ops read the public, logged-out pages so an agent can list what is coming up in a city and then pull one event's details, hosts and their social handles, and ticket or approval status, for example to shortlist founder events in LA. Both ops read the Next.js `__NEXT_DATA__` JSON embedded in the server-rendered page, so they answer over plain HTTP at tier 1 with no browser.

- `cityEvents(city) -> name, slug, eventId, startAt, endAt, timezone, venue, address, city, locationType, hosts, guestCount, requireApproval, isFree`
- `getEvent(slug) -> name, slug, eventId, startAt, endAt, timezone, locationType, venue, address, city, addressVisibility, description, hostNames, hostUsernames, hostTwitter, hostLinkedin, hostInstagram, hostWebsite, calendar, registration, requireApproval, isFree, priceCents, currency, soldOut, spotsRemaining, waitlist, guestCount`

Caveats observed on 2026-10-09:

- Times: `startAt` and `endAt` are UTC ISO strings. Convert with the event's own `timezone` field (IANA, e.g. `America/Los_Angeles`). Checked: VesselShow returns `2026-10-10T02:00:00.000Z`, which the page shows as Friday, October 9, 7:00 PM Pacific.
- `city` is the discover-page slug: `la`, `sf`, `nyc`, `london`. It returns the 20 events in the page's initial payload, roughly the next few days. Later events load through `api.luma.com/discover/get-paginated-events`, which keys on an internal `discplace-...` id, not the slug; pagination is not covered.
- The event URL is `https://luma.com/<slug>`. Feed `slug` from `cityEvents` straight into `getEvent`.
- `searchEvents` is not built. Luma has no logged-out search: `api.luma.com/search/get-results` returns 401 "You are not signed in.", `luma.com/search` is a 404, and the discover page has no search box.
- `venue` and `address` are absent when the host hides the address (`addressVisibility: "guests-only"`); `city` is still present.
- `hosts` and the `host*` lists are parallel arrays, one slot per host, with `null` where a host has no value. A host can have a `null` name. LinkedIn handles are paths like `/in/name` or `/company/name`.
- `description` is a list of text runs from paragraphs only. Bullet and numbered lists in the description (for example the artist list on VesselShow) are dropped. Join the runs with spaces for a readable summary.
- `priceCents` is a single representative price. Events with several ticket types (early bird, member, standard) show more options on the page than this field captures.
- `guestCount` is often 0 when the host hides the guest list.
- Verified on held-out inputs: `cityEvents city=la` (20 events, tier 1, about 2 s) and `getEvent slug=VesselShow` (tier 1, about 1 s). api-anything spaces calls 1 s apart; no rate limiting seen.
