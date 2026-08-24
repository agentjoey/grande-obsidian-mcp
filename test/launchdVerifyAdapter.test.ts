import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { ProjectService } from "../src/projectService.js";
import type { ToolDef } from "../src/tools.js";
import {
  loadCanonicalExpectedTools,
  loadLiveToolsSafely,
} from "../ops/launchd/verify.js";

const fakeTools = [{
  name: "list_projects",
  description: "List projects",
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  handler: async () => ({ projects: [] }),
}] as ToolDef[];

describe("launchd verify host adapter", () => {
  it("loads expected tool definitions from the resolved canonical tree rather than the invoking worktree", async () => {
    const canonicalRoot = "/workspace/grande-obsidian-mcp";
    const worktreeRoot = "/workspace/.grande-work/worktrees/grande-obsidian-mcp/task-phase5";
    let importedUrl = "";
    let receivedService: ProjectService | null = null;

    const tools = await loadCanonicalExpectedTools(canonicalRoot, async (url) => {
      importedUrl = url;
      return {
        buildTools: (service: ProjectService) => {
          receivedService = service;
          return fakeTools;
        },
      };
    });

    expect(importedUrl).toBe(pathToFileURL(join(canonicalRoot, "src", "tools.ts")).href);
    expect(importedUrl).not.toContain(worktreeRoot);
    expect(tools).toEqual(fakeTools);
    expect(receivedService).not.toBeNull();
    await expect(receivedService!.listProjects()).rejects.toThrow(/must not be invoked/i);
  });

  it("wraps authenticated MCP failures without leaking the bearer token", async () => {
    const token = "super-secret-token";
    await expect(loadLiveToolsSafely(token, async (receivedToken) => {
      expect(receivedToken).toBe(token);
      throw new Error(`transport exploded with Authorization: Bearer ${token}`);
    })).rejects.toThrow(/^authenticated MCP tools\/list failed$/);

    try {
      await loadLiveToolsSafely(token, async () => {
        throw new Error(token);
      });
    } catch (error) {
      expect(String(error)).not.toContain(token);
    }
  });
});
