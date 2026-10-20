import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import chardet from 'chardet';
import { Readable } from 'stream';
import { FileParseError } from '../../errors';
import { createLogger } from '../../utils';
import { STREAMING_THRESHOLD_BYTES } from './limits';

const logger = createLogger('FileParser');

/**
 * Supported file types for parsing
 */
export type FileType = 'csv' | 'xlsx' | 'json';

/**
 * Result of parsing a file
 */
export interface ParseResult {
  headers: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  issues: string[];
}

/**
 * FileParser handles parsing of CSV, Excel, and JSON files.
 * Supports streaming for large files (>5MB CSV, all XLSX via ExcelJS).
 * Detects file encoding via chardet and strips UTF-8 BOM.
 */
export class FileParser {
  /**
   * Parse file content based on file type.
   * Now async to support ExcelJS streaming.
   */
  async parse(content: string | Buffer, fileType: FileType): Promise<ParseResult> {
    logger.info('Parsing file', { fileType });

    try {
      switch (fileType) {
        case 'csv':
          return this.parseCSV(content);
        case 'xlsx':
          return await this.parseExcel(content as Buffer);
        case 'json':
          return this.parseJSON(typeof content === 'string' ? content : this.decodeBuffer(content));
        default:
          throw new FileParseError(`Unsupported file type: ${fileType}`);
      }
    } catch (error) {
      if (error instanceof FileParseError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to parse file', error, { fileType });
      throw new FileParseError(`Failed to parse ${fileType} file: ${message}`);
    }
  }

  /**
   * Detect encoding and decode buffer to string.
   * Strips UTF-8 BOM if present.
   */
  private decodeBuffer(buffer: Buffer): string {
    // Detect encoding from first 4KB
    const sample = buffer.subarray(0, 4096);
    const detected = chardet.detect(sample) || 'utf-8';

    let text: string;
    try {
      const decoder = new TextDecoder(detected);
      text = decoder.decode(buffer);
    } catch {
      // Fallback to utf-8 if detected encoding is not supported
      text = buffer.toString('utf-8');
    }

    // Strip UTF-8 BOM
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.slice(1);
    }

    return text;
  }

