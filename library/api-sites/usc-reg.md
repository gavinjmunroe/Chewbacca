# usc-reg

usc-reg reads USC Web Registration (webreg.usc.edu) for the signed-in student without loading anything that changes registration. It answers four questions for Fall 2026 (term 20263) and Spring 2027 (term 20271): when the registration appointment opens and which restrictions apply, which holds the term carries, which sections are registered, and what sits in the course bin. All ops are read only, server-rendered HTML, and run in the browser tier.

Log in with: `chewbacca api login usc-reg`, which imports from whichever Chrome profile is signed in to USC, using the cookie-file route with cookies for my.usc.edu, shibboleth.usc.edu, login.usc.edu and login.microsoftonline.com. The Entra cookies are what get past Microsoft's sign-in.

- registrationAppointmentFall2026() -> term, begins, restrictions[]
- registrationAppointmentSpring2027() -> term, begins, restrictions[]
- holdsFall2026() -> [{text}] (each line of the Restrictions notice; [] when the term has none)
- holdsSpring2027() -> [{text}]
- scheduleFall2026() -> per course: course, sectionIds[], sections[], types[], units[], seats[], times[], days[], instructors[], locations[]
- scheduleSpring2027() -> same fields as scheduleFall2026
- courseBinFall2026() -> same fields as scheduleFall2026, read from myCourseBin
- courseBinSpring2027() -> same fields as scheduleFall2026

Caveats observed on 2026-10-09:

- WebReg keeps the selected term in the server session. GET /Terms?term=<code>&handler=TermSelect sets it, and the data pages ignore a ?term= query param (tested). An op can't take term as an argument because the learned page request never carries it, so each op is pinned to one term with minTier 3. That makes the term select run first on every call. Don't lower minTier, because plain HTTP would answer for whichever term the session last selected. Adding a new term means adding ops with its code.
- Each call launches Chrome and signs in again: webreg.usc.edu/auth to login.microsoftonline.com (OIDC) to USC Shibboleth to webreg.usc.edu/signin-oidc. One call takes about 6 to 9 seconds. The trigger needs login.microsoftonline.com, and none of the spec's own requests do. Without the Entra cookies, Entra stops on its CmsiInterrupt page (pgid CmsiInterrupt, error 399218) and every op fails with auth.
- On load the pages fire only GETs, plus Cloudflare RUM and Datadog RUM telemetry POSTs. The course bin page carries Schedule, Remove, Unschedule and grade-option forms. The ops only read the HTML and never touch those forms. For a term with holds, TermSelect redirects to /Restrictions, whose Continue button goes to /Acknowledgement. The ops never click it.
- Registered units aren't a separate field. Add up units within schedule. units and types keep the page's mobile label text ("Units: 4.0", "Type: Lecture").
- instructors is a flat list per course, so a section with two instructors makes it longer than sections.
- An empty term (no registered courses, empty bin) returns [].
- Once, during setup, a Fall op returned Spring data. That was before the final re-learn, and six later calls that alternated terms all came back correct. Check the term field on appointment results. Schedule and course bin results carry no term label.
- The myUSC portal (my.usc.edu) has none of this data. Its Registration & Fee Summary tile (atweb.usc.edu/registrationfeesummary) sits behind the same Entra sign-in and wasn't taught.
