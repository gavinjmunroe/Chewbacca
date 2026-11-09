# usc-fees

usc-fees reads USC's Registration and Fee Summary (atweb.usc.edu/registrationfeesummary) for the signed-in student. It lists the terms the student is registered for, and for one term it returns the charges, the awards and credits, pending aid, the totals, net charges, and academic and tuition units. Both ops are read only GETs on the app's own JSON API, the same calls the page makes, and they answer over plain HTTP (tier 1) once a session is imported.

Log in with: `chewbacca api login usc-fees`, which imports from whichever Chrome profile is signed in to USC (chosen by the USC cookies alone, never the Microsoft ones), using cookies for atweb.usc.edu, shibboleth.usc.edu, login.usc.edu and the narrowed Entra set on login.microsoftonline.com.

- registeredTerms() -> termCode, description, termBeginDate, termEndDate, isCurrentTerm
- termSummary(term) -> termCode, term, totalCharges, totalAwardsAndCredits, totalPending, netCharges, academicUnits, tuitionUnits, charges[], awardsAndCredits[], pending[] (each line: description, longDescription, transactionType, financialTransactionCode, fee {symbol, feeAmount, formattedAmount})

Caveats observed on 2026-10-10:

- term is a five digit USC term code: the year, then 1 spring, 2 summer, 3 fall (20263 = Fall 2026). Anything else is refused before a request is sent. Take codes from registeredTerms.
- There is no balance or due date in this app. netCharges is the term's charges minus awards and credits, and the page says it is not a bill. The account balance and due date live in USC ePay (my.usc.edu/portal/epay/bridgecn.php, a payment portal), which was not taught.
- The app signs in through its own backend (bff/login) to Entra and then USC Shibboleth. The session cookie it sets is what tier 1 replays. When it lapses a call comes back auth: run the login again.
- The summary response also carries a profile block (USC ID, local and permanent address, phones) and an enrolled course list. termSummary picks fields so none of that comes back. Use usc-reg for courses.
- The API also has getbursartransactions and getpostsummary, which the page never calls. Bursar transactions were the same charge lines with no dates, so they weren't taught. The Download Report button (a PDF) isn't used.
- Verified on a term that wasn't an example: every total, the units and all charge descriptions matched the response the page itself loaded after picking that term in the term menu.
