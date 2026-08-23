# grande-obsidian-mcp Roadmap Refresh & Phase 2 Safe Write Core Design

**Date:** 2026-08-23  
**Status:** Approved by Human Owner  
**Phase:** Phase 2 / Safe Write Core  
**Repository:** `grande-obsidian-mcp`

## 1. Purpose

This document is the authoritative design baseline for Phase 2 of `grande-obsidian-mcp`.

The provider is an **Obsidian-oriented, project-scoped, filesystem-backed safe Markdown provider**. It is not an arbitrary disk filesystem MCP and must not evolve into one by accident. The filesystem is an implementation layer for a deliberately narrow public Markdown capability surface.

Phase 1 / M1 established the read core. Phase 2 adds only the minimum safe write surface required to make writes a first-class product capability without broadening the provider into general filesystem mutation.

## 2. Product and architecture boundary

The architecture remains:

```text
ChatGPT
  -> GrandeGPT generic S5 MCP capability
  -> grande-obsidian-mcp
  -> safe project-scoped filesystem layer
  -> Obsidian Vault / project root
```

`grande-obsidian-mcp` owns Markdown/path/filesystem safety. GrandeGPT owns authorization and task binding. The provider must remain unaware of GrandeGPT task internals.

### 2.1 Public document format

The current public document format is **Markdown only (`.md`)**.

No other file format is part of the public capability contract in Phase 2. Non-Markdown document paths are rejected rather than silently accepted as generic files.

### 2.2 Project scope

All reads and writes remain scoped to a configured project root and one visible direct-child project directory. The provider must reject traversal, hidden path components, symbolic-link traversal/escape, absolute paths, and any candidate path that escapes the resolved project boundary.

Cross-project mutation is not allowed.

## 3. Roadmap refresh

### Phase 1 / M1: Read Core — completed

The approved public read capabilities are:

1. `list_projects`
2. `get_project_structure`
3. `read_project_document`
4. `search_project`

These remain unchanged by Phase 2 and must continue to be read-only.

### Phase 2: Safe Write Core — current

Phase 2 adds exactly two write capabilities:

5. `create_project_document`
6. `update_project_document`

After Phase 2 the public capability surface must contain **exactly six** tools. No other write operation is implied by this roadmap.

### Post-Phase-2 work

Any broader mutation capability requires a separate approved design. In particular, Phase 2 does not reserve, prebuild, or expose delete, rename, move, append, patch, frontmatter patching, batch write, directory creation, locking, indexing, caching, database state, background workers, cross-project mutation, or Obsidian CLI integration.

The roadmap therefore stays deliberately narrow: first establish a reliable read core, then safe create/update, then evaluate future needs from real use rather than prebuilding a generic filesystem API.

## 4. Phase 2 public capability contract

At Phase 2 completion the tool manifest must be exactly:

| Tool | Risk | readOnlyHint | destructiveHint | openWorldHint |
| --- | --- | --- | --- | --- |
| `list_projects` | read | `true` | `false` | `false` |
| `get_project_structure` | read | `true` | `false` | `false` |
| `read_project_document` | read | `true` | `false` | `false` |
| `search_project` | read | `true` | `false` | `false` |
| `create_project_document` | write | `false` | `false` | `false` |
| `update_project_document` | write | `false` | `false` | `false` |

The create/update annotations are intentionally non-destructive: neither tool is allowed to delete a document or overwrite an unrelated/current version without the required safety condition.

## 5. GrandeGPT / provider responsibility boundary

### GrandeGPT responsibilities

- Read capability may run without a real GrandeGPT task.
- Safe write capability requires a real GrandeGPT task.
- GrandeGPT controls authorization and task binding for write invocation.
- Normal safe create/update does not require a per-file Human Gate.
- GrandeGPT remains responsible for any higher-level capability risk policy.

### Provider responsibilities

- The provider controls project/path validation.
- The provider enforces Markdown-only policy.
- The provider enforces content-size bounds.
- The provider revalidates mutation-time filesystem state.
- The provider rejects unsafe symlinks and path escape.
- The provider enforces create-if-absent semantics.
- The provider enforces SHA-guarded compare-and-swap update semantics.
- The provider performs safe atomic publication/replacement.
- The provider performs post-write SHA verification.
- The provider returns stable write-domain errors.

