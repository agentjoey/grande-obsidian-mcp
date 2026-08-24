import { describe, expect, it } from "vitest";
import { buildTools } from "../src/tools.js";
import type { ProjectService } from "../src/projectService.js";

const service: ProjectService = {
  listProjects: async () => [],
  getProjectStructure: async () => ({ entries: [], truncated: false }),
  readProjectDocument: async () => ({ content: "", sha256: "0".repeat(64), totalBytes: 0, truncated: false }),
  searchProject: async () => ({ results: [], truncated: false }),
  createProjectDocument: async (_project, path, content) => ({ path, sha256: "1".repeat(64), totalBytes: Buffer.byteLength(content) }),
  updateProjectDocument: async (_project, path, content) => ({ path, sha256: "2".repeat(64), totalBytes: Buffer.byteLength(content) }),
  moveProjectDocument: async (_project, sourcePath, targetPath) => ({ sourcePath, targetPath, sha256: "3".repeat(64), totalBytes: 0 }),
};

describe("MCP tool manifest", () => {
  it("exposes exactly the approved six Phase 2 tools with exact annotations", () => {
    const tools = buildTools(service);
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "create_project_document",
      "get_project_structure",
      "list_projects",
      "read_project_document",
      "search_project",
      "update_project_document",
    ]);

    for (const name of ["create_project_document", "update_project_document"] as const) {
      const write = tools.find((tool) => tool.name === name);
      expect(write?.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      });
    }

    for (const tool of tools.filter((candidate) => !["create_project_document", "update_project_document"].includes(candidate.name))) {
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
    }
  });

  it("documents project arguments as list_projects.directory rather than list_projects.id", () => {
    const tools = buildTools(service);
    const projectTools = tools.filter((tool) => "project" in tool.inputSchema.properties);
    expect(projectTools.map((tool) => tool.name).sort()).toEqual([
      "create_project_document",
      "get_project_structure",
      "read_project_document",
      "search_project",
      "update_project_document",
    ]);

    for (const tool of projectTools) {
      const description = tool.inputSchema.properties.project?.description;
      expect(description).toContain("direct-child project directory name");
      expect(description).toContain("list_projects.directory");
      expect(description).toContain("not list_projects.id");
    }
  });

  it("routes read tool arguments to the project service", async () => {
    const tools = buildTools(service);
    const read = tools.find((tool) => tool.name === "read_project_document");
    expect(read).toBeDefined();
    await expect(read!.handler({ project: "P033-GrandeGPT", path: "PRD.md" })).resolves.toEqual({
      content: "",
      sha256: "0".repeat(64),
      totalBytes: 0,
      truncated: false,
    });
  });

  it("routes Safe Create and permits an empty Markdown body", async () => {
    const tools = buildTools(service);
    const create = tools.find((tool) => tool.name === "create_project_document");
    expect(create?.inputSchema.required).toEqual(["project", "path", "content"]);
    await expect(create!.handler({ project: "P033-GrandeGPT", path: "EMPTY.md", content: "" })).resolves.toEqual({
      path: "EMPTY.md",
      sha256: "1".repeat(64),
      totalBytes: 0,
    });
  });

  it("requires expectedSha256 for update and exposes no force or overwrite bypass", async () => {
    const tools = buildTools(service);
    const update = tools.find((tool) => tool.name === "update_project_document");
    expect(update?.inputSchema.required).toEqual(["project", "path", "content", "expectedSha256"]);
    expect(Object.keys(update?.inputSchema.properties ?? {}).sort()).toEqual([
      "content",
      "expectedSha256",
      "path",
      "project",
    ]);
    await expect(update!.handler({
      project: "P033-GrandeGPT",
      path: "PRD.md",
      content: "updated",
      expectedSha256: "0".repeat(64),
    })).resolves.toEqual({
      path: "PRD.md",
      sha256: "2".repeat(64),
      totalBytes: 7,
    });
  });
});
