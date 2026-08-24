# grande-obsidian-mcp Phase 3 / Safe Move & Rename Core Design

**Date:** 2026-08-24  
**Status:** Completed; implementation, real S5 acceptance, and formal closeout completed 2026-08-24  
**Phase:** Phase 3 / Safe Move & Rename Core — completed  
**Repository:** `grande-obsidian-mcp`

## 1. Purpose

Phase 3 adds the smallest missing document-lifecycle capability after the completed Phase 1 Read Core and Phase 2 Safe Write Core: safely changing the path of an existing Markdown document inside one configured project.

The provider remains an **Obsidian-oriented, project-scoped, filesystem-backed safe Markdown provider**. It is not an arbitrary disk filesystem MCP. Phase 3 must not turn path mutation into general filesystem mutation or an Obsidian semantic-refactoring engine.

Phase 3 adds exactly one public capability:

- `move_project_document`

Rename and move are intentionally one capability because they are the same document-path mutation with different source and target names.

## 2. Approved product boundary

The architecture remains:

```text
ChatGPT
  -> GrandeGPT generic S5 MCP capability
  -> grande-obsidian-mcp
  -> safe project-scoped filesystem layer
  -> Obsidian Vault / project root
```

The Phase 3 path mutation boundary is:

- Markdown files only (`.md`);
- one configured project only;
- source and target are both project-relative paths in the same project;
- source must exist as a real regular Markdown file;
- target must not exist;
- target parent must already exist as a real directory;
- no automatic directory creation;
- source content is guarded by mandatory full-document SHA-256;
- no overwrite/force mode;
- no cross-project move;
- no directory move/rename;
- no wikilink, backlink, Markdown-link, frontmatter, or document-content rewriting;
- no Obsidian CLI or plugin API integration.

`move_project_document` changes only the document path. It must not intentionally modify the document bytes.

## 3. Roadmap state and public capability surface

### Phase 1 / M1: Read Core — completed

1. `list_projects`
2. `get_project_structure`
3. `read_project_document`
4. `search_project`

### Phase 2: Safe Write Core — completed

5. `create_project_document`
6. `update_project_document`

### Phase 3: Safe Move & Rename Core — current design

7. `move_project_document`

At Phase 3 completion the public tool manifest must contain **exactly seven** tools:

| Tool | Risk | readOnlyHint | destructiveHint | openWorldHint |
| --- | --- | --- | --- | --- |
| `list_projects` | read | `true` | `false` | `false` |
| `get_project_structure` | read | `true` | `false` | `false` |
| `read_project_document` | read | `true` | `false` | `false` |
| `search_project` | read | `true` | `false` | `false` |
| `create_project_document` | write | `false` | `false` | `false` |
| `update_project_document` | write | `false` | `false` | `false` |
| `move_project_document` | write | `false` | `false` | `false` |

Move is intentionally classified as normal safe write rather than destructive. It is permitted only when source bytes are preserved, the destination is absent, and all safety conditions pass. It does not expose delete or overwrite behavior.

GrandeGPT remains responsible for authorization and binding write capability invocation to a real task. The provider remains unaware of GrandeGPT task internals.

## 4. `move_project_document` public contract

### 4.1 Required input

The input object contains exactly these required fields:

- `project`: exact visible direct-child project directory name returned by `list_projects.directory`, for example `P033-GrandeGPT`; `list_projects.id` is not accepted as an alias.
- `sourcePath`: existing project-relative Markdown file path.
- `targetPath`: desired project-relative Markdown file path in the same project.
- `expectedSha256`: mandatory expected SHA-256 of the complete current source bytes, in the same lowercase 64-character form returned by `read_project_document`.

There is no `sourceProject`, `targetProject`, `force`, `overwrite`, `createParents`, `updateLinks`, or similar bypass/expansion field.

### 4.2 Successful result

A successful result is:

```json
{
  "sourcePath": "Inbox/architecture.md",
  "targetPath": "Architecture/provider.md",
  "sha256": "<64 lowercase hex characters>",
  "totalBytes": 1234
}
```

The returned SHA and byte count describe the final target document. They must match the bytes that were guarded at move time.

### 4.3 Success invariants

Success may be reported only when all of the following are verified:

- `sourcePath` no longer exists;
- `targetPath` exists as a real regular file;
- the final target SHA-256 equals `expectedSha256`;
- the final target byte count equals the guarded source byte count;
- the final target filesystem identity matches the exact source identity captured at mutation-time revalidation;
- the path mutation remained inside the exact project;
- no existing target was overwritten;
- no symbolic link was followed by the move primitive.

