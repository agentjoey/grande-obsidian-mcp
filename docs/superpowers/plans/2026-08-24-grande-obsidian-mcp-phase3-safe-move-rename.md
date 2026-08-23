# grande-obsidian-mcp Phase 3 / Safe Move & Rename Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add exactly one seventh public capability, `move_project_document`, that safely moves or renames one Markdown file within one configured project using an exact source SHA guard and a Darwin destination-exclusive rename primitive, without overwrite, content rewrite, cross-project mutation, directory creation, or weaker fallback semantics.

**Architecture:** Preserve the existing `tools.ts -> ProjectService -> vaultFs -> pathPolicy/file primitive` layering. Add one tiny Darwin helper around `renameatx_np` plus a no-shell Node wrapper; keep Markdown/SHA/source-identity semantics in `vaultFs`; expose the MCP tool only after the native primitive and domain behavior have been independently proven. The provider continues to own filesystem safety while GrandeGPT owns authorization/task binding.

**Tech Stack:** Node.js 24, TypeScript 5.9, Vitest 4, pnpm 10, macOS/Darwin C helper compiled with `/usr/bin/clang`, MCP SDK, existing launchd runtime.

**Spec:** `docs/superpowers/specs/2026-08-24-grande-obsidian-mcp-phase3-safe-move-rename-design.md`

## Global Constraints

- Public document format remains Markdown only (`.md`).
- Phase 3 adds exactly one public capability: `move_project_document`; the completed public surface is exactly seven tools.
- `project` means the exact `list_projects.directory` value, never `list_projects.id`.
- Move is same-project only; there are no `sourceProject` / `targetProject` inputs.
- `sourcePath`, `targetPath`, and `expectedSha256` are mandatory.
- `expectedSha256` is the exact lowercase 64-character full-document SHA returned by `read_project_document`.
- Target must be absent under actual filesystem semantics; no overwrite, force, replace, copy-delete fallback, or automatic retry is allowed.
- Target parent must already exist as a real directory; Phase 3 never creates directories.
- Move must preserve document bytes exactly and must not rewrite wikilinks, backlinks, Markdown links, frontmatter, aliases, headings, or blocks.
- Directory move/rename, cross-project move, delete, batch/glob move, case-only rename protocol, Obsidian CLI/plugin integration, locks, index/database/cache, and background workers remain out of scope.
- The only approved native addition is one Darwin exclusive-rename helper. No Node native addon, FFI framework, generic filesystem CLI, shell invocation, or committed compiled binary.
- The required mutation primitive is `renameatx_np` with `RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH`, anchored to an opened real project directory.
- If the required Darwin flags or filesystem semantics are unavailable, helper build/execution cannot be made reliable in the existing sandbox/launchd environment, or correctness would require weaker semantics, stop for Human Owner review.
- Stable public write-domain errors remain exactly: `FILE_EXISTS`, `FILE_NOT_FOUND`, `STALE_FILE`, `INVALID_INPUT`, `POLICY_DENIED`, `WRITE_FAILED`, `VERIFY_FAILED`.
- TDD is mandatory for production behavior: write RED, verify the intended failure, implement minimal GREEN, verify GREEN, then refactor only while green.
- No implementation task may weaken any Phase 1 or Phase 2 read/create/update invariant.

---

## File Structure

### New files

- `native/rename-excl.c` — tiny Darwin helper: open one project directory and perform exactly one `renameatx_np` call with fixed flags; emit a machine-stable result token.
- `src/exclusiveRename.ts` — no-shell Node wrapper around the helper; map helper tokens to a narrow internal error type.
- `ops/native/buildRenameExcl.ts` — deterministic `/usr/bin/clang` build utility for the helper; used by tests and launchd install.
- `test/exclusiveRename.test.ts` — P3-0 real helper/wrapper feasibility and destination/symlink/beneath behavior.
- `test/nativeBuild.test.ts` — deterministic build and binary-location coverage.

### Modified files

