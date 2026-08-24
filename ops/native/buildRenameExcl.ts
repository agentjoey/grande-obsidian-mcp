import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RENAME_EXCL_BINARY = "native/bin/rename-excl";

export function buildRenameExcl(repoRoot: string): string {
  const root = resolve(repoRoot);
  const sourcePath = resolve(root, "native/rename-excl.c");
  const binaryPath = resolve(root, RENAME_EXCL_BINARY);
  const binaryDirectory = dirname(binaryPath);
  mkdirSync(binaryDirectory, { recursive: true });

  // Multiple test workers or operational callers may build concurrently. Compile to a
  // private same-directory candidate so clang never truncates the live helper, then
  // atomically publish it to the one native-exec path approved by GrandeGPT.
  const candidatePath = resolve(
    binaryDirectory,
    `.rename-excl.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    const result = spawnSync("/usr/bin/clang", [
      "-std=c11",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-O2",
      sourcePath,
      "-o",
      candidatePath,
    ], { cwd: root, encoding: "utf8" });

    if (result.error || result.status !== 0) {
      throw new Error("rename-excl helper build failed");
    }

    // Publish before self-check because the sandbox intentionally permits native
    // execution only at native/bin/rename-excl. Atomic same-directory rename means
    // concurrent builders may replace one complete candidate with another, but no
    // caller can observe a partially written executable.
    renameSync(candidatePath, binaryPath);

    // Contract self-check: the helper accepts exactly three arguments after argv[0].
    // With none it must reject before touching any filesystem path and exit with EX_USAGE (64).
    const probe = spawnSync(binaryPath, [], { cwd: root, encoding: "utf8" });
    if (probe.error || probe.status !== 64) {
      throw new Error("rename-excl helper self-check failed");
    }

    return binaryPath;
  } finally {
    if (existsSync(candidatePath)) {
      unlinkSync(candidatePath);
    }
  }
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(thisFile)) {
  const repoRoot = resolve(dirname(thisFile), "../..");
  console.log(buildRenameExcl(repoRoot));
}
