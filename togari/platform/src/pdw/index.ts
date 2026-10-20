/**
 * @togari/admin — Personal Data Warehouse (PDW)
 *
 * 360-degree relationship mapping across Gmail, Fireflies, Google Drive, and Loom.
 */

// Types
export * from './types';

// Core
export { IngestOrchestrator, SourceAdapter } from './ingest-orchestrator';
export { PersonResolver, emailToPersonId } from './person-resolver';
export { scoreRelationship } from './relationship-scorer';
export type { RelationshipScoreInput, RelationshipScoreBreakdown } from './relationship-scorer';

// Source adapters
export { GmailAdapter } from './adapters/gmail';
export { FirefliesAdapter } from './adapters/fireflies';
export { GDriveAdapter } from './adapters/gdrive';
export { LoomAdapter } from './adapters/loom';
