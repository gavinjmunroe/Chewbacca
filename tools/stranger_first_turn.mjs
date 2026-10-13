#!/usr/bin/env node
// The stranger's first agent turn, headless: load the address `chewbacca
// agents --print-url` printed, the way a browser tab would (no token handed
// in, no Kyber), start an agent in the sample repo and ask it one thing.
//
//   node tools/stranger_first_turn.mjs <url>
//   env: NODE_PATH with playwright, STRANGER_REALM_HOME (the scratch engine's
//        home), STRANGER_REPO, STRANGER_ASK
//
// Prints one JSON line: ms to the tiles, ms from Enter to the first answer,
// the page's own errors. Nothing here takes the screen: WebKit is headless.
// Called by tools/stranger_run.py.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { webkit } = require("playwright");

// How long the page may take to draw the tiles. The 10/12 run drew them in
// under 2 s once the token was in; 60 s is a guessed ceiling for a cold page.
const TILES_MS = 60_000;
// How long the fake agent may take to answer. It replies in about 0.5 s
// (10/12 run: 0.46 s); 60 s covers a loaded Mac, guessed.
const ANSWER_MS = 60_000;
// Each sheet and chooser step. 8 s timed out once at load 31 in the 10/13
// run (the chooser lists every checkout under $HOME); 30 s is a guess.
const STEP_MS = 30_000;

const url = process.argv[2];
const out = { errors: [], console: [] };
const say = () => console.log(JSON.stringify(out));

/** One RPC to the scratch engine: the fake agent is picked as his default
 *  kind, which a stranger does by choosing Claude in the same sheet. */
async function pickFakeAgent(home) {
  const d = JSON.parse(readFileSync(`${home}/daemon.json`, "utf8"));
  const ws = new WebSocket(`ws://127.0.0.1:${d.port}`, [`realm.${d.token}`]);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = fail;
  });
  await new Promise((ok, fail) => {
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id === "1")
        m.error ? fail(new Error(JSON.stringify(m.error))) : ok();
    };
    ws.send(
      JSON.stringify({
        id: "1",
        method: "settings.set",
        params: { key: "ui.lastAgentKind", value: "fake" },
      }),
    );
  });
  ws.close();
}

const browser = await webkit.launch({ headless: true });
let page = null;
let stage = "load";
try {
  page = await (
    await browser.newContext({ viewport: { width: 1280, height: 860 } })
  ).newPage();
  page.on("pageerror", (e) =>
    out.errors.push(`page: ${e.message}`.slice(0, 200)),
  );
  page.on(
    "console",
    (m) => m.type() === "error" && out.console.push(m.text().slice(0, 200)),
  );
  await pickFakeAgent(process.env.STRANGER_REALM_HOME);
  const t0 = Date.now();
  await page.goto(url);
  try {
    await page.waitForSelector(".glass-tile-new", { timeout: TILES_MS });
  } catch {
    const body = await page.evaluate(() => document.body?.innerText ?? "");
    out.errors.push(
      `the page never drew the agents (${body.trim().slice(0, 120) || "blank"})`,
    );
    out.blank = body.trim().length === 0;
    say();
    process.exit(1);
  }
  out.ms_to_tiles = Date.now() - t0;
  out.address_bar_has_code = page.url().includes("launch=");
  stage = "new-agent";
  await page.click(".glass-tile-new");
  await page.waitForSelector(".space-name", { timeout: STEP_MS });
  await page.fill(".space-name", "First try");
  stage = "choose-folder";
  await page
    .getByRole("dialog", { name: "New space" })
    .getByRole("button", { name: /Choose folder/ })
    .click();
  await page.waitForSelector(".glass-pick", { timeout: STEP_MS });
  const repo = process.env.STRANGER_REPO;
  // Typed the way a person types a path in his chooser: from ~.
  const home = process.env.STRANGER_HOME || "";
  await page.keyboard.type(home && repo.startsWith(home) ? "~" + repo.slice(home.length) : repo);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".glass-pick", {
    state: "detached",
    timeout: STEP_MS,
  });
  stage = "create";
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForSelector(".composer-input", {
    state: "visible",
    timeout: 15000,
  });
  stage = "ask";
  const before = await page.evaluate(() => document.body.innerText);
  await page.click(".composer-input");
  await page.keyboard.type(process.env.STRANGER_ASK || "hello", { delay: 2 });
  const tAsk = Date.now();
  await page.keyboard.press("Enter");
  const ask = process.env.STRANGER_ASK || "hello";
  const answered = await page
    .waitForFunction(
      ({ before, ask }) => {
        const seen = new Set(before.split("\n").map((l) => l.trim()));
        return document.body.innerText
          .split("\n")
          .map((l) => l.trim())
          .some(
            (l) =>
              l.length > 12 &&
              !seen.has(l) &&
              !ask.includes(l) &&
              !l.includes(ask),
          );
      },
      { before, ask },
      { timeout: ANSWER_MS, polling: 100 },
    )
    .then(
      () => true,
      () => false,
    );
  out.answered = answered;
  if (answered) out.ms_to_answer = Date.now() - tAsk;
  if (answered) {
    const seen = new Set(before.split("\n").map((l) => l.trim()));
    out.first_new_line = (await page.evaluate(() => document.body.innerText))
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 12 && !seen.has(l) && !ask.includes(l) && !l.includes(ask))
      ?.slice(0, 160);
    if (process.env.STRANGER_SHOTS) {
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${process.env.STRANGER_SHOTS}/answered.png` });
    }
  }
  else out.errors.push("no answer appeared after the ask");
} catch (err) {
  out.errors.push(
    String(err.message || err)
      .split("\n")[0]
      .slice(0, 200),
  );
  out.at = stage;
  if (process.env.STRANGER_SHOTS && page) {
    await page
      .screenshot({ path: `${process.env.STRANGER_SHOTS}/failed-${stage}.png` })
      .catch(() => {});
    out.body = (await page.evaluate(() => document.body.innerText).catch(() => "")).slice(0, 600);
  }
} finally {
  await browser.close();
}
say();
process.exit(out.answered ? 0 : 1);
