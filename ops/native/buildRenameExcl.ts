import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RENAME_EXCL_BINARY = "native/bin/rename-excl";

export function buildRenameExcl(repoRoot: string): string {
  const root = resolve(repoRoot);
  const sourcePath = resolve(root, "native/rename-excl.c");
  const binaryPath = resolve(root, RENAME_EXCL_BINARY);
  mkdirSync(dirname(binaryPath), { recursive: true });

  const result = spawnSync("/usr/bin/clang", [
    "-std=c11",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-O2",
    sourcePath,
    "-o",
    binaryPath,
  ], { cwd: root, encoding: "utf8" });

  if (result.error || result.status !== 0) {
    throw new Error("rename-excl helper build failed");
  }

  // Contract self-check: the helper accepts exactly three arguments after argv[0].
  // With none it must reject before touching any filesystem path and exit with EX_USAGE (64).
  const probe = spawnSync(binaryPath, [], { cwd: root, encoding: "utf8" });
  if (probe.error || probe.status !== 64) {
    throw new Error("rename-excl helper self-check failed");
  }

  return binaryPath;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(thisFile)) {
  const repoRoot = resolve(dirname(thisFile), "../..");
  console.log(buildRenameExcl(repoRoot));
}
