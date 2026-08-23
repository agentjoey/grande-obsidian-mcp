import { describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";
import type { ProjectService } from "../src/projectService.js";
import { WriteDomainError } from "../src/writeErrors.js";

const token = "test-token-0123456789";
const service: ProjectService = {
  listProjects: async () => [{ id: "P033", name: "GrandeGPT", directory: "P033-GrandeGPT" }],
  getProjectStructure: async () => ({ entries: [{ path: "PRD.md", kind: "file" }], truncated: false }),
  readProjectDocument: async () => ({ content: "# PRD\n", sha256: "0".repeat(64), totalBytes: 6, truncated: false }),
  searchProject: async () => ({ results: [], truncated: false }),
  createProjectDocument: async (_project, path, content) => ({ path, sha256: "1".repeat(64), totalBytes: Buffer.byteLength(content) }),
  updateProjectDocument: async (_project, path, content) => ({ path, sha256: "2".repeat(64), totalBytes: Buffer.byteLength(content) }),
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

async function rpc(app: ReturnType<typeof createApp>, method: string, params: Record<string, unknown>) {
  return app.request("/mcp", {
    method: "POST",
    headers: rpcHeaders(),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

describe("MCP HTTP server", () => {
  it("fails closed on missing bearer, unlisted Origin, and non-loopback Host", async () => {
    const app = createApp({ service, token, allowedOrigins: [] });
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

    expect((await app.request("/mcp", { method: "POST", headers: { host: "127.0.0.1:8788", "content-type": "application/json" }, body })).status).toBe(401);
    expect((await app.request("/mcp", { method: "POST", headers: rpcHeaders({ origin: "https://evil.example" }), body })).status).toBe(403);
    expect((await app.request("/mcp", { method: "POST", headers: rpcHeaders({ host: "evil.example" }), body })).status).toBe(403);
  });

  it("serves exactly the four read tools plus Safe Create through Streamable HTTP MCP", async () => {
    const app = createApp({ service, token, allowedOrigins: [] });
    const response = await rpc(app, "tools/list", {});

    expect(response.status).toBe(200);
    const text = await response.text();
    for (const name of ["list_projects", "get_project_structure", "read_project_document", "search_project", "create_project_document"]) {
      expect(text).toContain(name);
    }
    expect(text).not.toContain("update_project_document");
  });

  it("surfaces stable write-domain codes as MCP tool errors", async () => {
    const errorService: ProjectService = {
      ...service,
      createProjectDocument: async () => {
        throw new WriteDomainError("FILE_EXISTS", "create target already exists");
      },
    };
    const app = createApp({ service: errorService, token, allowedOrigins: [] });
    const response = await rpc(app, "tools/call", {
      name: "create_project_document",
      arguments: { project: "P033-GrandeGPT", path: "PRD.md", content: "replacement" },
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("FILE_EXISTS");
    expect(text).toContain("isError");
  });
});
