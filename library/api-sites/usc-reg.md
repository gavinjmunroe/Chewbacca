# usc-reg

usc-reg reads USC Web Registration (webreg.usc.edu) for the signed-in student without loading anything that changes registration. It answers four questions for any term: when the registration appointment opens and which restrictions apply, which holds the term carries, which sections are registered, and what sits in the course bin. All ops are read only, server-rendered HTML, and run in the browser tier.

Log in with: `chewbacca api login usc-reg`, which imports from whichever Chrome profile is signed in to USC (chosen by the USC cookies alone), using the cookie-file route with cookies for my.usc.edu, shibboleth.usc.edu, login.usc.edu and login.microsoftonline.com. The Entra cookies are what get past Microsoft's sign-in.

- registrationAppointment(term) -> term, begins, restrictions[]
- holds(term) -> [{text}] (each line of the Restrictions notice; [] when the term has none)
- schedule(term) -> per course: course, sectionIds[], sections[], types[], units[], seats[], times[], days[], instructors[], locations[]
- courseBin(term) -> same fields as schedule, read from myCourseBin

term is the USC term code, YYYY then 1 spring, 2 summer, 3 fall (20271 is Spring 2027), and `usc-fees registeredTerms` lists the student's own. The eight ops pinned to Fall 2026 and Spring 2027 that came first were removed on 2026-10-10 once these took a term.

Caveats observed on 2026-10-09:

- WebReg keeps the selected term in the server session. GET /Terms?term=<code>&handler=TermSelect sets it, and the data pages ignore a ?term= query param (tested). The term ops fill the term into that trigger URL and also carry it as ?term= on the page request, which WebReg ignores and the engine needs so it can confirm the answer is for the term asked (2026-10-10: holds term=20271 returned the Spring notice and term=20263 returned [], schedule term=20263 the Fall sections and term=20271 []). minTier stays 3 so the term select runs first on every call. Don't lower it, because plain HTTP would answer for whichever term the session last selected.
- Each call launches Chrome and signs in again: webreg.usc.edu/auth to login.microsoftonline.com (OIDC) to USC Shibboleth to webreg.usc.edu/signin-oidc. One call takes about 6 to 9 seconds. The trigger needs login.microsoftonline.com, and none of the spec's own requests do. Without the Entra cookies, Entra stops on its CmsiInterrupt page (pgid CmsiInterrupt, error 399218) and every op fails with auth.
- On load the pages fire only GETs, plus Cloudflare RUM and Datadog RUM telemetry POSTs. The course bin page carries Schedule, Remove, Unschedule and grade-option forms. The ops only read the HTML and never touch those forms. For a term with holds, TermSelect redirects to /Restrictions, whose Continue button goes to /Acknowledgement. The ops never click it.
- Registered units aren't a separate field. Add up units within schedule. units and types keep the page's mobile label text ("Units: 4.0", "Type: Lecture").
- instructors is a flat list per course, so a section with two instructors makes it longer than sections.
- An empty term (no registered courses, empty bin) returns [].
- Once, during setup, a Fall op returned Spring data. That was before the final re-learn, and six later calls that alternated terms all came back correct. Check the term field on appointment results. Schedule and course bin results carry no term label.
- The myUSC portal (my.usc.edu) has none of this data. Its Registration & Fee Summary tile (atweb.usc.edu/registrationfeesummary) is the usc-fees site.
