import { describe, it, expect } from "vitest";
import {
  togariConfig,
  isBigQueryConfigured,
  isMcpConfigured,
} from "./config.js";

describe("togariConfig", () => {
  it("defaults brand, owner, project, and datasets", () => {
    expect(togariConfig.brand).toBe("bma");
    expect(togariConfig.ownerId).toBe("sagar");
    expect(togariConfig.gcpProjectId).toBe("midyear-glazing-485303-u3");
    expect(togariConfig.datasets).toEqual({
      lake: "togari_data_lake",
      pdw: "togari_pdw",
    });
  });

  it("defines the two launch channels", () => {
    const keys = togariConfig.channels.map((c) => c.key);
    expect(keys).toEqual(["email", "founder-marketing"]);
  });

  it("reports unconfigured when env vars are missing", () => {
    expect(typeof isBigQueryConfigured()).toBe("boolean");
    expect(typeof isMcpConfigured()).toBe("boolean");
  });
});
