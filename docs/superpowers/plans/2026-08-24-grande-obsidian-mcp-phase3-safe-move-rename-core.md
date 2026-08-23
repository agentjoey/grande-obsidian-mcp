# grande-obsidian-mcp Phase 3 / Safe Move & Rename Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add exactly one seventh public capability, `move_project_document`, for safe same-project Markdown move/rename guarded by exact source SHA and Darwin destination-exclusive rename semantics.

**Architecture:** Keep the existing `tools.ts -> ProjectService -> vaultFs -> pathPolicy/file primitive` layering. Add one tiny Darwin `renameatx_np` helper plus a no-shell Node wrapper; keep path/SHA/identity/recovery semantics in `vaultFs`, then expose the MCP tool only after the primitive and domain move are independently proven.

**Tech Stack:** Node.js 24, TypeScript 5.9, Vitest 4, pnpm 10, macOS/Darwin C helper compiled with `/usr/bin/clang`, existing MCP SDK and launchd packaging.

**Spec:** `docs/superpowers/specs/2026-08-24-grande-obsidian-mcp-phase3-safe-move-rename-design.md`

## Global Constraints

- Markdown only (`.md`).
- Phase 3 adds exactly one public tool: `move_project_document`; final public surface is exactly seven tools.
- `project` means exact `list_projects.directory`, never `list_projects.id`.
- Same-project only. No `sourceProject`/`targetProject` API.
- Required input exactly: `project`, `sourcePath`, `targetPath`, `expectedSha256`.
- `expectedSha256` is exact lowercase 64-char full-document SHA returned by `read_project_document`.
- Destination must be absent; no overwrite/force/replace.
- Destination parent must already exist; no mkdir.
- Document bytes must not intentionally change; no wikilink/backlink/Markdown-link/frontmatter rewriting.
- No directory move, cross-project move, delete, batch/glob move, case-only rename protocol, copy-delete fallback, Obsidian CLI/plugin API, locks, database/index/cache, or background workers.
- Native scope is one internal Darwin helper only. No Node addon, FFI framework, generic filesystem CLI, shell command, or committed binary.
- Required syscall: `renameatx_np` with `RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH`, anchored to an opened real project directory.
- If those flags/filesystem semantics are unavailable, `/usr/bin/clang` or helper execution is blocked by the controlled environment, or correctness needs weaker semantics, stop for Human Owner review.
- Stable public write errors remain exactly: `FILE_EXISTS`, `FILE_NOT_FOUND`, `STALE_FILE`, `INVALID_INPUT`, `POLICY_DENIED`, `WRITE_FAILED`, `VERIFY_FAILED`.
- TDD for production behavior: write RED test, observe intended failure, implement minimum GREEN, run full `unit`, then `typecheck` at each task boundary.

---

## File Map

**Create**
- `native/rename-excl.c` — one project-anchored exclusive rename syscall.
- `src/exclusiveRename.ts` — no-shell Node wrapper and narrow internal error.
- `ops/native/buildRenameExcl.ts` — deterministic clang build utility.
- `test/exclusiveRename.test.ts` — real native primitive feasibility and wrapper behavior.
- `test/nativeBuild.test.ts` — deterministic build coverage.

**Modify**
- `.gitignore` — ignore `native/bin/`.
- `package.json` — add `native:build`, leave existing scripts unchanged.
- `ops/launchd/install.ts` / `test/launchd.test.ts` — build canonical helper before LaunchAgent bootstrap.
- `src/pathPolicy.ts` / `test/pathPolicy.test.ts` — absent move-target validation with existing real parent.
- `src/vaultFs.ts` / `test/vaultFs.test.ts` — guarded snapshot, move, race verification and recovery.
- `src/projectService.ts` / `test/projectService.test.ts` — service method and SHA validation.
- `src/tools.ts` / `test/tools.test.ts` — seventh tool and exact schema/annotations.
- `test/server.test.ts`, `test/runtime.test.ts` — seven-tool registration/runtime regression.
- `src/writeErrors.ts` only if Create-specific messages need generic wording; no new code values.

---

### Task 1: P3-0 Darwin exclusive rename primitive

**Files**
- Create: `native/rename-excl.c`
- Create: `src/exclusiveRename.ts`
- Create: `test/exclusiveRename.test.ts`

