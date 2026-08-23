# grande-obsidian-mcp Phase 2 Safe Write Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add exactly two safe Markdown write capabilities, `create_project_document` and `update_project_document`, while preserving the existing four-tool read surface and enforcing exclusive create, exact-SHA guarded update, atomic target mutation, and post-write verification.

**Architecture:** Keep the existing `tools -> ProjectService -> pathPolicy/vaultFs/filePrimitives` shape. Extend the narrow filesystem layer rather than introducing a new subsystem: `pathPolicy.ts` validates existing/creatable Markdown paths, `filePrimitives.ts` owns same-directory temporary-file publication/replacement, `writeErrors.ts` maps implementation failures into the stable Phase 2 write-domain errors, and `projectService.ts` composes validation, SHA checks, mutation-time revalidation, atomic mutation, and verification. The MCP layer exposes exactly six tools and never learns GrandeGPT task internals.

**Tech Stack:** Node.js 24, TypeScript 5.9, Vitest 4, `node:fs/promises`, MCP SDK 1.30, Hono 4, Zod 4.

**Spec:** `docs/superpowers/specs/2026-08-23-grande-obsidian-mcp-roadmap-and-phase2-safe-write-design.md`

## Global Constraints

- Public documents remain Markdown only (`.md`).
- Write content limit is exactly 256 KiB = 262,144 UTF-8 bytes.
- Public MCP capability count after Phase 2 is exactly six.
- The first four tools remain read-only; create/update use `readOnlyHint=false`, `destructiveHint=false`, `openWorldHint=false`.
- Create is create-if-absent and must never overwrite an existing/racing target.
- Update requires `expectedSha256` and has no force/overwrite bypass.
- Parent directories must already exist; never auto-create directories.
- Traversal, hidden components, project escape, and unsafe symlinks fail closed.
- Mutation-time path/filesystem revalidation is mandatory.
- Success requires post-write SHA verification.
- Stable write errors are only `FILE_EXISTS`, `FILE_NOT_FOUND`, `STALE_FILE`, `INVALID_INPUT`, `POLICY_DENIED`, `WRITE_FAILED`, `VERIFY_FAILED`.
- Do not add delete, rename, move, append, patch, frontmatter patch, batch write, mkdir, locks, cache/index/database, background workers, cross-project mutation, Obsidian CLI, or provider awareness of GrandeGPT task internals.
- If an exclusive create primitive cannot satisfy create-if-absent atomically on the actual Node/macOS filesystem, stop for Human Owner review rather than weakening semantics.

---

## File structure and responsibility map

- Modify `src/pathPolicy.ts`: add a creatable-Markdown resolver that walks and validates every existing parent component without creating anything; preserve existing read behavior.
- Modify `src/filePrimitives.ts`: add an exclusive same-directory atomic create primitive; keep atomic replacement for update.
- Create `src/writeErrors.ts`: define the seven stable write-domain codes and safe translation from path/Node failures.
- Modify `src/vaultFs.ts`: add full-byte SHA helper/write verification and safe create/update filesystem operations built from path policy + primitives.
- Modify `src/projectService.ts`: extend the service interface with create/update and enforce UTF-8 size/SHA input validation.
- Modify `src/tools.ts`: expose exactly six tools and write annotations; preserve current argument validation style.
- Modify `src/server.ts`: register all six tools and preserve stable write-domain codes in MCP tool errors without leaking host paths/temp names.
- Modify `test/pathPolicy.test.ts`: creatable-path parent, hidden/traversal, missing-parent, symlink cases.
- Modify `test/filePrimitives.test.ts`: exclusive publication semantics, racing/existing target preservation, temp cleanup.
- Modify `test/vaultFs.test.ts`: end-to-end filesystem create/update/SHA/verification safety.
- Modify `test/projectService.test.ts`: size limit, SHA format, create/update service behavior.
- Modify `test/tools.test.ts`: exact six-tool manifest, annotations, required arguments/routing.
- Modify `test/server.test.ts`: exact six MCP tools and stable write error surface.

---

