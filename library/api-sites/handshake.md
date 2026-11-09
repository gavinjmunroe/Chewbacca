# handshake

USC's Handshake (connectSC) as read-only operations, for finding jobs, internships, employer events and career fairs without opening the site. Every op reads one of Handshake's own JSON routes under https://usc.joinhandshake.com/stu/ through the signed-in session, and every op answered at tier 1 (plain HTTP, about 0.3 to 1 s). Nothing here applies, RSVPs, saves, follows or messages.

Log in with `chewbacca api login handshake`, which imports the joinhandshake.com cookies from whichever Chrome profile used Handshake last (any student, any profile; `CHEWIE_CHROME_PROFILE` names one). After the 12 hour import runs out, `chewbacca api call` re-imports once by itself and retries.

- searchJobs(query) -> id, title, employer, location, type, employment, deadline, posted
- getJob(id) -> id, title, employer, type, location, workplace, deadline, applyStart, payType, payMinCents, payMaxCents, payPeriod, currency, applyType, applyUrl, applyInstructions, workAuthorization, description
- events(query) -> id, name, employer, type, start, end, timeZone, location, medium, virtual, path
- careerFairs(query) -> id, name, host, start, end, timeZone, location, medium, registrationEnd

Caveats observed on 2026-10-09:

- The ops trigger the `.json` form of each route (`/stu/postings.json`, `/stu/jobs/{id}.json`, `/stu/events/search.json`, `/stu/career_fairs.json`). Without the suffix, a browser navigation to `/stu/postings` redirects to the new `/job-search` single-page app, and that app writes to the account on load: it records a recent search (`JobSearchCreateRecentSearch`) and marks the top job as viewed (`markJobAsViewed`). Never teach or heal these ops from the `/job-search` or `/jobs/{id}` pages.
- searchJobs returns page 1 only, newest first, up to 25 postings (often 22 after Handshake's own filtering). Its order differs from the site's relevance order, but on the same query 18 of the site's top 25 were in it with matching title, employer and deadline. Pagination is not modeled.
- id from searchJobs is the job id, which getJob takes. A job's page is https://app.joinhandshake.com/jobs/{id}. A missing id returns class input (HTTP 404).
- Pay is in cents per payPeriod (4598 means 45.98 per hour). When the employer shows no range, the pay fields are absent rather than null.
- applyType external means apply on the employer's site at applyUrl. Anything else means apply inside Handshake on the job page.
- `type` in getJob is Handshake's combined label ("Internship - Full-Time", or just "Full-Time" for a regular job).
- events searches upcoming events open to USC: info sessions, recruiting talks, workshops. employer is the host's name, location is null for virtual events, and the page is https://app.joinhandshake.com + path. It does not return career fairs, which is why careerFairs exists.
- careerFairs includes fairs run by other schools that USC students can see, with host naming the school, and each fair's page is https://app.joinhandshake.com/career_fairs/{id}.
- The engine's own Chrome drops the session cookies on import (they have no expiry), and every capture then bounced with a 302. The session that works was imported as a cookie file with a 12 hour expiry, so expect class auth after about 12 hours. Re-run the login above.
- One non-secret cookie value is an ordinary English word, so api-anything refuses to save a spec whose description contains it. Keep op descriptions plain if one is refused for "holds the live cookie".
