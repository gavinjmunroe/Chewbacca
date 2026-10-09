# usc-jobs

USC's public job board on Workday (usc.wd5.myworkdayjobs.com, site ExternalUSCCareers, linked from usccareers.usc.edu), as read-only operations for finding a USC job and reading its posting without clicking through the Workday app. The page is a single-page app over Workday's candidate JSON API on the same host (`POST /wday/cxs/usc/ExternalUSCCareers/jobs` for search, `GET /wday/cxs/usc/ExternalUSCCareers/job/<slug>` for one posting). Both ops answered at tier 1 (direct HTTP, no browser, no login) in about 0.6 to 1.3 seconds.

- `searchJobs(query)` -> title, location, posted, timeType, jobId, jobSlug, jobPath
- `getJob(jobSlug)` -> title, jobId, location, campusLocation, posted, startDate, timeType, description, url

## Caveats

- This is the external staff and faculty-adjacent board. It has no student worker category: its worker types on 2026-10-09 were Staff, Staff Fixed Term, Staff Per Diem, Post Docs and Resource Employee. USC student jobs are posted inside signed-in Workday ("Browse Jobs" at wd5.myworkday.com/usc) and on Handshake, neither of which this site covers. A separate public site, USCAdvancementCareers, exists on the same tenant and is not covered either.
- Search is Workday's fuzzy full-text search. A specific word narrows well ("biostatistician" gave the same 3 jobs as the page, "data analyst" gave 11), but a broad word barely filters ("research" matched 425 of the 692 postings, "student" matched all 692). A nonsense query returns `[]`.
- searchJobs returns the first 20 results only. No pagination, facets or location filter.
- url is not in the search response. Build it as `https://usc.wd5.myworkdayjobs.com/en-US/ExternalUSCCareers` + jobPath. getJob returns url directly.
- getJob takes the last segment of jobPath (jobSlug, for example `Biostatistician-II_REQ20181725`). The full jobPath does not work as a param because the slashes get URL-encoded and Workday answers 404. The requisition id alone (`REQ20181725`) also 404s.
- description is HTML. Pay is not a separate field: when USC lists one it sits inside description as a dollar range (the Biostatistician II posting reads "$104,390.76" to "$132,636.23"). Not every posting was checked for one, so treat a missing range as unknown.
- location says "2 Locations" for multi-site postings in search; getJob's location and campusLocation give the primary one.
- posted is relative text ("Posted 3 Days Ago", "Posted 30+ Days Ago"), not a date. getJob's startDate is the posting start date.
- Verified 2026-10-09 against the rendered Workday pages: the biostatistician search list (titles, REQ ids, "Posted 3 Days Ago") and the Biostatistician II posting (title, REQ id, posted text, salary line) matched.
