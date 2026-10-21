/**
 * The PUBLIC share link: GET /u/:username
 *
 * WHY THIS EXISTS. The app's "share my profile" action built its link from
 * `amberConnectBaseUrl`, which defaulted to `https://amber.so` -- a host nobody here
 * serves. So every shared card said "Connect with Sagar on Amber --
 * https://amber.so/@sagar" and every recipient got a dead page. The link has to land
 * somewhere real, and it has to end in an actual connection rather than a marketing
 * page, so this serves a page whose only job is to hand the visitor to the app with
 * the username attached.
 *
 * HOW IT GETS INTO THE APP. Two mechanisms, in order of preference, and the page is
 * written so the second is only reached if the first fails:
 *
 *   1. A universal link. If /.well-known/apple-app-site-association (also served
 *      here) is live AND the app ships `associatedDomains: ["applinks:<host>"]`, iOS
 *      never loads this page at all -- it opens the app directly with the URL. That
 *      is the no-flash path. The AASA file is served unconditionally so that turning
 *      it on later is purely a client change: nothing here needs to move.
 *
 *   2. The `amber://` custom scheme. Until associated domains are enabled, this page
 *      loads and immediately redirects to `amber://connect?u=<username>`. The app's
 *      DeepLinkBridge picks that up and completes the connection.
 *
 * ...and if neither works because the app is not installed, the page falls back to a
 * visible install link instead of a blank screen.
 *
 * SECURITY / PRIVACY:
 *   - The username is validated against a strict allowlist BEFORE it touches SQL or
 *     HTML, and every interpolation into the page is escaped regardless. A username
 *     is attacker-controlled input reflected into a public HTML document, which is a
 *     textbook XSS sink.
 *   - The profile projection is display-only (name, avatar, occupation, city). No
 *     phone, no email, and deliberately NO amber_id: an unauthenticated endpoint that
 *     turns a guessable username into a stable internal id is an enumeration
 *     primitive, and the page has no use for the id -- the APP resolves the username
 *     to a user over an authenticated call once it opens.
 *   - An unknown username renders a generic "not found" page with the same shape and
 *     a 404, so the page is not a username oracle beyond what a public profile link
 *     inherently reveals.
 *   - no-store on the HTML: a shared link is often opened through a link preview
 *     proxy, and a cached redirect to a custom scheme is useless to the next person.
 */

import { getPublicProfileByUsername } from "../db/connections-store.js";

// Usernames are already constrained at signup; this is the independent gate that
// decides what may reach SQL and HTML. Anything else is rejected without a query.
const USERNAME_RE = /^[a-zA-Z0-9._-]{1,40}$/;

// Where to send someone who does not have the app. Overridable so this file does not
// have to change per environment. Set AMBER_INSTALL_URL in Railway to the TestFlight
// invite while Amber is in beta, and to the App Store listing at launch.
const INSTALL_URL = process.env.AMBER_INSTALL_URL || "https://apps.apple.com/app/amber";

// The App IDs that may claim universal links for this host: <TeamID>.<BundleID>.
//
// RESOLVED: the signing team is 4DMVHH99R2. `eas credentials` reports the
// distribution certificate, the provisioning profile, the APNs push key (B7L2U3457S)
// and the App Store Connect API key all issued under it; app.json's ZS5ZLTJQQ7 was
// stale and has been corrected to match. 4DMVHH99R2 is therefore listed first.
//
// ZS5ZLTJQQ7 WAS kept here as "cheap insurance" and that was wrong. iOS accepts an
// app whose App ID matches ANY entry in `details`, so listing a team that does not
// sign this app means an app signed under THAT team, with this bundle id, would
// legitimately claim /u/* on this host and receive users' share links. The signing
// team was confirmed as 4DMVHH99R2 (push key, distribution cert, provisioning
// profile and ASC key all issued under it), so the second entry buys nothing and
// widens who can claim these links. AMBER_APP_IDS still overrides if a real second
// team ever needs adding.
const APP_IDS = (process.env.AMBER_APP_IDS || "4DMVHH99R2.com.joinrytual.amber")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Escape for interpolation into HTML text or a quoted attribute. */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The bounce page.
 *
 * The redirect runs from an inline script rather than a <meta refresh> because a meta
 * refresh to a custom scheme is unreliable on iOS Safari, and it runs on a short
 * timer rather than immediately so the page has painted before the "Open in Amber?"
 * sheet appears -- an app-switch prompt over a blank white screen reads as a broken
 * link even when it works.
 */
