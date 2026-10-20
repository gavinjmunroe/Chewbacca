/**
 * Quality scoring utilities for agent-based contact enrichment.
 * Used to determine when contacts are "complete" and enrichment can stop.
 *
 * Enhanced with cross-source validation bonuses.
 */

import type { ContactInfoJson } from "../enrichment/types";

/**
 * Quality score thresholds
 */
export const QUALITY_THRESHOLDS = {
  /** Maximum tool calls allowed per company */
  MAX_STEPS: 30,
} as const;

/**
 * Cross-source validation scoring factors
 */
export const CROSS_VALIDATION_SCORES = {
  /** Contact found in both ZoomInfo AND Enformion */
  MULTI_SOURCE: 25,
  /** Email matches across sources */
  EMAIL_MATCH: 15,
  /** Phone matches across sources */
  PHONE_MATCH: 15,
  /** Name fuzzy-matches across sources */
  NAME_MATCH: 10,
  /** Address within 50km of business location */
  ADDRESS_PROXIMITY: 10,
  /** Penalty for conflicting data between sources */
  CONFLICT_PENALTY: -20,
  /** Identity score threshold for Enformion confidence */
  IDENTITY_SCORE_THRESHOLD: 70,
  /** Business officer/owner role verification */
  BUSINESS_ROLE: 15,
} as const;

/**
 * Calculate a quality score (0-100) for a contact based on data completeness.
 *
 * Base Scoring breakdown:
 * - Name: 15 points
 * - Title: 10 points
 * - Email: 25 points
 * - Phone: 25 points (any valid phone with 10+ digits)
 *
 * Cross-source validation bonuses (up to 25 points):
 * - Cross-source verified: +10 points
 * - Address match: +5 points (Enformion confirms local address)
 * - Identity score: +5 points (Enformion identity confidence)
 * - Business role: +5 points (verified as business officer/owner)
 *
 * @param contact - The contact to score
 * @returns Quality score from 0 to 100
 */
export function calculateQualityScore(contact: ContactInfoJson): number {
  let score = 0;

  // Base scoring (75 points max)
  // Name: 15 points
  if (contact.name && contact.name.trim().length > 0) {
    score += 15;
  }

  // Title: 10 points
  if (contact.title && contact.title.trim().length > 0) {
    score += 10;
  }

  // Email: 25 points (must contain @)
  if (contact.email?.includes("@")) {
    score += 25;
  }

  // Phone: 25 points for any valid phone
  const phoneDigits = contact.phone?.replace(/\D/g, "") ?? "";
  if (phoneDigits.length >= 10) {
    score += 25;
  }

  // Cross-source validation bonuses (up to 25 points)
  // Cross-source verified: +10 points
  if (contact.provenance?.cross_source_verified) {
    score += 10;
  }

  // Address match: +5 points (Enformion confirms person is in same area as business)
  const addressMatchScore = contact.provenance?.enformion?.address_match_score;
  if (typeof addressMatchScore === "number" && addressMatchScore >= 50) {
    score += 5;
  }

  // Identity score: +5 points (Enformion identity confidence)
  const identityScore = contact.provenance?.enformion?.identity_score;
  if (
    typeof identityScore === "number" &&
    identityScore >= CROSS_VALIDATION_SCORES.IDENTITY_SCORE_THRESHOLD
  ) {
    score += 5;
  }

  // Business role: +5 points (verified as business officer/owner)
  if (contact.provenance?.business_role) {
    score += 5;
  }

  return Math.min(score, 100);
}

/**
 * Calculate detailed scoring breakdown for a contact.
 * Useful for displaying confidence factors in the UI.
 *
 * @param contact - The contact to score
 * @returns Detailed breakdown of scoring factors
 */
export function getScoreBreakdown(
  contact: ContactInfoJson,
): Array<{ factor: string; points: number; applied: boolean }> {
  const breakdown: Array<{ factor: string; points: number; applied: boolean }> =
    [];

  // Base factors
  const hasName = Boolean(contact.name?.trim());
  breakdown.push({ factor: "Name", points: 15, applied: hasName });

  const hasTitle = Boolean(contact.title?.trim());
  breakdown.push({ factor: "Title", points: 10, applied: hasTitle });

  const hasEmail = Boolean(contact.email?.includes("@"));
  breakdown.push({ factor: "Email", points: 25, applied: hasEmail });

  const phoneDigits = contact.phone?.replace(/\D/g, "") ?? "";
  const hasPhone = phoneDigits.length >= 10;
  breakdown.push({ factor: "Phone", points: 25, applied: hasPhone });

  // Cross-source validation factors
  const crossSourceVerified = Boolean(
    contact.provenance?.cross_source_verified,
  );
  breakdown.push({
    factor: "Cross-source verified",
    points: 10,
    applied: crossSourceVerified,
  });

  const addressMatchScore = contact.provenance?.enformion?.address_match_score;
  const hasAddressMatch =
    typeof addressMatchScore === "number" && addressMatchScore >= 50;
  breakdown.push({
    factor: "Address match",
    points: 5,
    applied: hasAddressMatch,
  });

  const identityScore = contact.provenance?.enformion?.identity_score;
  const hasIdentityScore =
    typeof identityScore === "number" &&
    identityScore >= CROSS_VALIDATION_SCORES.IDENTITY_SCORE_THRESHOLD;
  breakdown.push({
    factor: "Identity confidence",
    points: 5,
    applied: hasIdentityScore,
  });

  const hasBusinessRole = Boolean(contact.provenance?.business_role);
  breakdown.push({
    factor: "Business role verified",
    points: 5,
    applied: hasBusinessRole,
  });

  return breakdown;
}