## 5. SHA-guarded source semantics

Phase 3 extends the Phase 2 optimistic-concurrency model:

```text
read -> SHA -> mutation
```

The caller reads the source document, obtains its full-document SHA-256, and passes that SHA as `expectedSha256`.

The provider must:

1. resolve and validate the source;
2. read the complete source bytes and compute SHA-256;
3. fail with `STALE_FILE` if the SHA differs from `expectedSha256`;
4. capture the source filesystem identity (`dev` + `ino`) and byte count;
5. immediately before the exclusive rename, re-resolve/revalidate source and target, re-read/re-hash the source, and re-check the same source identity;
6. fail with `STALE_FILE` without mutation if the source SHA or source identity no longer matches;
7. execute the approved exclusive rename primitive;
8. verify final target identity, bytes/SHA, byte count, and final path state before success.

There is no automatic reread-and-retry, implicit merge, or force move when the expected SHA is stale.

A stale source detected before the rename primitive runs must leave both paths unchanged: source remains at `sourcePath`, and `targetPath` remains absent.

## 6. Target no-overwrite semantics

`move_project_document` is target-exclusive.

If `targetPath` already exists, or appears concurrently before the exclusive rename commits, the operation fails with `FILE_EXISTS` and must not overwrite or replace the target.

The public API deliberately exposes no overwrite option.

A normal POSIX/macOS `rename(source, target)` is not sufficient because ordinary rename removes/replaces an existing destination. A check-then-rename sequence is also not sufficient because another process can create the destination between the check and rename.

Phase 3 therefore requires an operating-system primitive whose mutation itself is exclusive against a pre-existing destination.

## 7. Correct Darwin filesystem primitive

### 7.1 Design correction from the initial Phase 3 discussion

The initially considered `link(source, target) -> verify -> unlink(source)` sequence is **not approved for implementation**. Although hard-link creation protects the destination from overwrite, a concurrent source replacement between target-link creation and path-based source unlink can cause the provider to unlink a newer source entry. The SHA guard cannot fully close that final path race with Node's path-based `unlink()`.

Phase 3 instead uses Darwin's exclusive rename facility.

### 7.2 Required syscall semantics

On macOS/Darwin, `renamex_np` / `renameatx_np` supports `RENAME_EXCL`, which causes the rename to fail with `EEXIST` if the destination exists on supporting filesystems. `RENAME_NOFOLLOW_ANY` causes an error when symbolic links are encountered during pathname resolution. `RENAME_RESOLVE_BENEATH` can additionally constrain relative path resolution beneath an opened directory when using `renameatx_np`.

The preferred helper implementation is anchored to the already validated project directory and performs an operation equivalent to:

```c
renameatx_np(
  project_dir_fd,
  source_relative_path,
  project_dir_fd,
  target_relative_path,
  RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH
)
```

The helper must open the project directory as a real directory without following a final symlink and must operate on already policy-validated project-relative paths. If `RENAME_RESOLVE_BENEATH` is unavailable on the actual supported deployment target, implementation must stop for design review rather than silently weakening project-boundary semantics. A `renamex_np` fallback is acceptable only if equivalent no-symlink and project-boundary guarantees are demonstrated and explicitly approved during implementation review.

The destination-exclusive guarantee must come from the rename syscall itself, not from a preceding existence check.

### 7.3 Filesystem capability and cross-device behavior

The implementation must fail closed if the active filesystem does not support the required exclusive rename semantics.

`EXDEV` or an equivalent cross-filesystem condition returns `WRITE_FAILED`. Phase 3 must not fall back to copy-and-delete, because that would change atomicity, metadata, rollback, and failure semantics.

The real S5 release gate must prove the approved primitive on the actual configured Obsidian project filesystem, not only on temporary unit-test storage.

## 8. Minimal Darwin helper boundary

Node's public `fs` API does not expose the required Darwin exclusive-rename flags. Phase 3 therefore permits one narrowly scoped internal native executable.

The helper is **not**:

- a Node native addon;
- a generic filesystem CLI;
- an Obsidian CLI adapter;
- a public MCP capability;
- a general command runner.

Its single responsibility is to execute one project-anchored exclusive rename operation and return a machine-stable success/error result.

Recommended structure:

```text
native/rename-excl.c        # tiny Darwin syscall helper
src/exclusiveRename.ts      # Node wrapper, no shell invocation
```

The exact filenames may change in the implementation plan, but the responsibility boundary must not.

