/**
 * email-delivery — the one place this service sends mail to a person.
 *
 * There was no outbound email in amber-id before this. Everything the product
 * sends goes over iMessage (lib/photon-sender.js), because every account was a
 * phone number. An org member invited at a work address is the first user who
 * cannot be reached that way.
 *
 * IT FAILS CLOSED AND IT IS NOT CLEVER. One provider (Resend, chosen for
 * nothing more than a single HTTPS call and no SDK), one function, no queue, no
 * retry, no templates. If RESEND_API_KEY is absent, send() returns
 * { ok: false, reason: "not_configured" } and the caller tells the user that
 * email sign-in is unavailable.
 *
 * WHAT IT MUST NEVER DO IS FALL BACK TO RETURNING THE LINK. A sign-in link that
 * comes back in an HTTP response instead of an inbox is an unauthenticated way
 * to log in as somebody else; a dev-mode escape hatch for that is the kind of
 * thing that ships to production inside an env var nobody audits. So the only
 * concession to local development is AMBER_EMAIL_LOG=1, which prints the body
 * to the server's own stdout -- visible to whoever is running the server, which
 * in development is the developer, and in production is nobody holding a
 * browser.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY) || process.env.AMBER_EMAIL_LOG === "1";
}

function fromAddress() {
  // The domain has to be one Resend has verified, and it was pointing at a
  // .com this company does not own -- which Resend rejects outright, so every
  // send failed for a reason that had nothing to do with the send.
  return process.env.AMBER_EMAIL_FROM || "Amber <no-reply@amberintelligence.ai>";
}

/**
 * The domain Resend has to have verified, pulled out of whatever shape
 * AMBER_EMAIL_FROM is in ("Amber <x@y.com>" or bare "x@y.com").
 *
 * It exists so the failure message can NAME the domain. "The mail provider
 * refused it (validation_error)" is true and sends somebody to read Resend's
 * docs; "verify amberintelligence.ai at resend.com/domains" is the same fact
 * with the next action in it.
 */
export function sendingDomain() {
  const m = /<([^>]+)>/.exec(fromAddress());
  const addr = (m ? m[1] : fromAddress()).trim();
  return addr.split("@")[1]?.toLowerCase() ?? null;
}

/**
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function sendEmail({
  to,
  subject,
  text,
  html = null,
  /*
   * WHEN, IF NOT NOW. Resend takes an ISO timestamp and holds the message
   * until then, which is the whole of "schedule this" -- no queue of our
   * own, no worker, nothing to go wrong between here and the send.
   */
  sendAt = null,
  replyTo = null,
  /*
   * [{ filename, content }] where content is base64. Resend takes them
   * inline, so there is nothing to store and nothing to clean up: the file
   * goes out with the message and this process never keeps a copy.
   */
  attachments = null,
} = {}) {
  if (!to || !subject || !text) return { ok: false, reason: "incomplete" };

  if (process.env.AMBER_EMAIL_LOG === "1") {
    console.log(`[email] to=${to} subject=${subject}\n${text}`);
    if (!process.env.RESEND_API_KEY) return { ok: true };
  }
  if (!process.env.RESEND_API_KEY) return { ok: false, reason: "not_configured" };

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [to],
        subject,
        text,
        ...(html ? { html } : {}),
        ...(sendAt ? { scheduled_at: sendAt } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(attachments?.length ? { attachments } : {}),
      }),
    });
    if (!res.ok) {
      /*
       * THE STATUS ALONE WAS NOT ENOUGH, and the reason it was chosen still
       * holds: the body can carry the recipient's address, and a log of
       * failed sign-in attempts must not become a list of who was invited.
       *
       * Resend's error body has a `name` -- validation_error, not_found,
       * restricted_api_key -- which names the problem and contains no
       * address. That one field is read and nothing else. "The domain is not
       * verified" and "the key is wrong" are different afternoons, and the
       * status code alone tells them apart badly.
       */
      /*
       * AND THE SENTENCE, WITH ADDRESSES TAKEN OUT OF IT.
       *
       * `name` alone turned out to be useless in the one situation that
       * matters. "validation_error" is what Resend says for a domain that
       * is not verified, for a key scoped to the wrong thing, and for the
       * free-tier rule that only the account owner's own address may be
       * written to -- three completely different afternoons, one word.
       * Somebody staring at "validation_error" has no way to tell which,
       * and that is where an evening goes.
       *
       * The `message` field says which, in a sentence. The original reason
       * for dropping it stands -- it can quote the recipient -- so every
       * address in it is replaced before it leaves this function. What
       * survives is the part that is about the configuration, which is the
       * part somebody needs.
       */
      let name = null;
      let message = null;
      try {
        const body = await res.json();
        name = typeof body?.name === "string" ? body.name : null;
        message =
          typeof body?.message === "string"
            ? body.message.replace(/[^\s<>@]+@[^\s<>@]+\.[a-z]{2,}/gi, "an address").slice(0, 300)
            : null;
      } catch {
        name = null;
      }
      console.error(
        `[email] send failed status=${res.status} name=${name ?? "unknown"}` +
          (message ? ` message=${message}` : ""),
      );
      return {
        ok: false,
        reason: "send_failed",
        status: res.status,
        detail: message ?? name,
        code: name,
      };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[email] send threw: ${err?.message}`);
    return { ok: false, reason: "send_failed" };
  }
}

/** Where a link in an email points. The website, not this API. */
/**
 * WHERE A LINK IN AN EMAIL SHOULD POINT.
 *
 * THIS DEFAULTED TO A DOMAIN THAT DOES NOT EXIST. app.amberintelligence.com
 * was a placeholder from before the site had an address, and it meant every
 * invitation ever issued on a deployment without AMBER_WEB_BASE_URL set
 * carried a link to nowhere -- which fails as a 404 in somebody else's
 * browser, days later, with nothing in our logs.
 *
 * So the request's own origin is preferred, when there is one and it is an
 * origin we already allow. An admin pressing "invite" is standing on the site
 * the invitee needs to land on; that is better information than any
 * environment variable, and it cannot drift. The allowlist check is what keeps
 * it from being a redirect somebody can choose: a forged Origin header would
 * otherwise put an attacker's domain in an email we send.
 *
 * The env var remains for jobs and scripts, which have no request to ask.
 */
export function webBaseUrl(request = null) {
  const origin = String(request?.headers?.origin || "").replace(/\/+$/, "");
  if (origin && allowedWebOrigins().includes(origin)) return origin;
  return (process.env.AMBER_WEB_BASE_URL || "https://amberintelligence.ai").replace(/\/+$/, "");
}

/** The browser origins this service already trusts, as a list. */
function allowedWebOrigins() {
  return String(process.env.AMBER_WEB_ORIGINS || "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}
