import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWriteFile } from "../src/filePrimitives.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("atomicWriteFile", () => {
  it("replaces a file through a same-directory temporary file without leaving temp artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "grande-obsidian-atomic-"));
    roots.push(root);
    const dir = join(root, "project");
    await mkdir(dir);
    const target = join(dir, "PRD.md");
    await writeFile(target, "old\n", "utf8");

    await atomicWriteFile(target, Buffer.from("new content\n", "utf8"));

    await expect(readFile(target, "utf8")).resolves.toBe("new content\n");
    await expect(readdir(dir)).resolves.toEqual(["PRD.md"]);
  });
});
