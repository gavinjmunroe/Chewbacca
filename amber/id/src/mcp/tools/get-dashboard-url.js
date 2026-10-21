import { z } from "zod";

import { toE164 } from "../../pdw/phone.js";
import { personIdFromHandle } from "../../pdw/person-resolver.js";
// Long-lived (30-day) token on purpose: this tool hands a bare URL to a human
// out-of-band and has nowhere to persist a refresh token. Every in-app sign-in
// path uses the short access token + refresh rotation instead.
import { signLegacyMedhaSession } from "../../lib/medha-jwt.js";

export const name = "get_dashboard_url";

export const config = {
  title: "Get dashboard URL",
  description:
    "Return a signed dashboard URL for the given phone. Token is the standard Medha session JWT (current TTL: 30 days; spec calls for a 10-minute magic-link TTL but that would require touching medha-jwt.js, which is out of scope for this PR).",
  inputSchema: {
    phone: z
      .string()
      .describe("Phone number in E.164 or any locally-parseable form."),
  },
};

export async function handler({ phone }) {
  const e164 = toE164(phone);
  if (!e164) {
    return errorResult("invalid_phone", `Could not parse '${phone}' as E.164.`);
  }
  const personId = personIdFromHandle(e164);
  if (!personId) {
    return errorResult(
      "no_person_id",
      `Phone ${e164} did not resolve to a person id.`,
    );
  }

  let signed;
  try {
    signed = signLegacyMedhaSession({ personId, phone: e164 });
  } catch (err) {
    return errorResult("sign_failed", err.message || "JWT sign failed.");
  }

  // NO HARDCODED HOST. This used to fall back to a medha-trip-planning
  // hostname, which is a service outside the two amber-id is allowed to
  // reach. If neither variable is set there is no dashboard to link to, and
  // saying so beats handing the caller a URL that points somewhere nobody chose.
  const base = (
    process.env.MEDHA_DASHBOARD_URL ||
    process.env.DASHBOARD_PUBLIC_URL ||
    ""
  ).trim();
  if (!base) {
    return errorResult(
      "dashboard_not_configured",
      "No dashboard URL is configured. Set MEDHA_DASHBOARD_URL on this service.",
    );
  }
  const url = `${base.replace(/\/+$/, "")}/?token=${encodeURIComponent(signed.token)}`;

  const payload = {
    url,
    token: signed.token,
    person_id: personId,
    phone: e164,
    expires_at: signed.expiresAt,
  };
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function errorResult(code, message) {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: code, message }) }],
  };
}