function page({ title, heading, sub, deepLink, avatarUrl }) {
  const avatar = avatarUrl
    ? '<img class="avatar" src="' + esc(avatarUrl) + '" alt="" referrerpolicy="no-referrer">'
    : '<div class="avatar placeholder"></div>';
  const redirect = deepLink
    ? [
        "<script>",
        "// Hand off to the app. location.replace (not assign) so the browser's back",
        "// button does not bounce the visitor straight back into this redirect.",
        "var target = " + JSON.stringify(deepLink) + ";",
        "setTimeout(function () { window.location.replace(target); }, 350);",
        "// If we are still visible after the handoff should have happened, the app is",
        "// not installed: reveal the install link rather than sit on a dead page.",
        "setTimeout(function () {",
        "  if (!document.hidden) {",
        "    var f = document.getElementById('fallback');",
        "    if (f) f.className = 'fallback show';",
        "  }",
        "}, 2200);",
        "</script>",
      ].join("\n")
    : "";
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="robots" content="noindex">',
    "<title>" + esc(title) + "</title>",
    "<style>",
    ":root { color-scheme: light; }",
    "* { box-sizing: border-box; }",
    "body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;",
    "  padding:32px 24px; background:#FBF7F0; color:#201E1D;",
    '  font-family: ui-serif, Georgia, "Times New Roman", serif; -webkit-font-smoothing:antialiased; }',
    ".card { width:100%; max-width:380px; text-align:center; }",
    ".avatar { width:84px; height:84px; border-radius:42px; object-fit:cover;",
    "  border:1px solid rgba(178,98,45,0.45); display:block; margin:0 auto 22px; }",
    ".avatar.placeholder { background:#F4EDE3; }",
    "h1 { font-size:27px; line-height:1.25; letter-spacing:0.2px; margin:0 0 10px; font-weight:500; }",
    "p { margin:0; font-size:15px; line-height:1.55; color:rgba(32,30,29,0.62);",
    "  font-family: ui-sans-serif, -apple-system, system-ui, sans-serif; }",
    ".kicker { font-family: ui-sans-serif, -apple-system, system-ui, sans-serif; font-size:10.5px;",
    "  letter-spacing:1.8px; text-transform:uppercase; color:#8C491A; margin-bottom:18px; }",
    ".fallback { margin-top:30px; opacity:0; transition:opacity .35s ease; pointer-events:none; }",
    ".fallback.show { opacity:1; pointer-events:auto; }",
    "a.btn { display:inline-block; margin-top:14px; padding:14px 26px; border-radius:999px;",
    "  background:#201E1D; color:#FFF8F0; text-decoration:none;",
    "  font-family: ui-sans-serif, -apple-system, system-ui, sans-serif;",
    "  font-size:12.5px; letter-spacing:1.4px; text-transform:uppercase; }",
    "</style>",
    "</head>",
    "<body>",
    '  <div class="card">',
    '    <div class="kicker">Amber</div>',
    "    " + avatar,
    "    <h1>" + esc(heading) + "</h1>",
    "    <p>" + esc(sub) + "</p>",
    '    <div class="fallback" id="fallback">',
    "      <p>Don&rsquo;t have Amber yet?</p>",
    '      <a class="btn" href="' + esc(INSTALL_URL) + '">Get Amber</a>',
    "    </div>",
    "  </div>",
    "  " + redirect,
    "</body>",
    "</html>",
  ].join("\n");
}