- `.gitignore` — ignore `native/bin/`.
- `package.json` — add exactly one `native:build` script; do not change dependency surface unless a later stop condition is approved.
- `ops/launchd/install.ts` — build/verify the helper before bootstrapping the canonical LaunchAgent.
- `test/launchd.test.ts` — prove launchd install includes helper build and still pins canonical repo/runtime.
- `src/pathPolicy.ts` — add the minimum move-target resolver for an absent Markdown target with an existing real parent.
- `test/pathPolicy.test.ts` — move target policy coverage.
- `src/vaultFs.ts` — add `MarkdownMove`, guarded source snapshot/identity checks, move orchestration, final verification, and reverse exclusive-rename recovery.
- `test/vaultFs.test.ts` — Phase 3 domain safety and deterministic race/recovery tests.
- `src/projectService.ts` — add `moveProjectDocument` and reuse exact SHA validation.
- `test/projectService.test.ts` — service routing and malformed SHA coverage.
- `src/tools.ts` — add exactly one seventh tool with exact schema and annotations.
- `test/tools.test.ts` — exactly-seven manifest and no bypass fields.
- `test/server.test.ts` — server exposes the seventh tool without changing the first six.
- `test/runtime.test.ts` — runtime regression including move while preserving Phase 1/2 behavior.
- `src/writeErrors.ts` — only generalize Create-specific messages / map helper failures; do not add public error codes.

---

### Task 1: P3-0 Darwin exclusive-rename helper and Node wrapper

**Files:**
- Create: `native/rename-excl.c`
- Create: `src/exclusiveRename.ts`
- Create: `test/exclusiveRename.test.ts`

**Interfaces:**
- Consumes: validated absolute project directory and project-relative source/target paths.
- Produces:

```ts
export type ExclusiveRenameFailure =
  | "EEXIST"
  | "ENOENT"
  | "EXDEV"
  | "ELOOP"
  | "ENOTCAPABLE"
  | "ENOTDIR"
  | "EINVAL"
  | "ENOTSUP"
  | "EPERM"
  | "EACCES"
  | "UNKNOWN";

export class ExclusiveRenameError extends Error {
  readonly failure: ExclusiveRenameFailure;
  constructor(failure: ExclusiveRenameFailure, message?: string);
}

export async function exclusiveRename(
  projectDirectory: string,
  sourceRelativePath: string,
  targetRelativePath: string,
  helperPath?: string,
): Promise<void>;
```

The C helper argv is exactly `<project-directory> <source-relative-path> <target-relative-path>`. It accepts no arbitrary flags. Success stdout is exactly `OK\n`; syscall/open failure stdout is exactly `ERR <TOKEN>\n`; unexpected internal contract failure exits non-zero and must be mapped to `UNKNOWN` by the wrapper.

- [ ] **Step 1: Write the failing native feasibility tests**

Create `test/exclusiveRename.test.ts`. Use a test-local `compileHelper()` that invokes `/usr/bin/clang` directly with argv, never a shell. Cover at minimum: successful rename, existing target preserved with `EEXIST`, any symlink component rejected, and `..` / beneath escape rejected.

```ts
function compileHelper(output: string): void {
  const result = spawnSync("/usr/bin/clang", [
    "-std=c11",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-O2",
    resolve("native/rename-excl.c"),
    "-o",
    output,
  ], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
}
```

Initial behavioral test shape:

```ts
it("moves a file without changing bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "gomcp-rename-"));
  const helper = join(root, "rename-excl");
  compileHelper(helper);
  await writeFile(join(root, "a.md"), "alpha");

  await expect(exclusiveRename(root, "a.md", "b.md", helper)).resolves.toBeUndefined();
  await expect(readFile(join(root, "b.md"), "utf8")).resolves.toBe("alpha");
  await expect(lstat(join(root, "a.md"))).rejects.toMatchObject({ code: "ENOENT" });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run test/exclusiveRename.test.ts`

Expected: FAIL because `native/rename-excl.c` and/or `src/exclusiveRename.ts` do not exist. Do not accept a compiler/toolchain setup error as the intended RED; first prove `/usr/bin/clang` itself is invokable in the test environment.

- [ ] **Step 3: Implement the minimal Darwin helper**

Implement `native/rename-excl.c` with fixed behavior. Required outline:

```c
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

static const char *token_for_errno(int value) {
  switch (value) {
    case EEXIST: return "EEXIST";
    case ENOENT: return "ENOENT";
    case EXDEV: return "EXDEV";
    case ELOOP: return "ELOOP";
#ifdef ENOTCAPABLE
    case ENOTCAPABLE: return "ENOTCAPABLE";
#endif
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

int main(int argc, char **argv) {
  if (argc != 4) return 64;
  int fd = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (fd < 0) {
    printf("ERR %s\n", token_for_errno(errno));
    return 1;
  }
  unsigned int flags = RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH;
  int rc = renameatx_np(fd, argv[2], fd, argv[3], flags);
  int saved_errno = errno;
  close(fd);
  if (rc == 0) {
    printf("OK\n");
    return 0;
  }
  printf("ERR %s\n", token_for_errno(saved_errno));
  return 1;
}
```

