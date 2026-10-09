# linkedin-jobs

LinkedIn's logged-out public job search, used to read hiring-surge buying signals for outbound: which companies are posting which roles, where, and how recently. Both ops are plain HTTP GETs against public, signed-out LinkedIn pages, with no account, cookie or session in the spec. searchJobs reads the server-rendered results list of `/jobs/search`, and getJob reads the guest posting fragment at `/jobs-guest/jobs/api/jobPosting/<jobId>` that the search page itself loads for its detail pane. Chain them: take `jobId` from searchJobs and pass it to getJob.

- `searchJobs(keywords, location) -> jobId, title, company, companyUrl, location, postedDate, posted, url`
- `getJob(jobId) -> [ {title, company, companyUrl, location, posted, applicants}, {criteriaLabels, criteriaValues, seniority, employmentType, description} ]`

## Caveats

- Verified live on 2026-10-09. Both ops answered at tier 1 (plain HTTP, no browser): searchJobs in about 3 to 8 s, getJob in about 0.3 to 1.7 s. Held-out checks: searchJobs `keywords=account executive`, `location=Denver, Colorado, United States` (first result Muck Rack, jobId 4466540145, postedDate 2026-09-17, matched the page), and getJob `jobId=4466540145` (title, company, "Be among the first 25 applicants", Full-time, matched the raw posting).
- Result count per call is whatever the first server-rendered page holds: 26 for a narrow search, 60 for a broad one. Pagination is not modeled.
- Write `location` in full, as LinkedIn's own location box does: `Austin, Texas, United States`. A bare `Austin` was geocoded to Austin, Colorado.
- There is no separate companyJobs op. Putting the company name in `keywords` with a broad location (`keywords=Stripe`, `location=United States`) returned 60 results, all from Stripe. LinkedIn's exact company filter (`f_C`) needs a numeric company id that the public cards do not expose.
- `postedDate` is the ISO date from the card's `datetime`; `posted` is the relative text ("1 week ago"). `companyUrl` and `url` have their tracking query strings stripped. `companyUrl` can carry a country subdomain (`ca.linkedin.com`, `il.linkedin.com`).
- getJob returns two objects in page order, because the guest fragment has no single root element: `data[0]` is the top card, `data[1]` is the details. Merge them. `criteriaLabels` and `criteriaValues` pair by index and are the reliable criteria source. `seniority` and `employmentType` are read by position (first and second criterion) and are wrong if LinkedIn omits the seniority row. Job function is often absent. `description` is the full plain text of the posting, often 5k to 10k characters.
- An unknown jobId returns `ok: false`, `class: input` (HTTP 404).
- No rate limiting was seen on the plain HTTP tier across about a dozen calls. The browser tier is a different story: after one search capture, LinkedIn sent the Chrome profile to `/authwall` on the next search load, and `/jobs/view/<id>` answered HTTP 999 with a reCAPTCHA authwall. If a call ever falls back to the browser, expect it to be walled. Keep volume light and spaced.
