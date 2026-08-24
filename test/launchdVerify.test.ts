import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectService } from "../src/projectService.js";
import { buildTools, type ToolDef } from "../src/tools.js";
import { toolManifestDigest, canonicalizeSourceTools } from "../src/toolManifest.js";
import {
  verifyProduction,
  type ProductionVerifyDependencies,
} from "../ops/launchd/verifyCore.js";

const canonicalSha = "a".repeat(40);
const repoRoot = "/workspace/grande-obsidian-mcp";

const never = async (): Promise<never> => {
  throw new Error("verification fixture handlers must not be invoked");
};
const service: ProjectService = {
  listProjects: never,
  getProjectStructure: never,
  readProjectDocument: never,
  searchProject: never,
  createProjectDocument: never,
  updateProjectDocument: never,
  moveProjectDocument: never,
  createProjectDirectory: never,
};
const expectedTools = buildTools(service);

function liveTool(tool: ToolDef) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(tool.inputSchema.properties).map(([name, property]) => [name, { type: property.type }]),
      ),
      required: tool.inputSchema.required ?? [],
    },
    annotations: { ...tool.annotations },
  };
}

function dependencies(overrides: Partial<ProductionVerifyDependencies> = {}): ProductionVerifyDependencies {
  return {
    resolveCanonicalState: async () => ({ repoRoot, canonicalSha, trackedTreeClean: true }),
    inspectLaunchAgent: async () => ({
      loaded: true,
      workingDirectory: repoRoot,
      runnerPath: join(repoRoot, "ops", "launchd", "run.ts"),
    }),
    probeUnauthenticated: async () => ({ status: 401, buildSha: canonicalSha }),
    loadExpectedTools: async () => expectedTools,
    loadLiveTools: async () => expectedTools.map(liveTool),
    ...overrides,
  };
}

describe("production launchd verification", () => {
  it("returns bounded identity and manifest evidence only when all gates match", async () => {
    const summary = await verifyProduction(dependencies());
    const digest = toolManifestDigest(canonicalizeSourceTools(expectedTools));

    expect(summary).toEqual({
      label: "ai.agentjoey.grande-obsidian-mcp",
      canonicalSha,
      runtimeSha: canonicalSha,
      unauthenticatedStatus: 401,
      toolsCount: 8,
      expectedToolsDigest: digest,
      liveToolsDigest: digest,
    });
  });

  it("rejects dirty canonical tracked state before accepting runtime evidence", async () => {
    await expect(verifyProduction(dependencies({
      resolveCanonicalState: async () => ({ repoRoot, canonicalSha, trackedTreeClean: false }),
    }))).rejects.toThrow(/tracked tree/i);
  });

  it("rejects absent service or non-canonical launchd paths", async () => {
    await expect(verifyProduction(dependencies({
      inspectLaunchAgent: async () => ({
        loaded: false,
        workingDirectory: repoRoot,
        runnerPath: join(repoRoot, "ops", "launchd", "run.ts"),
      }),
    }))).rejects.toThrow(/not loaded/i);

    await expect(verifyProduction(dependencies({
      inspectLaunchAgent: async () => ({
        loaded: true,
        workingDirectory: "/workspace/other-checkout",
        runnerPath: join(repoRoot, "ops", "launchd", "run.ts"),
      }),
    }))).rejects.toThrow(/WorkingDirectory/i);

    await expect(verifyProduction(dependencies({
      inspectLaunchAgent: async () => ({
        loaded: true,
        workingDirectory: repoRoot,
        runnerPath: "/workspace/other-checkout/ops/launchd/run.ts",
      }),
    }))).rejects.toThrow(/runner/i);
  });

  it.each([200, 403, 500])("rejects unauthenticated MCP status %i instead of exactly 401", async (status) => {
    await expect(verifyProduction(dependencies({
      probeUnauthenticated: async () => ({ status, buildSha: canonicalSha }),
    }))).rejects.toThrow(/401/);
  });

  it("rejects missing, malformed, or stale runtime build identity", async () => {
    await expect(verifyProduction(dependencies({
      probeUnauthenticated: async () => ({ status: 401, buildSha: null }),
    }))).rejects.toThrow(/build SHA/i);

    await expect(verifyProduction(dependencies({
      probeUnauthenticated: async () => ({ status: 401, buildSha: "bad" }),
    }))).rejects.toThrow(/build SHA/i);

    await expect(verifyProduction(dependencies({
      probeUnauthenticated: async () => ({ status: 401, buildSha: "b".repeat(40) }),
    }))).rejects.toThrow(/does not match canonical/i);
  });

  it("rejects stale or malformed live tool contract", async () => {
    await expect(verifyProduction(dependencies({
      loadLiveTools: async () => expectedTools.slice(0, -1).map(liveTool),
    }))).rejects.toThrow(/missing live tool: create_project_directory/i);

    await expect(verifyProduction(dependencies({
      loadLiveTools: async () => [{
        name: "bad",
        description: "Bad",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true, destructiveHint: false },
      }],
    }))).rejects.toThrow(/openWorldHint/);
  });
});