/**
 * Check if a contact meets the completeness threshold.
 * A contact is complete if it has:
 * - A name, AND
 * - Either a valid email OR a phone number
 *
 * @param contact - The contact to check
 * @returns True if the contact meets minimum completeness criteria
 */
export function isContactComplete(contact: ContactInfoJson): boolean {
  const hasName = Boolean(contact.name?.trim());
  const hasEmail = Boolean(contact.email?.includes("@"));
  const phoneDigits = contact.phone?.replace(/\D/g, "") ?? "";
  const hasPhone = phoneDigits.length >= 10;

  // Complete if has name AND (email OR phone)
  return hasName && (hasEmail || hasPhone);
}

/**
 * Check if a contact has high quality (score >= threshold).
 *
 * @param contact - The contact to check
 * @param threshold - Minimum score threshold (caller must specify)
 * @returns True if the contact meets the quality threshold
 */
export function isHighQualityContact(
  contact: ContactInfoJson,
  threshold: number,
): boolean {
  return calculateQualityScore(contact) >= threshold;
}

/**
 * Count how many contacts in a list are "complete".
 *
 * @param contacts - Array of contacts to evaluate
 * @returns Number of complete contacts
 */
export function countCompleteContacts(contacts: ContactInfoJson[]): number {
  return contacts.filter(isContactComplete).length;
}

/**
 * Check if enrichment should stop.
 * Always returns false — the agent runs until MAX_STEPS to maximize
 * the chance of finding a verified mobile number for the owner.
 *
 * @param _contacts - Unused; kept for interface compatibility
 * @returns Always false
 */
export function shouldStopEnrichment(_contacts: ContactInfoJson[]): boolean {
  return false;
}

/**
 * Get a summary of contact quality for a list of contacts.
 * Useful for agent decision-making.
 *
 * @param contacts - Array of contacts to summarize
 * @returns Quality summary object
 */
export function getQualitySummary(contacts: ContactInfoJson[]): {
  totalContacts: number;
  completeContacts: number;
  averageScore: number;
  contactsWithEmail: number;
  contactsWithPhone: number;
  contactsWithAddressMatch: number;
  contactsCrossSourceVerified: number;
  contactsWithIdentityScore: number;
  contactsWithBusinessRole: number;
  shouldStop: boolean;
} {
  if (contacts.length === 0) {
    return {
      totalContacts: 0,
      completeContacts: 0,
      averageScore: 0,
      contactsWithEmail: 0,
      contactsWithPhone: 0,
      contactsWithAddressMatch: 0,
      contactsCrossSourceVerified: 0,
      contactsWithIdentityScore: 0,
      contactsWithBusinessRole: 0,
      shouldStop: false,
    };
  }

  const scores = contacts.map(calculateQualityScore);
  const totalScore = scores.reduce((sum, s) => sum + s, 0);

  // Count contacts with address match (Enformion verified local)
  const contactsWithAddressMatch = contacts.filter((c) => {
    const addressMatchScore = c.provenance?.enformion?.address_match_score;
    return typeof addressMatchScore === "number" && addressMatchScore >= 50;
  }).length;

  // Count contacts that are cross-source verified
  const contactsCrossSourceVerified = contacts.filter(
    (c) => c.provenance?.cross_source_verified,
  ).length;

  // Count contacts with high identity score
  const contactsWithIdentityScore = contacts.filter((c) => {
    const identityScore = c.provenance?.enformion?.identity_score;
    return (
      typeof identityScore === "number" &&
      identityScore >= CROSS_VALIDATION_SCORES.IDENTITY_SCORE_THRESHOLD
    );
  }).length;

  // Count contacts with verified business role
  const contactsWithBusinessRole = contacts.filter(
    (c) => c.provenance?.business_role,
  ).length;

  return {
    totalContacts: contacts.length,
    completeContacts: countCompleteContacts(contacts),
    averageScore: Math.round(totalScore / contacts.length),
    contactsWithEmail: contacts.filter((c) => c.email?.includes("@")).length,
    contactsWithPhone: contacts.filter(
      (c) => (c.phone?.replace(/\D/g, "") ?? "").length >= 10,
    ).length,
    contactsWithAddressMatch,
    contactsCrossSourceVerified,
    contactsWithIdentityScore,
    contactsWithBusinessRole,
    shouldStop: shouldStopEnrichment(contacts),
  };
}

/**
 * Identify which contacts need more enrichment (missing email or phone).
 *
 * @param contacts - Array of contacts to check
 * @returns Contacts that could benefit from further enrichment
 */
export function getContactsNeedingEnrichment(
  contacts: ContactInfoJson[],
): ContactInfoJson[] {
  return contacts.filter((contact) => {
    const hasEmail = Boolean(contact.email?.includes("@"));
    const phoneDigits = contact.phone?.replace(/\D/g, "") ?? "";
    const hasPhone = phoneDigits.length >= 10;

    // Needs enrichment if missing email OR phone
    return !hasEmail || !hasPhone;
  });
}
