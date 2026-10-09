# google-maps

Google Maps place search, read logged out, for finding local small businesses to build sites for and for local lead lists. `searchPlaces` turns a free-text query into up to 20 places with the contact and rating fields a lead row needs, and `getPlace` pulls one business in full, including its weekly hours, from a query that names it. Both ops replay the `/search?tbm=map` request the Maps frontend makes (a `)]}'`-prefixed positional JSON array) over plain HTTP at tier 1, about 0.5 to 3.5 s per call. Verified 2026-10-09 from a clean `API_ANYTHING_HOME`, US IP, en-US.

- `searchPlaces(query) -> name, address, rating, reviewCount, category, categories, phone, website, placeId, cid, lat, lng, todayHours, openStatus`
- `getPlace(query) -> name, address, phone, website, rating, reviewCount, category, categories, placeId, cid, lat, lng, hoursDays, hoursText, hoursRaw, openStatus`

```sh
api-anything call google-maps searchPlaces "query=bakery in Austin TX"
api-anything call google-maps getPlace "query=Quack's 43rd Street Bakery Austin TX"
```

## Caveats

- Put the place in the query ("bakery in Austin TX"). The request carries a fixed Los Angeles viewport from the capture, so a query with no location is biased to LA.
- `searchPlaces` returns `data: null` (with `ok: true`) when Google resolves the query to a single business. Call `getPlace` with the same query for that case.
- `getPlace` returns `[]` when the query matches several places ("Bakery in Austin TX"). The reliable chain is `searchPlaces`, then `getPlace` with "name, full address" from that row, which resolved every time it was tried.
- Place ids (`ChIJ...`, `place_id:ChIJ...`) and cids (`0x...:0x...`) are not accepted as input: both came back `[]`. They are returned as output fields for dedupe and for building a Maps URL. A cid lookup through `/maps/preview/place` does work at tier 1, but its record sits at the root of the response next to unrelated entries, and the extractor cannot isolate it cleanly, so it was not shipped.
- `hoursText` holds only the first interval of each day: Sushi Gen's Friday shows 11 AM to 2 PM and drops 5 to 8:30 PM. `hoursRaw` keeps every interval, one `[day, dayIndex, [y,m,d], [[text, [[openH,openM],[closeH,closeM]]], ...], ...]` per day. `hoursDays` starts at today. Times use a narrow no-break space before AM and PM.
- `todayHours` and `openStatus` describe the moment of the call.
- `phone` and `website` are absent when the business lists none. About half of the 20 taco-truck results had no website.
- Review counts depend on the session. In one headless capture Google served the "limited view" without `reviewCount` for every result; the replayed tier 1 calls and the live page both had it (Tacos Los Carnalillos Taco Truck 2: 299, matching the page). Treat a missing `reviewCount` as unknown, not zero.
- Sponsored results shown on the page are not in the list.
- One page of results only (up to 20). No pagination, no filters (open now, price, rating).
- No rate limit or challenge was hit across about 15 calls spaced by the default 1 s.

Checked against the rendered page: Quack's 43rd Street Bakery (4.5, 1,785 reviews, (512) 453-3399, quacks43rd.com, 411 E 43rd St) and Violette Bakehouse (4.9, 304 reviews, 2901 Medical Arts St #300, violettebh.com, "Opens 8 AM" on a Friday, matching `hoursText[0]` of 8 AM to 5 PM).
