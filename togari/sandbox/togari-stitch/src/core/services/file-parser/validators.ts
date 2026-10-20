/**
 * Result of validating a single row
 */
export interface RowValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Result of validating all rows
 */
export interface ValidationResult {
  valid: boolean;
  errors: Array<{ row: number; field: string; message: string }>;
  warnings: Array<{ row: number; field: string; message: string }>;
}

/**
 * Email validation regex pattern
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * URL validation regex pattern
 */
const URL_REGEX = /^https?:\/\/[^\s]+$/;

/**
 * Required fields by entity type
 */
const REQUIRED_FIELDS: Record<string, string[]> = {
  company: ['name'],
  contact: ['fullName'],
};

/**
 * DataValidator validates parsed rows for completeness and correctness
 */
export class DataValidator {
  /**
   * Validate all rows for a given entity type
   */
  validate(
    rows: Record<string, unknown>[],
    entityType: 'company' | 'contact'
  ): ValidationResult {
    const errors: Array<{ row: number; field: string; message: string }> = [];
    const warnings: Array<{ row: number; field: string; message: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = i + 1; // 1-based for user-friendly display
      const validation = this.validateRow(row, rowIndex, entityType);

      for (const error of validation.errors) {
        const [field, message] = this.parseFieldMessage(error);
        errors.push({ row: rowIndex, field, message });
      }

      for (const warning of validation.warnings) {
        const [field, message] = this.parseFieldMessage(warning);
        warnings.push({ row: rowIndex, field, message });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate a single row
   */
  validateRow(
    row: Record<string, unknown>,
    _rowIndex: number,
    entityType: string
  ): RowValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for empty rows
    if (this.isEmptyRow(row)) {
      errors.push('_row: Row is empty');
      return { valid: false, errors, warnings };
    }

    // Check required fields
    const requiredFields = REQUIRED_FIELDS[entityType] || [];
    for (const field of requiredFields) {
      const value = row[field];
      if (value === undefined || value === null || value === '') {
        errors.push(`${field}: Required field is missing`);
      }
    }

    // Validate email format if present
    const emailFields = this.findFieldsByPattern(row, ['email', 'e-mail', 'emailaddress']);
    for (const field of emailFields) {
      const value = row[field];
      if (value !== undefined && value !== null && value !== '') {
        if (typeof value !== 'string' || !this.isValidEmail(value)) {
          warnings.push(`${field}: Invalid email format`);
        }
      }
    }

    // Validate URL format if present
    const urlFields = this.findFieldsByPattern(row, ['url', 'website', 'link', 'homepage']);
    for (const field of urlFields) {
      const value = row[field];
      if (value !== undefined && value !== null && value !== '') {
        if (typeof value !== 'string' || !this.isValidUrl(value)) {
          warnings.push(`${field}: Invalid URL format`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Check if a row is empty
   */
  private isEmptyRow(row: Record<string, unknown>): boolean {
    const values = Object.values(row);
    return values.every(
      (value) => value === undefined || value === null || value === ''
    );
  }

  /**
   * Find fields matching common patterns (case-insensitive)
   */
  private findFieldsByPattern(
    row: Record<string, unknown>,
    patterns: string[]
  ): string[] {
    const fields = Object.keys(row);
    return fields.filter((field) => {
      const lowerField = field.toLowerCase();
      return patterns.some((pattern) => lowerField.includes(pattern.toLowerCase()));
    });
  }

  /**
   * Validate email format
   */
  private isValidEmail(value: string): boolean {
    return EMAIL_REGEX.test(value);
  }

  /**
   * Validate URL format
   */
  private isValidUrl(value: string): boolean {
    return URL_REGEX.test(value);
  }

  /**
   * Parse field:message format from validation string
   */
  private parseFieldMessage(message: string): [string, string] {
    const colonIndex = message.indexOf(':');
    if (colonIndex > 0) {
      return [message.substring(0, colonIndex), message.substring(colonIndex + 2)];
    }
    return ['_unknown', message];
  }
}
