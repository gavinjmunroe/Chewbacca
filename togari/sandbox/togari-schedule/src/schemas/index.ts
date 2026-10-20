/**
 * @togari/bma-content/schemas
 * Central export for all BMA GTM OS schemas
 */

// Enums — the foundation everything else references
export * from './enums';

// Signal generation (4-step process)
export * from './signal-package';

// Email templates (per-persona drafts, review checklists, replies)
export * from './email-templates';

// Relationship records (person-centric BigQuery rows)
export * from './relationship-record';

// Meeting briefs and debriefs
export * from './meeting-brief';

// Shared state layer (pipeline, campaign, content, team)
export * from './pipeline-state';

// Content briefs, carousels, brand system, metrics
export * from './content-brief';

// GLM Conscience Check reports
export * from './conscience-report';

// Opportunity Engine V2 (Signal Subscriptions + One-Time Data Pulls)
export * from './opportunity-engine';
