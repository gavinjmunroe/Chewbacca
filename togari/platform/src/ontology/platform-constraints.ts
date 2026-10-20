/**
 * @togari/admin — Platform constraints
 *
 * Per-platform character limits, daily volume caps, and format rules.
 * Product repos use these to validate content before submission.
 */

import type { Channel } from './enums';

// ============================================================================
// PLATFORM CHARACTER LIMITS
// ============================================================================

export interface PlatformConstraint {
  platform: string;
  maxCharacters: number;
  maxCharactersBeforeFold?: number;
  maxHashtags?: number;
  maxMentions?: number;
  mediaSupported: ('image' | 'video' | 'carousel' | 'document' | 'poll')[];
  maxMediaItems?: number;
  dailyVolumeCap?: number;
  notes?: string;
}

export const PLATFORM_CONSTRAINTS: Record<string, PlatformConstraint> = {
  linkedin_post: {
    platform: 'LinkedIn',
    maxCharacters: 3000,
    maxCharactersBeforeFold: 210,
    maxHashtags: 5,
    maxMentions: 10,
    mediaSupported: ['image', 'video', 'carousel', 'document', 'poll'],
    maxMediaItems: 20,
    notes: 'First 210 chars visible before "see more". Hook must land in that window.',
  },
  linkedin_dm: {
    platform: 'LinkedIn DM',
    maxCharacters: 8000,
    mediaSupported: ['image', 'document'],
    notes: 'Keep under 300 chars for cold outreach. Longer = lower response rate.',
  },
  cold_email: {
    platform: 'Email (Cold)',
    maxCharacters: 900,
    mediaSupported: [],
    dailyVolumeCap: 40,
    notes: 'Under 150 words ideal. Under 90 words for first touch. No images in cold email — deliverability risk.',
  },
  warm_email: {
    platform: 'Email (Warm)',
    maxCharacters: 2000,
    mediaSupported: ['image', 'document'],
    notes: 'Can be longer than cold. Still keep focused — one CTA.',
  },
  instagram_post: {
    platform: 'Instagram',
    maxCharacters: 2200,
    maxHashtags: 30,
    mediaSupported: ['image', 'video', 'carousel'],
    maxMediaItems: 10,
    notes: 'First 125 chars visible before fold. Hashtags in first comment preferred.',
  },
  instagram_dm: {
    platform: 'Instagram DM',
    maxCharacters: 1000,
    mediaSupported: ['image', 'video'],
    notes: 'Stub — no API connector yet.',
  },
  x_post: {
    platform: 'X/Twitter',
    maxCharacters: 280,
    maxHashtags: 3,
    mediaSupported: ['image', 'video', 'poll'],
    maxMediaItems: 4,
    notes: 'Threads supported but each post capped at 280. No carousel native.',
  },
  imessage: {
    platform: 'iMessage',
    maxCharacters: 20000,
    mediaSupported: ['image', 'video'],
    notes: 'No formal limit but keep short. Matches texting cadence.',
  },
};

// ============================================================================
// CHANNEL-TO-PLATFORM MAPPING
// ============================================================================

const CHANNEL_PLATFORM_MAP: Partial<Record<Channel, string>> = {
  bma_linkedin: 'linkedin_post',
  sagar_linkedin: 'linkedin_post',
  kevin_linkedin: 'linkedin_post',
  gartiwar: 'linkedin_post',
  caleb_personal: 'linkedin_post',
  linkedin_posting: 'linkedin_post',
  linkedin_dm: 'linkedin_dm',
  linkedin_outbound: 'linkedin_dm',
  cold_email: 'cold_email',
  warm_email: 'warm_email',
  instagram_dm: 'instagram_dm',
  instagram_posting: 'instagram_post',
  x_posting: 'x_post',
  imessage_dm: 'imessage',
  rytual: 'instagram_post',
};

/** Get platform constraints for a channel, or undefined if no mapping exists */
export function getChannelConstraints(channel: Channel): PlatformConstraint | undefined {
  const platformKey = CHANNEL_PLATFORM_MAP[channel];
  return platformKey ? PLATFORM_CONSTRAINTS[platformKey] : undefined;
}

/** Validate content length against platform constraints */
export function validateContentLength(channel: Channel, text: string): {
  valid: boolean;
  charCount: number;
  maxAllowed: number | null;
  overBy: number;
} {
  const constraints = getChannelConstraints(channel);
  if (!constraints) {
    return { valid: true, charCount: text.length, maxAllowed: null, overBy: 0 };
  }
  const over = Math.max(0, text.length - constraints.maxCharacters);
  return {
    valid: over === 0,
    charCount: text.length,
    maxAllowed: constraints.maxCharacters,
    overBy: over,
  };
}
