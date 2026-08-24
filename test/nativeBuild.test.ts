import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRenameExcl, RENAME_EXCL_BINARY } from "../ops/native/buildRenameExcl.js";

function buildInChild(repoRoot: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", "ops/native/buildRenameExcl.ts"],
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`native build child failed with ${code}: ${stderr}`));
    });
  });
}

describe("deterministic rename-excl native build", () => {
  it("builds the fixed repo-owned executable path and repeated builds are idempotent", () => {
    const repoRoot = resolve(".");
    const expected = resolve(repoRoot, RENAME_EXCL_BINARY);

    const first = buildRenameExcl(repoRoot);
    const second = buildRenameExcl(repoRoot);

    expect(first).toBe(expected);
    expect(second).toBe(expected);
    expect(existsSync(expected)).toBe(true);
    expect(statSync(expected).isFile()).toBe(true);
    expect(statSync(expected).mode & 0o111).not.toBe(0);
  });

  it("publishes only self-checked complete helpers when builds overlap", async () => {
    const repoRoot = resolve(".");
    const expected = resolve(repoRoot, RENAME_EXCL_BINARY);

    await Promise.all(Array.from({ length: 8 }, () => buildInChild(repoRoot)));

    const probe = spawnSync(expected, [], { cwd: repoRoot, encoding: "utf8" });
    expect(probe.error).toBeUndefined();
    expect(probe.status, probe.stderr).toBe(64);
  });

  it("keeps the regenerated native/bin helper ignored and untracked", () => {
    // Plain check-ignore deliberately excludes tracked paths. This only returns 0 when
    // the freshly generated helper is both covered by .gitignore and no longer tracked.
    const result = spawnSync("git", ["check-ignore", "-q", "native/bin/rename-excl"], {
      cwd: resolve("."),
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  });
});
