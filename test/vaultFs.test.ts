import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdown, listMarkdownEntries, listProjects, readMarkdown, updateMarkdown } from "../src/vaultFs.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "grande-obsidian-vault-"));
  roots.push(root);
  const projectRoot = join(root, "10_Projects", "Active");
  await mkdir(join(projectRoot, "P033-GrandeGPT", "design"), { recursive: true });
  await mkdir(join(projectRoot, "P037-MasaGo"), { recursive: true });
  await writeFile(join(projectRoot, "P033-GrandeGPT", "PRD.md"), "# PRD\nhello world\n", "utf8");
  await writeFile(join(projectRoot, "P033-GrandeGPT", "design", "DESIGN.md"), "# Design\n", "utf8");
  await writeFile(join(projectRoot, "P033-GrandeGPT", "design", "image.png"), "not markdown", "utf8");
  return { root, projectRoot };
}

describe("vault filesystem", () => {
  it("lists only real direct-child project directories in stable order", async () => {
    const { root, projectRoot } = await fixture();
    await mkdir(join(projectRoot, ".hidden"));
    await mkdir(join(root, "outside"));
    await symlink(join(root, "outside"), join(projectRoot, "P099-Alias"));

    await expect(listProjects(projectRoot)).resolves.toEqual([
      { id: "P033", name: "GrandeGPT", directory: "P033-GrandeGPT" },
      { id: "P037", name: "MasaGo", directory: "P037-MasaGo" },
    ]);
  });

  it("lists bounded project-relative Markdown structure and directories", async () => {
    const { projectRoot } = await fixture();
    await expect(listMarkdownEntries(projectRoot, "P033-GrandeGPT", 10)).resolves.toEqual({
      entries: [
        { path: "PRD.md", kind: "file" },
        { path: "design", kind: "directory" },
        { path: "design/DESIGN.md", kind: "file" },
      ],
      truncated: false,
    });
  });

  it("truncates structure before exceeding the requested entry limit", async () => {
    const { projectRoot } = await fixture();
    await expect(listMarkdownEntries(projectRoot, "P033-GrandeGPT", 2)).resolves.toEqual({
      entries: [
        { path: "PRD.md", kind: "file" },
        { path: "design", kind: "directory" },
      ],
      truncated: true,
    });
  });

  it("returns bounded text while hashing the full Markdown document", async () => {
    const { projectRoot } = await fixture();
    const full = "# PRD\nhello world\n";
    const result = await readMarkdown(projectRoot, "P033-GrandeGPT", "PRD.md", 8);
    expect(result.content).toBe("# PRD\nhe");
    expect(result.truncated).toBe(true);
    expect(result.sha256).toBe(createHash("sha256").update(full).digest("hex"));
    expect(result.totalBytes).toBe(Buffer.byteLength(full));
  });

  it("fails closed when project traversal encounters a symlink", async () => {
    const { root, projectRoot } = await fixture();
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "secret.md"), "secret", "utf8");
    await symlink(outside, join(projectRoot, "P033-GrandeGPT", "linked"));

    await expect(listMarkdownEntries(projectRoot, "P033-GrandeGPT", 10)).rejects.toThrow(/symbolic link/i);
  });

  it("creates a new Markdown document and reports its verified SHA and byte count", async () => {
    const { projectRoot } = await fixture();
    const content = Buffer.from("# New\ncomplete content\n", "utf8");

    await expect(createMarkdown(projectRoot, "P033-GrandeGPT", "design/NEW.md", content)).resolves.toEqual({
      path: "design/NEW.md",
      sha256: createHash("sha256").update(content).digest("hex"),
      totalBytes: content.byteLength,
    });

    await expect(readFile(join(projectRoot, "P033-GrandeGPT", "design", "NEW.md"))).resolves.toEqual(content);
    expect((await readdir(join(projectRoot, "P033-GrandeGPT", "design"))).filter((name) => name.includes(".grande-"))).toEqual([]);
  });

  it("never overwrites an existing create target", async () => {
    const { projectRoot } = await fixture();
    const target = join(projectRoot, "P033-GrandeGPT", "PRD.md");
    const before = await readFile(target);

    await expect(createMarkdown(projectRoot, "P033-GrandeGPT", "PRD.md", Buffer.from("replacement\n")))
      .rejects.toMatchObject({ code: "FILE_EXISTS" });
    await expect(readFile(target)).resolves.toEqual(before);
  });

  it("never creates a missing parent directory", async () => {
    const { projectRoot } = await fixture();
    const missingParent = join(projectRoot, "P033-GrandeGPT", "missing");

    await expect(createMarkdown(projectRoot, "P033-GrandeGPT", "missing/NEW.md", Buffer.from("new\n")))
      .rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    await expect(lstat(missingParent)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("maps unsafe create symlinks to POLICY_DENIED", async () => {
    const { root, projectRoot } = await fixture();
    const outside = join(root, "outside-create");
    await mkdir(outside);
    await symlink(outside, join(projectRoot, "P033-GrandeGPT", "linked-create"));

    await expect(createMarkdown(projectRoot, "P033-GrandeGPT", "linked-create/NEW.md", Buffer.from("new\n")))
      .rejects.toMatchObject({ code: "POLICY_DENIED" });
  });

  it("updates a Markdown document only when the current full SHA matches exactly", async () => {
    const { projectRoot } = await fixture();
    const target = join(projectRoot, "P033-GrandeGPT", "PRD.md");
    const before = await readFile(target);
    const expectedSha256 = createHash("sha256").update(before).digest("hex");
    const next = Buffer.from("# PRD\nupdated content\n", "utf8");

    await expect(updateMarkdown(projectRoot, "P033-GrandeGPT", "PRD.md", next, expectedSha256)).resolves.toEqual({
      path: "PRD.md",
      sha256: createHash("sha256").update(next).digest("hex"),
      totalBytes: next.byteLength,
    });
    await expect(readFile(target)).resolves.toEqual(next);
  });

  it("returns STALE_FILE and preserves current bytes when expected SHA is stale", async () => {
    const { projectRoot } = await fixture();
    const target = join(projectRoot, "P033-GrandeGPT", "PRD.md");
    const before = await readFile(target);
    const staleSha = createHash("sha256").update("older version\n").digest("hex");

    await expect(updateMarkdown(projectRoot, "P033-GrandeGPT", "PRD.md", Buffer.from("replacement\n"), staleSha))
      .rejects.toMatchObject({ code: "STALE_FILE" });
    await expect(readFile(target)).resolves.toEqual(before);
  });

  it("maps missing and unsafe update targets to stable write-domain errors", async () => {
    const { root, projectRoot } = await fixture();
    const validSha = "0".repeat(64);
    await expect(updateMarkdown(projectRoot, "P033-GrandeGPT", "missing.md", Buffer.from("new\n"), validSha))
      .rejects.toMatchObject({ code: "FILE_NOT_FOUND" });

    const outside = join(root, "outside-update.md");
    await writeFile(outside, "outside\n", "utf8");
    await symlink(outside, join(projectRoot, "P033-GrandeGPT", "linked-update.md"));
    await expect(updateMarkdown(projectRoot, "P033-GrandeGPT", "linked-update.md", Buffer.from("new\n"), validSha))
      .rejects.toMatchObject({ code: "POLICY_DENIED" });
  });
});
