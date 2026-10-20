/**
 * Dedup v2 API route registration entry point.
 *
 * WS-0 sets these up as no-op stubs so src/index.ts can wire them in.
 * WS-1 fills in registerPeopleRoutes (match/create/update endpoints).
 * WS-2 fills in registerApiKeyRoutes (issue/list/revoke endpoints).
 * WS-3 fills in registerAppleRoutes (push-to-apple endpoint).
 */

import type { Application } from "express";
import { registerApiKeyRoutes as registerApiKeyRoutesImpl } from "./api-keys.routes.js";
import { registerPeopleRoutes as mountPeopleRoutes } from "./people.routes.js";
import { registerAppleRoutes as registerAppleRoutesImpl } from "./apple.routes.js";

export function registerPeopleRoutes(app: Application): void {
  mountPeopleRoutes(app);
}

export function registerApiKeyRoutes(app: Application): void {
  registerApiKeyRoutesImpl(app);
}

export function registerAppleRoutes(app: Application): void {
  registerAppleRoutesImpl(app);
}
