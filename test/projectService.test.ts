import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService } from "../src/projectService.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "grande-obsidian-service-"));
  roots.push(root);
  const projectRootPath = join(root, "10_Projects", "Active");
  const project = "P033-GrandeGPT";
  await mkdir(join(projectRootPath, project, "design"), { recursive: true });
  await writeFile(join(projectRootPath, project, "PRD.md"), "# PRD\nPhase 4 is complete.\n", "utf8");
  await writeFile(join(projectRootPath, project, "design", "DESIGN.md"), "# Design\nphase 4 architecture\n", "utf8");
  await writeFile(join(projectRootPath, project, "design", "ignore.txt"), "Phase 4 secret\n", "utf8");
  return { projectRootPath, project };
}

describe("project service", () => {
  it("searches Markdown only, case-insensitively, with bounded project-relative results", async () => {
    const { projectRootPath, project } = await fixture();
    const service = createProjectService({ projectRootPath });

    await expect(service.searchProject(project, "PHASE 4", 1)).resolves.toEqual({
      results: [
        { path: "PRD.md", line: 2, excerpt: "Phase 4 is complete." },
      ],
      truncated: true,
    });
  });

  it("marks search truncated when a Markdown file cannot be scanned in full", async () => {
    const { projectRootPath, project } = await fixture();
    await writeFile(join(projectRootPath, project, "large.md"), "x".repeat(256 * 1024 + 32), "utf8");
    const service = createProjectService({ projectRootPath });

    await expect(service.searchProject(project, "not-present", 20)).resolves.toEqual({
      results: [],
      truncated: true,
    });
  });

  it("rejects empty search queries", async () => {
    const { projectRootPath, project } = await fixture();
    const service = createProjectService({ projectRootPath });
    await expect(service.searchProject(project, "", 20)).rejects.toThrow();
  });

  it("delegates bounded structure and document reads through the configured root", async () => {
    const { projectRootPath, project } = await fixture();
    const service = createProjectService({ projectRootPath, maxReadBytes: 12, maxStructureEntries: 2 });

    const structure = await service.getProjectStructure(project);
    expect(structure.entries).toHaveLength(2);
    expect(structure.truncated).toBe(true);

    const read = await service.readProjectDocument(project, "PRD.md");
    expect(read.content.length).toBeLessThanOrEqual(12);
    expect(read.truncated).toBe(true);
  });

  it("creates Markdown through the configured root and returns verified metadata", async () => {
    const { projectRootPath, project } = await fixture();
    const service = createProjectService({ projectRootPath });
    const content = "# New\nservice create\n";

    await expect(service.createProjectDocument(project, "design/NEW.md", content)).resolves.toEqual({
      path: "design/NEW.md",
      sha256: createHash("sha256").update(content).digest("hex"),
      totalBytes: Buffer.byteLength(content),
    });
    await expect(readFile(join(projectRootPath, project, "design", "NEW.md"), "utf8")).resolves.toBe(content);
  });

  it("enforces the 256 KiB write limit in UTF-8 bytes", async () => {
    const { projectRootPath, project } = await fixture();
    const service = createProjectService({ projectRootPath });
    const exact = "a".repeat(256 * 1024);

    await expect(service.createProjectDocument(project, "design/exact.md", exact)).resolves.toMatchObject({
      totalBytes: 256 * 1024,
    });
    await expect(service.createProjectDocument(project, "design/too-large.md", `${exact}a`))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.createProjectDocument(project, "design/multibyte.md", "😀".repeat(65_537)))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