The Node wrapper must invoke the helper with `spawn`/`execFile`-style argv passing, never through a shell. The helper must accept only the validated project directory plus source/target project-relative paths needed for the one rename operation. It must not accept arbitrary flags that can widen behavior.

The compiled binary must not be committed to Git. The implementation plan must define deterministic build/install behavior for development tests and launchd production use. If the required helper cannot be built and executed reliably in the existing GrandeGPT sandbox and launchd environment without adding a materially broader runtime subsystem, implementation must stop for Human Owner review.

## 9. Mutation-time race handling

No user-space check can make the source path immutable between the final SHA/identity check and the rename syscall. Phase 3 therefore combines:

- pre-mutation path validation;
- immediate mutation-time source SHA recheck;
- required mutation-time source identity (`dev` + `ino`) recheck;
- one syscall for destination-exclusive rename;
- post-rename target identity/SHA verification;
- fail-closed recovery if verification shows the moved entry was not the exact guarded source state.

### 9.1 Post-rename mismatch

If the exclusive rename succeeds but the final target does not match the guarded mutation-time source identity/SHA, the provider must not report success.

It must attempt a reverse exclusive rename from `targetPath` back to `sourcePath` using the same protected primitive.

If reverse rename succeeds and the exact moved identity/SHA is verified restored at `sourcePath`, return `STALE_FILE` and leave `targetPath` absent.

If safe restoration cannot be proven, return `VERIFY_FAILED` and surface no success. The provider must not use overwrite-capable rollback and must never delete a competing source or target in an attempt to make the state look clean.

This failure mode is intentionally explicit: safety takes precedence over pretending the move was atomic when concurrent external mutation made the final state ambiguous.

## 10. Path policy

Both `sourcePath` and `targetPath` inherit all existing Markdown/path rules:

- project-relative only;
- `.md` only;
- no absolute paths;
- no `.` or `..` traversal components;
- no hidden path components;
- no backslash path syntax;
- no unsafe control/display/spoofing characters already rejected by path policy;
- no symlink source, target, parent, or traversal;
- no path escape outside the project.

Additional Phase 3 rules:

- `sourcePath` and `targetPath` must not resolve to the same logical entry;
- target parent must already exist as a real directory;
- no directory is created;
- source must be a regular Markdown file;
- target must be absent under actual filesystem semantics.

### 10.1 Case-only rename

Phase 3 does not implement a special temporary-path protocol for case-only rename on case-insensitive filesystems. If the target spelling resolves to the existing source entry or otherwise fails the target-absent policy, the move is rejected. A future phase may add an explicitly designed case-only rename flow if real use justifies it.

## 11. Same-project only

The public input contains one `project` field, not `sourceProject` and `targetProject`.

Allowed:

```text
P033-GrandeGPT/Inbox/A.md
  -> P033-GrandeGPT/Archive/A.md
```

Not expressible and therefore not allowed:

```text
P033-GrandeGPT/A.md
  -> P035-OtherProject/A.md
```

Cross-project mutation is a different authorization and safety boundary and requires a separate future design.

## 12. Wikilinks and document semantics

Phase 3 uses the approved **A1** behavior: file-path mutation only.

The provider does not rewrite any other Markdown document and does not update:

- Obsidian wikilinks;
- aliases;
- heading/block references;
- backlinks;
- Markdown links;
- relative links;
- frontmatter references.

If a move/rename makes an existing link stale, that is documented Phase 3 behavior, not an implicit promise to perform semantic refactoring.

Wikilink-aware rename remains a separate future capability candidate. If pursued later, it requires its own design and may justify an Obsidian adapter rather than a partial handwritten link parser.

## 13. Stable error model

Phase 3 reuses the Phase 2 stable write-domain error set and adds no new public error code:

- `FILE_EXISTS`
- `FILE_NOT_FOUND`
- `STALE_FILE`
- `INVALID_INPUT`
- `POLICY_DENIED`
- `WRITE_FAILED`
- `VERIFY_FAILED`

Phase 3 meanings:

| Code | Meaning |
| --- | --- |
| `FILE_EXISTS` | Target already exists or appears before the exclusive rename commits. |
| `FILE_NOT_FOUND` | Project, source, or target parent is missing as the required filesystem type. |
| `STALE_FILE` | Source SHA/identity changed before mutation, or a post-rename source race was safely restored to the original path. |
| `INVALID_INPUT` | Invalid project/path/SHA shape, identical source/target, or another invalid request shape. |
| `POLICY_DENIED` | Traversal, hidden path, symlink, project escape, or another explicit path-policy denial. |
| `WRITE_FAILED` | Supported exclusive rename could not be executed for a non-policy filesystem reason, including unsupported/cross-device semantics. |
| `VERIFY_FAILED` | Final or recovery state cannot be proven to match the approved invariant. |