### Explicit non-responsibility

The provider must not inspect, encode, persist, or reason about GrandeGPT task IDs, task state, Human Gate state, attestations, or other GrandeGPT internals. A write reaches the provider only after GrandeGPT has satisfied its own authorization/task requirements.

## 6. Shared write rules

### 6.1 Markdown only

Both write tools accept only project-relative paths ending in `.md` after path-policy validation. Hidden components, `.` / `..`, absolute paths, backslash-separated paths, unsafe display/control characters, and symbolic links are rejected.

### 6.2 Content size

Write content is UTF-8 text and is limited to **256 KiB = 262,144 bytes** after UTF-8 encoding.

The limit is measured in bytes, not JavaScript string length. Content larger than the limit fails with `INVALID_INPUT` before mutation.

### 6.3 Existing parent only

Phase 2 never creates directories. Every parent directory of a target document must already exist, be a real directory, stay inside the project, and not be a symbolic link.

Missing parent directories fail; no `mkdir` or recursive directory creation is permitted.

### 6.4 Mutation-time revalidation

Path validation performed before preparing a write is not sufficient by itself. Immediately before the target-changing primitive, the provider must revalidate the relevant project/parent/target filesystem state so a path or symlink change between initial validation and mutation cannot silently bypass policy.

The implementation should keep the check-to-mutation window as small as practical with the available Node/macOS primitives. It must fail closed if the state no longer satisfies policy.

### 6.5 Same-directory temporary files

Atomic publication/replacement may use temporary files only in the already-existing target directory so the final mutation does not cross filesystems. Temporary files must use exclusive creation, restrictive mode, and cleanup on failure.

Temporary implementation artifacts are not public documents and must not be exposed as successful targets.

### 6.6 Post-write verification

A successful write is not complete when the mutation syscall returns. The provider must read the final target bytes and verify the final SHA-256 equals the SHA-256 of the intended content.

The provider must never report success if verification fails.

The normal successful result is the final document path, verified SHA-256, and total byte length; it must not expose temporary paths or internal filesystem details.

## 7. `create_project_document`

### 7.1 Input

Required fields:

- `project`: visible direct-child project directory name.
- `path`: project-relative Markdown path.
- `content`: UTF-8 Markdown content, at most 256 KiB.

### 7.2 Semantics

`create_project_document` is **create-if-absent**.

- If the target does not exist, publish the exact requested bytes.
- If the target already exists, return `FILE_EXISTS`.
- The tool must never overwrite or replace an existing target.
- The parent directory must already exist.
- No auto-`mkdir` is allowed.
- Traversal, hidden paths, path escape, and unsafe symlink traversal are rejected.
- The final publication must be atomic from the point of view of the target path: callers must not observe a partially written target as a successful create.
- Success requires post-write SHA verification.

### 7.3 Exclusive publication under race

A normal POSIX/macOS `rename(temp, target)` is **not sufficient** for create-if-absent because an existing target can be replaced.

Before implementing Safe Create, the implementation plan must validate the actual Node/macOS/iCloud-capable filesystem primitive used for exclusive publication. The chosen primitive must guarantee that publication fails if the target exists at publication time, including a concurrent creator race, while retaining same-filesystem atomicity for the final target appearance.

If the available platform primitive cannot satisfy exclusive create + atomic publication without a possible overwrite window, this is a design/platform conflict and implementation must stop for Human Owner review. It must not be weakened into check-then-rename or any variant that can overwrite a racing target.

### 7.4 Create invariants

- **C1 Never overwrite existing file.**
- **C2 Never create parent directory.**
- **C3 Never escape project.**
- **C4 Never follow unsafe symlink.**
- **C5 Never expose partial target as success.**

## 8. `update_project_document`

### 8.1 Input

Required fields:

- `project`: visible direct-child project directory name.
- `path`: project-relative Markdown path.
- `content`: new UTF-8 Markdown content, at most 256 KiB.
- `expectedSha256`: mandatory expected SHA-256 for the current full document bytes.

