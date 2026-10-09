# usc-libraries

USC Libraries study room availability from LibCal (libcal.usc.edu), read only, for checking which group study rooms are open on a day without clicking through the booking grid. The spaces page fills its grid from a public POST, `/spaces/availability/grid`, and the op below replays it at tier 1 (direct HTTP, no browser, no login). It never books anything. The approved catalog search op is not included: it failed to save, see the caveats.

- `studyRooms(lid, start, end)` -> roomId, start, end, booked

## Caveats

- lid is the LibCal location id: 2893 Doheny Memorial Library, 2895 Leavey Library, 13141 Science and Engineering Library. These are the ids the libcal.usc.edu home page links to.
- start and end are YYYY-MM-DD, end exclusive, so one day is `start=2026-10-13 end=2026-10-14`. The page itself only asks for a three day window starting today, so start and end are not in the trigger URL. Direct replay handles any date, but a tier 3 fallback or a heal would reload today's window.
- booked is `s-lc-eq-checkout` when the slot is taken and missing when it is open. Doheny and Science and Engineering use one hour slots, some spaces use 15 minute slots.
- Room names are not in the grid response. The spaces page holds them in a script (`resourceNameIdMap`), which api-anything cannot read as JSON. On 2026-10-09: Doheny 18374 East Asian-109C, 18375 East Asian-109D, 18376 East Asian-110A, 18377 East Asian-110B (capacity 6 each). Science and Engineering 117784 SSL 208 Group Study 1, 117785 SSL 209 Group Study 2, plus space 102682 on 15 minute slots. Leavey lists rooms such as 18361 2nd Floor-201A and 233278 LVL 210-A.
- Leavey is too big for one call. A single day there returned 1,488 slots, and the output cap cut it to the first 250 (about 11 spaces). Doheny and Science and Engineering fit comfortably (44 to 66 slots a day).
- searchCatalog (Primo VE at uosc.primo.exlibrisgroup.com) was not saved. The public JSON route `/primaws/rest/pub/pnxs?...&skipDelivery=N&tab=LibraryCatalog&scope=MyInstitution&vid=01USC_INST:01USC` works with no login and returns title, author (`pnx.sort.author`), year, type and availability (`delivery.bestlocation.availabilityStatus`, `mainLocation`, `callNumber`). api-anything refused to save it because the required view id `01USC_INST` is also the value of the site's `institute` cookie, which its credential scan treats as a live secret. The value is public (it appears in links on libraries.usc.edu), but the scan has no override for URL params, so the op was left out rather than hand-editing the spec.
- Grid calls took about 0.3 seconds. No rate limiting or challenge was seen.
