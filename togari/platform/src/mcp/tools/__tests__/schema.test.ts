import { describe, it, expect } from "vitest";
import { queueBqRows, getMockState } from "../../../../tests/smoke/helpers";
import { BigQueryClient } from "../../../bigquery/client";
import {
  buildAddFieldTool,
  buildListFieldsTool,
  buildSetValueTool,
  buildGetTool,
} from "../schema";

const CTX = { tenantId: "bma", userId: "test-user" };

function makeBq() {
  return new BigQueryClient("test-project", null, null);
}

describe("togari_schema_add_field", () => {
  const tool = buildAddFieldTool({ bq: makeBq() });

  it("inserts a def when the field does not exist yet", async () => {
    // resolveFieldId SELECT returns no rows -> triggers INSERT
    queueBqRows([]);
    const before = getMockState().bq.writes.length;
    const result = await tool.handler(
      { entity: "deal", field_name: "Deal Score", field_type: "number" },
      CTX,
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Defined custom field");
    expect(getMockState().bq.writes.length).toBe(before + 1);

    const write = getMockState().bq.writes.at(-1);
    expect(write.sql.trim().toUpperCase().startsWith("INSERT")).toBe(true);
    expect(write.sql).toContain("custom_field_defs");
    // free-text name normalized to snake_case
    expect(write.params.fieldName).toBe("deal_score");
    expect(write.params.fieldType).toBe("number");
    expect(write.params.clientId).toBe("bma");
  });

  it("skips the insert when the def already exists (idempotent)", async () => {
    queueBqRows([{ field_id: "f_existing" }]);
    const before = getMockState().bq.writes.length;
    const result = await tool.handler(
      { entity: "deal", field_name: "deal_score" },
      CTX,
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("already existed");
    expect(getMockState().bq.writes.length).toBe(before);
  });

  it("rejects an invalid entity", async () => {
    const result = await tool.handler(
      { entity: "widget" as any, field_name: "x" },
      CTX,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid arguments");
  });
});

describe("togari_schema_set_value", () => {
  const tool = buildSetValueTool({ bq: makeBq() });

  it("auto-defines the field then merges the value", async () => {
    // defineField -> resolveFieldId SELECT returns nothing -> INSERT def, then MERGE value
    queueBqRows([]);
    const before = getMockState().bq.writes.length;
    const result = await tool.handler(
      {
        entity: "deal",
        entity_id: "deal_1",
        field_name: "priority",
        value: "high",
      },
      CTX,
    );
    expect(result.isError).toBeFalsy();
    // one INSERT (def) + one MERGE (value)
    expect(getMockState().bq.writes.length).toBe(before + 2);

    const [defW, valueW] = getMockState().bq.writes.slice(-2);
    expect(defW.sql.trim().toUpperCase().startsWith("INSERT")).toBe(true);
    expect(defW.sql).toContain("custom_field_defs");

    expect(valueW.sql.trim().toUpperCase().startsWith("MERGE")).toBe(true);
    expect(valueW.sql).toContain("custom_field_values");
    expect(valueW.params.valueString).toBe("high");
    expect(valueW.params.fieldName).toBe("priority");
    expect(valueW.params.entityId).toBe("deal_1");
  });

  it("honors the registered number type and stores in value_number", async () => {
    // Registered field is a number -> value routes to value_number.
    queueBqRows([{ field_id: "f_score", field_type: "number" }]);
    const before = getMockState().bq.writes.length;
    await tool.handler(
      { entity: "deal", entity_id: "deal_2", field_name: "score", value: 42 },
      CTX,
    );
    // def already exists -> only the MERGE write
    expect(getMockState().bq.writes.length).toBe(before + 1);
    const valueW = getMockState().bq.writes.at(-1);
    expect(valueW.params.valueNumber).toBe(42);
    // Inactive value columns now use typed NULL literals in SQL, not params,
    // so only the active column's param is present.
    expect(valueW.params.valueString).toBeUndefined();
    expect(valueW.sql).toContain("CAST(NULL AS STRING)");
  });
});

describe("togari_schema_list_fields", () => {
  const tool = buildListFieldsTool({ bq: makeBq() });

  it("renders a markdown table of defs", async () => {
    queueBqRows([
      {
        field_id: "f1",
        client_id: "bma",
        entity: "deal",
        field_name: "priority",
        field_type: "string",
        description: "how urgent",
        created_at: { value: "2026-07-10T00:00:00Z" },
        is_active: true,
      },
    ]);
    const result = await tool.handler({ entity: "deal" }, CTX);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("priority");
    const last = getMockState().bq.queries.at(-1);
    expect(last.sql).toContain("custom_field_defs");
    expect(last.params.entity).toBe("deal");
  });
});

describe("togari_schema_get", () => {
  const tool = buildGetTool({ bq: makeBq() });

  it("returns custom values for an entity", async () => {
    queueBqRows([
      {
        value_id: "v1",
        client_id: "bma",
        entity: "deal",
        entity_id: "deal_1",
        field_id: "f1",
        field_name: "priority",
        value_string: "high",
        value_number: null,
        value_bool: null,
        value_json: null,
        updated_at: { value: "2026-07-10T00:00:00Z" },
      },
    ]);
    const result = await tool.handler(
      { entity: "deal", entity_id: "deal_1" },
      CTX,
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("priority");
    expect(result.content[0].text).toContain("high");
  });
});