### Task 1: Prove an exclusive create primitive before Safe Create production behavior

**Files:**
- Modify: `test/filePrimitives.test.ts`
- Modify: `src/filePrimitives.ts`

**Interfaces:**
- Produces: `atomicCreateFile(targetPath: string, content: Uint8Array): Promise<void>`.
- Preserves: `atomicWriteFile(targetPath: string, content: Uint8Array): Promise<void>` as the update replacement primitive.

- [ ] **Step 1: Write the failing exclusive-publication tests first**

Add tests that use the real Node filesystem and prove all of the following:

```ts
it("publishes a complete new target without leaving temp artifacts", async () => {
  // create real temp directory, call atomicCreateFile, verify exact bytes and only target remains
});

it("fails with EEXIST and preserves an existing target byte-for-byte", async () => {
  // pre-create target with "old\n", call atomicCreateFile("new\n"), expect rejection code EEXIST,
  // then read target and expect "old\n"
});
```

Also add a race-shaped test in which the target is created after temp preparation but before exclusive publication. Structure the primitive around an injectable/internal final publish helper only if needed for deterministic timing; do not turn the injection point into a public MCP option.

- [ ] **Step 2: Run the focused primitive tests and verify RED**

Run `unit` and confirm the new tests fail because `atomicCreateFile` does not exist. Existing tests must remain green apart from the intentional new failures.

- [ ] **Step 3: Implement exclusive publication using actual Node/macOS semantics**

Use a same-directory, exclusively created, `0o600` temp file. Write all bytes, `sync()` the temp file, and close it before publication. For the final create-if-absent step, use a primitive whose filesystem operation itself is exclusive against an existing target. The preferred Node/macOS candidate is `link(tempPath, targetPath)`: hard-link creation fails with `EEXIST` if the target directory entry exists and makes the complete temp inode visible atomically; afterward unlink the temp name. Never use `rename(temp, target)` for Safe Create.

Conceptual implementation:

```ts
export async function atomicCreateFile(targetPath: string, content: Uint8Array): Promise<void> {
  const temporaryPath = await writeSyncedTemporaryFile(targetPath, content);
  try {
    await link(temporaryPath, targetPath); // exclusive directory-entry creation
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}
```

Keep the helper same-directory. If the real test shows `link()` is unavailable or does not preserve existing-target semantics on this platform, stop under the approved platform-conflict gate.

- [ ] **Step 4: Run `unit` and verify GREEN**

Expected: existing atomic replacement test plus exclusive create tests pass on the actual sandboxed macOS filesystem.

- [ ] **Step 5: Run `typecheck` and commit Task 1**

Expected: typecheck green. Commit message: `feat: add exclusive atomic create primitive`.

---

### Task 2: P2-A Safe Create path policy, filesystem operation, and write-domain errors

**Files:**
- Create: `src/writeErrors.ts`
- Modify: `src/pathPolicy.ts`
- Modify: `src/vaultFs.ts`
- Modify: `test/pathPolicy.test.ts`
- Modify: `test/vaultFs.test.ts`

**Interfaces:**
- Produces: `WriteErrorCode = "FILE_EXISTS" | "FILE_NOT_FOUND" | "STALE_FILE" | "INVALID_INPUT" | "POLICY_DENIED" | "WRITE_FAILED" | "VERIFY_FAILED"`.
- Produces: `WriteDomainError` with stable `code` and sanitized message.
- Produces: `resolveCreatableMarkdown(projectRootPath: string, project: string, documentPath: string): Promise<string>`.
- Produces: `createMarkdown(projectRootPath: string, project: string, documentPath: string, content: Uint8Array): Promise<MarkdownWrite>`.
- Produces: `MarkdownWrite = { path: string; sha256: string; totalBytes: number }`.

- [ ] **Step 1: Write failing path-policy tests**

Cover an existing parent + absent `.md` target, missing parent, non-Markdown target, hidden/traversal/absolute path, symlinked parent, and symlink target. For a creatable target, only the final path may be absent; every parent component must already be a real directory.

Expected public mapping for create-related path failures:

```ts
INVALID_INPUT  // malformed/non-md path
FILE_NOT_FOUND // project or parent missing/not directory
POLICY_DENIED  // hidden/traversal/symlink/path escape
FILE_EXISTS    // target directory entry already exists as a regular file
```

- [ ] **Step 2: Run `unit` and verify RED**

The new resolver/create tests must fail before production changes.

- [ ] **Step 3: Implement `WriteDomainError` translation**

Create `src/writeErrors.ts` with the exact seven-code union and helpers that translate existing `PathPolicyError` values:

```ts
INVALID_INPUT -> INVALID_INPUT
NOT_FOUND -> FILE_NOT_FOUND
PATH_ESCAPE -> POLICY_DENIED
```

Translate Node `ENOENT` to `FILE_NOT_FOUND` where a required project/parent/target is missing, Node `EEXIST` during exclusive create to `FILE_EXISTS`, and unexpected pre-verification filesystem failures to `WRITE_FAILED`. Do not leak absolute paths or temp names in public messages.

- [ ] **Step 4: Implement `resolveCreatableMarkdown` without mkdir**

Reuse the existing project/document component validation rules. Walk each existing parent with `lstat`, reject any symlink, require directories, keep the candidate lexically contained in the project root, and inspect the final directory entry with `lstat` only to distinguish absent vs existing vs symlink. Do not create parent directories.

- [ ] **Step 5: Write the failing Safe Create filesystem tests**

Add tests that prove:

```ts
const result = await createMarkdown(root, project, "design/NEW.md", Buffer.from("# New\n"));
expect(result.path).toBe("design/NEW.md");
expect(result.sha256).toBe(sha256("# New\n"));
expect(result.totalBytes).toBe(Buffer.byteLength("# New\n"));
```

Also prove existing target bytes survive, missing parent is not created, symlink paths fail, and no temp file survives a failed create.

- [ ] **Step 6: Implement Safe Create with mutation-time revalidation + verification**

`createMarkdown` must:

1. resolve the creatable target;
2. prepare intended bytes/SHA;
3. immediately before publication re-run creatable-target validation;
4. call `atomicCreateFile`;
5. read the final target full bytes;
6. compare final SHA and byte length/content hash to the intended bytes;
7. return `MarkdownWrite` only on verified success;
8. translate any verification mismatch/read failure after publication to `VERIFY_FAILED`.

The final `atomicCreateFile` call remains the race-safe guard if another creator wins after revalidation.

- [ ] **Step 7: Run `unit` + `typecheck` and commit Task 2**

Expected: green. Commit message: `feat: implement safe markdown create core`.

---

### Task 3: Expose `create_project_document` and finish the P2-A gate

**Files:**
- Modify: `src/projectService.ts`
- Modify: `src/tools.ts`
- Modify: `src/server.ts`
- Modify: `test/projectService.test.ts`
- Modify: `test/tools.test.ts`
- Modify: `test/server.test.ts`

**Interfaces:**
- Adds service method: `createProjectDocument(project: string, path: string, content: string): Promise<MarkdownWrite>`.
- Adds MCP tool input: `{ project: string; path: string; content: string }`.
- Write annotation constant: `{ readOnlyHint: false, destructiveHint: false, openWorldHint: false }`.

- [ ] **Step 1: Write failing service validation tests**

Test 262,144 UTF-8 bytes succeeds and 262,145 bytes fails `INVALID_INPUT`. Include a multibyte UTF-8 case proving byte-count rather than string-length enforcement. Route a normal create through the configured project root.

- [ ] **Step 2: Write failing tool-manifest tests**

Change the manifest expectation from four to five tools for this slice and assert create annotations exactly:

```ts
{
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
}
```

Assert missing/empty `project`, `path`, or `content` is rejected using the existing required-string policy, except that empty Markdown content is a valid document body. Therefore add a string reader that distinguishes required presence/type from non-empty constraints for `content`.

- [ ] **Step 3: Implement the minimal service/tool/server changes**

