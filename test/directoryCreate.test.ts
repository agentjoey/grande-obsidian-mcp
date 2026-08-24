import { mkdir, mkdtemp, lstat, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCreatableDirectory } from "../src/pathPolicy.js";
import { createDirectory } from "../src/vaultFs.js";
import { WriteDomainError } from "../src/writeErrors.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "grande-obsidian-directory-"));
  roots.push(root);
  const projectRoot = join(root, "10_Projects", "Active");
  const project = "P033-GrandeGPT";
  await mkdir(join(projectRoot, project, "design"), { recursive: true });
  await writeFile(join(projectRoot, project, "PRD.md"), "# PRD\n", "utf8");
  return { root, projectRoot, project };
}

async function expectMissing(path: string): Promise<void> {
  await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("safe directory creation", () => {
  it("creates one absent directory leaf and reports only its logical path", async () => {
    const { projectRoot, project } = await fixture();
    await expect(createDirectory(projectRoot, project, "design/archive"))
      .resolves.toEqual({ path: "design/archive" });

    const stat = await lstat(join(projectRoot, project, "design", "archive"));
    expect(stat.isDirectory()).toBe(true);
    expect(stat.isSymbolicLink()).toBe(false);
  });

  it("never creates missing parents", async () => {
    const { projectRoot, project } = await fixture();
    const parent = join(projectRoot, project, "missing");
    await expect(createDirectory(projectRoot, project, "missing/child"))
      .rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    await expectMissing(parent);
  });

  it("never replaces existing directory or file targets", async () => {
    const { projectRoot, project } = await fixture();
    await expect(createDirectory(projectRoot, project, "design"))
      .rejects.toMatchObject({ code: "FILE_EXISTS" });

    const before = await readFile(join(projectRoot, project, "PRD.md"));
    await expect(createDirectory(projectRoot, project, "PRD.md"))
      .rejects.toMatchObject({ code: "FILE_EXISTS" });
    await expect(readFile(join(projectRoot, project, "PRD.md"))).resolves.toEqual(before);
  });

  it("maps a target symlink to POLICY_DENIED", async () => {
    const { root, projectRoot, project } = await fixture();
    const outside = join(root, "outside-target");
    await mkdir(outside);
    await symlink(outside, join(projectRoot, project, "design", "linked"));
    await expect(createDirectory(projectRoot, project, "design/linked"))
      .rejects.toMatchObject({ code: "POLICY_DENIED" });
  });

  it("allows only one concurrent create winner", async () => {
    const { projectRoot, project } = await fixture();
    const calls = await Promise.allSettled([
      createDirectory(projectRoot, project, "design/race"),
      createDirectory(projectRoot, project, "design/race"),
    ]);

    expect(calls.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = calls.find((result) => result.status === "rejected");
    expect(rejection).toMatchObject({ reason: { code: "FILE_EXISTS" } });
  });

  it("fails closed when the parent becomes a symlink before mkdir", async () => {
    const { root, projectRoot, project } = await fixture();
    const parent = join(projectRoot, project, "design");
    const outside = join(root, "outside-race");
    await mkdir(outside);
    let calls = 0;
    let mkdirCalled = false;

    await expect(createDirectory(projectRoot, project, "design/archive", {
      resolveCreatableDirectory: async (...args) => {
        const resolved = await resolveCreatableDirectory(...args);
        if (++calls === 1) {
          await rm(parent, { recursive: true });
          await symlink(outside, parent);
        }
        return resolved;
      },
      mkdir: async () => {
        mkdirCalled = true;
      },
    })).rejects.toMatchObject({ code: "POLICY_DENIED" });

    expect(mkdirCalled).toBe(false);
    await expectMissing(join(outside, "archive"));
  });

  it("does not report success or destructively roll back when verification fails", async () => {
    const { projectRoot, project } = await fixture();
    const target = join(projectRoot, project, "design", "verify-fail");

    await expect(createDirectory(projectRoot, project, "design/verify-fail", {
      verifyCreatedDirectory: async () => {
        throw new WriteDomainError("VERIFY_FAILED", "created directory could not be verified");
      },
    })).rejects.toMatchObject({ code: "VERIFY_FAILED" });

    const stat = await lstat(target);
    expect(stat.isDirectory()).toBe(true);
  });
});
