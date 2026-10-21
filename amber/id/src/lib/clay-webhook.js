/**
 * Validation and delivery for pushing Amber contacts OUT to a Clay table.
 *
 * THE ENTIRE POINT OF THIS FILE IS THE VALIDATOR. Everything else here is plumbing.
 *
 * A user-supplied URL that the SERVER then makes requests to is a textbook SSRF sink:
 * without a gate, anyone with an Amber account could point their "Clay webhook" at
 * http://169.254.169.254/ (cloud metadata), http://localhost:5432 (our own Postgres),
 * or any host inside the deployment's network, and use our server as a proxy to reach
 * things they cannot reach themselves -- while we obligingly POST their entire contact
 * book at it.
 *
 * The gate is an ALLOWLIST, not a denylist. Denylisting private ranges is the classic
 * wrong answer: it loses to DNS rebinding, to IPv6-mapped IPv4, to decimal and octal
 * IP encodings, to redirects, and to whatever encoding gets discovered next. Since the
 * only legitimate destination is Clay, we require the host to BE Clay:
 *
 *   - scheme must be https (so the URL cannot be downgraded or read in transit)
 *   - host must be clay.com or *.clay.com, matched on labels rather than by substring
 *     (a substring check would accept `clay.com.evil.tld`, which is the single most
 *     common way this check is written wrong)
 *   - no embedded credentials, no port override
 *
 * With the host pinned to a domain we do not control but Clay does, the private-network
 * question stops being ours to answer: clay.com does not resolve to 127.0.0.1.
 * Redirects are refused separately at fetch time for the same reason.
 */

// Clay's own hosts. `api.clay.com` is where "Import from Webhook" sources live today;
// the apex and other subdomains are allowed so a change on Clay's side does not
// silently break every user's push.
// An EXACT host set, not a suffix match.
//
// This was `*.clay.com`, which is a bet on DNS: `https://localhost.clay.com/hook` and
// `https://169.254.169.254.clay.com/hook` both PASSED validation and were saved only by
// the fact that Clay does not publish those records today. One wildcard A record or one
// subdomain takeover under clay.com would have turned this into internal-network SSRF.
// An explicit set does not depend on anyone else's DNS hygiene. Add a host here if Clay
// ever moves webhooks; that is a deliberate one-line decision rather than a standing
// wildcard.
const ALLOWED_HOSTS = new Set(["api.clay.com", "clay.com", "www.clay.com"]);

/** How long a single delivery may take before we give up on it. */
export const CLAY_TIMEOUT_MS = 15_000;

/**
 * ONE ROW PER REQUEST, and the reason is Clay's own contract.
 *
 * Clay's webhook source says, verbatim: "You can send data to this source by including
 * key-value pairs in the body of a POST request sent to this URL." Key-value pairs --
 * a flat JSON OBJECT, one row. An earlier version here batched 50 rows as a JSON array
 * per request, which is the shape most ingest APIs want and is the wrong shape for
 * this one: an array arrives as a single row whose every column is a blob, or is
 * rejected outright. Either way it silently produces garbage rather than an error, so
 * it is worth being explicit.
 *
 * 'array' is kept because some Clay sources may accept a batch, and posting 500 rows as
 * 10 requests instead of 500 would be a real difference. It is opt-in and never the
 * default.
 *
 * MEASURED AGAINST A REAL CLAY WEBHOOK SOURCE (2026-08-18), and the result is why the
 * default is not going to change without re-measuring:
 *
 *   sent {A}          -> Clay stored {A}          (one row, columns mapped)
 *   sent [{A}]        -> Clay stored [{A}]        (array-wrapped, NOT unwrapped)
 *   sent [{A},{B}]    -> Clay stored [{A},{B}]    (ONE row holding both people)
 *
 * Clay records the request body VERBATIM. It does not split an array into rows. So
 * 'array' mode against a source that behaves this way puts a whole batch into a single
 * row and returns HTTP 200 while doing it -- the failure is completely silent, and at
 * CLAY_BATCH_SIZE that is fifty people in one cell.
 *
 * The tell is cheap to re-check on any new source: POST an array of TWO distinguishable
 * rows and count the rows that appear. Two means the source unwraps and 'array' is
 * safe; one means it does not. Never infer it from a single-element array -- with one
 * element both behaviors produce byte-identical output.
 */