**Produces**

```ts
export type ExclusiveRenameFailure =
  | "EEXIST" | "ENOENT" | "EXDEV" | "ELOOP" | "ENOTDIR"
  | "EINVAL" | "ENOTSUP" | "EPERM" | "EACCES" | "UNKNOWN";

export class ExclusiveRenameError extends Error {
  readonly failure: ExclusiveRenameFailure;
}

export async function exclusiveRename(
  projectDirectory: string,
  sourceRelativePath: string,
  targetRelativePath: string,
  helperPath?: string,
): Promise<void>;
```

Helper argv is exactly `<project-directory> <source-relative-path> <target-relative-path>`. Success stdout is `OK\n`; failure stdout is `ERR <TOKEN>\n`. No helper flags are user-configurable.

- [ ] **Step 1: RED test for destination exclusivity**

Create `test/exclusiveRename.test.ts` with a local compiler:

```ts
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function compileHelper(output: string): void {
  const result = spawnSync("/usr/bin/clang", [
    "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2",
    resolve("native/rename-excl.c"), "-o", output,
  ], { encoding: "utf8" });
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

it("never replaces an existing destination", async () => {
  const root = await mkdtemp(join(tmpdir(), "gomcp-rename-excl-"));
  const helper = join(root, "rename-excl");
  compileHelper(helper);
  await writeFile(join(root, "source.md"), "source");
  await writeFile(join(root, "target.md"), "target");
  const run = spawnSync(helper, [root, "source.md", "target.md"], { encoding: "utf8" });
  expect(run.status).not.toBe(0);
  expect(run.stdout).toBe("ERR EEXIST\n");
  await expect(readFile(join(root, "source.md"), "utf8")).resolves.toBe("source");
  await expect(readFile(join(root, "target.md"), "utf8")).resolves.toBe("target");
});
```

Run `grande_run(profile="unit")`.

Expected RED: clang fails because `native/rename-excl.c` is absent. If `/usr/bin/clang` itself is denied by the sandbox, that is a P3-0 stop condition, not permission to use another unsafe execution route.

- [ ] **Step 2: Minimal C helper**

Create `native/rename-excl.c`:

```c
#define _DARWIN_C_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>

#ifndef RENAME_EXCL
#error "RENAME_EXCL is required"
#endif
#ifndef RENAME_NOFOLLOW_ANY
#error "RENAME_NOFOLLOW_ANY is required"
#endif
#ifndef RENAME_RESOLVE_BENEATH
#error "RENAME_RESOLVE_BENEATH is required"
#endif

static const char *token_for_errno(int value) {
  switch (value) {
    case EEXIST: return "EEXIST";
    case ENOENT: return "ENOENT";
    case EXDEV: return "EXDEV";
    case ELOOP: return "ELOOP";
    case ENOTDIR: return "ENOTDIR";
    case EINVAL: return "EINVAL";
#ifdef ENOTSUP
    case ENOTSUP: return "ENOTSUP";
#endif
    case EPERM: return "EPERM";
    case EACCES: return "EACCES";
    default: return "UNKNOWN";
  }
}

static int valid_relative(const char *path) {
  if (path == NULL || path[0] == '\0' || path[0] == '/') return 0;
  const char *segment = path;
  for (const char *p = path;; p++) {
    if (*p == '/' || *p == '\0') {
      size_t length = (size_t)(p - segment);
      if (length == 0) return 0;
      if (length == 1 && segment[0] == '.') return 0;
      if (length == 2 && segment[0] == '.' && segment[1] == '.') return 0;
      if (*p == '\0') break;
      segment = p + 1;
    }
  }
  return 1;
}

int main(int argc, char **argv) {
  if (argc != 4 || !valid_relative(argv[2]) || !valid_relative(argv[3])) {
    fputs("ERR EINVAL\n", stdout);
    return 2;
  }
  int fd = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (fd < 0) {
    printf("ERR %s\n", token_for_errno(errno));
    return 1;
  }
  int result = renameatx_np(
    fd, argv[2], fd, argv[3],
    RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH
  );
  int saved = errno;
  close(fd);
  if (result == 0) {
    fputs("OK\n", stdout);
    return 0;
  }
  printf("ERR %s\n", token_for_errno(saved));
  return 1;
}
```

