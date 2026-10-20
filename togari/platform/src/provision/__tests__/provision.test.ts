import { describe, it, expect } from "vitest";
import {
  queueBqRows,
  getMockState,
  onFetch,
} from "../../../tests/smoke/helpers";
import { BigQueryClient } from "../../bigquery/client";
import { planClientWarehouse, defaultPlan } from "../planner";
import { ProvisionService } from "../service";

function makeBq() {
  return new BigQueryClient("test-project", null, null);
}

/** Build a fake Anthropic /v1/messages envelope wrapping `text`. */
function anthropicEnvelope(text: string) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

const PLAN_JSON = JSON.stringify({
  pipelines: [
    {
      name: "media outreach",
      stages: [
        { name: "pitched", order: 1 },
        { name: "placed", order: 2 },
        { name: "published", order: 3 },
      ],
    },
  ],
  fields: [
    { entity: "contact", fieldName: "outlet", fieldType: "string" },
    { entity: "deal", fieldName: "embargo_date", fieldType: "date" },
  ],
  notes: "PR firm structure.",
});

describe("planClientWarehouse", () => {
  it("returns the plan the model produces", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    onFetch("api.anthropic.com/v1/messages", () =>
      anthropicEnvelope(PLAN_JSON),
    );

    const plan = await planClientWarehouse({
      clientId: "joe",
      description: "Joe runs a PR firm.",
    });

    expect(plan.clientId).toBe("joe");
    expect(plan.pipelines).toHaveLength(1);
    expect(plan.pipelines[0].name).toBe("media outreach");
    expect(plan.pipelines[0].stages.map((s) => s.name)).toEqual([
      "pitched",
      "placed",
      "published",
    ]);
    expect(plan.fields.map((f) => f.fieldName)).toEqual([
      "outlet",
      "embargo_date",
    ]);
  });

  it("falls back to the default plan without an API key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const plan = await planClientWarehouse({
      clientId: "acme",
      description: "anything",
    });
    expect(plan).toEqual(defaultPlan("acme"));
    expect(plan.pipelines[0].name).toBe("clients");
  });
});

describe("ProvisionService.preview", () => {
  it("plans without writing anything", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    onFetch("api.anthropic.com/v1/messages", () =>
      anthropicEnvelope(PLAN_JSON),
    );

    const before = getMockState().bq.writes.length;
    const svc = new ProvisionService({ bq: makeBq() });
    const plan = await svc.preview({
      clientId: "joe",
      description: "Joe runs a PR firm.",
    });

    expect(plan.pipelines[0].name).toBe("media outreach");
    expect(getMockState().bq.writes.length).toBe(before);
  });
});

describe("ProvisionService.provision", () => {
  it("inserts pipeline_stages and defines custom fields", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    onFetch("api.anthropic.com/v1/messages", () =>
      anthropicEnvelope(PLAN_JSON),
    );

    // Queue order matches the read sequence in provision():
    //   1. existingStageNames SELECT for "media outreach" -> 0 existing stages
    //   2. defineField -> resolveFieldId SELECT for "outlet"        -> no rows
    //   3. defineField -> resolveFieldId SELECT for "embargo_date"  -> no rows
    queueBqRows([]); // no existing stages -> seeding proceeds
    queueBqRows([]); // outlet def does not exist -> INSERT
    queueBqRows([]); // embargo_date def does not exist -> INSERT

    const before = getMockState().bq.writes.length;
    const svc = new ProvisionService({ bq: makeBq() });
    const result = await svc.provision({
      clientId: "joe",
      description: "Joe runs a PR firm.",
    });

    // 1 stages INSERT + 2 field-def INSERTs
    expect(getMockState().bq.writes.length).toBe(before + 3);
    expect(result.stagesCreated).toBe(3);
    expect(result.fieldsCreated).toBe(2);

    const writes = getMockState().bq.writes.slice(-3);
    const stageWrite = writes[0];
    expect(stageWrite.sql.trim().toUpperCase().startsWith("INSERT")).toBe(true);
    expect(stageWrite.sql).toContain("pipeline_stages");
    expect(stageWrite.params.pipeline).toBe("media outreach");
    expect(stageWrite.params.stageName1).toBe("pitched");
    expect(stageWrite.params.clientId).toBe("joe");

    const fieldWrites = writes.slice(1);
    for (const w of fieldWrites) {
      expect(w.sql).toContain("custom_field_defs");
    }
    expect(fieldWrites.map((w) => w.params.fieldName)).toEqual([
      "outlet",
      "embargo_date",
    ]);
  });

  it("skips stages that already exist (idempotent)", async () => {
    delete process.env.ANTHROPIC_API_KEY; // default plan: clients / lead,active,closed

    // existingStageNames SELECT for "clients" -> all three already present
    queueBqRows([
      { stage_name: "lead" },
      { stage_name: "active" },
      { stage_name: "closed" },
    ]);
    // default plan fields: deal.source, contact.role -> both already exist
    queueBqRows([{ field_id: "f_source" }]);
    queueBqRows([{ field_id: "f_role" }]);

    const before = getMockState().bq.writes.length;
    const svc = new ProvisionService({ bq: makeBq() });
    const result = await svc.provision({
      clientId: "acme",
      description: "anything",
    });

    expect(getMockState().bq.writes.length).toBe(before);
    expect(result.stagesCreated).toBe(0);
    expect(result.fieldsCreated).toBe(0);
  });
});