export const CLAY_MODES = ["object", "array"];
export const CLAY_DEFAULT_MODE = "object";
/** Rows per request when a destination is known to accept 'array'. */
export const CLAY_BATCH_SIZE = 50;
/**
 * Concurrent in-flight requests when posting one row at a time. Enough to make a few
 * hundred contacts finish in seconds, low enough not to look like an attack to Clay's
 * rate limiter -- which, if tripped, would fail the rest of the push.
 */
export const CLAY_CONCURRENCY = 4;
/**
 * Wall-clock ceiling for one whole push, independent of the per-request timeout.
 *
 * Without this, a destination that answers slowly but SUCCESSFULLY is unbounded: 2000
 * rows at 4 concurrent and 15s each is 500 sequential waits, about two hours, with the
 * HTTP connection held open and the contact book resident the entire time. A dead host
 * already failed fast (the timeout trips the stop flag); slow-success was the gap.
 */
export const CLAY_DEADLINE_MS = 60_000;

/**
 * Is this a URL we are willing to send a user's contacts to?
 * Returns { ok: true, url } or { ok: false, reason } — never throws.
 */
export function validateClayWebhookUrl(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return { ok: false, reason: "Paste the webhook URL from your Clay table." };
  if (s.length > 2048) return { ok: false, reason: "That URL is too long to be a Clay webhook." };

  let u;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, reason: "That doesn't look like a URL." };
  }

  if (u.protocol !== "https:") {
    return { ok: false, reason: "The webhook URL must start with https://." };
  }
  // Credentials in a URL are never part of a legitimate Clay webhook, and they are a
  // classic way to smuggle a different authority past a careless parser.
  if (u.username || u.password) {
    return { ok: false, reason: "Remove the username/password from the URL." };
  }
  if (u.port) {
    return { ok: false, reason: "Remove the port from the URL." };
  }

  // An exact-set membership test. Not `host.includes("clay.com")`, which would happily
  // accept "clay.com.evil.tld" and hand an attacker exactly the SSRF this function exists
  // to prevent, and not a "*.clay.com" suffix either -- see ALLOWED_HOSTS above.
  //
  // The trailing dot is stripped first: "api.clay.com." is the fully-qualified form of
  // the same name and resolves identically, so rejecting it just refuses a legitimate URL.
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!ALLOWED_HOSTS.has(host)) {
    return {
      ok: false,
      reason: `That URL points at ${u.hostname}, not Clay. Copy the webhook URL from your Clay table's "Import from Webhook" source.`,
    };
  }

  // Normalize away the fragment and any trailing whitespace; keep the query, because
  // Clay's webhook URLs can legitimately carry one.
  u.hash = "";
  return { ok: true, url: u.toString() };
}

/**
 * Flatten one Amber contact into the shape a Clay table wants: a single level of
 * scalar-ish fields with stable, human-readable keys, because Clay maps webhook JSON
 * to columns by key and a nested object becomes an unusable blob in a cell.
 *
 * `amber_contact_id` is included as the dedupe key: it is stable across pushes, so a
 * user can re-push without Clay accumulating duplicate rows (Clay dedupes on a column
 * you nominate). It is an internal id and carries nothing sensitive on its own.
 */
export function toClayRow(contact) {
  const phones = Array.isArray(contact.phoneNumbers) ? contact.phoneNumbers : [];
  const emails = Array.isArray(contact.emails) ? contact.emails : [];
  return {
    amber_contact_id: contact.id ?? null,
    full_name: contact.name ?? null,
    first_name: contact.firstName ?? null,
    last_name: contact.lastName ?? null,
    email: emails[0] ?? null,
    // Every address, comma-joined, so nothing is dropped for people with several —
    // Clay can split a column, but it cannot recover a value that never arrived.
    emails_all: emails.length > 1 ? emails.join(", ") : null,
    phone: phones[0] ?? null,
    phones_all: phones.length > 1 ? phones.join(", ") : null,
    company: contact.company ?? null,
    title: contact.title ?? null,
    location: contact.city ?? null,
    linkedin_url: contact.linkedinUrl ?? null,
    source: contact.source ?? null,
    pushed_from: "amber",
  };
}