No fallback to ordinary `rename`, `mv`, hard-link/unlink or copy/delete.

Run `unit`. Expected GREEN for the target-preservation test. If required macros or syscall are unavailable, stop.

- [ ] **Step 3: Add real success and symlink tests**

Add one success case and one symlink-parent case:

```ts
it("moves a file with exclusive rename", async () => {
  const root = await mkdtemp(join(tmpdir(), "gomcp-rename-ok-"));
  const helper = join(root, "rename-excl");
  compileHelper(helper);
  await writeFile(join(root, "source.md"), "bytes");
  const run = spawnSync(helper, [root, "source.md", "target.md"], { encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  expect(run.stdout).toBe("OK\n");
  await expect(readFile(join(root, "target.md"), "utf8")).resolves.toBe("bytes");
});

it("rejects a symlinked parent", async () => {
  const root = await mkdtemp(join(tmpdir(), "gomcp-rename-link-"));
  const outside = await mkdtemp(join(tmpdir(), "gomcp-rename-outside-"));
  const helper = join(root, "rename-excl");
  compileHelper(helper);
  await writeFile(join(outside, "source.md"), "outside");
  await symlink(outside, join(root, "linked"));
  const run = spawnSync(helper, [root, "linked/source.md", "target.md"], { encoding: "utf8" });
  expect(run.status).not.toBe(0);
  expect(run.stdout).toMatch(/^ERR (ELOOP|EPERM|EACCES|ENOTDIR)\n$/);
});
```

Run `unit`; both must pass.

- [ ] **Step 4: RED then GREEN Node wrapper**

First add a dynamic-import assertion and run `unit`; expected RED because `src/exclusiveRename.ts` is absent:

```ts
await expect(import("../src/exclusiveRename.js")).resolves.toHaveProperty("exclusiveRename");
```

Then create `src/exclusiveRename.ts` using `spawn(..., { shell:false })`, collect only stdout, require exact `OK\n` or `ERR TOKEN\n`, and throw `ExclusiveRenameError` for failure. Default helper path is:

```ts
export function defaultExclusiveRenameHelperPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../native/bin/rename-excl");
}
```

The wrapper must never return raw stderr, host paths, or process detail through its public error message.

Add tests calling the wrapper against the compiled test helper for success and `EEXIST`.

Run `unit`, then `typecheck`; both pass.

- [ ] **Step 5: Commit Task 1**

Commit: `feat: add Darwin exclusive rename primitive`

---

### Task 2: Deterministic helper build and launchd packaging

**Files**
- Create: `ops/native/buildRenameExcl.ts`
- Create: `test/nativeBuild.test.ts`
- Modify: `.gitignore`, `package.json`, `ops/launchd/install.ts`, `test/launchd.test.ts`

**Produces**

```ts
export function renameExclSourcePath(repoRoot: string): string;
export function renameExclBinaryPath(repoRoot: string): string;
export function buildRenameExcl(repoRoot: string): string;
```

- [ ] **Step 1: RED build-module test**

Create `test/nativeBuild.test.ts` that dynamically imports `buildRenameExcl`, calls it on `resolve(".")`, and asserts returned path is `resolve("native/bin/rename-excl")` and is executable/readable. Run `unit`; expected RED because module does not exist.

- [ ] **Step 2: Implement exact build utility**

Create `ops/native/buildRenameExcl.ts` using `spawnSync("/usr/bin/clang", fixedArgv, { shell:false })`; compile with the same flags as Task 1, `mkdirSync(dirname(binary), {recursive:true})`, then `chmodSync(binary, 0o755)`.

Entry-point behavior must be exact and import-safe:

```ts
import { fileURLToPath } from "node:url";

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  buildRenameExcl(resolve("."));
}
```

- [ ] **Step 3: Repo packaging**

Append `native/bin/` to `.gitignore`.

Add only this new package script:

```json
"native:build": "node --disable-warning=ExperimentalWarning ops/native/buildRenameExcl.ts"
```

Do not alter existing test/typecheck/start/launchd commands.

- [ ] **Step 4: launchd install builds canonical helper**

Import `buildRenameExcl` into `ops/launchd/install.ts`. After existing canonical repo/dependency/config/token validation and before plist bootstrap:

