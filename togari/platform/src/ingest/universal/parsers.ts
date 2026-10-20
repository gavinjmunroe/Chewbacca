/**
 * Universal ingestion — format normalizers.
 *
 * Turns a raw payload of a given content type into something the extractor can
 * read: either an array of records (CSV / JSON / XLSX tabular data) or a plain
 * text blob (free-form notes). Everything here is dependency-light: CSV uses a
 * tiny hand-rolled parser, XLSX reuses the repo's existing `xlsx` dependency.
 * All parsing is defensive — a malformed payload falls back to raw text rather
 * than throwing, because the raw is already preserved upstream.
 */

import * as XLSX from "xlsx";
import { createLogger } from "../../observability/logger";
import type { IngestContentType } from "./types";

const logger = createLogger("ingest/universal/parsers");

export interface ParsedPayload {
  kind: "records" | "text";
  records?: Record<string, unknown>[];
  text?: string;
}

/**
 * Split a single CSV line into fields, honoring double-quoted fields and
 * escaped quotes (""). Deliberately small: handles the common export shapes
 * without pulling in a CSV library.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/** Parse a CSV string (header row + data rows) into array-of-objects. */
export function parseCsv(csv: string): Record<string, unknown>[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]);
  const records: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const record: Record<string, unknown> = {};
    headers.forEach((header, idx) => {
      record[header] = cells[idx] ?? "";
    });
    records.push(record);
  }
  return records;
}

/** Parse a base64-encoded XLSX workbook into rows from its first sheet. */
export function parseXlsx(base64: string): Record<string, unknown>[] {
  const buffer = Buffer.from(base64, "base64");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json(sheet, {
    defval: "",
  }) as Record<string, unknown>[];
}

/**
 * Normalize a raw payload into records or text based on its content type.
 * Any parse failure falls back to `{ kind: "text" }` carrying whatever raw
 * string is available.
 */
export function normalizePayload(input: {
  contentType: IngestContentType;
  rawText?: string;
  rawJson?: unknown;
}): ParsedPayload {
  const rawText = input.rawText ?? "";

  try {
    switch (input.contentType) {
      case "csv": {
        const records = parseCsv(rawText);
        if (records.length > 0) return { kind: "records", records };
        return { kind: "text", text: rawText };
      }
      case "json": {
        const source =
          input.rawJson !== undefined && input.rawJson !== null
            ? input.rawJson
            : JSON.parse(rawText);
        const records = Array.isArray(source) ? source : [source];
        return {
          kind: "records",
          records: records as Record<string, unknown>[],
        };
      }
      case "xlsx": {
        const records = parseXlsx(rawText);
        if (records.length > 0) return { kind: "records", records };
        return { kind: "text", text: rawText };
      }
      case "text":
      default:
        return { kind: "text", text: rawText };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("payload normalize failed — falling back to text", {
      contentType: input.contentType,
      error: message,
    });
    return { kind: "text", text: rawText };
  }
}
