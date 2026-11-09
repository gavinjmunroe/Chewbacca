# usc-parking

usc-parking reads a USC student's own parking account on AIMS (usc.aimsparking.com, USC Transportation's permit site): the balance, unpaid citations and their total, unpaid fees and permits, how many permits are active, waitlists, the vehicles on file, and each active permit. Both ops are read-only GETs on the JSON the account pages load, and answer over plain HTTP (tier 1) once signed in.

Log in with: `chewbacca api login usc-parking`. It imports the narrowed Entra cookies from whichever Chrome profile is signed in to USC, then finishes the sign-in headless (bin/lib/sso_warmup.mjs) at uscauth.aimsparking.com, the page behind the site's "USC NetID" button. A lapsed session does the same on its own inside `chewbacca api call`.

- account() -> signedIn, balance, unpaidTickets, unpaidTicketsTotal, unpaidFees, unpaidFeesTotal, unpaidPermits, activePermits, waitlists, vehicles, cartItems
- activePermits() -> permitNumber, type, status, activeMs, expiresMs, balance, vehicles

Caveats observed on 2026-10-13:

- signedIn false means the answer is a guest page, never the student's account. `chewbacca api call` re-signs in and retries once when it sees it; if it still says false, Entra wants a password or Duo and that's a BLOCKED line, never a "no tickets".
- A signed-out activePermits answers an error page where the JSON was, which the engine calls drift. On this site that also means signed out.
- activeMs and expiresMs are epoch milliseconds. 1798790340000 is Dec 31 2026 11:59 pm Pacific, and the permits page showed 12/31/2026 for the same permit. Balances are strings in dollars ("0.00").
- The individual citation list (/tickets/) sits behind a Cloudflare Turnstile challenge for the headless browser, so it's not taught. account's unpaidTickets and unpaidTicketsTotal come from the same account data the site's header badge uses.
- Why not a tier-3 trigger: AIMS's sign-in hands the session over with a POST from uscauth to usc.aimsparking.com/secure/index.php, and the engine's read guard aborts that POST, so the trigger never signs in. The ops keep the SSO URL as their trigger only for healing.
- Order Permit, the cart, Pay Now, Appeal Ticket and vehicle edits are writes and are never loaded or taught.
