import { createHash } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExclusiveRenameError } from "../src/exclusiveRename.js";
import {
  createMarkdown,
  listMarkdownEntries,
  listProjects,
  moveMarkdown,
  readMarkdown,
  updateMarkdown,
  type MoveDependencies,
} from "../src/vaultFs.js";

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

function digest(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function nodeCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
}

const fakeExclusiveRename: MoveDependencies["exclusiveRename"] = async (
  projectDirectory,
  sourceRelativePath,
  targetRelativePath,
) => {
  const source = join(projectDirectory, sourceRelativePath);
  const target = join(projectDirectory, targetRelativePath);
  try {
    await lstat(target);
    throw new ExclusiveRenameError("EEXIST");
  } catch (error) {
    if (error instanceof ExclusiveRenameError) throw error;
    if (nodeCode(error) !== "ENOENT") throw error;
  }
  await rename(source, target);
};

async function expectMissing(path: string): Promise<void> {
  await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
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
    expect(result.sha256).toBe(digest(full));
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
      sha256: digest(content),
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
    const expectedSha256 = digest(before);
    const next = Buffer.from("# PRD\nupdated content\n", "utf8");

    await expect(updateMarkdown(projectRoot, "P033-GrandeGPT", "PRD.md", next, expectedSha256)).resolves.toEqual({
      path: "PRD.md",
      sha256: digest(next),
      totalBytes: next.byteLength,
    });
    await expect(readFile(target)).resolves.toEqual(next);
  });

  it("returns STALE_FILE and preserves current bytes when expected SHA is stale", async () => {
    const { projectRoot } = await fixture();
    const target = join(projectRoot, "P033-GrandeGPT", "PRD.md");
    const before = await readFile(target);
    const staleSha = digest("older version\n");

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

  it.each([
    ["Inbox/a.md", "Inbox/renamed.md"],
    ["Inbox/a.md", "Archive/a.md"],
  ])("moves %s to %s with exact bytes, SHA, byte count, and filesystem identity", async (sourcePath, targetPath) => {
    const { projectRoot } = await fixture();
    const projectPath = join(projectRoot, "P033-GrandeGPT");
    await mkdir(join(projectPath, "Inbox"));
    await mkdir(join(projectPath, "Archive"));
    const source = join(projectPath, sourcePath);
    const target = join(projectPath, targetPath);
    const content = Buffer.from("# Move me\nexact bytes\n", "utf8");
    await writeFile(source, content);
    const before = await lstat(source);

    await expect(moveMarkdown(projectRoot, "P033-GrandeGPT", sourcePath, targetPath, digest(content), {
      exclusiveRename: fakeExclusiveRename,
    })).resolves.toEqual({ sourcePath, targetPath, sha256: digest(content), totalBytes: content.byteLength });

    const after = await lstat(target);
    expect([after.dev, after.ino]).toEqual([before.dev, before.ino]);
    await expect(readFile(target)).resolves.toEqual(content);
    await expectMissing(source);
  });

  it("never overwrites an existing move target and preserves both files", async () => {
    const { projectRoot } = await fixture();
    const projectPath = join(projectRoot, "P033-GrandeGPT");
    await mkdir(join(projectPath, "Inbox"));
    await mkdir(join(projectPath, "Archive"));
    const source = join(projectPath, "Inbox/a.md");
    const target = join(projectPath, "Archive/a.md");
    const sourceBytes = Buffer.from("source\n");
    const targetBytes = Buffer.from("target\n");
    await writeFile(source, sourceBytes);
    await writeFile(target, targetBytes);

    await expect(moveMarkdown(projectRoot, "P033-GrandeGPT", "Inbox/a.md", "Archive/a.md", digest(sourceBytes), {
      exclusiveRename: fakeExclusiveRename,
    })).rejects.toMatchObject({ code: "FILE_EXISTS" });
    await expect(readFile(source)).resolves.toEqual(sourceBytes);
    await expect(readFile(target)).resolves.toEqual(targetBytes);
  });

  it("rejects identical logical source and target before mutation", async () => {
    const { projectRoot } = await fixture();
    const content = await readFile(join(projectRoot, "P033-GrandeGPT", "PRD.md"));
    await expect(moveMarkdown(projectRoot, "P033-GrandeGPT", "PRD.md", "PRD.md", digest(content), {
      exclusiveRename: fakeExclusiveRename,
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects a stale caller SHA before mutation", async () => {
    const { projectRoot } = await fixture();
    const source = join(projectRoot, "P033-GrandeGPT", "PRD.md");
    const before = await readFile(source);
    await expect(moveMarkdown(projectRoot, "P033-GrandeGPT", "PRD.md", "moved.md", digest("older\n"), {
      exclusiveRename: fakeExclusiveRename,
    })).rejects.toMatchObject({ code: "STALE_FILE" });
    await expect(readFile(source)).resolves.toEqual(before);
    await expectMissing(join(projectRoot, "P033-GrandeGPT", "moved.md"));
  });

  it("revalidates bytes immediately before rename and refuses a mutation-time change", async () => {
    const { projectRoot } = await fixture();
    const projectPath = join(projectRoot, "P033-GrandeGPT");
    const source = join(projectPath, "PRD.md");
    const original = await readFile(source);
    let calls = 0;
    const dependencies = {} as MoveDependencies;
    Object.defineProperty(dependencies, "exclusiveRename", {
      get() {
        writeFileSync(source, "changed between guard and rename\n");
        return (async (...args: Parameters<MoveDependencies["exclusiveRename"]>) => {
          calls += 1;
          return fakeExclusiveRename(...args);
        }) as MoveDependencies["exclusiveRename"];
      },
    });

    await expect(moveMarkdown(projectRoot, "P033-GrandeGPT", "PRD.md", "moved.md", digest(original), dependencies))
      .rejects.toMatchObject({ code: "STALE_FILE" });
    expect(calls).toBe(0);
    await expectMissing(join(projectPath, "moved.md"));
  });

  it("revalidates source identity immediately before rename even when replacement bytes are identical", async () => {
    const { projectRoot } = await fixture();
    const projectPath = join(projectRoot, "P033-GrandeGPT");
    const source = join(projectPath, "PRD.md");
    const original = await readFile(source);
    const before = await lstat(source);
    let calls = 0;
    const dependencies = {} as MoveDependencies;
    Object.defineProperty(dependencies, "exclusiveRename", {
      get() {
        const replacement = join(projectPath, ".replacement.md");
        writeFileSync(replacement, original);
        renameSync(replacement, source);
        return (async (...args: Parameters<MoveDependencies["exclusiveRename"]>) => {
          calls += 1;
          return fakeExclusiveRename(...args);
        }) as MoveDependencies["exclusiveRename"];
      },
    });

    await expect(moveMarkdown(projectRoot, "P033-GrandeGPT", "PRD.md", "moved.md", digest(original), dependencies))
      .rejects.toMatchObject({ code: "STALE_FILE" });
    const after = await lstat(source);
    expect([after.dev, after.ino]).not.toEqual([before.dev, before.ino]);
    expect(calls).toBe(0);
    await expectMissing(join(projectPath, "moved.md"));
  });

  it("rechecks target absence immediately before rename", async () => {
    const { projectRoot } = await fixture();
    const projectPath = join(projectRoot, "P033-GrandeGPT");
    const source = join(projectPath, "PRD.md");
    const target = join(projectPath, "moved.md");
    const original = await readFile(source);
    let calls = 0;
    const dependencies = {} as MoveDependencies;
    Object.defineProperty(dependencies, "exclusiveRename", {
      get() {
        writeFileSync(target, "competitor\n");
        return (async (...args: Parameters<MoveDependencies["exclusiveRename"]>) => {
          calls += 1;
          return fakeExclusiveRename(...args);
        }) as MoveDependencies["exclusiveRename"];
      },
    });

    await expect(moveMarkdown(projectRoot, "P033-GrandeGPT", "PRD.md", "moved.md", digest(original), dependencies))
      .rejects.toMatchObject({ code: "FILE_EXISTS" });
    expect(calls).toBe(0);
    await expect(readFile(source)).resolves.toEqual(original);
    await expect(readFile(target, "utf8")).resolves.toBe("competitor\n");
  });

  it("safely reverses the same moved identity and returns STALE_FILE only after exact restoration", async () => {
    const { projectRoot } = await fixture();
    const projectPath = join(projectRoot, "P033-GrandeGPT");
    const sourceRel = "PRD.md";
    const targetRel = "moved.md";
    const source = join(projectPath, sourceRel);
    const target = join(projectPath, targetRel);
    const original = await readFile(source);
    let calls = 0;
    const injected: MoveDependencies["exclusiveRename"] = async (directory, from, to) => {
      calls += 1;
      if (calls === 1) {
        await fakeExclusiveRename(directory, from, to);
        writeFileSync(target, "post-rename mutation\n");
        return;
      }
      writeFileSync(target, original);
      await fakeExclusiveRename(directory, from, to);
    };

    await expect(moveMarkdown(projectRoot, "P033-GrandeGPT", sourceRel, targetRel, digest(original), {
      exclusiveRename: injected,
    })).rejects.toMatchObject({ code: "STALE_FILE" });
    expect(calls).toBe(2);
    await expect(readFile(source)).resolves.toEqual(original);
    await expectMissing(target);
  });

  it("does not reverse a post-rename target that is no longer the guarded source identity", async () => {
    const { projectRoot } = await fixture();
    const projectPath = join(projectRoot, "P033-GrandeGPT");
    const source = join(projectPath, "PRD.md");
    const target = join(projectPath, "moved.md");
    const original = await readFile(source);
    const before = await lstat(source);
    let calls = 0;
    const injected: MoveDependencies["exclusiveRename"] = async (directory, from, to) => {
      calls += 1;
      await fakeExclusiveRename(directory, from, to);
      const replacement = join(projectPath, ".other-identity.md");
      writeFileSync(replacement, original);
      renameSync(replacement, target);
    };

    await expect(moveMarkdown(projectRoot, "P033-GrandeGPT", "PRD.md", "moved.md", digest(original), {
      exclusiveRename: injected,
    })).rejects.toMatchObject({ code: "VERIFY_FAILED" });
    expect(calls).toBe(1);
    const after = await lstat(target);
    expect([after.dev, after.ino]).not.toEqual([before.dev, before.ino]);
    await expectMissing(source);
    await expect(readFile(target)).resolves.toEqual(original);
  });

  it("returns VERIFY_FAILED without destructive cleanup when safe reverse rename fails", async () => {
    const { projectRoot } = await fixture();
    const projectPath = join(projectRoot, "P033-GrandeGPT");
    const source = join(projectPath, "PRD.md");
    const target = join(projectPath, "moved.md");
    const original = await readFile(source);
    let calls = 0;
    const injected: MoveDependencies["exclusiveRename"] = async (directory, from, to) => {
      calls += 1;
      if (calls === 1) {
        await fakeExclusiveRename(directory, from, to);
        writeFileSync(target, "post-rename mutation\n");
        return;
      }
      throw new ExclusiveRenameError("EEXIST");
    };

    await expect(moveMarkdown(projectRoot, "P033-GrandeGPT", "PRD.md", "moved.md", digest(original), {
      exclusiveRename: injected,
    })).rejects.toMatchObject({ code: "VERIFY_FAILED" });
    expect(calls).toBe(2);
    await expectMissing(source);
    await expect(readFile(target, "utf8")).resolves.toBe("post-rename mutation\n");
  });
});
