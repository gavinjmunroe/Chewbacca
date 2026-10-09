# brightspace

USC Brightspace (D2L) read through its own Valence REST API with the student's signed-in session. These ops feed the coursework ledger: they list enrolled courses, every dropbox and its submission state, released grades, announcements, flat content items with due dates, and calendar due items across courses, so assignments that only exist in Brightspace show up even when no syllabus listed them. All ops are read-only GETs that return plain JSON at tier 1 (Node fetch with the imported cookie jar). No browser is needed once the session is imported.

Log in from his USC Work profile: `chewbacca api login brightspace` (reads the d2l cookies from the Work Chrome profile, the same way `brightspace` does, and imports them for 12 hours)

- myCourses() -> orgUnitId, code, name, start, end, active, canAccess, homeUrl
- upcoming(orgUnitIds, start, end) -> title, courseCode, course, orgUnitId, start, due, type, eventType, url
- assignments(orgUnitId) -> folderId, name, due, outOf, gradeItemId, hidden, groupTypeId
- submissions(orgUnitId, folderId) -> status, score, isGraded, completedAt, firstSubmittedAt
- grades(orgUnitId) -> gradeItemId, name, type, points, max, weighted, weight, displayed, lastModified, released
- announcements(orgUnitId) -> id, title, date, created, modified, body, pinned
- content(orgUnitId) -> itemId, title, type, activityType, url, start, due, end, completed

Caveats observed on 2026-10-09:

- The D2L login cookies (d2lSessionVal, d2lSecureSessionVal) are browser-session cookies with no expiry. A plain `login --profile` import stores them, but api-anything's own Chrome drops them on restart, so every capture bounced to the USC SSO page and direct API URLs returned 403. The working import was a cookie file holding only the four brightspace.usc.edu d2l cookies with a 12 hour expiry, loaded with `login --cookies` and deleted right after. Expect to redo that when the session lapses. Opening Brightspace in Chrome Profile 1 renews the underlying session.
- `login` reports `loggedIn: false` for this site even when the session works. Judge by a myCourses call, not by that flag.
- orgUnitId is the numeric course offering id from myCourses. A lecture and its lab are separate org units (BISC 101 has two), so read both.
- upcoming needs orgUnitIds as a comma-separated list. Without the list the cross-course calendar call errors. start and end are ISO UTC datetimes like 2026-10-01T00:00:00.000Z. due is the event's EndDateTime.
- assignments does not say whether the student submitted. Call submissions for that. Its status is 0 unsubmitted, 1 submitted, 2 draft, 3 feedback published, and score is null until a grade is released.
- grades returns only the student's own released grade values (myGradeValues), not the course's full grade item list.
- content is the flat content/myItems list, not the nested module tree. The nested table of contents (content/toc) went over api-anything's 20,000 character output cap for three of six courses, so it was dropped. Module titles are not included.
- upcoming and content are paged by a Next field. Only the first page is returned. Every course checked fit on one page.
- Folders without a due date return due as null. Some courses return an empty list for announcements or content, which is ok with [].
- The export carries no example values, because the ids are tied to one student's enrollments, so `verify` needs ids from myCourses first.
