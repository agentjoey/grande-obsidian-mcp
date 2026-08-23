import { PathPolicyError } from "./pathPolicy.ts";
import {
  createMarkdown,
  listMarkdownEntries,
  listProjects,
  readMarkdown,
  updateMarkdown,
  type MarkdownRead,
  type MarkdownWrite,
  type ProjectSummary,
  type StructureResult,
} from "./vaultFs.ts";
import { WriteDomainError } from "./writeErrors.ts";

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
  createProjectDocument(project: string, path: string, content: string): Promise<MarkdownWrite>;
  updateProjectDocument(project: string, path: string, content: string, expectedSha256: string): Promise<MarkdownWrite>;
}

const DEFAULT_MAX_READ_BYTES = 32 * 1024;
const DEFAULT_MAX_STRUCTURE_ENTRIES = 250;
const SEARCH_SCAN_ENTRY_LIMIT = 1000;
const SEARCH_FILE_MAX_BYTES = 256 * 1024;
const MAX_WRITE_BYTES = 256 * 1024;
const SHA256_RE = /^[0-9a-f]{64}$/;

function writeContent(content: string): Buffer {
  const encoded = Buffer.from(content, "utf8");
  if (encoded.byteLength > MAX_WRITE_BYTES) {
    throw new WriteDomainError("INVALID_INPUT", "content exceeds the 256 KiB write limit");
  }
  return encoded;
}

function expectedSha(value: string): string {
  if (!SHA256_RE.test(value)) {
    throw new WriteDomainError("INVALID_INPUT", "expectedSha256 must be a lowercase 64-character SHA-256");
  }
  return value;
}

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

    async createProjectDocument(project, path, content) {
      return createMarkdown(options.projectRootPath, project, path, writeContent(content));
    },

    async updateProjectDocument(project, path, content, expectedSha256) {
      return updateMarkdown(
        options.projectRootPath,
        project,
        path,
        writeContent(content),
        expectedSha(expectedSha256),
      );
    },
  };
}
