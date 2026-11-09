// sso_warmup.mjs <signin-url> <cookies-in.json> <cookies-out.json> [check-path json-path]
//
// Finishes a USC sign-in that only completes inside a page, headless, and
// writes the site's session cookies for `api-anything login --cookies`.
//
// AIMS parking signs in through Entra SAML, then a handoff page POSTs the
// session over to usc.aimsparking.com. The engine's read guard aborts that POST
// on a tier-3 call, and `api-anything capture` signs in but keeps the cookies
// in its own browser profile, never in the site's session (2026-10-13: every
// fresh-engine call answered as a guest, signedIn false).
//
// In: the cookie jar chewbacca-api decrypted from the student's Chrome (the
// narrowed Entra set plus the USC SSO hosts). Out: every cookie the browser
// holds for the landing page's registrable domain. Never a window, and the only
// requests this makes are the ones the sign-in page itself makes.
import { createRequire } from "module";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const [url, inFile, outFile, checkPath, checkField] = process.argv.slice(2);
if (!url || !inFile || !outFile) {
  console.error(
    "usage: sso_warmup.mjs <signin-url> <cookies-in.json> <cookies-out.json>",
  );
  process.exit(2);
}

// playwright-core ships inside the api engine this script serves, so resolve
// it from there rather than adding a dependency to the kit. The engine's own
// binary is the reliable pointer: `npm root -g` named /usr/local while the
// engine sat under /opt/homebrew on this Mac (2026-10-13).
function loadPlaywright() {
  const pkgs = [];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const bin = path.join(dir, "api-anything");
    if (!fs.existsSync(bin)) continue;
    // <root>/api-anything/dist/cli.js, symlinked into a bin directory
    pkgs.push(path.join(path.dirname(fs.realpathSync(bin)), "..", "package.json"));
  }
  if (!pkgs.some((p) => fs.existsSync(p))) {
    try {
      const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      pkgs.push(path.join(npmRoot.trim(), "api-anything", "package.json"));
    } catch {}
  }
  for (const pkg of pkgs) {
    if (fs.existsSync(pkg)) return createRequire(pkg)("playwright-core");
  }
  throw new Error("api-anything is not installed, so there is no browser to sign in with");
}

const root = (h) => h.replace(/^\./, "").split(".").slice(-2).join(".");
const { chromium } = loadPlaywright();
const jar = JSON.parse(fs.readFileSync(inFile, "utf8"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
let code = 0;
try {
  const ctx = await browser.newContext();
  await ctx.addCookies(
    jar.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || "/",
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
    })),
  );
  const page = await ctx.newPage();
  const seen = [];
  if (checkPath) {
    page.on("response", async (r) => {
      const u = new URL(r.url());
      if (u.pathname + u.search === checkPath || (u.pathname + u.search).startsWith(checkPath + "&")) {
        try { seen.push(await r.json()); } catch {}
      }
    });
  }
  // Measured 2026-10-13: Entra to the AIMS landing page took 3 to 6 s at load
  // 17 to 37. 30 s leaves room on a busy Mac and still fails fast when Entra
  // stops on a password page that nobody will ever type into.
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  const start = new URL(url).hostname;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const host = new URL(page.url()).hostname;
    if (host !== start && root(host) === root(start)) break;
    await page.waitForTimeout(500);
  }
  const landed = new URL(page.url()).hostname;
  if (root(landed) !== root(start) || landed === start) {
    console.error(`sign-in stopped at ${landed}: USC wants a password or Duo`);
    code = 1;
  } else {
    await page
      .waitForLoadState("networkidle", { timeout: 10000 })
      .catch(() => {});
    // Landing on the site is not proof: a rejected SAML answer also lands on
    // its guest home. Read the answer the site's own page got for the check
    // request, sent with the headers the site expects (a bare fetch from the
    // page came back as a guest on 2026-10-13 even when signed in).
    if (checkPath && checkField) {
      let v = seen.length ? seen[seen.length - 1] : undefined;
      for (const k of checkField.split(".")) v = v == null ? v : v[k];
      if (v !== true) {
        console.error(`landed on ${landed} as a guest: the sign-in didn't take`);
        code = 1;
      }
    }
  }
  if (code === 0) {
    const mine = (await ctx.cookies()).filter(
      (c) => root(c.domain) === root(landed),
    );
    const fd = fs.openSync(outFile, "wx", 0o600);
    fs.writeSync(
      fd,
      JSON.stringify(
        mine.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          // Session cookies get the same 12 hours the profile import gives.
          expires:
            c.expires > 0
              ? c.expires
              : Math.floor(Date.now() / 1000) + 12 * 3600,
          httpOnly: c.httpOnly,
          secure: c.secure,
        })),
      ),
    );
    fs.closeSync(fd);
  }
} catch (e) {
  console.error(`sign-in failed: ${String(e.message).split("\n")[0]}`);
  code = 1;
} finally {
  await browser.close();
}
process.exit(code);
