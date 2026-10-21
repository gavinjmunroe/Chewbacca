/**
 * TEST-ONLY: swap src/db/sql.js for src/db/sql-fake.js via an ESM loader, so
 * modules that `import { query, withTransaction } from "./sql.js"` transparently
 * hit the in-memory fake. Nothing in the runtime graph imports this.
 *
 * Usage — installFakeSql() MUST run before the module under test is imported,
 * which means the import has to be dynamic:
 *
 *   import { installFakeSql } from "./sql-fake-harness.js";
 *   const sql = await installFakeSql();
 *   const { upsertContactsForOwner } = await import("./store.js");
 *
 * `node --test` runs each test file in its own process, so the loader never
 * leaks into another file's module graph.
 *
 * ── Stubbing other modules ──────────────────────────────────────────────────
 *
 * Route tests need a couple of collaborators replaced (auth, a network client)
 * while keeping the real store. Pass `stubs` — a map of module-path SUFFIX to
 * module source:
 *
 *   await installFakeSql({
 *     stubs: {
 *       "/src/lib/auth-session.js": `
 *         export * from "PASSTHROUGH";
 *         export const requireAuth = async (req) => { req.privyUser = {...}; };
 *       `,
 *     },
 *   });
 *
 * The literal token PASSTHROUGH is replaced with a URL that re-enters the REAL
 * module (it carries a query string, so the loader does not match it again).
 * That way a stub overrides one export and inherits the rest, instead of having
 * to re-implement a whole module — the failure mode that makes stubs rot.
 * Explicit local exports win over `export *`, so listing a name overrides it.
 */

import { register } from "node:module";

let installed = false;

export async function installFakeSql({ stubs = {} } = {}) {
  const fakeUrl = new URL("./sql-fake.js", import.meta.url).href;
  const rootUrl = new URL("../../", import.meta.url).href;

  if (!installed) {
    // Resolve each stub's PASSTHROUGH against the real file, marked so the
    // loader lets it through untouched.
    const resolved = {};
    for (const [suffix, source] of Object.entries(stubs)) {
      const realUrl = `${rootUrl.replace(/\/$/, "")}${suffix}?passthrough=1`;
      resolved[suffix] = source.replaceAll("PASSTHROUGH", realUrl);
    }

    const loader = `
      const FAKE_URL = ${JSON.stringify(fakeUrl)};
      const STUBS = ${JSON.stringify(resolved)};
      export async function load(url, context, next) {
        if (url.endsWith("/src/db/sql.js")) {
          return {
            format: "module",
            shortCircuit: true,
            source: 'export * from "' + FAKE_URL + '";',
          };
        }
        for (const [suffix, source] of Object.entries(STUBS)) {
          if (url.endsWith(suffix)) {
            return { format: "module", shortCircuit: true, source };
          }
        }
        return next(url, context);
      }
    `;
    register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);
    installed = true;
  }

  // Same URL the loader re-exports from → same module instance → shared state.
  const fake = await import(fakeUrl);
  fake.resetFakeSql();
  return fake;
}
