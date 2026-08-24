import type { ProjectService } from "./projectService.ts";

export type ToolName =
  | "list_projects"
  | "get_project_structure"
  | "read_project_document"
  | "search_project"
  | "create_project_document"
  | "update_project_document"
  | "move_project_document";

export interface ToolDef {
  name: ToolName;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: "string" | "number"; description?: string }>;
    required?: string[];
  };
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: false;
    openWorldHint: false;
  };
  handler(args: Record<string, unknown>): Promise<unknown>;
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false as const,
  openWorldHint: false as const,
};

const SAFE_WRITE = {
  readOnlyHint: false,
  destructiveHint: false as const,
  openWorldHint: false as const,
};

const PROJECT_ARG_DESCRIPTION =
  "Visible direct-child project directory name from list_projects.directory (for example, P033-GrandeGPT), not list_projects.id.";

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function requiredText(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
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

export function buildTools(service: ProjectService): ToolDef[] {
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
        properties: { project: { type: "string", description: PROJECT_ARG_DESCRIPTION } },
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
          project: { type: "string", description: PROJECT_ARG_DESCRIPTION },
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
          project: { type: "string", description: PROJECT_ARG_DESCRIPTION },
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
    {
      name: "create_project_document",
      description: "Safely create a new Markdown document without overwriting an existing target.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string", description: PROJECT_ARG_DESCRIPTION },
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["project", "path", "content"],
      },
      annotations: SAFE_WRITE,
      handler: (args) =>
        service.createProjectDocument(
          requiredString(args, "project"),
          requiredString(args, "path"),
          requiredText(args, "content"),
        ),
    },
    {
      name: "update_project_document",
      description: "Safely replace an existing Markdown document only when its full SHA-256 matches the expected version.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string", description: PROJECT_ARG_DESCRIPTION },
          path: { type: "string" },
          content: { type: "string" },
          expectedSha256: { type: "string" },
        },
        required: ["project", "path", "content", "expectedSha256"],
      },
      annotations: SAFE_WRITE,
      handler: (args) =>
        service.updateProjectDocument(
          requiredString(args, "project"),
          requiredString(args, "path"),
          requiredText(args, "content"),
          requiredString(args, "expectedSha256"),
        ),
    },
    {
      name: "move_project_document",
      description: "Safely perform a same-project Markdown move or rename without overwriting an existing target; wikilinks are not rewritten.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string", description: PROJECT_ARG_DESCRIPTION },
          sourcePath: { type: "string" },
          targetPath: { type: "string" },
          expectedSha256: { type: "string" },
        },
        required: ["project", "sourcePath", "targetPath", "expectedSha256"],
      },
      annotations: SAFE_WRITE,
      handler: (args) =>
        service.moveProjectDocument(
          requiredString(args, "project"),
          requiredString(args, "sourcePath"),
          requiredString(args, "targetPath"),
          requiredString(args, "expectedSha256"),
        ),
    },
  ];
}
