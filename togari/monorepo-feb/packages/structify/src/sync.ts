import type { StructifyClient } from './client';
import type { Person } from '@togari/core';

/**
 * Sync configuration for Clay integration
 */
export interface SyncConfig {
  clayApiKey: string;
  clayBaseUrl?: string;
  peopleIntakeTableId: string;
}

/**
 * Clay API Response for enrichment data
 */
export interface ClayEnrichmentData {
  linkedinData?: {
    headline?: string;
    summary?: string;
    experience?: Array<{
      company: string;
      title: string;
      startDate?: string;
      endDate?: string;
      current: boolean;
    }>;
  };
  companyData?: {
    name: string;
    domain: string;
    industry?: string;
    employeeCount?: number;
    description?: string;
  };
  emailVerification?: {
    isValid: boolean;
    email: string;
  };
}

/**
 * Clay Sync Service
 * Handles bidirectional sync between Structify and Clay
 */
export class ClaySyncService {
  constructor(
    private readonly structifyClient: StructifyClient,
    private readonly config: SyncConfig
  ) {}

  /**
   * Push person to Clay for enrichment
   */
  async pushToClayForEnrichment(personId: string, organizationId: string): Promise<void> {
    const person = await this.structifyClient.getPerson(personId, organizationId);

    if (!person) {
      throw new Error(`Person ${personId} not found`);
    }

    const payload = {
      person_id: personId,
      linkedin_url: person.linkedinUrl,
      full_name: person.fullName,
      work_email: person.workEmail,
      company_domain: person.companyDomain,
      organization_id: organizationId,
    };

    const response = await fetch(
      `${this.config.clayBaseUrl || 'https://api.clay.com/v1'}/tables/${this.config.peopleIntakeTableId}/rows`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.clayApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      throw new Error(`Clay push failed: ${response.statusText}`);
    }
  }

  /**
   * Pull enriched data from Clay and update Structify
   */
  async pullFromClayAndUpdate(personId: string, enrichmentData: ClayEnrichmentData): Promise<Person> {
    const updates: Partial<Person> = {};

    // Update LinkedIn data
    if (enrichmentData.linkedinData) {
      if (enrichmentData.linkedinData.headline) {
        updates.linkedinHeadline = enrichmentData.linkedinData.headline;
      }
      if (enrichmentData.linkedinData.summary) {
        updates.linkedinSummary = enrichmentData.linkedinData.summary;
      }
      if (enrichmentData.linkedinData.experience) {
        updates.linkedinExperience = enrichmentData.linkedinData.experience;
      }
    }

    // Update company data
    if (enrichmentData.companyData) {
      updates.companyData = enrichmentData.companyData;
      if (enrichmentData.companyData.name) {
        updates.currentCompany = enrichmentData.companyData.name;
      }
      if (enrichmentData.companyData.domain) {
        updates.companyDomain = enrichmentData.companyData.domain;
      }
    }

    // Update email validation
    if (enrichmentData.emailVerification) {
      updates.emailValid = enrichmentData.emailVerification.isValid;
      if (enrichmentData.emailVerification.isValid) {
        updates.workEmail = enrichmentData.emailVerification.email;
      }
    }

    // Store full enrichment data
    updates.enrichmentData = enrichmentData;
    updates.updatedAt = new Date();

    return this.structifyClient.updatePerson(personId, updates);
  }

  /**
   * Batch push multiple people to Clay
   */
  async batchPushToClay(personIds: string[], organizationId: string): Promise<void> {
    const promises = personIds.map((personId) =>
      this.pushToClayForEnrichment(personId, organizationId)
    );

    await Promise.allSettled(promises);
  }
}

/**
 * Webhook handler for Clay enrichment callbacks
 */
export async function handleClayEnrichmentWebhook(
  payload: {
    person_id: string;
    enrichment_data: ClayEnrichmentData;
  },
  syncService: ClaySyncService
): Promise<Person> {
  return syncService.pullFromClayAndUpdate(payload.person_id, payload.enrichment_data);
}
