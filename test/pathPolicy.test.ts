import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCreatableMarkdown, resolveExistingMarkdown, resolveProjectDirectory } from "../src/pathPolicy.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "grande-obsidian-policy-"));
  roots.push(root);
  const projectRoot = join(root, "10_Projects", "Active");
  const project = "P033-GrandeGPT";
  await mkdir(join(projectRoot, project, "design"), { recursive: true });
  await writeFile(join(projectRoot, project, "design", "architecture.md"), "# Architecture\n", "utf8");
  return { root, projectRoot, project };
}

describe("project path policy", () => {
  it("resolves a real direct-child project and Markdown document", async () => {
    const { projectRoot, project } = await fixture();
    await expect(resolveProjectDirectory(projectRoot, project)).resolves.toBe(join(projectRoot, project));
    await expect(resolveExistingMarkdown(projectRoot, project, "design/architecture.md"))
      .resolves.toBe(join(projectRoot, project, "design", "architecture.md"));
  });

  it.each(["../secret.md", "/tmp/secret.md", ".obsidian/plugins/x.md", "design\\architecture.md", "design/readme.txt"])(
    "rejects unsafe document path %s",
    async (path) => {
      const { projectRoot, project } = await fixture();
      await expect(resolveExistingMarkdown(projectRoot, project, path)).rejects.toThrow();
    },
  );

  it("rejects spoofing/control characters in logical paths", async () => {
    const { projectRoot, project } = await fixture();
    await expect(resolveExistingMarkdown(projectRoot, project, "design/evil\u202E.md")).rejects.toThrow();
    await expect(resolveExistingMarkdown(projectRoot, project, "design/evil\n.md")).rejects.toThrow();
  });

  it("rejects a symlinked project", async () => {
    const { root, projectRoot } = await fixture();
    const outside = join(root, "outside-project");
    await mkdir(outside);
    await symlink(outside, join(projectRoot, "P099-Alias"));
    await expect(resolveProjectDirectory(projectRoot, "P099-Alias")).rejects.toThrow(/symbolic link/i);
  });

  it("rejects a symlink anywhere inside a document path", async () => {
    const { root, projectRoot, project } = await fixture();
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "secret.md"), "secret", "utf8");
    await symlink(outside, join(projectRoot, project, "linked"));
    await expect(resolveExistingMarkdown(projectRoot, project, "linked/secret.md")).rejects.toThrow(/symbolic link/i);
  });

  it("resolves an absent Markdown target only when every parent already exists", async () => {
    const { projectRoot, project } = await fixture();
    await expect(resolveCreatableMarkdown(projectRoot, project, "design/new.md"))
      .resolves.toBe(join(projectRoot, project, "design", "new.md"));
    await expect(resolveCreatableMarkdown(projectRoot, project, "missing/new.md"))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an existing create target without changing it", async () => {
    const { projectRoot, project } = await fixture();
    await expect(resolveCreatableMarkdown(projectRoot, project, "design/architecture.md"))
      .rejects.toMatchObject({ code: "ALREADY_EXISTS" });
  });

  it("rejects unsafe create paths and symlink targets", async () => {
    const { root, projectRoot, project } = await fixture();
    const outside = join(root, "outside-create.md");
    await writeFile(outside, "outside\n", "utf8");
    await symlink(outside, join(projectRoot, project, "design", "linked.md"));

    for (const path of ["../new.md", ".hidden/new.md", "design/new.txt", "design/linked.md"]) {
      await expect(resolveCreatableMarkdown(projectRoot, project, path)).rejects.toThrow();
    }
  });
});
