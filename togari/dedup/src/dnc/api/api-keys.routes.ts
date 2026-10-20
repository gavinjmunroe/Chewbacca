/**
 * Dashboard-facing API key management.
 *
 * Auth: Auth0 JWT (NOT the issued `tgi_live_` key). The dashboard user logs
 * in via Auth0, sends their bearer JWT here, and uses these endpoints to
 * mint / list / revoke long-lived keys that Clay will paste into columns.
 *
 * The `requireAuth0User` middleware below only enforces a valid `sub` claim,
 * intentionally separate from `validateOAuthToken` in src/services/oauth.ts
 * which is tuned for machine-to-machine MCP traffic and requires a `client_id`
 * custom claim that dashboard end-users will not carry.
 */

import type { Application, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import jwksRsa from "jwks-rsa";

import { issueKey, listKeys, revokeKey } from "../auth/api-keys.js";

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN
  ? `https://${process.env.AUTH0_DOMAIN.replace(/^https?:\/\//, "")}`
  : "https://dev-4prs757badfajpi5.us.auth0.com";
const AUDIENCE = process.env.AUTH0_AUDIENCE ?? "https://mcp.bluemodern.ai";
const ISSUER = `${AUTH0_DOMAIN}/`;

const jwksClient = jwksRsa({
  jwksUri: `${AUTH0_DOMAIN}/.well-known/jwks.json`,
  cache: true,
  rateLimit: true,
});

function getSigningKey(header: jwt.JwtHeader): Promise<string> {
  return new Promise((resolve, reject) => {
    jwksClient.getSigningKey(header.kid, (err, key) => {
      if (err) return reject(err);
      if (!key) return reject(new Error("No signing key found"));
      resolve(key.getPublicKey());
    });
  });
}

async function requireAuth0User(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const decoded = await new Promise<jwt.JwtPayload>((resolve, reject) => {
      jwt.verify(
        token,
        (header, cb) => {
          getSigningKey(header)
            .then((k) => cb(null, k))
            .catch((e) => cb(e));
        },
        { audience: AUDIENCE, issuer: ISSUER, algorithms: ["RS256"] },
        (err, payload) =>
          err ? reject(err) : resolve(payload as jwt.JwtPayload),
      );
    });
    if (!decoded.sub) {
      res.status(401).json({ error: "Token missing sub claim" });
      return;
    }
    res.locals.user = decoded;
    res.locals.ownerId = decoded.sub;
    next();
  } catch (err) {
    process.stderr.write(
      `[api-keys] JWT verify failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function registerApiKeyRoutes(app: Application): void {
  app.post("/api/v1/keys", requireAuth0User, async (req, res) => {
    const ownerId = res.locals.ownerId as string;
    const rawName: unknown = req.body?.name;
    const name =
      typeof rawName === "string" && rawName.trim() ? rawName.trim() : null;
    try {
      const issued = await issueKey(ownerId, name);
      res.status(201).json(issued);
    } catch (err) {
      process.stderr.write(
        `[api-keys] issue failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      res.status(500).json({ error: "Failed to issue API key" });
    }
  });

  app.get("/api/v1/keys", requireAuth0User, async (_req, res) => {
    const ownerId = res.locals.ownerId as string;
    try {
      const keys = await listKeys(ownerId);
      res.json({ keys });
    } catch (err) {
      process.stderr.write(
        `[api-keys] list failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      res.status(500).json({ error: "Failed to list API keys" });
    }
  });

  app.delete("/api/v1/keys/:keyId", requireAuth0User, async (req, res) => {
    const ownerId = res.locals.ownerId as string;
    const { keyId } = req.params;
    try {
      await revokeKey(keyId, ownerId);
      res.status(204).send();
    } catch (err) {
      process.stderr.write(
        `[api-keys] revoke failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      res.status(500).json({ error: "Failed to revoke API key" });
    }
  });
}
