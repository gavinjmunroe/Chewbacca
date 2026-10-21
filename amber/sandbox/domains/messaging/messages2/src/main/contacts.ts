// Read macOS Contacts directly from the AddressBook SQLite database. Apple's
// Contacts.framework would require a Swift helper binary; reading the
// SQLite is simpler and uses the same Full Disk Access permission Caleb
// has already granted (the AddressBook DB lives under ~/Library/Application
// Support/AddressBook and is TCC-protected the same way chat.db is).
//
// Schema reference (Apple internal, stable across macOS 11–15):
//   ZABCDRECORD          one row per contact
//     ZFIRSTNAME, ZLASTNAME, ZORGANIZATION, ZIMAGEDATA (JPEG blob)
//   ZABCDPHONENUMBER     one row per phone (ZOWNER → ZABCDRECORD.Z_PK)
//     ZFULLNUMBER
//   ZABCDEMAILADDRESS    one row per email (ZOWNER → ZABCDRECORD.Z_PK)
//     ZADDRESS
//
// Macs typically have multiple AddressBook "Sources" (local, iCloud, Exchange);
// we union them all so the user sees every contact regardless of origin.

import Database from "better-sqlite3";
import { app } from "electron";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const AB_DIR = join(
  homedir(),
  "Library",
  "Application Support",
  "AddressBook",
  "Sources",
);

export interface ContactRecord {
  displayName: string;
  organization: string | null;
  photoFileUrl: string | null;
}

let cache: Map<string, ContactRecord> | null = null;
let lastLoaded = 0;
const TTL_MS = 10 * 60 * 1000;

// Photos dir: write JPEGs to userData once per contact (keyed by content hash)
// so the renderer can <img src="file://..."> them without IPC roundtrips.
function photosDir(): string {
  const dir = join(app.getPath("userData"), "contact-photos");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function writePhoto(blob: Buffer): string | null {
  if (!blob || blob.length === 0) return null;
  try {
    const hash = createHash("sha1").update(blob).digest("hex").slice(0, 16);
    const filePath = join(photosDir(), `${hash}.jpg`);
    if (!existsSync(filePath)) writeFileSync(filePath, blob);
    return pathToFileURL(filePath).href;
  } catch {
    return null;
  }
}

// Normalize a phone number to the last 10 digits. This is US-default;
// for an international codebase we'd use libphonenumber, but for matching
// `+15550100003` ↔ `(555) 010-0003` ↔ `5550100003` this suffices.
function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d]/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

function loadContacts(): Map<string, ContactRecord> {
  const result = new Map<string, ContactRecord>();
  if (!existsSync(AB_DIR)) return result;

  let sources: string[] = [];
  try {
    sources = readdirSync(AB_DIR).filter((s) => !s.startsWith("."));
  } catch {
    return result;
  }

  for (const source of sources) {
    const dbPath = join(AB_DIR, source, "AddressBook-v22.abcddb");
    if (!existsSync(dbPath)) continue;

    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });

      const rows = db
        .prepare(
          `
          SELECT
            r.Z_PK            AS id,
            r.ZFIRSTNAME      AS firstName,
            r.ZLASTNAME       AS lastName,
            r.ZORGANIZATION   AS organization,
            r.ZIMAGEDATA      AS photoBytes,
            p.ZFULLNUMBER     AS phoneNumber,
            e.ZADDRESS        AS email
          FROM ZABCDRECORD r
          LEFT JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
          LEFT JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK
        `,
        )
        .all() as Array<{
        id: number;
        firstName: string | null;
        lastName: string | null;
        organization: string | null;
        photoBytes: Buffer | null;
        phoneNumber: string | null;
        email: string | null;
      }>;

      // Group rows by contact id, since the LEFT JOIN cross-products
      // phones × emails and we'd index the same contact's photo many times.
      const byId = new Map<
        number,
        {
          displayName: string;
          organization: string | null;
          photoBytes: Buffer | null;
          phones: Set<string>;
          emails: Set<string>;
        }
      >();

      for (const row of rows) {
        const displayName =
          [row.firstName, row.lastName].filter(Boolean).join(" ") ||
          row.organization ||
          "";
        if (!displayName) continue;

        let entry = byId.get(row.id);
        if (!entry) {
          entry = {
            displayName,
            organization: row.organization,
            photoBytes: row.photoBytes,
            phones: new Set(),
            emails: new Set(),
          };
          byId.set(row.id, entry);
        }
        if (row.phoneNumber) entry.phones.add(normalizePhone(row.phoneNumber));
        if (row.email) entry.emails.add(normalizeEmail(row.email));
      }

      for (const entry of byId.values()) {
        const photoFileUrl = entry.photoBytes
          ? writePhoto(entry.photoBytes)
          : null;
        const record: ContactRecord = {
          displayName: entry.displayName,
          organization: entry.organization,
          photoFileUrl,
        };
        for (const phone of entry.phones) result.set(phone, record);
        for (const email of entry.emails) result.set(email, record);
      }
    } catch (err) {
      console.error(
        `[contacts] Failed to read ${dbPath}:`,
        (err as Error).message,
      );
    } finally {
      try {
        db?.close();
      } catch {
        /**/
      }
    }
  }

  return result;
}

export function getContacts(force = false): Map<string, ContactRecord> {
  const now = Date.now();
  if (force || !cache || now - lastLoaded > TTL_MS) {
    cache = loadContacts();
    lastLoaded = now;
  }
  return cache;
}

export function lookupContact(
  handle: string | null | undefined,
): ContactRecord | null {
  if (!handle) return null;
  const contacts = getContacts();
  if (handle.includes("@")) {
    return contacts.get(normalizeEmail(handle)) ?? null;
  }
  return contacts.get(normalizePhone(handle)) ?? null;
}
