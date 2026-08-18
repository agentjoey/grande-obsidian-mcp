import { lstat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;
const SPOOFING_CHAR_RE = /[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029\u061c]/;

export class PathPolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = `PathPolicyError [${code}]`;
    this.code = code;
  }
}

function assertDisplaySafe(value: string, label: string): void {
  if (CONTROL_CHAR_RE.test(value) || SPOOFING_CHAR_RE.test(value)) {
    throw new PathPolicyError("INVALID_INPUT", `${label} contains unsafe control/spoofing characters`);
  }
}

function assertProjectName(project: string): void {
  if (project.length === 0 || project === "." || project === "..") {
    throw new PathPolicyError("INVALID_INPUT", "project must be one non-empty directory name");
  }
  assertDisplaySafe(project, "project");
  if (project.startsWith(".") || project.includes("/") || project.includes("\\") || isAbsolute(project)) {
    throw new PathPolicyError("INVALID_INPUT", "project must be a visible direct-child directory name");
  }
}

function documentSegments(path: string): string[] {
  if (path.length === 0 || isAbsolute(path) || path.includes("\\")) {
    throw new PathPolicyError("INVALID_INPUT", "document path must be a non-empty '/'-separated relative path");
  }
  assertDisplaySafe(path, "document path");
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === ".." || segment.startsWith(".")) {
      throw new PathPolicyError("INVALID_INPUT", "document path contains a forbidden component");
    }
  }
  if (!segments.at(-1)?.endsWith(".md")) {
    throw new PathPolicyError("INVALID_INPUT", "document path must end in .md");
  }
  return segments;
}

async function assertRealDirectory(path: string, label: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) {
    throw new PathPolicyError("PATH_ESCAPE", `${label} must not be a symbolic link`);
  }
  if (!stat.isDirectory()) {
    throw new PathPolicyError("NOT_FOUND", `${label} is not a directory`);
  }
}

function assertContained(root: string, candidate: string): void {
  const rel = relative(root, candidate);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new PathPolicyError("PATH_ESCAPE", "resolved path escapes configured project root");
  }
}

export async function resolveProjectDirectory(projectRootPath: string, project: string): Promise<string> {
  assertProjectName(project);
  await assertRealDirectory(projectRootPath, "projectRoot");
  const candidate = join(projectRootPath, project);
  assertContained(projectRootPath, candidate);
  await assertRealDirectory(candidate, "project");
  return candidate;
}

export async function resolveExistingMarkdown(
  projectRootPath: string,
  project: string,
  documentPath: string,
): Promise<string> {
  const projectPath = await resolveProjectDirectory(projectRootPath, project);
  const segments = documentSegments(documentPath);
  let current = projectPath;

  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]!);
    assertContained(projectPath, current);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) {
      throw new PathPolicyError("PATH_ESCAPE", "document path must not contain a symbolic link");
    }
    const isLast = index === segments.length - 1;
    if (isLast) {
      if (!stat.isFile()) throw new PathPolicyError("NOT_FOUND", "document is not a regular file");
    } else if (!stat.isDirectory()) {
      throw new PathPolicyError("NOT_FOUND", "document parent component is not a directory");
    }
  }

  return current;
}
