/**
 * Clay-callable people API. Single-record only — batch lives in engine.ts.
 *
 *   POST   /api/v1/people/match           → MatchResult
 *   POST   /api/v1/people                 → 201 { contact }
 *   PATCH  /api/v1/people/:contact_id     → 200 { contact }
 *
 * All routes sit behind validateApiKey. The owner_id is sourced from
 * res.locals.apiKey.ownerId — never from the request body.
 */

import type { Application, Request, Response, NextFunction } from "express";
import { validateApiKey } from "../auth/api-key-middleware.js";
import { Matcher, MatcherError } from "../dedup/matcher.js";
import type {
  ApiKeyContext,
  MatchRequest,
  UnifiedContact,
} from "../types/index.js";

function getOwnerId(res: Response): string {
  const ctx = res.locals.apiKey as ApiKeyContext | undefined;
  if (!ctx?.ownerId) throw new Error("apiKey context missing on res.locals");
  return ctx.ownerId;
}

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

function bad(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

export function registerPeopleRoutes(app: Application): void {
  const matcher = new Matcher();

  app.post(
    "/api/v1/people/match",
    validateApiKey,
    asyncHandler(async (req, res) => {
      const ownerId = getOwnerId(res);
      const body = (req.body ?? {}) as MatchRequest;

      if (
        typeof body !== "object" ||
        (!body.email && !body.linkedin && !body.phone && !body.name)
      ) {
        bad(
          res,
          "match requires at least one of: email, linkedin, phone, name",
        );
        return;
      }

      const result = await matcher.match(ownerId, {
        name: body.name,
        email: body.email,
        linkedin: body.linkedin,
        phone: body.phone,
      });
      res.json(result);
    }),
  );

  app.post(
    "/api/v1/people",
    validateApiKey,
    asyncHandler(async (req, res) => {
      const ownerId = getOwnerId(res);
      const body = (req.body ?? {}) as Partial<UnifiedContact>;

      if (typeof body !== "object" || Object.keys(body).length === 0) {
        bad(res, "create requires a contact body");
        return;
      }

      const contact = await matcher.create(ownerId, body);
      res.status(201).json({ contact });
    }),
  );

  app.patch(
    "/api/v1/people/:contact_id",
    validateApiKey,
    asyncHandler(async (req, res) => {
      const ownerId = getOwnerId(res);
      const rawContactId = req.params.contact_id;
      const contactId =
        typeof rawContactId === "string" ? rawContactId : rawContactId?.[0];
      const body = (req.body ?? {}) as Partial<UnifiedContact>;

      if (!contactId) {
        bad(res, "contact_id path param is required");
        return;
      }

      if (typeof body !== "object" || Object.keys(body).length === 0) {
        bad(res, "patch requires at least one field");
        return;
      }

      try {
        const contact = await matcher.update(ownerId, contactId, body);
        res.json({ contact });
      } catch (err) {
        if (err instanceof MatcherError && err.code === "not_found") {
          res.status(404).json({ error: err.message });
          return;
        }
        throw err;
      }
    }),
  );

  console.log("[Dedup v2] people routes mounted (WS-1)");
}
