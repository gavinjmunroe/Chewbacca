# rmp (RateMyProfessors)

These ops read RateMyProfessors through the site's own GraphQL endpoint (POST https://www.ratemyprofessors.com/graphql) so instructor choices, such as picking Spring 2027 sections at USC, can be checked without a browser. Search a school for a name, then pass the returned `id` to getProfessor for the summary and the latest written ratings. Both ops are read-only, need no login, and answered at tier 1 (plain HTTP) in testing on 2026-10-09.

- `searchProfessors(query, schoolId) -> id, legacyId, first, last, department, school, avgRating, avgDifficulty, numRatings, wouldTakeAgainPercent`
- `getProfessor(id) -> id, legacyId, first, last, department, school, avgRating, avgDifficulty, numRatings, wouldTakeAgainPercent, ratings[] (class, date, clarityRating, difficultyRating, helpfulRating, ratingTags, comment, grade, attendanceMandatory, wouldTakeAgain, thumbsUpTotal, thumbsDownTotal, ...)`

## Caveats

- Ids are GraphQL global ids: base64 of `School-<n>` or `Teacher-<n>`. USC (school page /school/1381) is `schoolId=U2Nob29sLTEzODE=`. A professor at /professor/794431 is `id=VGVhY2hlci03OTQ0MzE=`. `legacyId` in the output is the numeric id used in page URLs. Numeric ids do not work as args.
- searchProfessors returns only the first 5 matches (the page's own `first: 5`). The site shows a larger total (46 for "Lee" at USC); pagination is not modeled, so use a more specific query such as a full last name.
- getProfessor returns the 5 most recent ratings, newest first. Quality is `clarityRating`; `ratingTags` is one string joined with `--`; `date` is a UTC timestamp string.
- getProfessor works at tier 1 only. The site serves professor pages by numeric id and returns 404 for the base64 id, so if the GraphQL request drifts, heal and the browser fallback cannot rebuild this op. Re-learn it from a fresh capture of a professor page reached by in-app navigation.
- searchProfessors' trigger is `/search/professors?q={query}&sid={schoolId}`; the `sid` query param accepts the base64 school id, so its heal path works.
- `wouldTakeAgainPercent` is a float (81.8182), shown rounded on the page (44% for 44). Treat it with numRatings: a professor with one rating can show 0.
- No rate limiting seen at a handful of calls; api-anything paces to 1 request per second.
