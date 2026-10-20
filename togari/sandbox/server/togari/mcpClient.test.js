import { describe, it, expect, vi, beforeEach } from "vitest";

const callToolMock = vi.fn();
const connectMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(function () {
    return {
      connect: connectMock,
      callTool: callToolMock,
    };
  }),
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn(),
}));

describe("callTogariTool", () => {
  beforeEach(() => {
    vi.resetModules();
    callToolMock.mockReset();
    connectMock.mockClear();
  });

  it("throws when MCP is not configured", async () => {
    delete process.env.TOGARI_MCP_URL;
    const { callTogariTool } = await import("./mcpClient.js");
    await expect(
      callTogariTool("togari_ask", { question: "hi" }),
    ).rejects.toThrow("togari_not_configured");
  });

  it("parses JSON text content", async () => {
    process.env.TOGARI_MCP_URL = "https://example.com/mcp";
    callToolMock.mockResolvedValue({
      content: [{ type: "text", text: '{"client":{"name":"Acme"}}' }],
    });
    const { callTogariTool } = await import("./mcpClient.js");
    const { parsed } = await callTogariTool("togari_client_get", {
      client_id: "acme",
    });
    expect(parsed).toEqual({ client: { name: "Acme" } });
    delete process.env.TOGARI_MCP_URL;
  });

  it("retries once with a fresh connection after a transport error", async () => {
    process.env.TOGARI_MCP_URL = "https://example.com/mcp";
    callToolMock
      .mockRejectedValueOnce(new Error("session expired"))
      .mockResolvedValueOnce({ content: [{ type: "text", text: "answer" }] });
    const { callTogariTool } = await import("./mcpClient.js");
    const { parsed } = await callTogariTool("togari_ask", { question: "q" });
    expect(parsed).toBe("answer");
    expect(callToolMock).toHaveBeenCalledTimes(2);
    delete process.env.TOGARI_MCP_URL;
  });
});