Extend `ProjectService`; rename/generalize `ReadToolDef`/`buildReadTools` only as much as required to register read + write tools. Preserve the first four tool definitions and annotations unchanged. Register the fifth tool in the MCP server.

When a write handler throws `WriteDomainError`, return an MCP tool error (`isError: true`) containing a sanitized structured/text payload with the stable `code`. Do not convert read-path behavior globally unless necessary.

- [ ] **Step 4: Run P2-A gate**

Run fresh `unit`, then fresh `typecheck`. Confirm all M1 read tests still pass in the same unit suite.

- [ ] **Step 5: Commit Task 3**

Commit message: `feat: expose safe create capability`.

---

### Task 4: P2-B SHA-guarded atomic update core

**Files:**
- Modify: `src/vaultFs.ts`
- Modify: `src/projectService.ts`
- Modify: `test/vaultFs.test.ts`
- Modify: `test/projectService.test.ts`

**Interfaces:**
- Produces: `updateMarkdown(projectRootPath: string, project: string, documentPath: string, content: Uint8Array, expectedSha256: string): Promise<MarkdownWrite>`.
- Adds service method: `updateProjectDocument(project: string, path: string, content: string, expectedSha256: string): Promise<MarkdownWrite>`.

- [ ] **Step 1: Write failing exact-SHA/stale-preservation tests**

Create an existing Markdown fixture and compute its full SHA. Prove matching SHA updates and returns the new verified SHA. Then prove:

```ts
const before = await readFile(target);
await expect(updateMarkdown(..., staleSha)).rejects.toMatchObject({ code: "STALE_FILE" });
await expect(readFile(target)).resolves.toEqual(before);
```

Add missing-target, symlink, non-Markdown, oversized-content, and malformed-SHA service tests.

- [ ] **Step 2: Run `unit` and verify RED**

The update tests must fail because update behavior is absent.

- [ ] **Step 3: Implement SHA input validation in the service**

Require exactly `/^[0-9a-f]{64}$/`; missing or malformed values return `INVALID_INPUT`. Enforce the same 262,144-byte UTF-8 content bound as create.

- [ ] **Step 4: Implement exact-SHA update with revalidation immediately before replace**

`updateMarkdown` must:

1. resolve the existing Markdown target with symlink-safe policy;
2. read current full bytes and hash them;
3. compare exact current SHA to `expectedSha256`, returning `STALE_FILE` before any mutation on mismatch;
4. prepare the same-directory synced temp via `atomicWriteFile`'s existing replacement flow;
5. immediately before atomic replacement, re-resolve the target and re-read/re-hash the current full bytes; if the SHA no longer equals `expectedSha256`, clean the temp and return `STALE_FILE`;
6. atomically replace the target using same-directory rename only after the second validation;
7. read final full bytes and verify intended SHA;
8. return success only after verification; otherwise return `VERIFY_FAILED`.

Refactor `filePrimitives.ts` minimally if needed so temp preparation and final replace can be separated enough to perform the required second SHA/path validation immediately before rename. Do not add locks.

- [ ] **Step 5: Run `unit` + `typecheck` and commit Task 4**

Expected: green. Commit message: `feat: implement sha guarded markdown update`.

---

### Task 5: Expose `update_project_document` and lock the exact six-tool contract

**Files:**
- Modify: `src/tools.ts`
- Modify: `src/server.ts`
- Modify: `test/tools.test.ts`
- Modify: `test/server.test.ts`

**Interfaces:**
- Adds MCP tool input: `{ project: string; path: string; content: string; expectedSha256: string }`.
- Final tool builder returns exactly six tools in the approved set.

- [ ] **Step 1: Write failing final manifest tests**

Assert sorted names are exactly:

```ts
[
  "create_project_document",
  "get_project_structure",
  "list_projects",
  "read_project_document",
  "search_project",
  "update_project_document",
]
```

Assert the four original tools retain read-only annotations and both write tools have the exact write annotations. Assert update requires all four input fields and no `force`/overwrite field exists.

- [ ] **Step 2: Write failing MCP server integration assertions**

