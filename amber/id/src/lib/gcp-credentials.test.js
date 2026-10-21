/**
 * gcp-credentials: the conversion that took production down when it vanished.
 *
 * Railway holds the service account as JSON TEXT; every Google library reads a
 * FILE PATH. That conversion lived inside src/db/firestore.js as a side effect of
 * Firestore's boot, and the thing depending on it was the Cloud SQL connector.
 * Deleting Firestore removed Cloud SQL authentication in a commit that touched
 * neither, and the symptom was every authenticated request 401ing while the app
 * rendered as an empty account.
 *
 * These pin the behavior so it cannot be an accident of some other module again.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const KEY = JSON.stringify({
  client_email: "svc@proj.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n",
  project_id: "proj",
});

/** Fresh module instance, because the resolution is memoized on purpose. */
async function fresh() {
  return import(`./gcp-credentials.js?t=${Math.random()}`);
}

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

test("JSON in the env becomes a real file, and the path is exported", () =>
  withEnv(
    { GOOGLE_APPLICATION_CREDENTIALS_JSON: KEY, GOOGLE_APPLICATION_CREDENTIALS: undefined },
    async () => {
      const { ensureGcpCredentials } = await fresh();
      const res = ensureGcpCredentials();
      assert.equal(res.ok, true);
      assert.equal(res.source, "GOOGLE_APPLICATION_CREDENTIALS_JSON");
      // The whole point: the library-visible variable now points at a real file.
      assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, res.path);
      assert.ok(fs.existsSync(res.path));
      assert.equal(JSON.parse(fs.readFileSync(res.path, "utf8")).project_id, "proj");
    },
  ));

test("an EXISTING credentials file always wins over the env var", () =>
  withEnv({ GOOGLE_APPLICATION_CREDENTIALS_JSON: KEY }, async () => {
    // A deploy that mounts a real key file, or a developer with gcloud ADC, must
    // not have it silently replaced.
    const real = `${process.env.TMPDIR || "/tmp"}/gcp-creds-test-real.json`;
    fs.writeFileSync(real, KEY);
    await withEnv({ GOOGLE_APPLICATION_CREDENTIALS: real }, async () => {
      const { ensureGcpCredentials } = await fresh();
      const res = ensureGcpCredentials();
      assert.equal(res.ok, true);
      assert.equal(res.source, "GOOGLE_APPLICATION_CREDENTIALS");
      assert.equal(res.path, real);
    });
    fs.unlinkSync(real);
  }));

test("nothing configured -> not ok, with a reason, and NOT cached", () =>
  withEnv(
    { GOOGLE_APPLICATION_CREDENTIALS_JSON: undefined, GOOGLE_APPLICATION_CREDENTIALS: undefined },
    async () => {
      const mod = await fresh();
      const first = mod.ensureGcpCredentials();
      assert.equal(first.ok, false);
      assert.match(first.reason, /GOOGLE_APPLICATION_CREDENTIALS/);
      // A failure must not poison a later attempt — the variable may arrive after
      // the first call in some start-up orders.
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = KEY;
      assert.equal(mod.ensureGcpCredentials().ok, true);
    },
  ));

test("malformed JSON fails HERE, with a readable reason", () =>
  withEnv(
    { GOOGLE_APPLICATION_CREDENTIALS_JSON: "{not json", GOOGLE_APPLICATION_CREDENTIALS: undefined },
    async () => {
      // Otherwise a Google library reports "could not load the default
      // credentials" ten frames from the actual problem.
      const { ensureGcpCredentials } = await fresh();
      const res = ensureGcpCredentials();
      assert.equal(res.ok, false);
      assert.match(res.reason, /not valid JSON/);
    },
  ));

test("valid JSON with no client_email is refused", () =>
  withEnv(
    { GOOGLE_APPLICATION_CREDENTIALS_JSON: '{"project_id":"p"}', GOOGLE_APPLICATION_CREDENTIALS: undefined },
    async () => {
      const { ensureGcpCredentials } = await fresh();
      const res = ensureGcpCredentials();
      assert.equal(res.ok, false);
      assert.match(res.reason, /client_email/);
    },
  ));

test("missing creds WITH Cloud SQL configured is an ERROR, not a warning", () =>
  withEnv(
    {
      GOOGLE_APPLICATION_CREDENTIALS_JSON: undefined,
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
      AMBER_SQL_DB: "amber",
    },
    async () => {
      // This is the production state that produced the outage. It has to shout.
      const { reportGcpCredentials } = await fresh();
      const seen = { error: [], warn: [], log: [] };
      reportGcpCredentials({
        error: (m) => seen.error.push(m),
        warn: (m) => seen.warn.push(m),
        log: (m) => seen.log.push(m),
      });
      assert.equal(seen.error.length, 1, "must go to error, not warn");
      assert.match(seen.error[0], /NO CREDENTIALS/);
      assert.match(seen.error[0], /401/, "must name the symptom operators will actually see");
    },
  ));

test("missing creds with NO Cloud SQL configured is only a warning", () =>
  withEnv(
    {
      GOOGLE_APPLICATION_CREDENTIALS_JSON: undefined,
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
      AMBER_SQL_DB: undefined,
      AMBER_SQL_CONNECTION_NAME: undefined,
    },
    async () => {
      // Ordinary local development. A gate that shouts here gets ignored there.
      const { reportGcpCredentials } = await fresh();
      const seen = { error: [], warn: [] };
      reportGcpCredentials({ error: (m) => seen.error.push(m), warn: (m) => seen.warn.push(m), log: () => {} });
      assert.equal(seen.error.length, 0);
      assert.equal(seen.warn.length, 1);
    },
  ));
