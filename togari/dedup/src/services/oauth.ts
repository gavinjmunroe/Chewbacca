import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import jwksRsa from "jwks-rsa";

// TODO(karthik): confirm production Auth0 tenant; the dev-4prs757... slug suggests a dev tenant is in use somewhere
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
      if (err) {
        reject(err);
        return;
      }
      if (!key) {
        reject(new Error("No signing key found"));
        return;
      }
      const signingKey = key.getPublicKey();
      resolve(signingKey);
    });
  });
}

export function oauthProtectedResourceHandler(
  _req: Request,
  res: Response,
): void {
  res.json({
    resource: AUDIENCE,
    authorization_servers: [ISSUER],
    scopes_supported: [
      "openid",
      "profile",
      "email",
      "read:contacts",
      "read:deals",
      "write:contacts",
      "write:deals",
      "delete:contacts",
      "delete:deals",
    ],
  });
}

export function oauthDiscoveryHandler(_req: Request, res: Response): void {
  res.json({
    resource: AUDIENCE,
    resource_identifier: AUDIENCE,
    issuer: ISSUER,
    authorization_endpoint: `${AUTH0_DOMAIN}/authorize`,
    token_endpoint: `${AUTH0_DOMAIN}/oauth/token`,
    registration_endpoint: `${AUTH0_DOMAIN}/oidc/register`,
    jwks_uri: `${AUTH0_DOMAIN}/.well-known/jwks.json`,
    scopes_supported: [
      "openid",
      "profile",
      "email",
      "read:contacts",
      "read:deals",
      "write:contacts",
      "write:deals",
      "delete:contacts",
      "delete:deals",
    ],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ],
    code_challenge_methods_supported: ["S256"],
  });
}

export async function validateOAuthToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = await new Promise<jwt.JwtPayload>((resolve, reject) => {
      jwt.verify(
        token,
        (header, callback) => {
          getSigningKey(header)
            .then((key) => callback(null, key))
            .catch((err) => callback(err));
        },
        { audience: AUDIENCE, issuer: ISSUER, algorithms: ["RS256"] },
        (err, payload) =>
          err ? reject(err) : resolve(payload as jwt.JwtPayload),
      );
    });

    res.locals.user = decoded;
    res.locals.permissions =
      (decoded as Record<string, unknown>).permissions ?? [];
    const claims = decoded as Record<string, unknown>;
    res.locals.clientId =
      claims["https://mcp.bluemodern.ai/client_id"] ||
      claims.client_id ||
      claims.org_id ||
      null;

    if (!res.locals.clientId) {
      res
        .status(403)
        .json({ error: "Forbidden", message: "Token missing client_id claim" });
      return;
    }
    next();
  } catch (error) {
    process.stderr.write(
      `OAuth: JWT verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