```ts
const renameHelper = buildRenameExcl(repoRoot);
if (!existsSync(renameHelper)) fail(`exclusive rename helper was not built: ${renameHelper}`);
```

Existing refusal to install from `.grande-work/worktrees` remains unchanged.

Extend `test/launchd.test.ts` to assert installer contains `buildRenameExcl` and still uses canonical `repoRoot`. Extend package-script test to assert exact `native:build` value.

- [ ] **Step 5: Fresh verification and binary hygiene**

Run `unit`, then `typecheck`.

Use `grande_diff` and verify `native/bin/rename-excl` is absent from tracked diff. If it appears, fix `.gitignore` before commit.

- [ ] **Step 6: Commit Task 2**

Commit: `build: package exclusive rename helper`

---

### Task 3: Move path policy and SHA/identity domain semantics

**Files**
- Modify: `src/pathPolicy.ts`, `test/pathPolicy.test.ts`, `src/vaultFs.ts`, `test/vaultFs.test.ts`
- Modify `src/writeErrors.ts` only if wording must be generalized; no new codes.

**Consumes** `exclusiveRename()` from Task 1.

**Produces**

```ts
export interface MarkdownMove {
  sourcePath: string;
  targetPath: string;
  sha256: string;
  totalBytes: number;
}

export async function resolveMoveTargetMarkdown(
  projectRootPath: string,
  project: string,
  documentPath: string,
): Promise<string>;

export async function moveMarkdown(
  projectRootPath: string,
  project: string,
  sourcePath: string,
  targetPath: string,
  expectedSha256: string,
  renameFile?: typeof exclusiveRename,
): Promise<MarkdownMove>;
```

The optional rename dependency is internal deterministic race-test injection only; normal service calls omit it.

- [ ] **Step 1: RED target-policy tests**

Add tests for valid absent target, missing parent=`NOT_FOUND`, existing target=`ALREADY_EXISTS`, hidden/traversal/non-md=`INVALID_INPUT`, and symlinked parent=`PATH_ESCAPE`. Run `unit`; expected RED because `resolveMoveTargetMarkdown` is absent.

- [ ] **Step 2: Minimal target resolver**

Extract the existing create-target walk into a private helper:

```ts
async function resolveAbsentMarkdown(
  projectRootPath: string,
  project: string,
  documentPath: string,
  targetLabel: "create target" | "move target",
): Promise<string> { /* existing real-parent + absent-final semantics */ }
```

`resolveCreatableMarkdown()` delegates with `"create target"`; new `resolveMoveTargetMarkdown()` delegates with `"move target"`. Existing create tests must remain unchanged/green.

Run `unit`.

- [ ] **Step 3: Deterministic native setup for vaultFs tests**

Do not depend on Vitest file ordering. In `test/vaultFs.test.ts`:

```ts
import { beforeAll } from "vitest";
import { resolve } from "node:path";
import { buildRenameExcl } from "../ops/native/buildRenameExcl.js";
import { exclusiveRename } from "../src/exclusiveRename.js";

let helperPath: string;
beforeAll(() => { helperPath = buildRenameExcl(resolve(".")); });

const realRename: typeof exclusiveRename = (projectDirectory, source, target) =>
  exclusiveRename(projectDirectory, source, target, helperPath);
```

All domain tests that need a real rename pass `realRename`; test order is irrelevant.

- [ ] **Step 4: RED happy-path move test**

Create source + existing target parent, compute expected SHA, call:

```ts
await expect(moveMarkdown(
  root, project, "Inbox/source.md", "Archive/target.md", expectedSha, realRename,
)).resolves.toEqual({
  sourcePath: "Inbox/source.md",
  targetPath: "Archive/target.md",
  sha256: expectedSha,
  totalBytes: bytes.byteLength,
});
```

Assert target bytes equal original and source is absent. Run `unit`; expected RED because `moveMarkdown` is absent.

- [ ] **Step 5: Implement guarded snapshot bound to one opened file**

In `vaultFs.ts`, import `open` and add:

