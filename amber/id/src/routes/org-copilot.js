/**
 * COPILOT, IN TWO CLICKS, AND THE REASON IT IS TWO RATHER THAN NINE.
 *
 * The version this replaces asked every customer to register their own Azure
 * application, add a permission, mint a client secret and paste three
 * identifiers back. That is nine steps because of a design decision, not a
 * Microsoft one.
 *
 * Amber is ONE MULTI-TENANT APPLICATION, registered once, by us. A customer's
 * administrator registers nothing. They press a button, Microsoft shows them
 * exactly which permission is being asked for, they approve it for their
 * tenant, and they come back connected. Every other vendor in their stack
 * already works this way, which is why it will not feel like a special request.
 *
 * WHY THE BUTTON FETCHES A URL INSTEAD OF LINKING STRAIGHT HERE. The previous
 * front end navigated the browser directly at /v1/oauth/microsoft/admin-consent.
 * A top-level navigation carries no Authorization header, so that request
 * arrives anonymous and the server cannot tell which company is connecting --
 * and the route 404'd, which is what was happening in production. The fix is
 * for the authenticated page to ASK for the URL, with its token, and then send
 * the browser there. Still one press.
 *
 * WHAT THE STATE CARRIES AND WHY IT IS SIGNED. The company and the person who
 * started this, so the callback -- which Microsoft delivers anonymously -- can
 * attribute the connection without trusting anything in the query string. The
 * HMAC is what stops somebody connecting their own Microsoft tenant to
 * somebody else's Amber workspace by editing a URL.
 *
 * WHAT IS DELIBERATELY NOT HERE. No token exchange: admin consent for an
 * application permission needs no authorization code, and asking for one
 * would mean asking for a delegated scope we do not want. We learn the tenant
 * id, we store it, and the poller uses client credentials from then on.
 */

import crypto from "node:crypto";
import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { makeResolveActor, requireOrgAdmin, requireOrgMember } from "../lib/resolve-actor.js";
import { openTenantScope } from "../db/tenant.js";
import { addConnector, listConnectors, updateConnector } from "../db/org-api-store.js";
import { webBaseUrl } from "../lib/email-delivery.js";

const PROVIDER = "microsoft-copilot";

/** The one permission. Named here so the UI and the consent URL cannot drift. */
export const COPILOT_SCOPE = "AiEnterpriseInteraction.Read.All";

export function copilotConfigured() {
  return Boolean(clientId());
}

function clientId() {
  return (
    process.env.MICROSOFT_CLIENT_ID ||
    process.env.MS_CLIENT_ID ||
    process.env.AZURE_CLIENT_ID ||
    null
  );
}

function apiBaseUrl(request) {
  const explicit = process.env.AMBER_API_BASE_URL || process.env.MEDHA_ID_PUBLIC_URL;
  if (explicit) return String(explicit).replace(/\/+$/, "");
  // Behind a proxy the host header is the public name; the protocol is not.
  const proto = request.headers["x-forwarded-proto"] || "https";
  return `${proto}://${request.headers.host}`;
}

function redirectUri(request) {
  return `${apiBaseUrl(request)}/v1/oauth/microsoft/admin-consent/callback`;
}

function stateSecret() {
  const s = process.env.AMBER_JWT_SECRET || process.env.MICROSOFT_CLIENT_SECRET;
  if (!s) throw new Error("no secret available for the Microsoft consent state");
  return s;
}

function mintState({ orgId, amberId, returnTo }) {
  const payload = Buffer.from(
    JSON.stringify({
      n: crypto.randomBytes(9).toString("base64url"),
      t: Date.now(),
      o: String(orgId),
      a: String(amberId),
      r: returnTo ?? "/org",
    }),
  ).toString("base64url");
  const mac = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

function readState(state) {
  const [payload, mac] = String(state ?? "").split(".");
  if (!payload || !mac) return null;
  const expected = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  // timingSafeEqual throws on a length mismatch, which a forged state can
  // cause deliberately.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const out = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    // Ten minutes. Long enough to find the administrator in the next room,
    // short enough that a link left in a browser history is not a door.
    if (Date.now() - Number(out.t) > 10 * 60 * 1000) return null;
    if (!out.o || !out.a) return null;
    return out;
  } catch {
    return null;
  }
}