If any required macro is unavailable at compile time on the supported deployment target, stop under the spec's native feasibility condition; do not silently omit a flag.

- [ ] **Step 4: Implement the minimal no-shell Node wrapper**

Use `spawn` or `execFile`, never shell execution. Reject unexpected output rather than guessing.

```ts
const result = await execFileAsync(helperPath, [projectDirectory, sourceRelativePath, targetRelativePath], {
  encoding: "utf8",
  shell: false,
});
```

Because `execFile` rejects on non-zero exit, capture stdout from the error and parse only `ERR <TOKEN>`. Never include absolute paths in public-facing error messages.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `pnpm vitest run test/exclusiveRename.test.ts`

Expected: all helper/wrapper tests PASS, including real `EEXIST`, symlink rejection, and beneath escape rejection.

- [ ] **Step 6: Run fresh repository verification**

Run profiles through GrandeGPT: `unit`, then `typecheck`.

Expected: both PASS before proceeding. If the sandbox blocks `/usr/bin/clang` or helper execution, stop and report the P3-0 feasibility gate rather than adding shell/FFI/native-addon workarounds.

- [ ] **Step 7: Commit Task 1**

Commit message: `feat: add exclusive rename primitive`

---

### Task 2: Deterministic native build and launchd packaging

**Files:**
- Create: `ops/native/buildRenameExcl.ts`
- Create: `test/nativeBuild.test.ts`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `ops/launchd/install.ts`
- Modify: `test/launchd.test.ts`

**Interfaces:**
- Produces:

```ts
export const RENAME_EXCL_BINARY = "native/bin/rename-excl";
export function buildRenameExcl(repoRoot: string): string;
```

The function returns the absolute compiled binary path after successful compilation and a tiny self-check. It must always derive source/output under the repo root and accept no arbitrary compiler command.

- [ ] **Step 1: Write failing deterministic-build tests**

Add tests asserting:

```ts
const binary = buildRenameExcl(repoRoot);
expect(binary).toBe(join(repoRoot, "native/bin/rename-excl"));
expect(statSync(binary).mode & 0o111).not.toBe(0);
```

Also assert repeated builds are idempotent, `native/bin/` is ignored by Git policy, and launchd install invokes the build before bootstrap.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run test/nativeBuild.test.ts test/launchd.test.ts`

Expected: FAIL because build utility/script/install integration is absent.

- [ ] **Step 3: Implement the build utility**

Use `spawnSync("/usr/bin/clang", [...])` with the same strict flags as Task 1. Create only `native/bin/` when needed. Do not commit the binary.

```ts
const result = spawnSync("/usr/bin/clang", [
  "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2",
  sourcePath, "-o", binaryPath,
], { cwd: repoRoot, encoding: "utf8" });
if (result.status !== 0) throw new Error("rename-excl helper build failed");
```

Do not expose raw compiler stderr through MCP responses; this utility is operational tooling, not a public capability.

- [ ] **Step 4: Wire package and launchd install**

Add:

```json
"native:build": "node --disable-warning=ExperimentalWarning ops/native/buildRenameExcl.ts"
```

Update launchd install so canonical install builds the helper before creating/bootstrapping the LaunchAgent. Do not alter provider port/auth/service contract.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm vitest run test/nativeBuild.test.ts test/launchd.test.ts`

Expected: PASS.

- [ ] **Step 6: Run fresh `unit` + `typecheck`**

Expected: both PASS.

- [ ] **Step 7: Commit Task 2**

Commit message: `build: package exclusive rename helper`

---

### Task 3: Move target path policy and internal error mapping

**Files:**
- Modify: `src/pathPolicy.ts`
- Modify: `test/pathPolicy.test.ts`
- Modify: `src/writeErrors.ts`

**Interfaces:**
- Produces:

```ts
export async function resolveMoveTargetMarkdown(
  projectRootPath: string,
  project: string,
  path: string,
): Promise<string>;
```

The function returns the absolute target path only when the target is absent, every existing parent is a real non-symlink directory inside the project, and the logical path is a valid non-hidden `.md` path.

