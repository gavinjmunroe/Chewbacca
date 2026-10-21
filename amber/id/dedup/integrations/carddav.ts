/**
 * iCloud CardDAV client.
 *
 * Auth: HTTP Basic with iCloud email + app-specific password
 *   (https://support.apple.com/en-us/HT204397).
 *
 * Discovery flow (RFC 6352):
 *   1. PROPFIND on /.well-known/carddav → current-user-principal href
 *   2. PROPFIND on principal → addressbook-home-set href
 *   3. PROPFIND on home set with Depth: 1 → list of addressbook collections
 *
 * Read flow:
 *   REPORT on an addressbook collection with addressbook-query → list of
 *   {href, etag, vcard} for every contact.
 *
 * Write flow:
 *   PUT a vCard body to {addressbook}/{uid}.vcf
 *     - On create: If-None-Match: *
 *     - On update: If-Match: <etag>
 *   Capture the response ETag for the next conditional update.
 *
 * We do not pull in an XML library — the responses are small and our needs
 * are narrow (a handful of element names). Regex parsing is fine and avoids
 * adding a dependency to the project.
 */

const ICLOUD_BASE =
  process.env.APPLE_CARDDAV_BASE_URL ?? "https://contacts.icloud.com";

export interface CardDavCreds {
  /** iCloud email (e.g. "user@icloud.com") */
  username: string;
  /** App-specific password — NOT the iCloud account password */
  password: string;
}

export interface AddressBook {
  href: string;
  displayName: string | null;
}

export interface CardDavContact {
  /** Full path to the vCard on the server, e.g. "/123456/carddavhome/card/ABC.vcf" */
  href: string;
  /** ETag for conditional update (If-Match) */
  etag: string;
  /** Raw vCard 3.0 body */
  vcard: string;
}

export interface PutResult {
  href: string;
  etag: string;
}

// ─── Low-level request helper ────────────────────────────────────────────────

function basicAuth(creds: CardDavCreds): string {
  return (
    "Basic " +
    Buffer.from(`${creds.username}:${creds.password}`).toString("base64")
  );
}

function absoluteUrl(href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  const base = new URL(ICLOUD_BASE);
  return `${base.protocol}//${base.host}${href}`;
}

async function dav(
  method: string,
  url: string,
  creds: CardDavCreds,
  body: string | null,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: basicAuth(creds),
    "User-Agent": "medha-dedup/1.0 (CardDAV client)",
    ...extraHeaders,
  };
  if (body) {
    headers["Content-Type"] = body.startsWith("<?xml")
      ? "application/xml; charset=utf-8"
      : "text/vcard; charset=utf-8";
  }

  const res = await fetch(absoluteUrl(url), {
    method,
    headers,
    body: body ?? undefined,
  });

  if (res.status === 401) {
    throw new Error(
      "CardDAV auth failed — check the iCloud email + app-specific password",
    );
  }
  return res;
}

// ─── Discovery ───────────────────────────────────────────────────────────────

/** Extract the first <href> value inside an XML element name. */
function extractHref(xml: string, elementName: string): string | null {
  const re = new RegExp(
    `<[^>]*${elementName}[^>]*>\\s*<[^>]*href[^>]*>([^<]+)<\\/[^>]*href[^>]*>`,
    "i",
  );
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

/** Step 1: find the principal URL for the authenticated user. */
async function findPrincipal(creds: CardDavCreds): Promise<string> {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
     <d:propfind xmlns:d="DAV:">
       <d:prop><d:current-user-principal/></d:prop>
     </d:propfind>`;

  const res = await dav("PROPFIND", "/.well-known/carddav", creds, body, {
    Depth: "0",
  });
  const xml = await res.text();
  const href = extractHref(xml, "current-user-principal");
  if (!href) {
    throw new Error(
      `CardDAV: could not find principal in PROPFIND response (status ${res.status})`,
    );
  }
  return href;
}

/** Step 2: from the principal, find the address book home set. */
async function findAddressBookHome(
  creds: CardDavCreds,
  principalHref: string,
): Promise<string> {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
     <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
       <d:prop><c:addressbook-home-set/></d:prop>
     </d:propfind>`;

  const res = await dav("PROPFIND", principalHref, creds, body, { Depth: "0" });
  const xml = await res.text();
  const href = extractHref(xml, "addressbook-home-set");
  if (!href) throw new Error("CardDAV: could not find addressbook-home-set");
  return href;
}

/** Step 3: list all addressbook collections under the home set. */
export async function listAddressBooks(
  creds: CardDavCreds,
): Promise<AddressBook[]> {
  const principal = await findPrincipal(creds);
  const home = await findAddressBookHome(creds, principal);

  const body = `<?xml version="1.0" encoding="utf-8" ?>
     <d:propfind xmlns:d="DAV:">
       <d:prop>
         <d:resourcetype/>
         <d:displayname/>
       </d:prop>
     </d:propfind>`;

  const res = await dav("PROPFIND", home, creds, body, { Depth: "1" });
  const xml = await res.text();

  const out: AddressBook[] = [];
  const responseRe = /<[^>]*response[^>]*>([\s\S]*?)<\/[^>]*response[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = responseRe.exec(xml)) !== null) {
    const block = m[1];
    if (!/addressbook/i.test(block)) continue;
    const hrefMatch = block.match(/<[^>]*href[^>]*>([^<]+)<\/[^>]*href[^>]*>/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1].trim();
    if (href === home || href.replace(/\/$/, "") === home.replace(/\/$/, "")) {
      continue;
    }
    const nameMatch = block.match(
      /<[^>]*displayname[^>]*>([^<]*)<\/[^>]*displayname[^>]*>/i,
    );
    out.push({ href, displayName: nameMatch ? nameMatch[1] : null });
  }

  return out;
}