Existing Create-specific public error messages should be generalized where necessary without changing stable error codes.

Public errors must not expose absolute host paths, helper internals, secrets, or raw process invocation details.

## 14. Component boundaries

Phase 3 should extend the existing architecture rather than restructure it:

```text
tools.ts
  -> ProjectService
  -> vaultFs
  -> pathPolicy + exclusiveRename/file primitive
```

### `tools.ts`

Adds the seventh MCP definition and exact input schema/annotations. Existing six tool contracts remain unchanged.

### `ProjectService`

Adds one method equivalent to:

```ts
moveProjectDocument(
  project: string,
  sourcePath: string,
  targetPath: string,
  expectedSha256: string,
): Promise<MarkdownMove>
```

The service validates request-level SHA shape and delegates filesystem work.

### `vaultFs`

Owns source/target Markdown semantics, SHA + source identity checks, mutation-time revalidation, final verification, recovery, and stable error translation.

### `pathPolicy`

Reuses existing source resolution and adds only the minimum target-resolution helper necessary to validate an absent Markdown target with an existing real parent. No generic arbitrary-path resolver should be introduced.

### native exclusive-rename boundary

Owns only the Darwin exclusive rename syscall and machine-stable errno reporting. It does not know Markdown semantics, SHA, MCP, GrandeGPT tasks, or authorization.

## 15. Implementation slices

### P3-0: Native primitive feasibility gate

Before production behavior is built, prove with a focused disposable test/probe that the selected helper can:

- compile in the supported development environment without a third-party native dependency;
- execute from the Node provider through a no-shell wrapper;
- perform `RENAME_EXCL` successfully on the supported macOS filesystem;
- return an exclusive-target failure when destination exists;
- reject symlink traversal with the selected flags;
- enforce project-beneath resolution with the selected flags;
- fail closed on unsupported/cross-device conditions;
- be built/located deterministically for tests and launchd production runtime.

This is a feasibility gate, not a public feature. If it cannot be satisfied within the approved narrow helper boundary, stop for Human Owner review rather than weakening move semantics.

### P3-A: Filesystem/domain move

Implement with TDD:

- successful same-project Markdown rename preserves exact bytes/SHA and filesystem identity;
- successful move to another existing parent directory preserves exact bytes/SHA and filesystem identity;
- stale SHA fails before mutation and preserves source/target state;
- changed source identity fails before mutation even if the replacement has identical bytes;
- existing target returns `FILE_EXISTS` and preserves both files;
- concurrent target creation cannot be overwritten;
- missing target parent returns `FILE_NOT_FOUND` and creates no directory;
- invalid/non-Markdown/traversal/hidden/absolute paths are rejected;
- symlink source/parent/target traversal is rejected;
- source and target cannot represent the same entry;
- helper unsupported/cross-device failure does not fall back to copy/delete;
- post-rename SHA/identity mismatch does not report success;
- safe reverse-rename recovery is verified;
- unrecoverable ambiguous state returns `VERIFY_FAILED` without destructive cleanup.

After P3-A, run fresh `unit` + `typecheck`.

### P3-B: Public MCP capability

Expose `move_project_document` and verify:

- manifest is exactly seven tools;
- the new tool is `risk=write` in GrandeGPT integration;
- annotations are exactly `readOnlyHint=false`, `destructiveHint=false`, `openWorldHint=false`;
- required input is exactly `project`, `sourcePath`, `targetPath`, `expectedSha256`;
- `project` schema description retains the `list_projects.directory`, not `id`, contract;
- no force/overwrite/updateLinks/createParents/cross-project field exists;
- all Phase 1/2 read/create/update behavior remains regression-green.

After P3-B, run fresh `unit` + `typecheck` and complete the release gate.

## 16. Load-bearing safety proofs

Only two deliberate mutation proofs are required.

### 16.1 Target overwrite protection proof

Temporarily replace/bypass the exclusive-destination primitive with an overwrite-capable ordinary rename path. The existing-target-preservation test must become RED. Restore the approved exclusive implementation afterward.

### 16.2 Stale-source protection proof

Temporarily bypass the source `expectedSha256` comparison. The stale-source-preservation test must become RED. Restore the approved SHA guard afterward.

The source-identity tests are normal regression coverage; they do not require a third deliberate mutation proof. These two proofs demonstrate that the central target-exclusivity and caller-version guards are causally load-bearing without creating a broader proof framework.