export function registerConnectLinkRoutes(app) {
  /**
   * The Apple App Site Association file, for universal links.
   *
   * Served as application/json at BOTH the bare path and the /.well-known/ path,
   * because iOS has fetched it from either depending on version. Harmless to serve
   * before the client opts in: iOS only looks for it when an app declares
   * `applinks:<this host>`, so publishing it early costs nothing and makes enabling
   * universal links later a client-only change.
   *
   * `/u/*` ONLY. Nothing else on this host should be claimed by the app -- claiming
   * `/*` would swallow every API call made from a webview into an app launch.
   */
  const aasa = async (_request, reply) => {
    reply
      .header("content-type", "application/json")
      .header("cache-control", "public, max-age=3600")
      .send({
        applinks: {
          details: APP_IDS.map((appID) => ({ appID, paths: ["/u/*"] })),
        },
      });
  };
  app.get("/.well-known/apple-app-site-association", aasa);
  app.get("/apple-app-site-association", aasa);

  /**
   * GET /u/:username -- the shared "connect with me" link. Public and
   * unauthenticated by necessity: the whole point is that it works for someone who
   * does not have the app yet.
   */
  app.get(
    "/u/:username",
    {
      // Public, so it gets its own tighter bucket. A share link that goes viral (or
      // gets scraped) must not be able to spend the API's global rate budget.
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      // Accept the @ that the shared URL carries, then validate what is left.
      const raw = String(request.params?.username ?? "").replace(/^@+/, "");
      reply
        .header("content-type", "text/html; charset=utf-8")
        // A link preview proxy must not cache a redirect into a custom scheme.
        .header("cache-control", "no-store")
        // This page reflects user-set text and runs one inline script of our own. A CSP
        // permitting exactly that and nothing else means even a future escaping mistake
        // cannot pull in remote script; img-src covers avatar URLs.
        .header(
          "content-security-policy",
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
            "img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        )
        .header("x-content-type-options", "nosniff")
        .header("referrer-policy", "no-referrer");

      if (!USERNAME_RE.test(raw)) {
        return reply.code(404).send(
          page({
            title: "Amber",
            heading: "That link isn’t valid",
            sub: "Ask them to share their Amber profile again.",
          }),
        );
      }

      let profile = null;
      try {
        profile = await getPublicProfileByUsername(raw);
      } catch (err) {
        // A database blip must still produce a page that gets the visitor into the
        // app -- the app can resolve the username itself. Degrade, do not 500.
        app.log.error({ err, username: raw }, "connect-link profile lookup failed");
      }

      if (!profile) {
        return reply.code(404).send(
          page({
            title: "Amber",
            heading: "We couldn’t find that profile",
            sub: "The link may be out of date. Ask them to share it again.",
            // Still offer the handoff: if they DO have the app, opening it is more
            // useful than a dead end, and the app reports the real reason.
            deepLink: "amber://connect?u=" + encodeURIComponent(raw),
          }),
        );
      }

      // CAP EVERY REFLECTED FIELD. These are user-set profile values rendered on our own
      // domain next to a "Get Amber" button, which makes an uncapped display name a
      // phishing primitive ("Amber Support - verify your account" as an <h1>) and an
      // enormous one an unbounded public response. Escaping stops script injection; it
      // does nothing about length or content, which is a separate problem.
      const cap = (v, n) => String(v ?? "").trim().slice(0, n);
      const name = cap(profile.fullName, 60);
      const handle = cap(profile.username, 40) || raw;
      const first = name.split(/\s+/)[0] || handle;
      const detail = [cap(profile.occupation, 60), cap(profile.currentCity, 40)]
        .filter(Boolean)
        .join(" · ");

      return reply.code(200).send(
        page({
          title: "Connect with " + (name || handle) + " on Amber",
          heading: "Connect with " + (name || "@" + handle),
          sub: detail || "Opening Amber to connect you with " + first + "…",
          avatarUrl: profile.avatarUrl,
          deepLink: "amber://connect?u=" + encodeURIComponent(handle),
        }),
      );
    },
  );
}