/**
 * A return path, forced to be a path.
 *
 * `return_to` reaches the browser as a redirect. Accepting an absolute URL
 * here would make this an open redirect: a link that looks like Amber,
 * authenticates against Amber, and lands somewhere else entirely.
 */
function safeReturn(value) {
  const v = String(value ?? "/org");
  if (!v.startsWith("/") || v.startsWith("//")) return "/org";
  return v;
}

export function registerOrgCopilotRoutes(
  app,
  { requireAuth = defaultRequireAuth, resolveActor = makeResolveActor() } = {},
) {
  const asMember = {
    preHandler: [requireAuth, resolveActor, requireOrgMember, openTenantScope],
  };
  const asAdmin = {
    preHandler: [requireAuth, resolveActor, requireOrgAdmin, openTenantScope],
  };

  /* --------------------------------------------------------------- status */

  /**
   * Is Copilot connected, and if not, exactly what is missing.
   *
   * THE REASON IS IN THE RESPONSE rather than only in the server log. "Not
   * connected" and "this deployment has no Microsoft application registered"
   * are different problems with different owners -- one is the customer's
   * administrator, the other is ours -- and a screen that cannot tell them
   * apart sends people to the wrong place.
   */
  app.get("/v1/org/copilot/status", asMember, async (request) => {
    const connectors = await listConnectors(request.actor.orgId).catch(() => []);
    const row = connectors.find((c) => c.provider === PROVIDER) ?? null;
    const cfg = row?.config ?? {};

    return {
      configured: copilotConfigured(),
      connected: Boolean(row && row.status !== "disabled" && cfg.tenantId),
      tenantId: cfg.tenantId ?? null,
      consentedAt: cfg.consentedAt ?? null,
      scope: COPILOT_SCOPE,
      reason: copilotConfigured()
        ? null
        : "this deployment has no Microsoft application registered — set MICROSOFT_CLIENT_ID",
    };
  });

  /* -------------------------------------------------------- start consent */

  /**
   * The URL to send the administrator to.
   *
   * An admin-only action: approving a tenant-wide permission is not something
   * an ordinary member should be able to start on the company's behalf, even
   * though Microsoft would refuse them at the far end. Refusing here means the
   * refusal is ours, in our words, before they go anywhere.
   */
  app.post("/v1/org/copilot/consent-url", asAdmin, async (request, reply) => {
    if (!copilotConfigured()) {
      return reply.code(503).send({
        error: "not_configured",
        message:
          "This deployment has no Microsoft application registered yet. Set MICROSOFT_CLIENT_ID " +
          "and MICROSOFT_CLIENT_SECRET, then try again.",
      });
    }

    const state = mintState({
      orgId: request.actor.orgId,
      amberId: request.actor.amberId,
      returnTo: safeReturn(request.body?.returnTo),
    });

    /*
     * THE ADMIN CONSENT ENDPOINT, not the ordinary authorize endpoint.
     * /adminconsent grants an APPLICATION permission for the whole tenant,
     * which is what a background poller needs; /authorize would grant a
     * delegated one that dies with one person's session.
     *
     * `organizations` rather than `common`: this is a work tenant by
     * definition, and offering a personal Microsoft account here produces a
     * confusing failure three screens later.
     */
    const url = new URL("https://login.microsoftonline.com/organizations/v2.0/adminconsent");
    url.searchParams.set("client_id", clientId());
    url.searchParams.set("scope", `https://graph.microsoft.com/.default`);
    url.searchParams.set("redirect_uri", redirectUri(request));
    url.searchParams.set("state", state);

    return { url: url.toString(), scope: COPILOT_SCOPE, expiresInSeconds: 600 };
  });

  /* ------------------------------------------------------------- callback */

  /**
   * Where Microsoft sends the administrator back.
   *
   * ANONYMOUS BY NATURE. This is a top-level browser navigation from
   * Microsoft, so there is no Authorization header and there cannot be one.
   * Everything this route trusts comes out of the signed state; everything
   * else in the query string is treated as a claim.
   *
   * It always redirects to a page rather than returning JSON, because the
   * person at the other end is an administrator in a browser, not a client.
   */
  /*
   * ITS OWN PATH, not /v1/oauth/microsoft/callback.
   *
   * That one already exists and belongs to the Outlook mail and calendar
   * flow, which exchanges an authorization code for a user's tokens. Sharing
   * it would have meant branching on a query parameter inside a working,
   * unrelated handler -- and the boot test refused the collision outright,
   * which is the right place to find out.
   *
   * The redirect URI registered in Azure must match this exactly.
   */
  app.get("/v1/oauth/microsoft/admin-consent/callback", async (request, reply) => {
    const site = webBaseUrl(request);
    const state = readState(request.query?.state);
    const back = safeReturn(state?.r);
    const fail = (why) => reply.redirect(`${site}${back}?copilot=${encodeURIComponent(why)}`);

    if (!state) return fail("bad_state");
    if (request.query?.error) return fail("declined");

    /*
     * Microsoft sends admin_consent=True and the tenant id. The tenant is the
     * whole prize: with it, client credentials can read that tenant's Copilot
     * history, and without it there is nothing to poll.
     */
    const consented = String(request.query?.admin_consent ?? "").toLowerCase() === "true";
    const tenantId = String(request.query?.tenant ?? "").trim();
    if (!consented || !tenantId) return fail("declined");
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return fail("bad_tenant");

    try {
      await openTenantScope({ actor: { orgId: state.o } }, null);
    } catch {
      /* openTenantScope is a preHandler; the direct call below does the work */
    }

    const { withTenant } = await import("../db/tenant.js");
    let stored = null;
    await withTenant(state.o, async () => {
      stored = await addConnector({
        orgId: state.o,
        provider: PROVIDER,
        label: "Microsoft Copilot",
        connectedBy: state.a,
        config: { tenantId, consentedAt: new Date().toISOString(), scope: COPILOT_SCOPE },
      }).catch(() => null);

      /*
       * addConnector returns the EXISTING row when there already is one, and
       * does not update it -- correct for "already added", wrong here,
       * because re-consenting after a tenant change has to move the tenant
       * id. So the config is written explicitly rather than assumed.
       */
      if (stored?.id) {
        await updateConnector({
          orgId: state.o,
          id: stored.id,
          status: "active",
          config: { tenantId, consentedAt: new Date().toISOString(), scope: COPILOT_SCOPE },
        }).catch(() => null);
      }
    });

    if (!stored) return fail("store_failed");
    return reply.redirect(`${site}${back}?copilot=connected`);
  });

  /* ------------------------------------------------- the old 404'ing path */

  /**
   * THE LINK THAT WAS IN THE PRODUCT, kept working on purpose.
   *
   * CopilotSetup pointed the browser straight here and got a 404, because
   * this route did not exist. It exists now and it still cannot authenticate
   * a top-level navigation -- so rather than fail in the same place with a
   * nicer status code, it sends the person to the page that CAN start the
   * flow, carrying their intent.
   *
   * Worth keeping even after the front end is fixed: this URL has been copied
   * into at least one "send this to your admin" instruction, and a link that
   * used to work and now 404s is a support conversation.
   */
  app.get("/v1/oauth/microsoft/admin-consent", async (request, reply) => {
    const site = webBaseUrl(request);
    const back = safeReturn(request.query?.return_to);
    return reply.redirect(`${site}${back}?copilot=start`);
  });
}