```ts
interface FileIdentity { dev: bigint; ino: bigint; }
interface GuardedSnapshot {
  identity: FileIdentity;
  content: Buffer;
  sha256: string;
  totalBytes: number;
}

async function readGuardedSnapshot(path: string): Promise<GuardedSnapshot> {
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile()) throw new WriteDomainError("FILE_NOT_FOUND", "document is not a regular file");
    const content = await handle.readFile();
    return {
      identity: { dev: stat.dev, ino: stat.ino },
      content,
      sha256: sha256(content),
      totalBytes: content.byteLength,
    };
  } finally {
    await handle.close();
  }
}

function sameIdentity(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}
```

Do not refactor Phase 2 read/update through this helper unless a compile error strictly requires it.

- [ ] **Step 6: Minimal move through final pre-syscall revalidation**

Implement:

```ts
if (sourcePath === targetPath) {
  throw new WriteDomainError("INVALID_INPUT", "sourcePath and targetPath must differ");
}
const projectPath = await resolveProjectDirectory(projectRootPath, project);
const sourceAbsolute = await resolveExistingMarkdown(projectRootPath, project, sourcePath);
const targetAbsolute = await resolveMoveTargetMarkdown(projectRootPath, project, targetPath);
const initial = await readGuardedSnapshot(sourceAbsolute);
if (initial.sha256 !== expectedSha256) throw new WriteDomainError("STALE_FILE", "document has changed since it was read");

const sourceAgain = await resolveExistingMarkdown(projectRootPath, project, sourcePath);
const targetAgain = await resolveMoveTargetMarkdown(projectRootPath, project, targetPath);
if (sourceAgain !== sourceAbsolute || targetAgain !== targetAbsolute) {
  throw new WriteDomainError("POLICY_DENIED", "move path changed during validation");
}
const latest = await readGuardedSnapshot(sourceAgain);
if (latest.sha256 !== expectedSha256 || !sameIdentity(latest.identity, initial.identity)) {
  throw new WriteDomainError("STALE_FILE", "document changed before move");
}
await renameFile(projectPath, sourcePath, targetPath);
```

Catch `ExclusiveRenameError` locally and map:
- `EEXIST` -> `FILE_EXISTS`
- `ENOENT` -> `FILE_NOT_FOUND`
- `ELOOP|EPERM|EACCES` -> `POLICY_DENIED`
- `EXDEV|ENOTSUP` -> `WRITE_FAILED`
- remaining -> `WRITE_FAILED`

No raw helper detail enters public errors.

- [ ] **Step 7: Add and satisfy normal error tests**

RED/GREEN cases:
1. stale SHA -> `STALE_FILE`, source unchanged, target absent;
2. existing target -> `FILE_EXISTS`, both unchanged;
3. missing parent -> `FILE_NOT_FOUND`, no directory created;
4. hidden/traversal/non-md/symlink -> existing stable policy errors;
5. exact same source/target -> `INVALID_INPUT`;
6. `EXDEV`/`ENOTSUP` injected helper error -> `WRITE_FAILED`, no fallback.

Run `unit` after each new failing case becomes green.

- [ ] **Step 8: RED identical-bytes replacement race test**

Force a new inode with identical bytes only on the first rename call:

```ts
let renameCalls = 0;
const racingRename: typeof exclusiveRename = async (projectDirectory, source, target) => {
  renameCalls += 1;
  if (renameCalls === 1) {
    const replacement = join(projectDirectory, "replacement.md");
    await writeFile(replacement, bytes);
    await rename(replacement, join(projectDirectory, source));
  }
  await exclusiveRename(projectDirectory, source, target, helperPath);
};
```

Call `moveMarkdown(..., racingRename)`. Expected initial RED: implementation reports success even though wrong inode moved.

- [ ] **Step 9: Post-rename verification and exclusive rollback**

After successful forward rename:
1. snapshot target;
2. require target identity equals `latest.identity`, SHA equals `expectedSha256`, byte count equals `latest.totalBytes`;
3. require source path is absent; distinguish `ENOENT` from other lstat errors;
4. if any postcondition fails, call the **same** `renameFile(projectPath, targetPath, sourcePath)` for reverse exclusive rename;
5. verify restored source identity/SHA equals the actually moved target snapshot and target is absent;
6. if restoration proven -> throw `STALE_FILE`;
7. if reverse rename fails or final state cannot be proven -> throw `VERIFY_FAILED`;
8. never delete/overwrite a competing source or target during recovery.

