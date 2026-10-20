/**
 * Types for one-prompt per-client warehouse provisioning.
 *
 * A ProvisionPlan is the structured output of the natural-language planner:
 * describe a client in plain English ("Joe runs a PR firm; pipelines: media
 * outreach and retainer clients; track outlet, journalist, angle, embargo
 * date") and get back the pipelines + stages + custom data-point fields that
 * make up that client's warehouse structure.
 *
 * Nothing here is DDL. Pipelines and stages become rows in
 * togari_data_lake.pipeline_stages; custom fields become rows via the
 * SchemaRegistry (custom_field_defs). Provisioning is additive and idempotent.
 */

/** A custom field value type, matching the SchemaRegistry FieldType set. */
export type ProvisionFieldType = "string" | "number" | "date" | "bool" | "json";

/** One stage in a pipeline, e.g. { name: "outreach", order: 1 }. */
export interface ProvisionStage {
  name: string;
  order: number;
  description?: string;
}

/** One pipeline and its ordered stages, e.g. "media outreach". */
export interface ProvisionPipeline {
  name: string;
  stages: ProvisionStage[];
}

/** One custom data-point field to attach to an entity (deal/contact/company). */
export interface ProvisionField {
  entity: string;
  fieldName: string;
  fieldType: ProvisionFieldType;
  description?: string;
}

/**
 * The full proposed warehouse structure for a client. Produced by the planner,
 * consumed by the service. Purely declarative: no side effects live here.
 */
export interface ProvisionPlan {
  clientId: string;
  /** Client display name the planner identified from the description, if any. */
  clientName?: string;
  pipelines: ProvisionPipeline[];
  fields: ProvisionField[];
  notes?: string;
}

/** The outcome of actually provisioning a plan against BigQuery. */
export interface ProvisionResult {
  clientId: string;
  stagesCreated: number;
  fieldsCreated: number;
  plan: ProvisionPlan;
  /** Per-pipeline stage-write errors (e.g. a table's row access policy). Empty on success. */
  stageErrors: string[];
}
