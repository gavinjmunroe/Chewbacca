/**
 * @togari/admin — Ingest Orchestrator
 *
 * Coordinates incremental data ingestion from any source adapter:
 * fetch -> transform -> extract persons -> dedupe -> store to GCS + BigQuery.
 */

import { BigQuery } from '@google-cloud/bigquery';
import { Storage } from '@google-cloud/storage';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../observability/logger';
import { PersonResolver } from './person-resolver';
import type {
  Interaction,
  Person,
  IngestSource,
  IngestionRun,
  RawRecord,
  IngestRunSummary,
} from './types';

const logger = createLogger('IngestOrchestrator');

const PDW_DATASET = 'togari_pdw';
const PDW_BUCKET = 'togari-pdw';

// ---------------------------------------------------------------------------
// Abstract source adapter
// ---------------------------------------------------------------------------

export abstract class SourceAdapter {
  abstract readonly source: IngestSource;

  /** Fetch records since the last watermark. null = full initial sync. */
  abstract fetchIncremental(watermark: string | null): Promise<RawRecord[]>;

  /** Transform raw records into normalized Interaction records. */
  abstract transform(raw: RawRecord[]): Promise<Interaction[]>;

  /** Extract Person stubs from interactions (name, email, etc.) */
  abstract extractPersons(interactions: Interaction[]): Promise<Person[]>;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class IngestOrchestrator {
  private bq: BigQuery;
  private storage: Storage;
  private adapter: SourceAdapter;
  private ownerId: string;
  private resolver: PersonResolver;

  constructor(
    bq: BigQuery,
    storage: Storage,
    adapter: SourceAdapter,
    ownerId: string,
  ) {
    this.bq = bq;
    this.storage = storage;
    this.adapter = adapter;
    this.ownerId = ownerId;
    this.resolver = new PersonResolver(bq, ownerId, PDW_DATASET);
  }

  /**
   * Execute a full incremental ingest run.
   */
  async run(): Promise<IngestRunSummary> {
    const runId = uuidv4();
    const startedAt = new Date().toISOString();
    let recordsProcessed = 0;
    let recordsFailed = 0;
    let newPersons = 0;
    let updatedPersons = 0;
    let watermark: string | null = null;

    // 1. Record run start
    const ingestionRun: IngestionRun = {
      run_id: runId,
      owner_id: this.ownerId,
      source: this.adapter.source,
      status: 'running',
      records_processed: 0,
      records_failed: 0,
      started_at: startedAt,
      completed_at: null,
      error_message: null,
      watermark: null,
    };
    await this.insertIngestionRun(ingestionRun);

    try {
      // 2. Get last watermark from most recent successful ingestion_run
      const lastWatermark = await this.getLastWatermark();
      logger.info(
        `Starting ingest run ${runId} for ${this.adapter.source} (watermark: ${lastWatermark ?? 'none'})`,
      );

      // 3. Fetch incremental
      const rawRecords = await this.adapter.fetchIncremental(lastWatermark);
      logger.info(`Fetched ${rawRecords.length} raw records from ${this.adapter.source}`);

      if (rawRecords.length === 0) {
        await this.updateIngestionRun(runId, {
          status: 'completed',
          records_processed: 0,
          records_failed: 0,
          completed_at: new Date().toISOString(),
          watermark: lastWatermark,
        });
        return {
          run_id: runId,
          source: this.adapter.source,
          status: 'completed',
          records_processed: 0,
          records_failed: 0,
          new_persons: 0,
          updated_persons: 0,
          new_interactions: 0,
          duration_ms: Date.now() - new Date(startedAt).getTime(),
          watermark: lastWatermark,
        };
      }

      // 4. Transform raw -> interactions
      const interactions = await this.adapter.transform(rawRecords);

      // 5. Extract persons from interactions
      const extractedPersons = await this.adapter.extractPersons(interactions);

      // 6. Load existing person index and deduplicate
      await this.resolver.loadIndex();
      const dedupedPersons = this.resolver.deduplicatePersons(extractedPersons);

      // Resolve person IDs and track new vs updated
      for (const person of dedupedPersons) {
        const resolution = this.resolver.resolvePersonId(
          person.email_addresses[0] ?? '',
        );
        person.person_id = resolution.person_id;
        if (resolution.is_new) {
          newPersons++;
        } else {
          updatedPersons++;
        }
      }

      // 7. Store raw content to GCS
      for (const raw of rawRecords) {
        try {
          const occurredAt = new Date(raw.fetched_at);
          const year = occurredAt.getFullYear();
          const month = String(occurredAt.getMonth() + 1).padStart(2, '0');
          const gcsPath = `${this.ownerId}/${this.adapter.source}/${year}/${month}/${raw.source_id}.json`;
          const bucket = this.storage.bucket(PDW_BUCKET);
          await bucket.file(gcsPath).save(JSON.stringify(raw.raw_data), {
            contentType: 'application/json',
          });
        } catch (err) {
          logger.error(`Failed to upload raw record ${raw.source_id} to GCS`, err);
          recordsFailed++;
        }
      }

      // 8. Upsert persons to BigQuery via MERGE
      await this.upsertPersons(dedupedPersons);

      // 9. Insert interactions to BigQuery
      await this.insertInteractions(interactions);
      recordsProcessed = interactions.length;

      // Determine new watermark from raw records
      watermark = this.computeWatermark(rawRecords);

      // 10. Update ingestion_runs
      await this.updateIngestionRun(runId, {
        status: 'completed',
        records_processed: recordsProcessed,
        records_failed: recordsFailed,
        completed_at: new Date().toISOString(),
        watermark,
      });

      logger.info(
        `Ingest run ${runId} completed: ${recordsProcessed} processed, ${recordsFailed} failed, ${newPersons} new persons`,
      );

      return {
        run_id: runId,
        source: this.adapter.source,
        status: 'completed',
        records_processed: recordsProcessed,
        records_failed: recordsFailed,
        new_persons: newPersons,
        updated_persons: updatedPersons,
        new_interactions: interactions.length,
        duration_ms: Date.now() - new Date(startedAt).getTime(),
        watermark,
      };
    } catch (err) {
      logger.error(`Ingest run ${runId} failed`, err);
      await this.updateIngestionRun(runId, {
        status: 'failed',
        records_processed: recordsProcessed,
        records_failed: recordsFailed,
        completed_at: new Date().toISOString(),
        error_message: err instanceof Error ? err.message : String(err),
        watermark,
      });
      return {
        run_id: runId,
        source: this.adapter.source,
        status: 'failed',
        records_processed: recordsProcessed,
        records_failed: recordsFailed,
        new_persons: newPersons,
        updated_persons: updatedPersons,
        new_interactions: 0,
        duration_ms: Date.now() - new Date(startedAt).getTime(),
        watermark,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async getLastWatermark(): Promise<string | null> {
    const query = `
      SELECT watermark
      FROM \`${PDW_DATASET}.ingestion_runs\`
      WHERE owner_id = @ownerId
        AND source = @source
        AND status = 'completed'
        AND watermark IS NOT NULL
      ORDER BY completed_at DESC
      LIMIT 1
    `;
    const [rows] = await this.bq.query({
      query,
      params: { ownerId: this.ownerId, source: this.adapter.source },
    });
    if (rows.length > 0) {
      return (rows[0] as { watermark: string }).watermark;
    }
    return null;
  }

  private async insertIngestionRun(run: IngestionRun): Promise<void> {
    await this.bq
      .dataset(PDW_DATASET)
      .table('ingestion_runs')
      .insert([run]);
  }

  private async updateIngestionRun(
    runId: string,
    updates: Partial<IngestionRun>,
  ): Promise<void> {
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { runId };

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        setClauses.push(`${key} = @${key}`);
        params[key] = value;
      }
    }

    if (setClauses.length === 0) return;

    const query = `
      UPDATE \`${PDW_DATASET}.ingestion_runs\`
      SET ${setClauses.join(', ')}
      WHERE run_id = @runId
    `;
    await this.bq.query({ query, params });
  }

  private async upsertPersons(persons: Person[]): Promise<void> {
    if (persons.length === 0) return;

    // Use BigQuery MERGE for upsert
    // Create a temporary table with incoming data, then merge
    const tempTableId = `_temp_persons_${Date.now()}`;
    const dataset = this.bq.dataset(PDW_DATASET);

    // Insert into temp table
    const tempTable = dataset.table(tempTableId);
    try {
      await dataset.createTable(tempTableId, {
        schema: {
          fields: [
            { name: 'person_id', type: 'STRING' },
            { name: 'owner_id', type: 'STRING' },
            { name: 'full_name', type: 'STRING' },
            { name: 'email_addresses', type: 'STRING', mode: 'REPEATED' },
            { name: 'phone_numbers', type: 'STRING', mode: 'REPEATED' },
            { name: 'linkedin_url', type: 'STRING' },
            { name: 'company', type: 'STRING' },
            { name: 'title', type: 'STRING' },
            { name: 'relationship_score', type: 'FLOAT64' },
            { name: 'last_interaction_at', type: 'TIMESTAMP' },
            { name: 'first_interaction_at', type: 'TIMESTAMP' },
            { name: 'interaction_count', type: 'INT64' },
            { name: 'tags', type: 'STRING', mode: 'REPEATED' },
            { name: 'metadata', type: 'JSON' },
            { name: 'created_at', type: 'TIMESTAMP' },
            { name: 'updated_at', type: 'TIMESTAMP' },
          ],
        },
      });

      await tempTable.insert(
        persons.map((p) => ({
          ...p,
          metadata: p.metadata ? JSON.stringify(p.metadata) : null,
        })),
      );

      const mergeQuery = `
        MERGE \`${PDW_DATASET}.persons\` AS target
        USING \`${PDW_DATASET}.${tempTableId}\` AS source
        ON target.person_id = source.person_id AND target.owner_id = source.owner_id
        WHEN MATCHED THEN UPDATE SET
          full_name = COALESCE(source.full_name, target.full_name),
          email_addresses = source.email_addresses,
          phone_numbers = source.phone_numbers,
          linkedin_url = COALESCE(source.linkedin_url, target.linkedin_url),
          company = COALESCE(source.company, target.company),
          title = COALESCE(source.title, target.title),
          last_interaction_at = GREATEST(source.last_interaction_at, target.last_interaction_at),
          first_interaction_at = LEAST(source.first_interaction_at, target.first_interaction_at),
          interaction_count = target.interaction_count + source.interaction_count,
          tags = source.tags,
          metadata = source.metadata,
          updated_at = CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN INSERT ROW
      `;
      await this.bq.query({ query: mergeQuery });
    } finally {
      // Clean up temp table
      try {
        await tempTable.delete();
      } catch {
        logger.warn(`Failed to delete temp table ${tempTableId}`);
      }
    }
  }

  private async insertInteractions(interactions: Interaction[]): Promise<void> {
    if (interactions.length === 0) return;

    // Batch insert (BigQuery supports up to 10,000 rows per insert)
    const batchSize = 5000;
    const table = this.bq.dataset(PDW_DATASET).table('interactions');

    for (let i = 0; i < interactions.length; i += batchSize) {
      const batch = interactions.slice(i, i + batchSize).map((ix) => ({
        ...ix,
        source_metadata: ix.source_metadata ? JSON.stringify(ix.source_metadata) : null,
      }));
      await table.insert(batch);
    }
  }

  private computeWatermark(rawRecords: RawRecord[]): string {
    // Use the latest fetched_at timestamp as watermark
    let latest = '';
    for (const r of rawRecords) {
      if (r.fetched_at > latest) latest = r.fetched_at;
    }
    return latest;
  }
}