- [ ] **Step 1: Add failing path-policy tests**

Cover: valid absent target in an existing parent; target exists -> `ALREADY_EXISTS`; missing parent -> `NOT_FOUND`; hidden/traversal/absolute/backslash/non-md -> policy/invalid error; symlink parent -> path escape; target path same logical entry as source is rejected at the domain layer, not by widening path policy.

Example:

```ts
await expect(resolveMoveTargetMarkdown(root, project, "Archive/new.md"))
  .resolves.toBe(join(root, project, "Archive/new.md"));
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `pnpm vitest run test/pathPolicy.test.ts`

Expected: FAIL because `resolveMoveTargetMarkdown` does not exist.

- [ ] **Step 3: Implement the minimum resolver**

Reuse existing project/path validation helpers. Do not create a generic arbitrary-path resolver. Validate every existing parent with `lstat`; reject symlinks; require final target absence.

- [ ] **Step 4: Generalize only necessary write-error messages**

Preserve all seven stable error codes. Map `ALREADY_EXISTS` / helper `EEXIST` to `FILE_EXISTS`; map helper `ENOENT` to `FILE_NOT_FOUND`; map `ELOOP` / `ENOTCAPABLE` to `POLICY_DENIED`; map `EXDEV`, `ENOTSUP`, `EINVAL`, unexpected helper failures to `WRITE_FAILED` unless the domain has stronger evidence for another stable code.

Do not add `MOVE_FAILED` or other new public codes.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm vitest run test/pathPolicy.test.ts`

Expected: PASS.

- [ ] **Step 6: Run fresh `unit` + `typecheck`**

Expected: both PASS.

- [ ] **Step 7: Commit Task 3**

Commit message: `feat: validate safe move targets`

---

### Task 4: P3-A SHA- and identity-guarded domain move

**Files:**
- Modify: `src/vaultFs.ts`
- Modify: `test/vaultFs.test.ts`

**Interfaces:**
- Produces:

```ts
export interface MarkdownMove {
  sourcePath: string;
  targetPath: string;
  sha256: string;
  totalBytes: number;
}

export interface MoveDependencies {
  exclusiveRename: typeof exclusiveRename;
}

export async function moveMarkdown(
  projectRootPath: string,
  project: string,
  sourcePath: string,
  targetPath: string,
  expectedSha256: string,
  dependencies?: MoveDependencies,
): Promise<MarkdownMove>;
```

`MoveDependencies` exists only to make deterministic race/recovery tests possible; default production dependency is the Task 1 wrapper. Do not expose this through ProjectService or MCP.

- [ ] **Step 1: Write failing success and no-overwrite tests**

Add tests for rename in same directory and move to another existing parent. Assert exact bytes, SHA, byte count, and source disappearance. Capture `dev` + `ino` before move and assert final target identity matches.

```ts
const before = await lstat(sourceAbs);
const result = await moveMarkdown(root, project, "Inbox/a.md", "Archive/a.md", sha);
const after = await lstat(targetAbs);
expect([after.dev, after.ino]).toEqual([before.dev, before.ino]);
```

Add existing-target test proving both source and target remain byte-for-byte unchanged.

- [ ] **Step 2: Run focused test and verify RED**

Run: `pnpm vitest run test/vaultFs.test.ts`

Expected: FAIL because `moveMarkdown` does not exist.

- [ ] **Step 3: Implement initial guarded snapshot and target validation**

Create an internal snapshot helper returning:

```ts
interface GuardedSource {
  absolutePath: string;
  projectPath: string;
  sha256: string;
  totalBytes: number;
  dev: bigint | number;
  ino: bigint | number;
}
```

Use complete bytes for SHA. Reject SHA mismatch with `STALE_FILE`. Resolve target with Task 3 policy. Reject source/target same logical path with `INVALID_INPUT`.

- [ ] **Step 4: Add failing mutation-time stale/identity tests**

Use dependency injection to mutate or replace the source immediately before the fake rename executes. Cover:

1. bytes changed -> `STALE_FILE`, no move;
2. source atomically replaced with identical bytes but different inode -> `STALE_FILE`, no move;
3. target appears before exclusive rename -> `FILE_EXISTS`, neither file overwritten.

- [ ] **Step 5: Implement immediate mutation-time revalidation**

