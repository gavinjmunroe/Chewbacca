// usc_card.mjs <jar.json>
//
// Reads the student's USCard balances (Dining Dollars, swipes, Discretionary)
// from USCard eAccounts, usc-sp.transactcampus.com, headless, with the USC
// sign-in cookies bin/lib/usc_card_jar.py wrote. Deletes the jar first thing.
//
// Only GETs of the account summary and the sign-in hops it redirects through.
// It never clicks anything on the account: no deposit, no plan change, no
// freeze. When USC's sign-in stops on its password page (login.usc.edu), it
// says so and returns, because nobody will type into a headless page.
//
// Prints one JSON line: {ok, balances: [...lines]} or {ok: false, why}.
// Seen on 2026-10-13 only up to login.usc.edu's password page: that Chrome's
// USC session was 8 hours old. The balance lines are read from the signed-in
// page's text, which nobody here has seen yet.
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const jarFile = process.argv[2];
const say = (o) => {
  console.log(JSON.stringify(o));
};
let jar = [];
try {
  jar = JSON.parse(fs.readFileSync(jarFile, "utf8"));
} finally {
  try {
    fs.rmSync(path.dirname(jarFile), { recursive: true, force: true });
  } catch {}
}

function loadPlaywright() {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const bin = path.join(dir, "api-anything");
    if (!fs.existsSync(bin)) continue;
    const pkg = path.join(
      path.dirname(fs.realpathSync(bin)),
      "..",
      "package.json",
    );
    if (fs.existsSync(pkg)) return createRequire(pkg)("playwright-core");
  }
  return null;
}

const SUMMARY =
  "https://usc-sp.transactcampus.com/student/AccountSummary.aspx?menu=0";
const pw = loadPlaywright();
if (!pw) {
  say({
    ok: false,
    why: "no headless browser: install the api engine with `chewbacca api install`",
  });
  process.exit(0);
}
const browser = await pw.chromium.launch({ channel: "chrome", headless: true });
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
  // Measured 2026-10-13: AccountSummary to login.usc.edu's password page took
  // about 6 s through shibboleth.usc.edu. 30 s leaves room on a busy Mac.
  await page.goto(SUMMARY, { waitUntil: "domcontentloaded", timeout: 30000 });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const u = new URL(page.url());
    if (
      u.hostname === "usc-sp.transactcampus.com" &&
      !/Anonymous/i.test(u.pathname)
    )
      break;
    if (u.hostname === "login.usc.edu" && /\/login\//.test(u.pathname)) break;
    await page.waitForTimeout(500);
  }
  await page
    .waitForLoadState("networkidle", { timeout: 10000 })
    .catch(() => {});
  const u = new URL(page.url());
  if (
    u.hostname !== "usc-sp.transactcampus.com" ||
    /Anonymous/i.test(u.pathname)
  ) {
    say({
      ok: false,
      why: `USC's sign-in wants your NetID password (stopped at ${u.hostname}). Sign in to any USC page in Chrome, then rerun within a few hours.`,
    });
  } else {
    const text = await page.evaluate(() => document.body.innerText);
    const balances = text
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(
        (l) =>
          /(dining dollar|swipe|discretionary|meal|guest)/i.test(l) &&
          /\$?\d/.test(l),
      );
    say(
      balances.length
        ? { ok: true, balances }
        : {
            ok: false,
            why: "signed in, but the summary page listed no balance lines",
          },
    );
  }
} catch (e) {
  say({
    ok: false,
    why: `sign-in failed: ${String(e.message).split("\n")[0]}`,
  });
} finally {
  await browser.close();
}
