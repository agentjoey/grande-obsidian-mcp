import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRenameExcl, RENAME_EXCL_BINARY } from "../ops/native/buildRenameExcl.js";

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