## 17. Release gate

Phase 3 is release-ready only when all of the following are fresh and true:

- P3-0 native primitive feasibility gate passes on supported macOS;
- unit suite green;
- typecheck green;
- Phase 1 read regression green;
- Phase 2 create/update regression green;
- both Phase 3 load-bearing proofs demonstrated and restored;
- public MCP manifest contains exactly seven tools;
- first four tools remain read-only;
- create/update/move remain safe write tools with exact non-destructive annotations;
- no delete, cross-project move, directory move, mkdir, overwrite, wikilink rewrite, copy-delete fallback, or Obsidian CLI capability is exposed;
- PR is opened and merged through the normal GrandeGPT flow;
- canonical launchd provider is rebuilt/reloaded/restarted as required by the native helper packaging change;
- complete real S5 acceptance passes on the actual configured Obsidian project filesystem.

## 18. Real S5 acceptance

Use disposable Markdown documents inside an already-existing project and already-existing parent directories.

### 18.1 Successful move

1. Create `phase3-s5-source.md` with known v1 content.
2. Read source; record `SHA1`, byte count, and exact content.
3. Invoke `move_project_document` from source to `phase3-s5-target.md` using `SHA1`.
4. Read target and prove SHA, bytes, and content are exactly unchanged.
5. Read source and prove it is no longer present.

### 18.2 Stale source protection

1. Create `phase3-s5-stale-source.md` v1.
2. Read and record `SHA-old`.
3. Update the source to v2 through Phase 2 guarded update.
4. Invoke move using `SHA-old`.
5. Require `STALE_FILE`.
6. Read source and prove v2 remains unchanged.
7. Prove stale target is absent.

### 18.3 Existing target protection

1. Create a source document.
2. Create a distinct target document.
3. Record both SHA/content values.
4. Invoke move from source to existing target using the valid source SHA.
5. Require `FILE_EXISTS`.
6. Read both and prove both are unchanged.

Acceptance documents may remain because the public provider still has no delete capability. Do not add delete merely for test cleanup convenience.

## 19. Explicit non-goals

Phase 3 must not add or prebuild:

- delete;
- directory move or rename;
- cross-project move;
- automatic `mkdir` / parent creation;
- overwrite/force/replace move;
- batch/glob move;
- copy-and-delete fallback;
- case-only rename protocol;
- append;
- patch;
- frontmatter patch;
- wikilink rewriting;
- backlink maintenance;
- Markdown-link rewriting;
- Obsidian CLI;
- Obsidian plugin API;
- generic filesystem CLI;
- Node native addon/FFI framework;
- locks;
- journal/database/index/cache;
- background reconciliation worker;
- provider awareness of GrandeGPT task internals.

The tiny Darwin exclusive-rename helper is the only approved native addition, and only because Node's public filesystem API does not expose the required exclusive rename flags.

## 20. Stop conditions

Implementation must stop and report to the Human Owner if any of the following occurs:

1. The actual deployment filesystem does not support the exclusive rename semantics required by `RENAME_EXCL`.
2. `RENAME_NOFOLLOW_ANY` / project-beneath protection cannot be maintained with the supported deployment target.
3. The native helper cannot be built, located, or executed reliably in the existing test + launchd environment without adding a broader runtime subsystem.
4. Correctness requires copy-delete fallback, overwrite-capable rename, cross-project mutation, new destructive capability, or a new routine Human Gate.
5. The approved public contract conflicts with actual platform behavior in a way that changes semantics.
6. The post-rename race/recovery model cannot preserve data and fail closed under the tested concurrency cases.

Ordinary implementation details, test failures, type errors, helper build fixes within the approved boundary, and targeted refactoring are not Human Gate conditions.

## 21. External platform references

The filesystem design relies on the documented Darwin rename semantics:

- Apple/Xcode `rename(2)` semantics for `renamex_np` / `renameatx_np`, including `RENAME_EXCL`, `RENAME_NOFOLLOW_ANY`, and `RENAME_RESOLVE_BENEATH`.
- Apple Foundation volume capability reporting for exclusive rename support (`volumeSupportsExclusiveRenaming`).

These references justify the native primitive choice; they do not widen the public provider contract.

## 22. Completion definition

Phase 3 is complete when the seventh public capability can safely move/rename one existing Markdown document within one project, guarded by exact source SHA and exact mutation-time source filesystem identity, without overwriting a destination, creating directories, altering document bytes, updating links, crossing project boundaries, or falling back to weaker filesystem semantics; and the real S5 acceptance demonstrates those guarantees against the canonical launchd provider.
