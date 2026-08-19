import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { PathPolicyError, resolveExistingMarkdown, resolveProjectDirectory } from "./pathPolicy.ts";

export interface ProjectSummary {
  id: string | null;
  name: string;
  directory: string;
}

export interface StructureEntry {
  path: string;
  kind: "directory" | "file";
}

export interface StructureResult {
  entries: StructureEntry[];
  truncated: boolean;
}

export interface MarkdownRead {
  content: string;
  sha256: string;
  totalBytes: number;
  truncated: boolean;
}

function lexicalName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function logicalPath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}

export async function listProjects(projectRootPath: string): Promise<ProjectSummary[]> {
  const rootStat = await lstat(projectRootPath);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new PathPolicyError("PATH_ESCAPE", "projectRoot must be a real directory");
  }

  const entries = await readdir(projectRootPath, { withFileTypes: true });
  const projects: ProjectSummary[] = [];
  for (const entry of entries.sort(lexicalName)) {
    if (entry.name.startsWith(".") || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const match = /^(P\d{3})-(.+)$/.exec(entry.name);
    projects.push({
      id: match?.[1] ?? null,
      name: match?.[2] ?? entry.name,
      directory: entry.name,
    });
  }
  return projects;
}

export async function listMarkdownEntries(
  projectRootPath: string,
  project: string,
  maxEntries: number,
): Promise<StructureResult> {
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new PathPolicyError("INVALID_INPUT", "maxEntries must be a positive integer");
  }
  const projectPath = await resolveProjectDirectory(projectRootPath, project);
  const found: StructureEntry[] = [];
  let truncated = false;

  async function walk(directory: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true })).sort(lexicalName);

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = join(directory, entry.name);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) {
        throw new PathPolicyError("PATH_ESCAPE", "project structure must not contain a symbolic link");
      }

      if (stat.isDirectory()) {
        if (found.length >= maxEntries) {
          truncated = true;
          return;
        }
        found.push({ path: logicalPath(projectPath, absolute), kind: "directory" });
        await walk(absolute);
        if (truncated) return;
      } else if (stat.isFile() && entry.name.endsWith(".md")) {
        if (found.length >= maxEntries) {
          truncated = true;
          return;
        }
        found.push({ path: logicalPath(projectPath, absolute), kind: "file" });
      }
    }
  }

  await walk(projectPath);
  return { entries: found, truncated };
}

export async function readMarkdown(
  projectRootPath: string,
  project: string,
  path: string,
  maxBytes: number,
): Promise<MarkdownRead> {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new PathPolicyError("INVALID_INPUT", "maxBytes must be a positive integer");
  }
  const absolute = await resolveExistingMarkdown(projectRootPath, project, path);
  const full = await readFile(absolute);
  return {
    content: full.subarray(0, maxBytes).toString("utf8"),
    sha256: createHash("sha256").update(full).digest("hex"),
    totalBytes: full.byteLength,
    truncated: full.byteLength > maxBytes,
  };
}
