import { OAuth2Client } from "google-auth-library";

// Public OAuth client identifier, not a secret — used only as the expected
// token audience. The env var still wins so another client can be swapped in
// without a code change.
const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ||
  "813373326630-deu4s78t52trlvnn9ojdaeppsfk0kafj.apps.googleusercontent.com";

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

export const allowedDomain = () =>
  process.env.ALLOWED_DOMAIN || "bluemodernadvisory.com";

/**
 * Verify a Google ID token and confirm it belongs to the allowed workspace domain.
 * Returns the payload, or null if the token is invalid or out-of-domain.
 */
export async function verifyGoogleToken(token) {
  if (!token) return null;
  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload.email_verified) return null;

    const domain = allowedDomain();
    const email = (payload.email || "").toLowerCase();
    if (payload.hd !== domain && !email.endsWith(`@${domain}`)) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Express middleware: requires a Bearer Google ID token, sets req.user.
 */
export async function requireBMAUser(req, res, next) {
  const header = (req.get("authorization") || "").trim();
  if (!header.startsWith("Bearer "))
    return res.status(401).json({ error: "Unauthorized" });

  const token = header.slice(7).trim();

  if (token.startsWith("tbk_")) {
    try {
      const { hashKey } = await import("./togari/settings.js");
      const { findApiKeyByHash } = await import("./db.js");
      const match = await findApiKeyByHash(hashKey(token));
      if (match) {
        req.user = { email: match.email, name: match.label, viaApiKey: true };
        return next();
      }
    } catch {
      // DB unavailable: fall through to 401 below
    }
    return res.status(401).json({ error: "Unauthorized" });
  }

  const payload = await verifyGoogleToken(token);
  if (!payload) return res.status(401).json({ error: "Unauthorized" });

  req.user = { email: payload.email, name: payload.name || payload.email };
  next();
}