  /**
   * Parse CSV content using PapaParse.
   * Uses streaming mode for buffers > 5MB.
   */
  private parseCSV(content: string | Buffer): ParseResult {
    const issues: string[] = [];

    // Decode buffer to string with encoding detection
    const text = typeof content === 'string' ? content : this.decodeBuffer(content);
    const sizeBytes = Buffer.byteLength(text, 'utf-8');

    if (sizeBytes > STREAMING_THRESHOLD_BYTES) {
      logger.info('Using streaming CSV parser for large file', { sizeBytes });
      return this.parseCSVStreaming(text, issues);
    }

    const result = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      transformHeader: (h: string) => h.trim(),
    });

    if (result.errors && result.errors.length > 0) {
      for (const error of result.errors) {
        const issue = `Row ${error.row}: ${error.message}`;
        issues.push(issue);
        logger.warn('CSV parsing issue', { row: error.row, message: error.message });
      }
    }

    const headers = this.cleanHeaders(result.meta.fields || []);
    const rows = result.data as Record<string, unknown>[];

    logger.info('CSV parsed successfully', { rowCount: rows.length, headerCount: headers.length });

    return {
      headers,
      rows,
      rowCount: rows.length,
      issues,
    };
  }

  /**
   * Streaming CSV parse for large files (>5MB).
   * Uses PapaParse step callback to process rows incrementally.
   */
  private parseCSVStreaming(text: string, issues: string[]): ParseResult {
    const rows: Record<string, unknown>[] = [];
    let headers: string[] = [];

    Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      transformHeader: (h: string) => h.trim(),
      step: (result) => {
        if (result.errors && result.errors.length > 0) {
          for (const error of result.errors) {
            if (issues.length < 100) { // Cap issue reporting
              issues.push(`Row ${error.row}: ${error.message}`);
            }
          }
        }
        rows.push(result.data);
      },
      complete: (result) => {
        headers = this.cleanHeaders(result.meta.fields || []);
      },
    });

    logger.info('CSV streaming parse completed', { rowCount: rows.length, headerCount: headers.length });

    return {
      headers,
      rows,
      rowCount: rows.length,
      issues,
    };
  }

  /**
   * Parse Excel content using ExcelJS streaming WorkbookReader.
   */
  private async parseExcel(content: Buffer): Promise<ParseResult> {
    const issues: string[] = [];
    const rows: Record<string, unknown>[] = [];
    let headers: string[] = [];
    let sheetCount = 0;
    let firstSheetName = '';
    let headerRow = true;

    const workbook = new ExcelJS.Workbook();
    const stream = Readable.from(content);

    await workbook.xlsx.read(stream);

    for (const worksheet of workbook.worksheets) {
      sheetCount++;

      // Only process the first sheet
      if (sheetCount > 1) continue;

      firstSheetName = worksheet.name;

      worksheet.eachRow((row, rowNumber) => {
        const values = row.values as unknown[];
        // ExcelJS row.values is 1-indexed (index 0 is empty)
        const cells = values.slice(1);

        if (headerRow) {
          headers = this.cleanHeaders(
            cells.map((v) => (v != null ? String(v) : ''))
          );
          headerRow = false;
          return;
        }

        // Build row object from headers + cells
        const record: Record<string, unknown> = {};
        for (let i = 0; i < headers.length; i++) {
          let cellValue = cells[i];
          // ExcelJS rich text handling
          if (cellValue && typeof cellValue === 'object' && 'richText' in (cellValue as Record<string, unknown>)) {
            cellValue = ((cellValue as { richText: { text: string }[] }).richText)
              .map((rt) => rt.text)
              .join('');
          }
          record[headers[i]] = cellValue ?? null;
        }
        rows.push(record);
      });
    }

    if (sheetCount === 0) {
      throw new FileParseError('Excel file contains no sheets');
    }

    if (sheetCount > 1) {
      issues.push(
        `Only the first sheet (${firstSheetName}) was processed. ${sheetCount - 1} additional sheet(s) were ignored.`
      );
    }

    logger.info('Excel parsed successfully', {
      rowCount: rows.length,
      headerCount: headers.length,
      sheetName: firstSheetName,
    });

    return {
      headers,
      rows,
      rowCount: rows.length,
      issues,
    };
  }

  /**
   * Parse JSON content
   */
  private parseJSON(content: string): ParseResult {
    const issues: string[] = [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new FileParseError(`Invalid JSON: ${message}`);
    }

    let rows: Record<string, unknown>[] = [];

    if (Array.isArray(parsed)) {
      // Direct array of records
      rows = parsed as Record<string, unknown>[];
    } else if (typeof parsed === 'object' && parsed !== null) {
      // Object - look for common array property names
      const obj = parsed as Record<string, unknown>;
      const arrayProperties = ['data', 'results', 'items', 'records'];

      let foundArray = false;
      for (const prop of arrayProperties) {
        if (Array.isArray(obj[prop])) {
          rows = obj[prop] as Record<string, unknown>[];
          issues.push(`Extracted data from '${prop}' property`);
          foundArray = true;
          break;
        }
      }

      if (!foundArray) {
        // Single object - wrap in array
        rows = [obj];
        issues.push('Single object was wrapped in an array');
      }
    } else {
      throw new FileParseError('JSON must be an object or array');
    }

    if (rows.length === 0) {
      return {
        headers: [],
        rows: [],
        rowCount: 0,
        issues: ['JSON data is empty'],
      };
    }

    // Infer headers from first row's keys
    const firstRow = rows[0];
    const rawHeaders = typeof firstRow === 'object' && firstRow !== null
      ? Object.keys(firstRow)
      : [];
    const headers = this.cleanHeaders(rawHeaders);

    logger.info('JSON parsed successfully', { rowCount: rows.length, headerCount: headers.length });

    return {
      headers,
      rows,
      rowCount: rows.length,
      issues,
    };
  }

  /**
   * Clean and normalize headers
   */
  private cleanHeaders(headers: string[]): string[] {
    return headers.map((header, index) => {
      // Trim whitespace
      let cleaned = header.trim();

      // Remove BOM character
      cleaned = cleaned.replace(/\uFEFF/g, '');

      // Replace empty headers with column_N
      if (!cleaned) {
        cleaned = `column_${index + 1}`;
      }

      return cleaned;
    });
  }
}
