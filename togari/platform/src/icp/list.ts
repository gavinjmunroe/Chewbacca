/**
 * The list a requester actually receives: at most LIST_MAX_CONTACTS people
 * from Clay's rows, each with an enriched work email (shown masked), as a CSV.
 *
 * Clay may return more rows than we send (accounts with no verified contact,
 * duplicates across accounts). Everything Clay returned is still stored on
 * the job for internal review; this module only shapes what goes out.
 */

export const LIST_MAX_CONTACTS = 10;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface ListContact {
  name: string;
  title: string;
  company: string;
  company_domain: string;
  email: string;
  linkedin: string;
  location: string;
  employee_count: string;
}

function text(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

/**
 * Keep rows that name a person and carry a usable work email, drop repeat
 * emails, and stop at the cap. Clay's own ordering (its best matches first)
 * is preserved.
 */
export function selectListContacts(
  rows: Record<string, unknown>[],
  max = LIST_MAX_CONTACTS,
): ListContact[] {
  const seen = new Set<string>();
  const contacts: ListContact[] = [];
  for (const row of rows) {
    if (contacts.length >= max) break;
    const email = text(row.contact_email).toLowerCase();
    const name = text(row.contact_name);
    if (!name || !EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    contacts.push({
      name,
      title: text(row.contact_title),
      company: text(row.company_name),
      company_domain: text(row.company_domain),
      email,
      linkedin: text(row.contact_linkedin),
      location: text(row.location),
      employee_count: text(row.employee_count),
    });
  }
  return contacts;
}

/**
 * The free list is a sample: work emails are verified but partly hidden
 * ("d***@mercydentalwi.com"), in the email body and the CSV alike. The
 * unmasked addresses are only stored in Togari.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

const CSV_COLUMNS: { header: string; key: keyof ListContact }[] = [
  { header: "Name", key: "name" },
  { header: "Title", key: "title" },
  { header: "Company", key: "company" },
  { header: "Company domain", key: "company_domain" },
  { header: "Work email", key: "email" },
  { header: "LinkedIn", key: "linkedin" },
  { header: "Location", key: "location" },
  { header: "Employees", key: "employee_count" },
];

/**
 * Quote every cell, and neutralize values a spreadsheet would run as a
 * formula (=, +, -, @): the data comes from third-party sources and the file
 * is opened by someone outside BMA.
 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildListCsv(contacts: ListContact[]): string {
  const lines = [
    CSV_COLUMNS.map((c) => csvCell(c.header)).join(","),
    ...contacts.map((contact) =>
      CSV_COLUMNS.map((c) =>
        csvCell(c.key === "email" ? maskEmail(contact.email) : contact[c.key]),
      ).join(","),
    ),
  ];
  // CRLF per RFC 4180, and a BOM so Excel reads names with accents correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}