/**
 * POST a single payload to a Clay webhook.
 *
 * `redirect: "manual"` is deliberate and is part of the SSRF story: validateClayWebhookUrl
 * proves the URL we were GIVEN is Clay, but a 302 could send the follow-up request
 * anywhere, and fetch would follow it by default with the same body attached. Refusing
 * to follow means the host we validated is the only host we ever talk to.
 *
 * `authToken` covers Clay's "Add auth token" option on a webhook source. If the user
 * turns that on, an unauthenticated POST starts failing with a 401 and the push would
 * otherwise look broken for no visible reason.
 *
 * Returns { ok, status, error } -- never throws, so one bad row cannot take down a push.
 */
export async function postClayPayload(url, payload, { timeoutMs = CLAY_TIMEOUT_MS, authToken } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { "content-type": "application/json" };
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: controller.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, status: res.status, error: "clay_redirected" };
    }
    if (!res.ok) {
      // A BOUNDED read. This was `(await res.text()).slice(0, 200)`, which pulls the
      // ENTIRE body into memory before throwing 99% of it away -- a hostile or broken
      // response could push unbounded bytes into the process. Read a fixed prefix off the
      // stream instead and drop the rest. The URL is never included: it is a credential.
      let detail = "";
      try {
        const reader = res.body?.getReader?.();
        if (reader) {
          const { value } = await reader.read();
          void reader.cancel();
          detail = value ? new TextDecoder().decode(value.slice(0, 200)) : "";
        }
      } catch {
        /* body unreadable; the status is enough */
      }
      return { ok: false, status: res.status, error: detail.slice(0, 200) || `http_${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return { ok: false, status: 0, error: aborted ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Push every row to Clay, in whichever shape this destination accepts.
 *
 * Stops at the FIRST failure rather than pushing on. A webhook that has started
 * rejecting us is usually rate-limiting or mis-authenticated, and hammering it turns a
 * recoverable partial push into a blocked one. Partial is genuinely recoverable here:
 * every row carries amber_contact_id, so re-running updates the rows that already
 * landed instead of duplicating them -- provided that column is set as the dedupe key
 * in Clay.
 *
 * Returns { pushed, failures } and never throws.
 */
/** Wrapped so the deadline logic is trivially testable with a fake clock. */
const nowMs = () => Date.now();

export async function pushRowsToClay(
  url,
  rows,
  { mode = CLAY_DEFAULT_MODE, authToken, concurrency = CLAY_CONCURRENCY, timeoutMs } = {},
) {
  const failures = [];
  let pushed = 0;
  const startedAt = nowMs();

  if (mode === "array") {
    for (let i = 0; i < rows.length; i += CLAY_BATCH_SIZE) {
      const batch = rows.slice(i, i + CLAY_BATCH_SIZE);
      const res = await postClayPayload(url, batch, { authToken, timeoutMs });
      if (res.ok) pushed += batch.length;
      else {
        failures.push({ index: i, status: res.status, error: res.error });
        break;
      }
    }
    return { pushed, failures };
  }

  // 'object' — one flat row per request, which is Clay's documented webhook contract.
  // A shared cursor rather than fixed slices, so a slow request does not idle a worker
  // that could be sending the next row.
  let cursor = 0;
  let stopped = false;
  const deadline = startedAt + CLAY_DEADLINE_MS;
  async function worker() {
    for (;;) {
      if (stopped) return;
      // Checked per row, so a slow-but-succeeding destination cannot hold the request
      // open indefinitely. Whatever landed before the deadline stays landed; the caller
      // sees a partial push, which is safe to re-run because Clay dedupes on
      // amber_contact_id.
      if (nowMs() > deadline) {
        failures.push({ index: cursor, status: 0, error: "deadline_exceeded" });
        stopped = true;
        return;
      }
      const i = cursor;
      cursor += 1;
      if (i >= rows.length) return;
      const res = await postClayPayload(url, rows[i], { authToken, timeoutMs });
      if (res.ok) {
        pushed += 1;
      } else {
        failures.push({ index: i, status: res.status, error: res.error });
        // Stop every worker, not just this one.
        stopped = true;
        return;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, rows.length)) }, () => worker()),
  );
  return { pushed, failures };
}
