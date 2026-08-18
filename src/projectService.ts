import { PathPolicyError } from "./pathPolicy.js";
import {
  listMarkdownEntries,
  listProjects,
  readMarkdown,
  type MarkdownRead,
  type ProjectSummary,
  type StructureResult,
} from "./vaultFs.js";

export interface ProjectServiceOptions {
  projectRootPath: string;
  maxReadBytes?: number;
  maxStructureEntries?: number;
}

export interface SearchMatch {
  path: string;
  line: number;
  excerpt: string;
}

export interface SearchResult {
  results: SearchMatch[];
  truncated: boolean;
}

export interface ProjectService {
  listProjects(): Promise<ProjectSummary[]>;
  getProjectStructure(project: string): Promise<StructureResult>;
  readProjectDocument(project: string, path: string): Promise<MarkdownRead>;
  searchProject(project: string, query: string, maxResults: number): Promise<SearchResult>;
}

const DEFAULT_MAX_READ_BYTES = 32 * 1024;
const DEFAULT_MAX_STRUCTURE_ENTRIES = 250;
const SEARCH_SCAN_ENTRY_LIMIT = 1000;
const SEARCH_FILE_MAX_BYTES = 256 * 1024;

export function createProjectService(options: ProjectServiceOptions): ProjectService {
  const maxReadBytes = options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES;
  const maxStructureEntries = options.maxStructureEntries ?? DEFAULT_MAX_STRUCTURE_ENTRIES;

  return {
    listProjects: () => listProjects(options.projectRootPath),

    getProjectStructure: (project) =>
      listMarkdownEntries(options.projectRootPath, project, maxStructureEntries),

    readProjectDocument: (project, path) =>
      readMarkdown(options.projectRootPath, project, path, maxReadBytes),

    async searchProject(project, query, maxResults) {
      if (query.length === 0) {
        throw new PathPolicyError("INVALID_INPUT", "search query must not be empty");
      }
      if (!Number.isInteger(maxResults) || maxResults <= 0) {
        throw new PathPolicyError("INVALID_INPUT", "maxResults must be a positive integer");
      }

      const structure = await listMarkdownEntries(options.projectRootPath, project, SEARCH_SCAN_ENTRY_LIMIT);
      const needle = query.toLowerCase();
      const matches: SearchMatch[] = [];
      let truncated = structure.truncated;

      for (const entry of structure.entries) {
        if (entry.kind !== "file") continue;
        const read = await readMarkdown(
          options.projectRootPath,
          project,
          entry.path,
          SEARCH_FILE_MAX_BYTES,
        );
        if (read.truncated) truncated = true;
        const lines = read.content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? "";
          if (!line.toLowerCase().includes(needle)) continue;
          matches.push({ path: entry.path, line: index + 1, excerpt: line });
          if (matches.length > maxResults) {
            return { results: matches.slice(0, maxResults), truncated: true };
          }
        }
      }

      return {
        results: matches,
        truncated,
      };
    },
  };
}