`tools/list` must contain all six names and no seventh tool. Add one write-error invocation case proving `STALE_FILE` remains visible as the stable provider error code rather than becoming an untyped success.

- [ ] **Step 3: Implement the minimal update tool and server routing**

Route `expectedSha256` unchanged to `ProjectService.updateProjectDocument`. Keep the provider unaware of task IDs; GrandeGPT write task binding remains outside this server.

- [ ] **Step 4: Run fresh full regression**

Run fresh `unit` and fresh `typecheck`. The unit suite is the M1 regression plus all Phase 2 tests.

- [ ] **Step 5: Commit Task 5**

Commit message: `feat: expose sha guarded update capability`.

---

### Task 6: Required load-bearing mutation proofs

**Files:**
- Temporary mutation only: `src/filePrimitives.ts`
- Temporary mutation only: `src/vaultFs.ts`
- Tests: existing-target-preserved create test; stale-write-preserves-original update test

**Interfaces:** None; all deliberate mutations must be reverted before release.

- [ ] **Step 1: Prove Create overwrite protection is load-bearing**

Temporarily replace the exclusive create publication with an overwrite-capable `rename(temp, target)` path. Run the focused create existing-target-preserved test. Expected: RED because the existing bytes are replaced or the expected `FILE_EXISTS` is not produced.

- [ ] **Step 2: Restore correct exclusive create implementation**

Revert only the deliberate mutation and rerun the focused create test. Expected: GREEN.

- [ ] **Step 3: Prove stale-SHA protection is load-bearing**

Temporarily bypass the SHA mismatch branch so a stale expected SHA proceeds to replacement. Run the stale-write-preserves-original test. Expected: RED because bytes change and/or `STALE_FILE` is not produced.

- [ ] **Step 4: Restore correct SHA comparison**

Revert only the deliberate mutation and rerun the stale test. Expected: GREEN.

- [ ] **Step 5: Run fresh `unit` + `typecheck` after restoration**

Both must be green. Confirm `grande_diff` contains no deliberate mutation residue.

---

### Task 7: Release delivery and real S5 acceptance

**Files:**
- No new product capability files expected.
- Repository/control-plane delivery metadata only as produced by GrandeGPT.

**Interfaces:** Final provider manifest: exactly six tools; GrandeGPT risk classification must report first four `read`, create/update `write`.

- [ ] **Step 1: Final code/spec review and fresh release gate**

Use `grande_diff`, run fresh `unit`, run fresh `typecheck`, and verify all changes stay inside approved Phase 2 scope. Confirm no TODO/TBD and no delete/rename/move/mkdir public capability.

- [ ] **Step 2: Verify provider capability metadata**

Use GrandeGPT capability inspection/listing after the updated provider is active. Confirm exactly six provider capabilities, read/write risk classification, and approved MCP annotations.

- [ ] **Step 3: Commit any final test-only corrections, push, open PR, inspect CI, merge**

Use the normal GrandeGPT sequence: `grande_commit` only after fresh validation, `grande_push`, `grande_pr_open`, `grande_pr_status`, `grande_pr_merge` when merge gates are green.

- [ ] **Step 4: Reload/restart canonical launchd after merge**

Use the repository's existing approved launchd/deploy path; do not invent a shell escape or a new deployment mechanism. Verify canonical service is healthy and exposes the merged six-tool contract.

- [ ] **Step 5: Run complete real S5 acceptance on a disposable Markdown file**

Within an already-existing project/parent directory:

1. invoke `create_project_document` with initial content under a real GrandeGPT task;
2. invoke `read_project_document` and record/verify initial SHA/content;
3. invoke `update_project_document` with the initial SHA and new content under the same or another valid real task as required by GrandeGPT policy;
4. read and verify new SHA/content;
5. invoke update again with the old SHA;
6. require `STALE_FILE`;
7. read once more and verify latest successful bytes are unchanged.

Do not add delete just to clean this file.

- [ ] **Step 6: Close task only after merged/accepted state is recorded**

Ensure no GrandeGPT job is still running, then close the development task/worktree.
