import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { listMarkdownEntries, listProjects, readMarkdown } from "../src/vaultFs.js";

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
});
