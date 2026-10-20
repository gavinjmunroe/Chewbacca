import { createLogger } from '../../utils';

const logger = createLogger('ColumnMapper');

/**
 * Column mapping configuration
 */
export interface ColumnMapping {
  /** Mapping from source column names to target field names */
  mappings: Record<string, string>;
  /** Confidence score for auto-inferred mappings */
  confidence: number;
  /** Columns that could not be mapped */
  unmappedColumns: string[];
}

/**
 * Known field patterns for different entity types
 */
const COMPANY_FIELD_PATTERNS: Record<string, string[]> = {
  name: ['company', 'company_name', 'companyname', 'business', 'business_name', 'organization', 'org'],
  website: ['website', 'url', 'site', 'web', 'homepage'],
  email: ['email', 'e-mail', 'mail', 'contact_email'],
  phone: ['phone', 'telephone', 'tel', 'contact', 'phone_number'],
  industry: ['industry', 'sector', 'vertical', 'category'],
  size: ['size', 'employees', 'employee_count', 'headcount', 'company_size'],
  'location.city': ['city', 'location'],
  'location.state': ['state', 'province', 'region'],
  'location.country': ['country', 'nation'],
  'location.address': ['address', 'street', 'street_address'],
  description: ['description', 'about', 'summary', 'bio'],
  revenue: ['revenue', 'annual_revenue', 'sales'],
  founded: ['founded', 'founded_year', 'year_founded', 'established'],
  // Healthcare-specific
  practiceType: ['practice_type', 'practice', 'practice_category', 'facility_type', 'org_type'],
  ehrSystem: ['ehr', 'ehr_system', 'emr', 'emr_system', 'electronic_health_record'],
  specialties: ['specialty', 'specialties', 'medical_specialty', 'clinical_specialty', 'department'],
  patientVolume: ['patient_volume', 'patients', 'patient_count', 'monthly_patients', 'annual_patients', 'census'],
  npi: ['npi', 'npi_number', 'national_provider_identifier'],
};

const CONTACT_FIELD_PATTERNS: Record<string, string[]> = {
  firstName: ['first_name', 'firstname', 'first', 'fname', 'given_name'],
  lastName: ['last_name', 'lastname', 'last', 'lname', 'family_name', 'surname'],
  name: ['name', 'full_name', 'fullname', 'contact_name'],
  email: ['email', 'e-mail', 'mail', 'work_email', 'contact_email'],
  phone: ['phone', 'telephone', 'tel', 'mobile', 'cell', 'phone_number'],
  title: ['title', 'job_title', 'position', 'role', 'job'],
  company: ['company', 'organization', 'employer', 'company_name'],
  linkedIn: ['linkedin', 'linkedin_url', 'linkedin_profile'],
  'location.city': ['city', 'location'],
  'location.state': ['state', 'province', 'region'],
  'location.country': ['country', 'nation'],
  // Healthcare-specific
  practiceType: ['practice_type', 'practice', 'facility_type', 'org_type'],
  ehrSystem: ['ehr', 'ehr_system', 'emr', 'emr_system', 'electronic_health_record'],
  specialties: ['specialty', 'specialties', 'medical_specialty', 'clinical_specialty', 'department'],
  patientVolume: ['patient_volume', 'patients', 'patient_count', 'monthly_patients', 'annual_patients', 'census'],
  npi: ['npi', 'npi_number', 'national_provider_identifier'],
};

/**
 * Column mapper for automatically mapping file columns to schema fields
 */
export class ColumnMapper {
  /**
   * Infer column mapping from headers
   * @param headers - Array of column header names
   * @param entityType - Type of entity to map to
   * @returns Inferred column mapping
   */
  inferMapping(headers: string[], entityType: 'company' | 'contact'): ColumnMapping {
    const patterns = entityType === 'company' ? COMPANY_FIELD_PATTERNS : CONTACT_FIELD_PATTERNS;
    const mappings: Record<string, string> = {};
    const mappedFields = new Set<string>();
    const unmappedColumns: string[] = [];

    for (const header of headers) {
      const normalizedHeader = this.normalizeHeader(header);
      let matched = false;

      for (const [targetField, fieldPatterns] of Object.entries(patterns)) {
        // Skip if this target field is already mapped
        if (mappedFields.has(targetField)) {
          continue;
        }

        // Check if header matches any pattern
        if (this.matchesPattern(normalizedHeader, fieldPatterns)) {
          mappings[header] = targetField;
          mappedFields.add(targetField);
          matched = true;
          logger.debug('Mapped column', { header, targetField });
          break;
        }
      }

      if (!matched) {
        unmappedColumns.push(header);
      }
    }

    // Calculate confidence based on proportion of mapped columns
    const confidence = headers.length > 0
      ? (headers.length - unmappedColumns.length) / headers.length
      : 0;

    logger.info('Column mapping inferred', {
      entityType,
      mappedCount: Object.keys(mappings).length,
      unmappedCount: unmappedColumns.length,
      confidence,
    });

    return {
      mappings,
      confidence,
      unmappedColumns,
    };
  }

  /**
   * Normalize header for pattern matching
   */
  private normalizeHeader(header: string): string {
    return header
      .toLowerCase()
      .trim()
      .replace(/[\s-]+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
  }

  /**
   * Check if a normalized header matches any of the patterns
   */
  private matchesPattern(normalizedHeader: string, patterns: string[]): boolean {
    return patterns.some(pattern => {
      const normalizedPattern = pattern.toLowerCase().replace(/[\s-]+/g, '_');
      return normalizedHeader === normalizedPattern ||
             normalizedHeader.includes(normalizedPattern) ||
             normalizedPattern.includes(normalizedHeader);
    });
  }
}
