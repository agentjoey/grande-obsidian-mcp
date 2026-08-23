import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicCreateFile, atomicWriteFile } from "../src/filePrimitives.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "grande-obsidian-atomic-"));
  roots.push(root);
  const dir = join(root, "project");
  await mkdir(dir);
  return { root, dir, target: join(dir, "PRD.md") };
}

describe("atomic file primitives", () => {
  it("replaces a file through a same-directory temporary file without leaving temp artifacts", async () => {
    const { dir, target } = await fixture();
    await writeFile(target, "old\n", "utf8");

    await atomicWriteFile(target, Buffer.from("new content\n", "utf8"));

    await expect(readFile(target, "utf8")).resolves.toBe("new content\n");
    await expect(readdir(dir)).resolves.toEqual(["PRD.md"]);
  });

  it("publishes a complete new target without leaving temp artifacts", async () => {
    const { dir, target } = await fixture();

    await atomicCreateFile(target, Buffer.from("new content\n", "utf8"));

    await expect(readFile(target, "utf8")).resolves.toBe("new content\n");
    await expect(readdir(dir)).resolves.toEqual(["PRD.md"]);
  });

  it("fails with EEXIST and preserves an existing target byte-for-byte", async () => {
    const { dir, target } = await fixture();
    await writeFile(target, "old\n", "utf8");

    await expect(atomicCreateFile(target, Buffer.from("new content\n", "utf8"))).rejects.toMatchObject({ code: "EEXIST" });

    await expect(readFile(target, "utf8")).resolves.toBe("old\n");
    await expect(readdir(dir)).resolves.toEqual(["PRD.md"]);
  });

  it("allows only one concurrent creator and never exposes mixed or partial bytes", async () => {
    const { dir, target } = await fixture();
    const first = Buffer.from("first complete payload\n", "utf8");
    const second = Buffer.from("second complete payload\n", "utf8");

    const results = await Promise.allSettled([
      atomicCreateFile(target, first),
      atomicCreateFile(target, second),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toBeDefined();
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toMatchObject({ code: "EEXIST" });
    }

    const final = await readFile(target);
    expect([first.equals(final), second.equals(final)]).toContain(true);
    await expect(readdir(dir)).resolves.toEqual(["PRD.md"]);
  });
});
