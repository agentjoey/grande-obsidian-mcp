import type { ProjectService } from "./projectService.js";

export interface ReadToolDef {
  name: "list_projects" | "get_project_structure" | "read_project_document" | "search_project";
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: "string" | "number"; description?: string }>;
    required?: string[];
  };
  annotations: {
    readOnlyHint: true;
    destructiveHint: false;
    openWorldHint: false;
  };
  handler(args: Record<string, unknown>): Promise<unknown>;
}

const READ_ONLY = {
  readOnlyHint: true as const,
  destructiveHint: false as const,
  openWorldHint: false as const,
};

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function optionalPositiveInt(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

export function buildReadTools(service: ProjectService): ReadToolDef[] {
  return [
    {
      name: "list_projects",
      description: "List projects directly under the configured Obsidian project root.",
      inputSchema: { type: "object", properties: {} },
      annotations: READ_ONLY,
      handler: async () => ({ projects: await service.listProjects() }),
    },
    {
      name: "get_project_structure",
      description: "List a bounded Markdown-focused structure for one configured project.",
      inputSchema: {
        type: "object",
        properties: { project: { type: "string" } },
        required: ["project"],
      },
      annotations: READ_ONLY,
      handler: (args) => service.getProjectStructure(requiredString(args, "project")),
    },
    {
      name: "read_project_document",
      description: "Read one Markdown document from a configured project with bounded output and a full-document SHA-256.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          path: { type: "string" },
        },
        required: ["project", "path"],
      },
      annotations: READ_ONLY,
      handler: (args) => service.readProjectDocument(requiredString(args, "project"), requiredString(args, "path")),
    },
    {
      name: "search_project",
      description: "Search Markdown text within one configured project and return bounded project-relative matches.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          query: { type: "string" },
          maxResults: { type: "number" },
        },
        required: ["project", "query"],
      },
      annotations: READ_ONLY,
      handler: (args) =>
        service.searchProject(
          requiredString(args, "project"),
          requiredString(args, "query"),
          optionalPositiveInt(args, "maxResults", 20),
        ),
    },
  ];
}