/** Convenience: pick the user's default addressbook (first one we find). */
export async function findDefaultAddressBook(
  creds: CardDavCreds,
): Promise<AddressBook> {
  const books = await listAddressBooks(creds);
  if (books.length === 0) {
    throw new Error("CardDAV: no address books found for this account");
  }
  const card = books.find((b) => /\/card\/?$/.test(b.href));
  return card ?? books[0];
}

// ─── Read all contacts in an address book ────────────────────────────────────

export async function listContacts(
  creds: CardDavCreds,
  addressBookHref: string,
): Promise<CardDavContact[]> {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
     <c:addressbook-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
       <d:prop>
         <d:getetag/>
         <c:address-data/>
       </d:prop>
       <c:filter><c:prop-filter name="FN"/></c:filter>
     </c:addressbook-query>`;

  const res = await dav("REPORT", addressBookHref, creds, body, { Depth: "1" });
  const xml = await res.text();

  const out: CardDavContact[] = [];
  const responseRe = /<[^>]*response[^>]*>([\s\S]*?)<\/[^>]*response[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = responseRe.exec(xml)) !== null) {
    const block = m[1];
    const hrefMatch = block.match(/<[^>]*href[^>]*>([^<]+)<\/[^>]*href[^>]*>/i);
    const etagMatch = block.match(
      /<[^>]*getetag[^>]*>([^<]+)<\/[^>]*getetag[^>]*>/i,
    );
    const dataMatch = block.match(
      /<[^>]*address-data[^>]*>([\s\S]*?)<\/[^>]*address-data[^>]*>/i,
    );
    if (!hrefMatch || !dataMatch) continue;
    out.push({
      href: hrefMatch[1].trim(),
      etag: etagMatch ? etagMatch[1].trim() : "",
      vcard: decodeXmlEntities(dataMatch[1]).trim(),
    });
  }

  return out;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ─── Write back ──────────────────────────────────────────────────────────────

export interface PutOptions {
  /** If set, sends If-Match: <etag> for conditional update. */
  ifMatch?: string;
  /** If true, sends If-None-Match: * to fail if the resource already exists. */
  ifNoneMatch?: boolean;
}

/**
 * PUT a vCard body to a specific href on the server.
 *
 * The href is the full server path including the .vcf filename. For a new
 * contact, generate {addressbookHref}/{uid}.vcf. For an update, use the
 * existing href returned by listContacts.
 *
 * Returns the new ETag so the caller can persist it for future updates.
 */
export async function putContact(
  creds: CardDavCreds,
  href: string,
  vcardBody: string,
  opts: PutOptions = {},
): Promise<PutResult> {
  const extra: Record<string, string> = {};
  if (opts.ifMatch) extra["If-Match"] = opts.ifMatch;
  if (opts.ifNoneMatch) extra["If-None-Match"] = "*";

  const res = await dav("PUT", href, creds, vcardBody, extra);

  if (res.status === 412) {
    throw new Error(
      "CardDAV PUT failed: precondition (If-Match/If-None-Match) did not pass — resource changed on server or already exists",
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `CardDAV PUT failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`,
    );
  }

  let etag = res.headers.get("etag") ?? "";
  if (!etag) etag = await fetchEtag(creds, href);
  return { href, etag };
}

async function fetchEtag(creds: CardDavCreds, href: string): Promise<string> {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
     <d:propfind xmlns:d="DAV:">
       <d:prop><d:getetag/></d:prop>
     </d:propfind>`;
  const res = await dav("PROPFIND", href, creds, body, { Depth: "0" });
  const xml = await res.text();
  const m = xml.match(/<[^>]*getetag[^>]*>([^<]+)<\/[^>]*getetag[^>]*>/i);
  return m ? m[1].trim() : "";
}

/** Build the href for a new contact: {addressbookHref}/{uid}.vcf */
export function newContactHref(addressBookHref: string, uid: string): string {
  const trimmed = addressBookHref.replace(/\/+$/, "");
  return `${trimmed}/${encodeURIComponent(uid)}.vcf`;
}

// ─── Connection test (called by credentials route) ───────────────────────────

/**
 * Verify the credentials work end-to-end: discover principal + home set +
 * at least one addressbook. Used by the credentials-store route to fail
 * fast on bad app-specific passwords.
 */
export async function verifyCredentials(
  creds: CardDavCreds,
): Promise<{ addressBook: AddressBook }> {
  const book = await findDefaultAddressBook(creds);
  return { addressBook: book };
}
