import { describe, expect, it } from "vitest";
import { buildReadTools } from "../src/tools.js";
import type { ProjectService } from "../src/projectService.js";

const service: ProjectService = {
  listProjects: async () => [],
  getProjectStructure: async () => ({ entries: [], truncated: false }),
  readProjectDocument: async () => ({ content: "", sha256: "0".repeat(64), totalBytes: 0, truncated: false }),
  searchProject: async () => ({ results: [], truncated: false }),
};

describe("read-only MCP tool manifest", () => {
  it("exposes exactly the approved four M1 tools with read-only annotations", () => {
    const tools = buildReadTools(service);
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "get_project_structure",
      "list_projects",
      "read_project_document",
      "search_project",
    ]);
    for (const tool of tools) {
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
    }
  });

  it("routes tool arguments to the project service", async () => {
    const tools = buildReadTools(service);
    const read = tools.find((tool) => tool.name === "read_project_document");
    expect(read).toBeDefined();
    await expect(read!.handler({ project: "P033-GrandeGPT", path: "PRD.md" })).resolves.toEqual({
      content: "",
      sha256: "0".repeat(64),
      totalBytes: 0,
      truncated: false,
    });
  });
});
