import { describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";
import type { ProjectService } from "../src/projectService.js";

const token = "test-token-0123456789";
const service: ProjectService = {
  listProjects: async () => [{ id: "P033", name: "GrandeGPT", directory: "P033-GrandeGPT" }],
  getProjectStructure: async () => ({ entries: [{ path: "PRD.md", kind: "file" }], truncated: false }),
  readProjectDocument: async () => ({ content: "# PRD\n", sha256: "0".repeat(64), totalBytes: 6, truncated: false }),
  searchProject: async () => ({ results: [], truncated: false }),
};

function rpcHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    host: "127.0.0.1:8788",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...extra,
  };
}

describe("MCP HTTP server", () => {
  it("fails closed on missing bearer, unlisted Origin, and non-loopback Host", async () => {
    const app = createApp({ service, token, allowedOrigins: [] });
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

    expect((await app.request("/mcp", { method: "POST", headers: { host: "127.0.0.1:8788", "content-type": "application/json" }, body })).status).toBe(401);
    expect((await app.request("/mcp", { method: "POST", headers: rpcHeaders({ origin: "https://evil.example" }), body })).status).toBe(403);
    expect((await app.request("/mcp", { method: "POST", headers: rpcHeaders({ host: "evil.example" }), body })).status).toBe(403);
  });

  it("serves the exact four read tools through Streamable HTTP MCP", async () => {
    const app = createApp({ service, token, allowedOrigins: [] });
    const response = await app.request("/mcp", {
      method: "POST",
      headers: rpcHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    for (const name of ["list_projects", "get_project_structure", "read_project_document", "search_project"]) {
      expect(text).toContain(name);
    }
    expect(text).not.toContain("create_project_document");
    expect(text).not.toContain("update_project_document");
  });
});