`expectedSha256` must be a 64-character lowercase hexadecimal SHA-256 in the same canonical form returned by `read_project_document`; malformed values fail with `INVALID_INPUT`.

### 8.2 Exact SHA CAS semantics

`update_project_document` is an exact compare-and-swap operation:

1. Resolve and validate the existing Markdown target.
2. Read the current full bytes and compute SHA-256.
3. Compare the computed SHA exactly with `expectedSha256`.
4. If they differ, return `STALE_FILE` without changing the current bytes.
5. Revalidate the filesystem/path state at mutation time.
6. Atomically replace the target with the intended bytes.
7. Read the final target and verify the intended SHA-256.
8. Report success only after verification passes.

There is no force flag, overwrite bypass, stale-write retry, or implicit merge.

### 8.3 Error preservation guarantee

A stale SHA or any failure before the atomic replacement must preserve the current target bytes exactly.

The implementation must also avoid exposing a partial replacement as success. A successful atomic replacement followed by failed post-write verification is reported as `VERIFY_FAILED`; the provider must not falsely claim success. Phase 2 does not add rollback, journal, lock, or backup capabilities to conceal such a verification failure.

### 8.4 Update invariants

- **U1 Never update without expected SHA.**
- **U2 Never update stale version.**
- **U3 Never follow unsafe symlink.**
- **U4 Never expose partial replacement as success.**
- **U5 Never report success without post-write verification.**

## 9. Stable write-domain errors

Phase 2 write capabilities expose only these stable write-domain error codes:

- `FILE_EXISTS`
- `FILE_NOT_FOUND`
- `STALE_FILE`
- `INVALID_INPUT`
- `POLICY_DENIED`
- `WRITE_FAILED`
- `VERIFY_FAILED`

Meaning:

| Code | Meaning |
| --- | --- |
| `FILE_EXISTS` | Safe Create target already exists at validation or exclusive publication time. |
| `FILE_NOT_FOUND` | Required project, parent directory, or Update target does not exist as the required filesystem type. |
| `STALE_FILE` | Update current full-document SHA differs from `expectedSha256`. |
| `INVALID_INPUT` | Invalid project/path/content/SHA shape or content exceeds 256 KiB. |
| `POLICY_DENIED` | Traversal/hidden/symlink/path-escape or another explicit filesystem policy denial. |
| `WRITE_FAILED` | Non-policy filesystem failure while preparing/publishing/replacing the write. |
| `VERIFY_FAILED` | Final target bytes/SHA cannot be verified as exactly the intended content after mutation. |

Existing read-domain error behavior does not need to be renamed merely to make write errors look uniform. Write operations translate lower-level filesystem/path failures into the stable write-domain set at the service/write boundary.

Public errors should not leak absolute host paths, temporary filenames, authorization secrets, or provider internals.

## 10. Filesystem primitive requirements

### 10.1 Temporary write durability step

For an atomic publish/replace implementation using a same-directory temporary file:

1. Create the temp file exclusively (`wx`) with restrictive permissions.
2. Write the complete intended bytes.
3. `fsync`/sync the file handle before publication/replacement.
4. Close the temp file.
5. Revalidate mutation-time path state.
6. Execute the approved atomic publication/replacement primitive.
7. Clean up the temp artifact on any path where it still exists.
8. Verify final bytes/SHA before success.

Phase 2 requires atomic target visibility and post-write verification. It does not introduce a stronger crash-consistency guarantee such as parent-directory `fsync` unless required by the chosen primitive to meet the approved target semantics.

### 10.2 Create versus update primitive

Create and Update need not use the identical final primitive.

- **Create** requires exclusive publication and must not replace an existing target under race.
- **Update** requires atomic replacement after successful exact-SHA validation and mutation-time policy revalidation.

A helper abstraction may share safe temp-file preparation/cleanup, but it must not erase the semantic distinction between exclusive create and replacement update.

## 11. TDD implementation slices

### P2-A Safe Create

Implement `create_project_document` using TDD.

Required test coverage includes:

