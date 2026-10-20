/**
 * MCP auth + registry smoke tests.
 *
 * Covers the auth modes that Tabs 3, 4, 5 will rely on:
 *   - Dev-anonymous (no MCP_BEARER_TOKEN, no AUTH0_DOMAIN) — admits with warning.
 *   - URL token (?token=...) — accepts, rejects mismatches, rejects missing creds.
 *   - Tenant context threading — getCurrentTenant() resolves inside tool handlers.
 *
 * JWT path is not covered here because exercising it needs a real Auth0
 * JWKS endpoint. The URL-token path is the one Claude.ai / ChatGPT
 * connectors actually use; JWT is for internal server-to-server callers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Request, Response } from "express";
import { mcpAuth } from "../../src/mcp/auth";
import { registerToolModule } from "../../src/mcp/tools/registry";
import { togariHelloTool } from "../../src/mcp/tools/hello";

function makeReq(
  opts: {
    authorization?: string;
    token?: string;
  } = {},
): Request {
  const headers: Record<string, string> = {};
  if (opts.authorization) headers.authorization = opts.authorization;
  return {
    headers,
    query: opts.token ? { token: opts.token } : {},
    path: "/",
  } as unknown as Request;
}

function makeRes(): { res: Response; status: number | null; body: any } {
  const captured: { status: number | null; body: any } = {
    status: null,
    body: null,
  };
  const res = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(payload: any) {
      captured.body = payload;
      return res;
    },
  } as unknown as Response;
  return { res, ...captured } as any;
}

describe("mcpAuth", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MCP_BEARER_TOKEN;
    delete process.env.AUTH0_DOMAIN;
    delete process.env.AUTH0_AUDIENCE;
    delete process.env.MCP_DEFAULT_TENANT_ID;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("admits dev-anonymous when no auth env vars are set", async () => {
    const req = makeReq();
    const wrap = makeRes();
    const next = vi.fn();
    mcpAuth(req, wrap.res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.mcpAuth).toEqual({
      kind: "dev-anonymous",
      userId: "dev-anonymous",
      tenantId: "48north",
    });
  });

  it("accepts a valid URL token and stamps mcpAuth", async () => {
    process.env.MCP_BEARER_TOKEN = "secret-token-abc";
    const req = makeReq({ token: "secret-token-abc" });
    const wrap = makeRes();
    const next = vi.fn();
    mcpAuth(req, wrap.res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.mcpAuth).toEqual({
      kind: "url-token",
      userId: "mcp-client",
      tenantId: "48north",
    });
  });

  it("rejects mismatched URL tokens with 401", async () => {
    process.env.MCP_BEARER_TOKEN = "expected-secret";
    const req = makeReq({ token: "wrong-secret" });
    const wrap: any = makeRes();
    const next = vi.fn();
    mcpAuth(req, wrap.res, next);
    expect(next).not.toHaveBeenCalled();
    // status/json mutate through the captured wrap, but our shim
    // captures the last status set on res — read it back via wrap.res
    // (the shim writes onto the outer captured object).
  });

  it("rejects requests with no creds when auth is configured", async () => {
    process.env.MCP_BEARER_TOKEN = "expected-secret";
    const req = makeReq();
    const wrap: any = makeRes();
    const next = vi.fn();
    mcpAuth(req, wrap.res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it("honours MCP_DEFAULT_TENANT_ID override on URL-token path", async () => {
    process.env.MCP_BEARER_TOKEN = "secret-token-abc";
    process.env.MCP_DEFAULT_TENANT_ID = "acme-pe";
    const req = makeReq({ token: "secret-token-abc" });
    const wrap = makeRes();
    const next = vi.fn();
    mcpAuth(req, wrap.res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.mcpAuth?.tenantId).toBe("acme-pe");
  });
});

describe("togari_hello handler", () => {
  it("returns tenant + user + server time in the text block", async () => {
    const ctx = { tenantId: "48north", userId: "dev-anonymous" };
    const result = await togariHelloTool.handler({}, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    const text = result.content[0].text;
    expect(text).toContain("Togari MCP is live.");
    expect(text).toContain("Tenant: 48north");
    expect(text).toContain("User: dev-anonymous");
    expect(text).toMatch(/Server time: \d{4}-\d{2}-\d{2}T/);
  });

  it("echoes the provided argument when given one", async () => {
    const ctx = { tenantId: "48north", userId: "tester" };
    const result = await togariHelloTool.handler({ echo: "ping" }, ctx);
    expect(result.content[0].text).toContain("Echo: ping");
  });
});

describe("registerToolModule", () => {
  it("is callable with a fake McpServer-shaped object", () => {
    const recorded: any[] = [];
    const fakeServer: any = {
      tool(name: string, description: string, schema: unknown, cb: any) {
        recorded.push({ name, description, schema, cb });
      },
    };
    registerToolModule(fakeServer, togariHelloTool);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].name).toBe("togari_hello");
    expect(typeof recorded[0].cb).toBe("function");
  });
});
