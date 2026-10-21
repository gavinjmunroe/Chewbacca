/**
 * Single integration point for every dedup route group.
 *
 * src/index.js calls `await registerDedup(app)` after the existing routes
 * are wired. Each route group lives in its own file owned by a parallel
 * tab (WS-3 people+health, WS-4 api-keys+magic-link, WS-5 apple,
 * WS-6 slack). The imports below are defensive: a missing module logs a
 * warning and the rest still register, so this file is safe to merge in
 * any order relative to those PRs and the eventual TS-runtime hook (tsx).
 *
 * Plain JS so src/index.js can import it without tsx loaded. Once tsx is
 * wired (devDep added by WS-0 + `--import tsx` in npm scripts), the
 * dynamic imports below resolve the TS route modules and the groups come
 * online automatically.
 *
 * `getDedupRegistrationReport()` powers the public /dedup/status diagnostic
 * mounted by src/index.js — surfaces the silent prod failures (e.g., 'works
 * locally, 404s on Railway') without needing Railway log access.
 */

const _DEDUP_REGISTRATION = {
  startedAt: null,
  finishedAt: null,
  attempted: 0,
  registered: 0,
  groups: [],
};

/**
 * Snapshot of the most recent registerDedup() run. Read by the
 * /dedup/status route. Returns a plain JSON-friendly object.
 */
export function getDedupRegistrationReport() {
  return {
    startedAt: _DEDUP_REGISTRATION.startedAt,
    finishedAt: _DEDUP_REGISTRATION.finishedAt,
    attempted: _DEDUP_REGISTRATION.attempted,
    registered: _DEDUP_REGISTRATION.registered,
    groups: _DEDUP_REGISTRATION.groups.slice(),
  };
}

async function safeRegister(app, modulePath, exportName, label) {
  _DEDUP_REGISTRATION.attempted++;
  try {
    const mod = await import(modulePath);
    const fn = mod[exportName] ?? mod.default;
    if (typeof fn !== "function") {
      const reason = `${exportName} not exported from ${modulePath}`;
      app.log.warn(`[dedup] ${label}: ${reason} — skipping`);
      _DEDUP_REGISTRATION.groups.push({ label, ok: false, reason });
      return false;
    }
    await fn(app);
    app.log.info(`[dedup] ${label} registered`);
    _DEDUP_REGISTRATION.groups.push({ label, ok: true });
    _DEDUP_REGISTRATION.registered++;
    return true;
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    app.log.warn(`[dedup] ${label} not registered: ${msg}`);
    _DEDUP_REGISTRATION.groups.push({ label, ok: false, reason: msg });
    return false;
  }
}

export async function registerDedup(app) {
  _DEDUP_REGISTRATION.startedAt = new Date().toISOString();
  _DEDUP_REGISTRATION.attempted = 0;
  _DEDUP_REGISTRATION.registered = 0;
  _DEDUP_REGISTRATION.groups = [];

  const groups = [
    {
      modulePath: "./health.routes.ts",
      exportName: "registerHealthRoutes",
      label: "health routes (WS-3)",
    },
    {
      modulePath: "./people.routes.ts",
      exportName: "registerPeopleRoutes",
      label: "people routes (WS-3)",
    },
    {
      modulePath: "./api-keys.routes.ts",
      exportName: "registerApiKeyRoutes",
      label: "api-keys routes (WS-4)",
    },
    {
      modulePath: "./magic-link.routes.ts",
      exportName: "registerMagicLinkRoutes",
      label: "magic-link routes (WS-4)",
    },
    {
      modulePath: "./apple.routes.ts",
      exportName: "registerAppleRoutes",
      label: "apple routes (WS-5)",
    },
    {
      modulePath: "./slack.routes.ts",
      exportName: "registerSlackRoutes",
      label: "slack routes (WS-6)",
    },
  ];

  for (const g of groups) {
    await safeRegister(app, g.modulePath, g.exportName, g.label);
  }

  _DEDUP_REGISTRATION.finishedAt = new Date().toISOString();

  app.log.info(
    `[dedup] registration complete: ${_DEDUP_REGISTRATION.registered}/${groups.length} groups online`,
  );
}
