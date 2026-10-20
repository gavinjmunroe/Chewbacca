/**
 * Event type definitions for Cloud Pub/Sub.
 *
 * Every mutation in the system publishes an event to the `togari-events` topic.
 * Subscribers can use these to drive: real-time dashboards, webhook delivery,
 * triggered automations, audit trails, and cross-service integration.
 */

// ─── Base event envelope ────────────────────────────────────────────────────

export interface BaseEvent<T extends EventType = EventType> {
  /** UUID v4 — unique per event */
  event_id: string;
  /** Discriminator — determines the shape of `payload` */
  event_type: T;
  /** Tenant identifier from JWT or TENANT_ID */
  client_id: string;
  /** ISO 8601 timestamp when the event was created */
  timestamp: string;
  /** The user who triggered the event (JWT sub), or 'system' for automated flows */
  actor?: string;
  /** Event-specific data — shape depends on event_type */
  payload: EventPayloadMap[T];
}

// ─── Event type union ───────────────────────────────────────────────────────

export type EventType =
  | 'deal_created'
  | 'deal_updated'
  | 'deal_stage_changed'
  | 'contact_enriched'
  | 'sequence_sent'
  | 'pilot_updated';

// ─── Payload types per event ────────────────────────────────────────────────

export interface DealCreatedPayload {
  deal_id: string;
  deal_name: string;
  company: string;
  pipeline: 'partnerships' | 'inbound' | 'outbound';
  stage: string;
  owner: string;
  value: number | null;
  deal_source: string | null;
}

export interface DealUpdatedPayload {
  deal_id: string;
  fields_updated: string[];
  /** Snapshot of the updated field values */
  changes: Record<string, unknown>;
}

export interface DealStageChangedPayload {
  deal_id: string;
  deal_name: string;
  company: string;
  pipeline: string;
  previous_stage: string;
  new_stage: string;
  owner: string;
}

export interface ContactEnrichedPayload {
  contact_id: string;
  company_domain: string | null;
  source_apis: string[];
  status: 'success' | 'partial' | 'failed';
  cost_usd: number;
}

export interface SequenceSentPayload {
  channel: string;
  recipient_id: string;
  recipient_name: string | null;
  sequence_step: number;
  total_steps: number;
  message_type: string;
}

export interface PilotUpdatedPayload {
  deal_id: string;
  pilot_stage: string;
  metrics: Record<string, unknown>;
  health_score: number | null;
}

// ─── Payload map (discriminated union support) ──────────────────────────────

export interface EventPayloadMap {
  deal_created: DealCreatedPayload;
  deal_updated: DealUpdatedPayload;
  deal_stage_changed: DealStageChangedPayload;
  contact_enriched: ContactEnrichedPayload;
  sequence_sent: SequenceSentPayload;
  pilot_updated: PilotUpdatedPayload;
}

// ─── Typed event constructors (for convenience) ─────────────────────────────

export type DealCreatedEvent = BaseEvent<'deal_created'>;
export type DealUpdatedEvent = BaseEvent<'deal_updated'>;
export type DealStageChangedEvent = BaseEvent<'deal_stage_changed'>;
export type ContactEnrichedEvent = BaseEvent<'contact_enriched'>;
export type SequenceSentEvent = BaseEvent<'sequence_sent'>;
export type PilotUpdatedEvent = BaseEvent<'pilot_updated'>;

/** Any event that flows through the togari-events topic */
export type TogariEvent =
  | DealCreatedEvent
  | DealUpdatedEvent
  | DealStageChangedEvent
  | ContactEnrichedEvent
  | SequenceSentEvent
  | PilotUpdatedEvent;
