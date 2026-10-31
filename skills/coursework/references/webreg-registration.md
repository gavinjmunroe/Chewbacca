# Registering in USC WebReg

Read this before submitting a WebReg checkout for a student.

- WebReg does no partial checkout. One blocked section fails the whole submit
  ("Web Registration does not process partial registration"). Unschedule the
  blocked sections, which keeps them in the bin, and resubmit the rest in the
  same turn. On 2026-10-31 a 5-class checkout failed on ACAD 174 and IR 308;
  the other 3 registered on the second submit.
- Before submitting, read every section in the bin. "Closed" under Registered,
  or a D-suffixed section, will fail. A note that D clearance was pre-granted
  is not proof: ACAD 174 failed "requires departmental authorization" on
  10/31 despite a 10/26 pre-grant note.
- Proof is the CheckoutResponse page ("You are registered in ..."). The
  "Your request is being processed" overlay sat about 20 seconds first.
- The usc-reg API is read only and returns HTTP 302 when the Entra session
  lapses. Drive webreg.usc.edu in Chrome instead, and try every connected
  browser before calling it signed out: on 10/31 one of three had the session.
- Term select: /Terms?term=<YYYYT>&handler=TermSelect, then Continue past the
  Restrictions page, then /CourseBin (/myCourseBin is a 404).
