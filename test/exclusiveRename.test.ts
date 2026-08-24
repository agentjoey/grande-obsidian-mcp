import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRenameExcl } from "../ops/native/buildRenameExcl.js";

async function buildRepoOwnedHelper(): Promise<string> {
  // Build through the same atomic repo-owned publisher used by production. Direct
  // clang -o to the shared native/bin/rename-excl path can truncate the live helper
  // while another Vitest worker is self-checking or executing it.
  return buildRenameExcl(resolve("."));
}

async function loadExclusiveRename() {
  return import("../src/exclusiveRename.js");
}

async function expectMissing(path: string): Promise<void> {
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("Darwin exclusive rename primitive", () => {
  it("moves a file without changing bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "gomcp-rename-"));
    const helper = await buildRepoOwnedHelper();
    await writeFile(join(root, "a.md"), "alpha");

    const { exclusiveRename } = await loadExclusiveRename();
    await expect(exclusiveRename(root, "a.md", "b.md", helper)).resolves.toBeUndefined();
    await expect(readFile(join(root, "b.md"), "utf8")).resolves.toBe("alpha");
    await expectMissing(join(root, "a.md"));
  });

  it("returns EEXIST and preserves both files when the target exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "gomcp-rename-existing-"));
    const helper = await buildRepoOwnedHelper();
    await writeFile(join(root, "a.md"), "source");
    await writeFile(join(root, "b.md"), "target");

    const { exclusiveRename } = await loadExclusiveRename();
    await expect(exclusiveRename(root, "a.md", "b.md", helper)).rejects.toMatchObject({ failure: "EEXIST" });
    await expect(readFile(join(root, "a.md"), "utf8")).resolves.toBe("source");
    await expect(readFile(join(root, "b.md"), "utf8")).resolves.toBe("target");
  });

  it("rejects any symlink encountered during path resolution", async () => {
    const root = await mkdtemp(join(tmpdir(), "gomcp-rename-symlink-"));
    const helper = await buildRepoOwnedHelper();
    await mkdir(join(root, "real"));
    await writeFile(join(root, "real", "a.md"), "source");
    await symlink(join(root, "real"), join(root, "alias"));

    const { exclusiveRename } = await loadExclusiveRename();
    await expect(exclusiveRename(root, "alias/a.md", "b.md", helper)).rejects.toMatchObject({ failure: "ELOOP" });
    await expect(readFile(join(root, "real", "a.md"), "utf8")).resolves.toBe("source");
    await expectMissing(join(root, "b.md"));
  });

  it("rejects a source path that escapes beneath the project directory", async () => {
    const base = await mkdtemp(join(tmpdir(), "gomcp-rename-beneath-"));
    const root = join(base, "project");
    await mkdir(root);
    const helper = await buildRepoOwnedHelper();
    await writeFile(join(base, "outside.md"), "outside");

    const { exclusiveRename } = await loadExclusiveRename();
    await expect(exclusiveRename(root, "../outside.md", "inside.md", helper)).rejects.toMatchObject({ failure: "ENOTCAPABLE" });
    await expect(readFile(join(base, "outside.md"), "utf8")).resolves.toBe("outside");
    await expectMissing(join(root, "inside.md"));
  });
});
