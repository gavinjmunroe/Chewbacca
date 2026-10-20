import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';

const AUTH0_DOMAIN = 'https://dev-4prs757badfajpi5.us.auth0.com';
const AUDIENCE = 'https://mcp.bluemodern.ai';
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
        reject(new Error('No signing key found'));
        return;
      }
      const signingKey = key.getPublicKey();
      resolve(signingKey);
    });
  });
}

export function oauthProtectedResourceHandler(_req: Request, res: Response): void {
  res.json({
    resource: AUDIENCE,
    authorization_servers: [ISSUER],
    scopes_supported: [
      'openid',
      'profile',
      'email',
      'read:contacts',
      'read:deals',
      'write:contacts',
      'write:deals',
      'delete:contacts',
      'delete:deals',
    ],
  });
}

export function oauthDiscoveryHandler(_req: Request, res: Response): void {
  res.json({
    resource: "https://mcp.bluemodern.ai",
    resource_identifier: "https://mcp.bluemodern.ai",
    issuer: ISSUER,
    authorization_endpoint: `${AUTH0_DOMAIN}/authorize`,
    token_endpoint: `${AUTH0_DOMAIN}/oauth/token`,
    registration_endpoint: `${AUTH0_DOMAIN}/oidc/register`,
    jwks_uri: `${AUTH0_DOMAIN}/.well-known/jwks.json`,
    scopes_supported: [
      'openid',
      'profile',
      'email',
      'read:contacts',
      'read:deals',
      'write:contacts',
      'write:deals',
      'delete:contacts',
      'delete:deals',
    ],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: [
      'none',
      'client_secret_post',
      'client_secret_basic',
    ],
    code_challenge_methods_supported: ['S256'],
  });
}

export async function validateOAuthToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  const token = authHeader.slice(7);
  process.stderr.write('OAuth: Attempting to validate token, length: ' + token.length + '\n');

  try {
    const decoded = await new Promise<jwt.JwtPayload>((resolve, reject) => {
      jwt.verify(
        token,
        (header, callback) => {
          getSigningKey(header)
            .then((key) => callback(null, key))
            .catch((err) => callback(err));
        },
        {
          audience: AUDIENCE,
          issuer: ISSUER,
          algorithms: ['RS256'],
        },
        (err, payload) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(payload as jwt.JwtPayload);
        }
      );
    });

    res.locals.user = decoded;
    res.locals.permissions = (decoded as Record<string, unknown>).permissions ?? [];
    // Extract client_id from custom claim or standard claim
    const claims = decoded as Record<string, unknown>;
    res.locals.clientId = claims['https://mcp.bluemodern.ai/client_id']
      || claims.client_id
      || claims.org_id
      || null;
    if (!res.locals.clientId) {
      process.stderr.write('OAuth: Token has no client_id claim — rejecting\n');
      res.status(403).json({ error: 'Forbidden', message: 'Token missing client_id claim' });
      return;
    }
    process.stderr.write('OAuth: Token validated successfully, client_id: ' + res.locals.clientId + ', permissions: ' + JSON.stringify(res.locals.permissions) + '\n');
    next();
  } catch (error: any) {
    process.stderr.write('OAuth validation error: ' + (error instanceof Error ? error.message : String(error)) + '\n');
    process.stderr.write('OAuth: JWT validation failed, trying userinfo fallback\n');

    try {
      const userinfoResponse = await fetch(`${AUTH0_DOMAIN}/userinfo`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (userinfoResponse.ok) {
        const userinfo = await userinfoResponse.json() as Record<string, unknown>;
        process.stderr.write('OAuth: Userinfo fallback succeeded for user: ' + JSON.stringify(userinfo.sub || userinfo.email || 'unknown') + '\n');
        res.locals.user = userinfo;

        // Try to extract permissions from the token itself
        let permissions: string[] = [];
        try {
          const decoded = jwt.decode(token) as Record<string, unknown> | null;
          if (decoded) {
            if (typeof decoded.scope === 'string') {
              permissions = decoded.scope.split(' ');
            } else if (Array.isArray(decoded.permissions)) {
              permissions = decoded.permissions as string[];
            }
          }
        } catch (_e) {
          // Ignore decode errors, permissions stays empty
        }
        process.stderr.write('OAuth: Extracted permissions from token: ' + JSON.stringify(permissions) + '\n');
        res.locals.permissions = permissions;

        // Extract client_id from userinfo or decoded token
        const decodedToken = jwt.decode(token) as Record<string, unknown> | null;
        res.locals.clientId = userinfo['https://mcp.bluemodern.ai/client_id']
          || userinfo.client_id
          || userinfo.org_id
          || decodedToken?.['https://mcp.bluemodern.ai/client_id']
          || decodedToken?.client_id
          || decodedToken?.org_id
          || null;
        if (!res.locals.clientId) {
          process.stderr.write('OAuth: Userinfo fallback has no client_id — rejecting\n');
          res.status(403).json({ error: 'Forbidden', message: 'Token missing client_id claim' });
          return;
        }
        next();
        return;
      }
    } catch (userinfoError: any) {
      process.stderr.write('OAuth: Userinfo fallback also failed: ' + (userinfoError instanceof Error ? userinfoError.message : String(userinfoError)) + '\n');
    }

    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
