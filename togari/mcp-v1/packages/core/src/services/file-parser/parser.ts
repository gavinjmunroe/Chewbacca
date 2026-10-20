import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { FileParseError } from '../../errors';
import { createLogger } from '../../utils';

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
 * FileParser handles parsing of CSV, Excel, and JSON files
 */
export class FileParser {
  /**
   * Parse file content based on file type
   */
  parse(content: string | Buffer, fileType: FileType): ParseResult {
    logger.info('Parsing file', { fileType });

    try {
      switch (fileType) {
        case 'csv':
          return this.parseCSV(content as string);
        case 'xlsx':
          return this.parseExcel(content as Buffer);
        case 'json':
          return this.parseJSON(content as string);
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
   * Parse CSV content using PapaParse
   */
  private parseCSV(content: string): ParseResult {
    const issues: string[] = [];

    const result = Papa.parse<Record<string, unknown>>(content, {
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
   * Parse Excel content using xlsx
   */
  private parseExcel(content: Buffer): ParseResult {
    const issues: string[] = [];

    const workbook = XLSX.read(content, { type: 'buffer' });

    if (workbook.SheetNames.length === 0) {
      throw new FileParseError('Excel file contains no sheets');
    }

    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];

    if (!sheet) {
      throw new FileParseError('Could not read Excel sheet');
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

    if (rows.length === 0) {
      return {
        headers: [],
        rows: [],
        rowCount: 0,
        issues: ['Excel sheet is empty'],
      };
    }

    // Extract headers from first row's keys
    const firstRow = rows[0];
    const rawHeaders = Object.keys(firstRow);
    const headers = this.cleanHeaders(rawHeaders);

    if (workbook.SheetNames.length > 1) {
      issues.push(`Only the first sheet (${firstSheetName}) was processed. ${workbook.SheetNames.length - 1} additional sheet(s) were ignored.`);
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
