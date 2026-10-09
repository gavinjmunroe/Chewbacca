# usc-classes

USC's public Schedule of Classes (classes.usc.edu) as read-only operations, for planning registration without clicking through the catalogue. The site is an Angular app over a public JSON API on the same host (`/api/Programs/TermCode`, `/api/Courses/CoursesByTermSchoolProgram`, `/api/Courses/Course`, `/api/Search/Basic`), and every op below answered at tier 1 (direct HTTP, no browser, no login). Term codes are year plus season digit: 20271 is Spring 2027, 20263 is Fall 2026, 20262 is Summer 2026. On 2026-10-09 `/api/Terms/All` listed 20271, 20263 and 20262 as Active and 20261 and older as Archived. A department listing needs its school code, so call listPrograms first to find it.

- `listPrograms(termCode)` -> program, name, school, schoolName
- `listCourses(termCode, program, school)` -> code, title, units, maxUnits, description, seatsTotal, seatsRemaining, sectionCount
- `getSections(termCode, course)` -> sectionId, type, topic, notes, schedule (dayCode, days, startTime, endTime), instructors (firstName, lastName), registered, total, waitlisted, units, linkCode, isFull, isCancelled, dClearance, syllabus
- `searchCourses(termCode, query)` -> code, title, units, description, seatsTotal, seatsRemaining

## Caveats

- Location is not available. The page shows "Sign In to View" in the location column and the public API has no location field, only `sectionLocationSqNumber`. Getting it would need a USC login, which was out of scope.
- listCourses needs the right school code for the program (CSCI is ENGV, ACAD is ACAD, WRIT is DRNS). A wrong or missing school returns an empty shell, reported as `class: input`. ANAT is the only program listed under two schools (MEDK and DNTR); listPrograms returns the first.
- getSections takes the course code without a space (`CSCI102` or `CSCI-102` both work). A course not offered that term returns HTTP 204, reported as `class: input` (ACAD185 has no Spring 2027 sections).
- registered can exceed total (WRIT 150 section 64440 in Fall 2026 shows 14 / 13 on the page too). Spring 2027 sections showed 0 registered as of 2026-10-09 because registration has not opened.
- topic carries the section theme where one exists, for example WRIT 150's "Community Engagement".
- linkCode groups lecture, lab and discussion sections that must be taken together. Units are strings ("4.0") on sections and numbers on courses.
- searchCourses took 4 to 6 seconds per call, the others 0.2 to 3 seconds. The site's unfiltered `/api/Search/Autocomplete` returns all 4,687 Spring 2027 courses in 4.3 MB and was deliberately not made an op.
- The site runs Cloudflare (`/cdn-cgi/challenge-platform` loads on every page) but never challenged plain requests during this session.
