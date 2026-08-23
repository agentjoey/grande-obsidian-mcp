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
};

describe("MCP tool manifest", () => {
  it("exposes the four M1 read tools plus Safe Create with exact annotations", () => {
    const tools = buildTools(service);
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "create_project_document",
      "get_project_structure",
      "list_projects",
      "read_project_document",
      "search_project",
    ]);

    const create = tools.find((tool) => tool.name === "create_project_document");
    expect(create?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });

    for (const tool of tools.filter((candidate) => candidate.name !== "create_project_document")) {
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
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
});