Now the identical-bytes replacement race test must be GREEN with `STALE_FILE` and verified restoration.

- [ ] **Step 10: RED/GREEN unrecoverable competing-source race**

Inject a rename function that performs the real forward move, then creates a new competing `sourcePath` before returning. Postcheck must reject success; reverse exclusive rename must fail because source now exists; final result must be `VERIFY_FAILED`. Assert both competing source and moved target remain untouched.

Run `unit`, then `typecheck`.

- [ ] **Step 11: Commit Task 3**

Commit: `feat: add SHA guarded Markdown move`

---

### Task 4: ProjectService and seventh MCP tool

**Files**
- Modify: `src/projectService.ts`, `test/projectService.test.ts`, `src/tools.ts`, `test/tools.test.ts`, `test/server.test.ts`, `test/runtime.test.ts`

**Produces**

```ts
moveProjectDocument(
  project: string,
  sourcePath: string,
  targetPath: string,
  expectedSha256: string,
): Promise<MarkdownMove>
```

and public `move_project_document` with safe-write annotations.

- [ ] **Step 1: RED ProjectService tests**

Add one successful routing test and malformed-SHA test:

```ts
await expect(service.moveProjectDocument(project, "Inbox/a.md", "Archive/a.md", "bad"))
  .rejects.toMatchObject({ code: "INVALID_INPUT" });
```

Run `unit`; expected RED because method is absent.

- [ ] **Step 2: Minimal ProjectService method**

Extend interface and implementation:

```ts
moveProjectDocument: (project, sourcePath, targetPath, expectedSha256) =>
  moveMarkdown(
    options.projectRootPath,
    project,
    sourcePath,
    targetPath,
    expectedSha(expectedSha256),
  ),
```

Reuse existing `expectedSha()`; no second SHA validator.

Run `unit`.

- [ ] **Step 3: RED exact-seven manifest test**

Expected names exactly:

```ts
[
  "create_project_document",
  "get_project_structure",
  "list_projects",
  "move_project_document",
  "read_project_document",
  "search_project",
  "update_project_document",
]
```

Move schema required array exactly:

```ts
["project", "sourcePath", "targetPath", "expectedSha256"]
```

Property keys exactly those four. Assert annotations:

```ts
{ readOnlyHint: false, destructiveHint: false, openWorldHint: false }
```

Assert project description contains `list_projects.directory` and no `force`, `overwrite`, `createParents`, `updateLinks`, `sourceProject`, `targetProject` keys exist.

Run `unit`; expected RED because seventh tool absent.

- [ ] **Step 4: Add exactly one tool**

Extend `ToolName` and append:

```ts
{
  name: "move_project_document",
  description: "Safely move or rename one Markdown document within the same project without overwriting an existing target.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string", description: PROJECT_ARG_DESCRIPTION },
      sourcePath: { type: "string" },
      targetPath: { type: "string" },
      expectedSha256: { type: "string" },
    },
    required: ["project", "sourcePath", "targetPath", "expectedSha256"],
  },
  annotations: SAFE_WRITE,
  handler: (args) => service.moveProjectDocument(
    requiredString(args, "project"),
    requiredString(args, "sourcePath"),
    requiredString(args, "targetPath"),
    requiredString(args, "expectedSha256"),
  ),
}
```

Do not change the first six tool definitions/annotations.

- [ ] **Step 5: Server/runtime regression**

`test/server.test.ts`: expect seven registered tools and exact move annotations.

`test/runtime.test.ts`: keep all existing Phase 1/2 behavior and verify runtime tool list contains `move_project_document`. Do **not** duplicate native move execution in this test; real native behavior is deterministic in `test/exclusiveRename.test.ts` and `test/vaultFs.test.ts`, and full provider behavior is covered by S5.

No platform capability skip is permitted anywhere; P3-0 is a hard gate.

- [ ] **Step 6: Fresh verification and commit**

Run `unit`, then `typecheck`; both pass.

Commit: `feat: expose safe move MCP capability`

---

### Task 5: Load-bearing proofs, merge, canonical launchd and real S5

**Permanent files:** none beyond Tasks 1-4 unless verification exposes an approved-scope defect.

- [ ] **Step 1: Fresh pre-proof baseline**

