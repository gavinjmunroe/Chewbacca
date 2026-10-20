/**
 * @togari/admin — Event types (extensible)
 */

export type EventType =
  | 'deal_created'
  | 'deal_updated'
  | 'deal_stage_changed'
  | 'contact_enriched'
  | 'sequence_sent'
  | 'pilot_updated'
  | 'person_created'
  | 'person_updated'
  | 'person_scored'
  | 'enrichment_completed'
  | 'campaign_created'
  | 'touchpoint_logged'
  | 'content_generated'
  | 'content_published'
  | string; // extensible for product-specific events

export interface BaseEvent<T = unknown> {
  event_id: string;
  event_type: EventType;
  client_id: string;
  timestamp: string;
  actor?: string;
  payload: T;
}
