import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { atomicCreateFile, atomicWriteFile } from "./filePrimitives.ts";
import { PathPolicyError, resolveCreatableMarkdown, resolveExistingMarkdown, resolveProjectDirectory } from "./pathPolicy.ts";
import { toWriteDomainError, WriteDomainError } from "./writeErrors.ts";

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

export interface MarkdownWrite {
  path: string;
  sha256: string;
  totalBytes: number;
}

function lexicalName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function logicalPath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

async function verifyWrittenFile(targetPath: string, expectedSha256: string): Promise<void> {
  try {
    const final = await readFile(targetPath);
    if (sha256(final) !== expectedSha256) {
      throw new WriteDomainError("VERIFY_FAILED", "written document did not match intended content");
    }
  } catch (error) {
    throw toWriteDomainError(error, "VERIFY_FAILED");
  }
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
    sha256: sha256(full),
    totalBytes: full.byteLength,
    truncated: full.byteLength > maxBytes,
  };
}

export async function createMarkdown(
  projectRootPath: string,
  project: string,
  path: string,
  content: Uint8Array,
): Promise<MarkdownWrite> {
  let targetPath: string;
  try {
    targetPath = await resolveCreatableMarkdown(projectRootPath, project, path);
  } catch (error) {
    throw toWriteDomainError(error);
  }

  const intendedSha = sha256(content);

  try {
    const revalidatedTarget = await resolveCreatableMarkdown(projectRootPath, project, path);
    if (revalidatedTarget !== targetPath) {
      throw new WriteDomainError("POLICY_DENIED", "write target changed during validation");
    }
    await atomicCreateFile(targetPath, content);
  } catch (error) {
    throw toWriteDomainError(error);
  }

  await verifyWrittenFile(targetPath, intendedSha);
  return { path, sha256: intendedSha, totalBytes: content.byteLength };
}

export async function updateMarkdown(
  projectRootPath: string,
  project: string,
  path: string,
  content: Uint8Array,
  expectedSha256: string,
): Promise<MarkdownWrite> {
  let targetPath: string;
  let current: Buffer;
  try {
    targetPath = await resolveExistingMarkdown(projectRootPath, project, path);
    current = await readFile(targetPath);
  } catch (error) {
    throw toWriteDomainError(error);
  }

  if (sha256(current) !== expectedSha256) {
    throw new WriteDomainError("STALE_FILE", "document has changed since it was read");
  }

  const intendedSha = sha256(content);

  try {
    await atomicWriteFile(targetPath, content, async () => {
      const revalidatedTarget = await resolveExistingMarkdown(projectRootPath, project, path);
      if (revalidatedTarget !== targetPath) {
        throw new WriteDomainError("POLICY_DENIED", "write target changed during validation");
      }
      const latest = await readFile(revalidatedTarget);
      if (sha256(latest) !== expectedSha256) {
        throw new WriteDomainError("STALE_FILE", "document changed before atomic replacement");
      }
    });
  } catch (error) {
    throw toWriteDomainError(error);
  }

  await verifyWrittenFile(targetPath, intendedSha);
  return { path, sha256: intendedSha, totalBytes: content.byteLength };
}