Run `unit` and `typecheck`; both pass on exact implementation HEAD.

- [ ] **Step 2: Load-bearing proof — overwrite protection**

Temporarily replace the forward exclusive rename path with overwrite-capable Node `rename(sourceAbsolute, targetAbsolute)` only for the proof. Run unit.

Expected RED: existing-target-preservation test fails because target is replaced or required `FILE_EXISTS` disappears.

Restore approved code and run unit GREEN. If the proof stays green, strengthen test before proceeding. Never commit broken proof code.

- [ ] **Step 3: Load-bearing proof — stale SHA protection**

Temporarily bypass `expectedSha256` comparison. Run unit.

Expected RED: stale-source-preservation test fails because stale source moves or `STALE_FILE` disappears.

Restore SHA guard and run unit GREEN. If proof stays green, strengthen test. Never commit broken proof code.

- [ ] **Step 4: Scope/diff audit**

Use `grande_diff`. Search permanent implementation for accidental public/fallback behavior: `delete`, `sourceProject`, `targetProject`, `overwrite`, `force`, `createParents`, `updateLinks`, `copyFile`, `Obsidian CLI`.

References in tests/spec/non-goal text are fine; no public schema or fallback path may exist.

Verify compiled `native/bin/rename-excl` is not tracked.

- [ ] **Step 5: Final verification + attested commit**

Run fresh `unit` and `typecheck` on restored final tree. Commit only any final approved-scope fixes/tests, e.g. `test: verify safe move release invariants`. Current HEAD must have GrandeGPT attestation before PR.

- [ ] **Step 6: Push/PR/merge**

Use controlled GrandeGPT flow: `grande_push`, `grande_pr_open`, `grande_pr_status`. Require local HEAD == PR head, attestation present, CI not pending/failed, PR mergeable. `CI=none` is acceptable only under the existing lightweight-repo attestation gate.

After Human Owner merge approval call `grande_pr_merge`; record merge SHA and canonical clean fast-forward.

- [ ] **Step 7: Canonical launchd rebuild/restart**

Run existing canonical launchd install workflow. It must build `native/bin/rename-excl` from canonical source before bootstrapping/restarting provider.

Host probes:

```bash
lsof -nP -iTCP:8788 -sTCP:LISTEN
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8788/mcp
```

Expected: 8788 LISTEN and unauthenticated `HTTP 401`. If canonical native build/install fails, stop; do not accept an old six-tool process.

- [ ] **Step 8: Live tool contract**

GrandeGPT provider discovery/inspect must return exactly seven capabilities. `move_project_document` must be `risk=write`, annotations exactly `false,false,false`, schema exactly four required fields, and project description must use `list_projects.directory`.

- [ ] **Step 9: Open disposable S5 acceptance task**

Open a fresh `grande-obsidian-mcp` task solely to authorize provider write calls; no repo edits. Use a real `list_projects.directory` value and already-existing parent directories.

- [ ] **Step 10: S5-A successful move**

1. Create source v1.
2. Read source; record SHA1, bytes, exact content.
3. Move source -> target using SHA1.
4. Read target; require same SHA, bytes, content.
5. Read source; require existing read-domain not-found result.

- [ ] **Step 11: S5-B stale protection**

1. Create stale source v1.
2. Read `SHA-old`.
3. Update source to v2 through Phase 2 guarded update.
4. Move using `SHA-old`.
5. Require `STALE_FILE`.
6. Read source; v2 unchanged.
7. Read stale target; absent.

- [ ] **Step 12: S5-C existing-target protection**

1. Create source3 and distinct target3.
2. Read both; record SHA/content.
3. Move source3 -> target3 using valid source SHA.
4. Require `FILE_EXISTS`.
5. Read both; both SHA/content unchanged.

No delete is added for cleanup; acceptance documents may remain.

- [ ] **Step 13: Close acceptance task and release report**

After no jobs remain, close disposable acceptance task. Final report must include: merge SHA, P3-0 native feasibility result, final unit/typecheck, two deliberate RED proofs, live exactly-seven manifest, move SHA/byte preservation, stale preservation, target-collision preservation, port/401 evidence, and explicit confirmation that no delete/wikilink/cross-project/mkdir/overwrite capability was added.

Phase 3 is complete only when all those facts are fresh and evidenced.
