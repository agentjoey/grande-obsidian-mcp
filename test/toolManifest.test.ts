import { describe, expect, it } from "vitest";
import type { ProjectService } from "../src/projectService.js";
import { buildTools, type ToolDef } from "../src/tools.js";
import {
  canonicalizeLiveTools,
  canonicalizeSourceTools,
  firstToolManifestDifference,
  toolManifestDigest,
} from "../src/toolManifest.js";

const never = async (): Promise<never> => {
  throw new Error("manifest fixture handlers must not be invoked");
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

function liveTool(tool: ToolDef) {
  const reversedProperties = Object.fromEntries(
    Object.entries(tool.inputSchema.properties)
      .reverse()
      .map(([name, property]) => [name, { type: property.type, description: "representation-only" }]),
  );
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: reversedProperties,
      required: [...(tool.inputSchema.required ?? [])].reverse(),
    },
    annotations: { ...tool.annotations },
  };
}

describe("semantic MCP tool manifest", () => {
  it("normalizes source and reordered live tools to the same deterministic digest", () => {
    const source = buildTools(service);
    const live = source.map(liveTool).reverse();

    const expected = canonicalizeSourceTools(source);
    const actual = canonicalizeLiveTools(live);

    expect(actual).toEqual(expected);
    expect(toolManifestDigest(actual)).toBe(toolManifestDigest(expected));
    expect(toolManifestDigest(actual)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(firstToolManifestDifference(expected, actual)).toBeNull();
  });

  it("changes digest for missing or added tools and reports a bounded first difference", () => {
    const source = buildTools(service);
    const expected = canonicalizeSourceTools(source);
    const missing = canonicalizeLiveTools(source.slice(0, -1).map(liveTool));
    const added = canonicalizeLiveTools([
      ...source.map(liveTool),
      {
        name: "future_tool",
        description: "Future tool",
        inputSchema: { type: "object", properties: {}, required: [] },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
    ]);

    expect(toolManifestDigest(missing)).not.toBe(toolManifestDigest(expected));
    expect(toolManifestDigest(added)).not.toBe(toolManifestDigest(expected));
    expect(firstToolManifestDifference(expected, missing)).toMatch(/missing live tool: create_project_directory/i);
    expect(firstToolManifestDifference(expected, added)).toMatch(/unexpected live tool: future_tool/i);
  });

  it("changes digest for semantic description, input, requiredness, or annotation changes", () => {
    const source = buildTools(service);
    const baseLive = source.map(liveTool);
    const expected = canonicalizeSourceTools(source);

    const descriptionChanged = structuredClone(baseLive);
    descriptionChanged[0]!.description += " changed";

    const inputChanged = structuredClone(baseLive);
    inputChanged.find((tool) => tool.name === "search_project")!.inputSchema.properties.maxResults!.type = "string";

    const requiredChanged = structuredClone(baseLive);
    requiredChanged.find((tool) => tool.name === "search_project")!.inputSchema.required = ["project", "query", "maxResults"];

    const annotationChanged = structuredClone(baseLive);
    const firstAnnotationTool = annotationChanged[0]!;
    firstAnnotationTool.annotations.readOnlyHint = !firstAnnotationTool.annotations.readOnlyHint;

    for (const changed of [descriptionChanged, inputChanged, requiredChanged, annotationChanged]) {
      const actual = canonicalizeLiveTools(changed);
      expect(toolManifestDigest(actual)).not.toBe(toolManifestDigest(expected));
      expect(firstToolManifestDifference(expected, actual)).not.toBeNull();
    }
  });

  it("ignores raw key order, protocol $schema, property descriptions, and source handler identity", () => {
    const source = buildTools(service);
    const sourceWithDifferentHandlers = source.map((tool) => ({
      ...tool,
      handler: async () => ({ ignored: true }),
    }));
    const live = source.map(liveTool);

    expect(canonicalizeSourceTools(sourceWithDifferentHandlers)).toEqual(canonicalizeSourceTools(source));
    expect(canonicalizeLiveTools(live)).toEqual(canonicalizeSourceTools(source));
  });

  it("rejects malformed live contract instead of inferring semantics", () => {
    expect(() => canonicalizeLiveTools([{
      name: "bad",
      description: "Bad",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true, destructiveHint: false },
    }])).toThrow(/openWorldHint/);

    expect(() => canonicalizeLiveTools([{
      name: "bad",
      description: "Bad",
      inputSchema: { type: "object", properties: { value: { type: "boolean" } } },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }])).toThrow(/type/);
  });
});