Immediately before calling `exclusiveRename`, re-resolve source and target, re-read full source, and require both SHA and `dev`+`ino` to equal the guarded snapshot. Re-check target absence through policy. Then call exactly one exclusive rename.

Do not perform ordinary `rename()` anywhere in the move path.

- [ ] **Step 6: Add failing post-rename mismatch/recovery tests**

Inject a fake exclusive rename that moves a different identity or changes bytes after mutation. Require:

- provider does not report success;
- reverse exclusive rename is attempted only when safe;
- successful reverse rename restoring exact moved identity/SHA -> `STALE_FILE` and target absent;
- failed/ambiguous reverse rename -> `VERIFY_FAILED` with no overwrite/delete cleanup.

- [ ] **Step 7: Implement final verification and safe reverse recovery**

After exclusive rename, resolve target as an existing Markdown file and verify:

```text
target SHA == expectedSha256
target totalBytes == guarded totalBytes
target dev/ino == guarded dev/ino
source path == absent
```

On mismatch, call the same exclusive primitive `target -> source`; never use overwrite-capable rollback. Verify restoration before returning `STALE_FILE`; otherwise return `VERIFY_FAILED`.

- [ ] **Step 8: Run focused tests and verify GREEN**

Run: `pnpm vitest run test/vaultFs.test.ts`

Expected: PASS for all Phase 1/2 existing tests plus new move cases.

- [ ] **Step 9: Run fresh `unit` + `typecheck`**

Expected: both PASS.

- [ ] **Step 10: Commit Task 4**

Commit message: `feat: add guarded markdown move`

---

### Task 5: ProjectService contract

**Files:**
- Modify: `src/projectService.ts`
- Modify: `test/projectService.test.ts`

**Interfaces:**
- Produces:

```ts
moveProjectDocument(
  project: string,
  sourcePath: string,
  targetPath: string,
  expectedSha256: string,
): Promise<MarkdownMove>;
```

- [ ] **Step 1: Add failing service tests**

Test exact routing to `moveMarkdown` and malformed SHA rejection. The existing lowercase 64-char validator must be reused, not duplicated with different semantics.

```ts
await expect(service.moveProjectDocument(
  "P033-GrandeGPT",
  "Inbox/a.md",
  "Archive/a.md",
  "BAD",
)).rejects.toMatchObject({ code: "INVALID_INPUT" });
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run test/projectService.test.ts`

Expected: FAIL because the method is absent.

- [ ] **Step 3: Implement minimal service method**