- creates a new Markdown document and returns verified SHA/byte count;
- rejects existing target with `FILE_EXISTS` and preserves existing bytes;
- missing parent returns `FILE_NOT_FOUND` and does not create directories;
- rejects non-`.md` paths;
- rejects content over 256 KiB by UTF-8 byte count;
- rejects traversal/hidden/absolute/unsafe path forms;
- rejects symlinked parent/target/path escape;
- fails safely when exclusive publication loses a concurrent create race;
- temp artifacts are cleaned on failure;
- success requires post-write verification;
- public tool manifest/annotations include Safe Create correctly.

After P2-A: fresh `unit` + `typecheck` must pass before proceeding.

### P2-B SHA-guarded Update

Implement `update_project_document` using TDD.

Required test coverage includes:

- requires `expectedSha256`;
- rejects malformed SHA with `INVALID_INPUT`;
- updates when current SHA exactly matches;
- stale SHA returns `STALE_FILE` and preserves original/current bytes;
- missing target returns `FILE_NOT_FOUND`;
- rejects non-`.md`, oversized, traversal/hidden/unsafe symlink paths;
- mutation-time revalidation fails closed;
- atomic replacement does not expose a partial target as success;
- final SHA/content verification is required for success;
- no force/overwrite bypass exists;
- public tool manifest/annotations contain exactly the approved six tools.

After P2-B: fresh `unit` + `typecheck` + full M1 regression must pass.

## 12. Load-bearing mutation proofs

Only two deliberate mutation proofs are required for Phase 2 release:

1. **Create overwrite protection proof**  
   Temporarily break the implementation's create overwrite/exclusive-publication protection. The existing-target-preserved test must fail red. Restore the correct implementation afterward.

2. **Stale-write protection proof**  
   Temporarily skip/bypass the SHA comparison. The stale-write-preserves-original test must fail red. Restore the correct implementation afterward.

These proofs exist to demonstrate the two central safety tests are causally load-bearing rather than merely green alongside the implementation.

No additional mutation-proof framework is required.

## 13. Explicit non-goals for Phase 2

Phase 2 must not add:

- delete;
- rename;
- move;
- append;
- patch;
- `patch_frontmatter`;
- batch write;
- `mkdir`;
- locks;
- cache/index/database;
- background worker;
- cross-project mutation;
- Obsidian CLI;
- generic arbitrary-path filesystem access;
- force/overwrite bypass;
- per-file Human Gate for normal safe create/update.

Tests may create and remove disposable fixture files/directories internally. Public cleanup capability is intentionally not added merely to make acceptance cleanup convenient.

## 14. Release gate

Phase 2 is release-ready only when all of the following are fresh and true:

- unit suite green;
- typecheck green;
- M1 read regression green;
- both load-bearing mutation proofs demonstrated and restored;
- public MCP tools are exactly six;
- the first four tools remain read risk;
- create/update are write risk;
- create/update annotations are exactly `readOnlyHint=false`, `destructiveHint=false`, `openWorldHint=false`;
- PR is opened and merged through the normal GrandeGPT flow;
- canonical launchd service is reloaded/restarted after merge;
- a complete real S5 acceptance succeeds.

### Real S5 acceptance sequence

Use a disposable Markdown path inside an already-existing project directory/parent:

1. `create_project_document` with initial content.
2. `read_project_document`; verify content and returned SHA.
3. `update_project_document` using that SHA and new content.
4. `read_project_document`; verify new content and new SHA.
5. Invoke `update_project_document` again using the old SHA.
6. The final call must fail with `STALE_FILE`.
7. Read again and prove the file still contains the latest successful version unchanged.

Do not add a delete capability just to clean up the disposable acceptance document.

## 15. Stop conditions

Implementation must stop and report to the Human Owner only if one of these conditions occurs:

1. This approved spec conflicts with the existing code or actual platform behavior in a way that changes required semantics.
2. Correct implementation requires expanding approved scope.
3. Exclusive create / atomic write cannot satisfy the required safety semantics on the current Node/macOS/filesystem platform.
4. Correct implementation requires a new destructive capability or a new Human Gate.

Ordinary implementation details, test failures, type errors, and refactoring within the approved boundary are not Human Gate conditions; they should be resolved through the normal TDD/debugging workflow.