Extend the interface and concrete service. Validate `expectedSha256` using the existing exact SHA validator, then delegate to `moveMarkdown`. Do not add move-specific authorization/task logic to the provider.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm vitest run test/projectService.test.ts`

Expected: PASS.

- [ ] **Step 5: Run fresh `unit` + `typecheck`**

Expected: both PASS.

- [ ] **Step 6: Commit Task 5**

Commit message: `feat: expose safe move service`

---

### Task 6: P3-B MCP tool manifest and server/runtime integration

**Files:**
- Modify: `src/tools.ts`
- Modify: `test/tools.test.ts`
- Modify: `test/server.test.ts`
- Modify: `test/runtime.test.ts`

**Interfaces:**
- New tool name: `move_project_document`.
- Exact required input fields: `project`, `sourcePath`, `targetPath`, `expectedSha256`.
- Exact annotations: `readOnlyHint=false`, `destructiveHint=false`, `openWorldHint=false`.

- [ ] **Step 1: Write failing manifest test**

Change the manifest expectation from six to exactly seven tools. Assert the new tool has exactly the four approved properties and no `force`, `overwrite`, `updateLinks`, `createParents`, `sourceProject`, or `targetProject` property.

```ts
expect(Object.keys(move!.inputSchema.properties).sort()).toEqual([
  "expectedSha256",
  "project",
  "sourcePath",
  "targetPath",
]);
```

Also assert the `project` description contains `list_projects.directory` and `not list_projects.id`.

- [ ] **Step 2: Run tools test and verify RED**

Run: `pnpm vitest run test/tools.test.ts`

Expected: FAIL because the seventh tool is absent.

- [ ] **Step 3: Implement minimal tool definition**

Extend `ToolName`; add one tool using the existing safe-write annotation object. Handler delegates to `service.moveProjectDocument(...)`. Description must state same-project Markdown move/rename and no overwrite semantics without promising wikilink updates.

- [ ] **Step 4: Run tools test and verify GREEN**

Run: `pnpm vitest run test/tools.test.ts`

Expected: PASS.

- [ ] **Step 5: Add failing server/runtime expectations**

Update server tool registration count/list. Add a runtime fixture case that moves a Markdown file within an existing project and proves returned target path/SHA and source absence. Keep all existing read/create/update assertions unchanged.

- [ ] **Step 6: Run focused server/runtime tests and verify RED then GREEN**

Run before integration changes: `pnpm vitest run test/server.test.ts test/runtime.test.ts`

Expected: RED on missing seventh tool/runtime routing.

Implement only the registration/routing changes needed, then rerun the same command.

Expected: PASS.

- [ ] **Step 7: Run full fresh regression**

Run GrandeGPT profiles: `unit`, then `typecheck`.

Expected: PASS; public tool surface is exactly seven and all Phase 1/2 tests remain green.

- [ ] **Step 8: Commit Task 6**

Commit message: `feat: expose safe move capability`

---

### Task 7: Load-bearing safety proofs

**Files:**
- Temporary local mutations only; restore before commit.
- Verify: `test/vaultFs.test.ts`

**Interfaces:** none; this task proves the tests are causally load-bearing.

- [ ] **Step 1: Prove target-overwrite protection test is load-bearing**

Temporarily bypass the exclusive target primitive in the move implementation with an overwrite-capable ordinary `rename(source, target)` path only for this proof.

Run the focused existing-target-preservation test.

Expected: RED because target bytes are replaced and/or the expected `FILE_EXISTS` is absent.

Immediately restore the approved implementation. Do not commit the broken version.

- [ ] **Step 2: Re-run focused test after restoration**

Expected: PASS.

- [ ] **Step 3: Prove stale-source protection test is load-bearing**

Temporarily bypass the `expectedSha256` comparison while leaving the rest of the flow intact.

Run the focused stale-source-preservation test.

Expected: RED because a stale caller can move a newer source version.

Immediately restore the SHA guard. Do not commit the broken version.

- [ ] **Step 4: Re-run focused stale test after restoration**

Expected: PASS.

- [ ] **Step 5: Verify no proof mutation remains**

Use `grande_diff` and confirm only intended implementation changes remain; no ordinary overwrite-capable rename path or skipped SHA guard survives.

- [ ] **Step 6: Run fresh `unit` + `typecheck`**

Expected: both PASS.

No commit is required unless the proof exposed a legitimate test/implementation defect that was fixed through a fresh TDD cycle.

---

### Task 8: Pre-PR release review and static acceptance checklist

**Files:**
- Review all Phase 3 files from Tasks 1–6.
- No new production scope.

- [ ] **Step 1: Run scope searches**

Search public/tool/service code for accidental additions: `delete`, `sourceProject`, `targetProject`, `force`, `overwrite`, `updateLinks`, `createParents`, `copyFile`, `mkdir`, `Obsidian CLI`.

Expected: no public Phase 3 bypass or out-of-scope capability. Internal unrelated existing occurrences are reviewed rather than mechanically removed.

- [ ] **Step 2: Verify native-helper boundary**

Confirm compiled `native/bin/rename-excl` is ignored and not tracked. Confirm helper accepts exactly three argv values after program name and fixed flags are hard-coded. Confirm Node wrapper uses no shell and no arbitrary flags.

- [ ] **Step 3: Verify exact manifest contract**

From tests/code, confirm exactly seven tools; first four read-only; create/update/move safe-write annotations exactly match spec; move input exactly four required fields.

- [ ] **Step 4: Run final fresh verification on the candidate HEAD**

Run `unit`, then `typecheck` through GrandeGPT. Both must PASS on the exact tree to be committed/pushed.

- [ ] **Step 5: Inspect final diff**

Use `grande_diff` in bounded pages. Confirm no TODO/TBD, no generated binary, no unrelated refactor, and no spec deviation.

- [ ] **Step 6: Commit final review fixes if any**

If Step 5 required changes, make them through TDD where behavioral, rerun fresh `unit` + `typecheck`, then commit. Otherwise no extra commit.

---

### Task 9: PR, merge, canonical native rebuild/restart, and real S5 acceptance

**Files:**
- No new feature code unless a verified acceptance defect requires a new task/fix cycle.

**Interfaces:** real `obsidian` provider through GrandeGPT S5 capability invocation.

- [ ] **Step 1: Push and open the Phase 3 PR**

Use GrandeGPT controlled `grande_push` and `grande_pr_open`. PR body must cite the approved Phase 3 spec, summarize P3-0/P3-A/P3-B, state that one native helper is added, and list fresh `unit` + `typecheck` evidence plus both load-bearing proofs.

- [ ] **Step 2: Read live PR/CI status**

Use `grande_pr_status`. Require task HEAD == PR head, current attestation present, CI not failed/pending under repository policy, and PR mergeable.

- [ ] **Step 3: Merge only after Human Owner approval**

Use `grande_pr_merge`. Do not bypass the Human Owner merge gate.

- [ ] **Step 4: Build/reinstall/restart canonical launchd provider**

Because Phase 3 adds a native helper, canonical production activation must run the repository's approved launchd install/restart path so `native/bin/rename-excl` is built from canonical source before provider start. Do not invent an ad-hoc deploy mechanism if the repo has no `.grande/deploy.yaml`.

Verify:

```text
127.0.0.1:8788 LISTEN
unauthenticated /mcp -> HTTP 401
```

- [ ] **Step 5: Verify live capability contract**

Use GrandeGPT capability discovery/inspect against provider `obsidian`. Require exactly seven tools and exact move risk/annotations/input schema.

- [ ] **Step 6: Real S5 successful move**

Inside an already-existing project/parent:

1. `create_project_document` source v1.
2. `read_project_document`; record `SHA1`, byte count, exact content.
3. `move_project_document` source -> target using `SHA1`.
4. Read target; require exact same SHA/bytes/content.
5. Read source; require not found.

Do not use a delete capability for cleanup.

- [ ] **Step 7: Real S5 stale-source protection**

1. Create stale-source v1.
2. Read and record `SHA-old`.
3. Update same source to v2 using Phase 2 guarded update.
4. Move using `SHA-old`.
5. Require `STALE_FILE`.
6. Read source and prove v2 unchanged.
7. Prove stale target absent.

- [ ] **Step 8: Real S5 existing-target protection**

1. Create distinct source and target.
2. Record both SHA/content values.
3. Move source -> existing target using valid source SHA.
4. Require `FILE_EXISTS`.
5. Read both and prove both unchanged.

- [ ] **Step 9: Close Phase 3 only after acceptance evidence is recorded**

Update the Phase 3 spec status/closeout record in a separate bounded closeout task after live acceptance, not by modifying the implementation commit retroactively. Record canonical merge SHA, live tool count, successful move SHA preservation, stale protection, and existing-target preservation.

---

## Stop Conditions During Execution

Stop and report to the Human Owner only if one of these occurs:

1. `/usr/bin/clang` or the helper cannot run in the supported GrandeGPT sandbox/launchd environment without adding a broader runtime mechanism.
2. `RENAME_EXCL`, `RENAME_NOFOLLOW_ANY`, or `RENAME_RESOLVE_BENEATH` is unavailable on the supported deployment target.
3. The actual configured Obsidian filesystem does not support the required exclusive rename semantics.
4. Correctness requires ordinary overwrite-capable rename, copy-delete fallback, cross-project mutation, directory mutation, delete, or a new routine destructive Human Gate.
5. The approved public contract conflicts with actual platform behavior in a way that changes semantics.
6. Post-rename race/recovery testing shows the exact guarded source state cannot be preserved or safely failed closed.

Ordinary unit failures, type errors, compiler warnings inside the approved helper boundary, test-fixture mistakes, and targeted refactoring are normal implementation work, not Human Gates.

## Completion Checklist

Phase 3 implementation is complete only when all are true:

- P3-0 native feasibility gate passed on supported macOS.
- Full unit suite green.
- Typecheck green.
- Phase 1 read regression green.
- Phase 2 create/update regression green.
- Both load-bearing proofs demonstrated red and restored green.
- Public MCP manifest exactly seven tools.
- `move_project_document` is write / non-destructive with exact four-field input.
- No delete, cross-project move, directory move, mkdir, overwrite, wikilink rewriting, copy-delete fallback, or Obsidian CLI capability exists.
- PR merged through normal GrandeGPT flow after Human Owner approval.
- Canonical launchd provider rebuilt/restarted with the native helper.
- Real S5 successful move, stale-source protection, and existing-target protection all pass on the actual configured Obsidian project filesystem.
