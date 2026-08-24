# grande-obsidian-mcp Phase 4 / Safe Directory Core Design

**Date:** 2026-08-24  
**Status:** Completed; live S5 acceptance passed on canonical `main` at `ab22c394131d6dae3e021d6c24813d7d2dd7c36d`  
**Phase:** Phase 4 / Safe Directory Core  
**Repository:** `grande-obsidian-mcp`  
**Base:** Phase 3 formally closed on canonical `main` at `6c9cad4cbf1e10326bf452ec959bf4b93e3e1519`

## 1. Purpose

Phase 4 adds the smallest missing structural capability after the completed read, safe document write, and safe document move cores: creating one project-scoped directory so later Markdown create/move operations can target a directory that did not previously exist.

The provider remains an **Obsidian-oriented, project-scoped, filesystem-backed safe Markdown provider**. Phase 4 does not turn it into a general filesystem MCP or a recursive directory-management API.

Phase 4 adds exactly one public capability:

- `create_project_directory`

No existing public capability changes semantics.

## 2. Product and architecture boundary

The architecture remains:

```text
ChatGPT
  -> GrandeGPT generic S5 MCP capability
  -> grande-obsidian-mcp
  -> safe project-scoped filesystem layer
  -> Obsidian Vault / project root
```

Responsibility remains unchanged:

- GrandeGPT owns authorization and binding write capabilities to a real task.
- `grande-obsidian-mcp` owns project/path/filesystem safety.
- The provider remains unaware of GrandeGPT task internals.
- Normal safe directory creation is a write capability, not a destructive capability.

Phase 4 does not add a new subsystem, database, cache, background worker, native helper, Obsidian CLI adapter, or plugin API integration.

## 3. Public tool surface

The final public MCP surface is exactly eight tools:

1. `list_projects`
2. `get_project_structure`
3. `read_project_document`
4. `search_project`
5. `create_project_document`
6. `update_project_document`
7. `move_project_document`
8. `create_project_directory`

No existing tool schema changes.

| Tool | Risk | `readOnlyHint` | `destructiveHint` | `openWorldHint` |
| --- | --- | --- | --- | --- |
| `list_projects` | read | `true` | `false` | `false` |
| `get_project_structure` | read | `true` | `false` | `false` |
| `read_project_document` | read | `true` | `false` | `false` |
| `search_project` | read | `true` | `false` | `false` |
| `create_project_document` | write | `false` | `false` | `false` |
| `update_project_document` | write | `false` | `false` | `false` |
| `move_project_document` | write | `false` | `false` | `false` |
| `create_project_directory` | write | `false` | `false` | `false` |

## 4. `create_project_directory` public contract

### Input

```json
{
  "project": "P033-GrandeGPT",
  "path": "Research/Archive"
}
```

Schema:

```text
project: string, required
path: string, required
additionalProperties: false
```

No optional fields exist.

`project` has the same meaning as every existing project-scoped tool: the exact visible direct-child directory returned as `list_projects.directory`, not `list_projects.id` and not an arbitrary path.

`path` is a project-relative directory path using `/` separators.

### Success result

```json
{
  "path": "Research/Archive"
}
```

No absolute path, inode, filesystem mode, timestamp, or implementation detail is returned.

### Annotation and risk classification

`create_project_directory` is a safe write:

```text
risk = write
readOnlyHint = false
destructiveHint = false
openWorldHint = false
```

It creates one absent directory leaf and never overwrites or deletes an existing object.

## 5. Directory path policy

Phase 4 adds a directory-specific resolver rather than broadening the Markdown document resolver into an arbitrary filesystem resolver.

The accepted logical path must satisfy all of the following:

- non-empty;
- relative, never absolute;
- `/`-separated;
- no `\\` separators;
- no empty segments;
- no `.` or `..` segments;
- no hidden component beginning with `.`;
- no control characters;
- no bidi/spoofing characters already forbidden by current display-safety policy;
- resolved project remains a real direct-child directory beneath the configured project root;
- every existing directory component is a real non-symlink directory;
- the final target does not already exist as any filesystem object.

Unlike Markdown document paths, the final directory name has no `.md` requirement. A directory literally named `archive.md` is therefore valid if the other rules hold.

The resolver is conceptually:

```ts
resolveCreatableDirectory(
  projectRootPath: string,
  project: string,
  directoryPath: string,
): Promise<string>
```

It returns an absolute target path internally only after proving the project and parent chain satisfy policy. The absolute path never crosses the public MCP boundary.

## 6. Non-recursive creation semantics

Phase 4 creates exactly one directory leaf.

Given:

```text
project/
  Research/
```

this may succeed:

```text
create_project_directory(path="Research/Archive")
```

because `Research` already exists as a real directory.

This must fail:

```text
create_project_directory(path="Missing/Archive")
```

if `Missing` does not already exist.

Phase 4 must never behave like `mkdir -p` and must never call `mkdir(..., { recursive: true })`.

The provider must not create partial parent paths on failure.

This rule also preserves existing document semantics: `create_project_document` and `move_project_document` continue to require their target parent directories to already exist. Phase 4 does not silently teach those existing tools to create parents.

## 7. Existing-target and no-overwrite semantics

If the final directory target already exists, creation fails regardless of the target type:

- existing directory -> `FILE_EXISTS`;
- existing regular file -> `FILE_EXISTS`;
- existing symlink -> `POLICY_DENIED`;
- any other filesystem object -> fail closed through the existing write-error model.

Phase 4 exposes no `force`, `overwrite`, `replace`, `merge`, `parents`, or `recursive` input.

Ordinary non-recursive OS `mkdir(target)` provides exclusive creation of the final leaf: if another actor creates the target between validation and mutation, the losing call receives `EEXIST` and must return `FILE_EXISTS` instead of treating the existing object as success.

## 8. Symlink and containment policy

Directory creation inherits the existing fail-closed project policy:

- configured project root must be a real directory;
- selected project must be a real direct-child directory;
- project symlinks are rejected;
- symlink components inside the requested parent chain are rejected;
- target symlinks are rejected;
- lexical traversal is rejected before mutation;
- no cross-project mutation exists.

The implementation must not use `realpath()` as a way to legitimize a symlink path. A symlink is a policy violation, not an alternate route to a valid location.

## 9. Mutation-time revalidation

Initial path validation is not sufficient because the filesystem can change between validation and `mkdir`.

The mutation sequence is:

1. resolve and validate the project and requested directory target;
2. record the intended absolute target;
3. immediately before mutation, re-run the directory target resolver;
4. require the revalidated target to equal the initially validated absolute target;
5. perform one non-recursive `mkdir(target)`;
6. translate OS errors through the existing write-domain mapper;
7. post-verify the created directory before reporting success.

If a parent becomes a symlink or otherwise violates policy during revalidation, the operation fails before `mkdir` and performs no fallback write elsewhere.

This is deliberately the same conservative pattern already used by Safe Create and Safe Move: validate, revalidate at the mutation boundary, mutate once, verify.

Phase 4 does not add locks, journals, leases, or a new native helper. The residual race between the final user-space revalidation and the OS `mkdir` is bounded by the kernel's exclusive single-leaf create semantics and post-verification. Unlike rename, `mkdir` already supplies the no-overwrite primitive required here.

## 10. Post-create verification

A successful `mkdir` syscall is not by itself enough to return MCP success.

After creation, the provider must prove:

- the selected project still resolves under policy;
- each component in the logical directory path is still a real non-symlink directory;
- the final absolute path equals the intended validated target;
- the final object is a directory and not a symlink.

If verification cannot prove this state, return `VERIFY_FAILED`.

Phase 4 must not attempt destructive rollback on a verification failure. Removing the new path could delete or affect an object that another actor replaced or populated after `mkdir`. The correct fail-closed behavior is to report that success cannot be proven and leave filesystem state untouched.

## 11. Error model

No new public error code is added.

The existing write-domain codes are sufficient:

```text
INVALID_INPUT
FILE_NOT_FOUND
FILE_EXISTS
POLICY_DENIED
WRITE_FAILED
VERIFY_FAILED
```

Expected meanings for `create_project_directory`:

| Condition | Public code |
| --- | --- |
| empty/absolute/backslash/traversal/hidden/control/spoofing logical path | `INVALID_INPUT` |
| unknown project | `FILE_NOT_FOUND` |
| missing parent directory | `FILE_NOT_FOUND` |
| parent is a regular file | `FILE_NOT_FOUND` |
| existing final directory | `FILE_EXISTS` |
| existing final regular file | `FILE_EXISTS` |
| symlinked project/parent/final target | `POLICY_DENIED` |
| target becomes existing at `mkdir` time | `FILE_EXISTS` |
| other mutation I/O failure | `WRITE_FAILED` |
| post-create state cannot be proven safe | `VERIFY_FAILED` |

Messages remain stable and bounded. They must not expose unrestricted absolute host paths in normal structured write errors.

## 12. Filesystem primitive

The filesystem layer adds a narrow primitive, conceptually:

```ts
export interface DirectoryWrite {
  path: string;
}

export async function createDirectory(
  projectRootPath: string,
  project: string,
  path: string,
): Promise<DirectoryWrite>
```

Responsibilities:

- call the directory-specific path resolver;
- perform mutation-time revalidation;
- call ordinary non-recursive `mkdir(target)` exactly once;
- translate OS/path errors into the existing write-domain model;
- post-verify the safe final state;
- return only the logical directory path.

It must not accept a mode, recursive flag, permissions policy, overwrite setting, alternate root, or callback supplied through MCP.

A narrow internal dependency seam may be used in tests to deterministically simulate mutation races and verification failure. That seam is not part of the public MCP contract.

## 13. ProjectService integration

`ProjectService` gains one thin route:

```ts
createProjectDirectory(project: string, path: string): Promise<DirectoryWrite>
```

It delegates to the filesystem primitive under the configured project root.

No search, read, create-document, update-document, or move-document semantics change.

## 14. MCP tool integration

`src/tools.ts` adds exactly one tool:

```text
name = create_project_directory
required = [project, path]
additionalProperties = false
annotations = SAFE_WRITE
```

The description must explicitly communicate:

- one directory is created;
- operation is non-recursive;
- parents must already exist;
- existing target is not overwritten.

No existing input schema gains `createParents`, `recursive`, or any similar option.

## 15. Composition with existing capabilities

Phase 4 is useful through composition rather than by expanding the new tool.

Example:

```text
create_project_directory("Research")
  -> create_project_document("Research/notes.md")
```

and:

```text
create_project_directory("Archive")
  -> read_project_document("PRD.md")
  -> move_project_document(
       sourcePath="PRD.md",
       targetPath="Archive/PRD.md",
       expectedSha256=<read SHA>
     )
```

This preserves the existing architecture: each tool stays small, while useful workflows emerge from composition.

Phase 4 does not add a compound "create directory and move" transaction.

## 16. Scope exclusions

Phase 4 explicitly does not add:

- recursive mkdir / `mkdir -p`;
- directory deletion;
- directory move or rename;
- file deletion;
- recursive directory copy;
- cross-project mutation;
- overwrite/force/replace flags;
- permission/mode inputs;
- batch operations;
- Obsidian wikilink rewrite;
- Obsidian CLI;
- Obsidian command/plugin execution;
- a new native helper;
- a lock service, journal, database, cache, or background worker.

These are future capabilities only if separately justified and designed.

## 17. TDD matrix

Implementation follows RED -> GREEN -> refactor, with regressions kept green after every slice.

### Path policy

1. creates a root-level directory target under a valid project;
2. creates a nested leaf under an existing real parent;
3. rejects missing parent;
4. rejects existing directory target;
5. rejects existing regular-file target;
6. rejects target symlink;
7. rejects parent symlink;
8. rejects project symlink;
9. rejects `..` traversal;
10. rejects absolute path;
11. rejects backslash path;
12. rejects hidden component;
13. rejects empty and repeated-slash segments;
14. rejects control/spoofing characters;
15. accepts a directory name ending in `.md` because this is not a document resolver.

### Mutation primitive

16. successful creation returns only logical `path`;
17. created object is a real directory;
18. `mkdir` is non-recursive;
19. missing-parent failure creates no partial parent;
20. concurrent create produces one winner and one `FILE_EXISTS` loser;
21. mutation-time parent change fails before `mkdir`;
22. mutation-time target appearance becomes `FILE_EXISTS`;
23. post-create verification failure returns `VERIFY_FAILED`;
24. verification failure performs no delete/rollback;
25. successful post-verification proves the exact intended target.

### Service / MCP / regression

26. `ProjectService.createProjectDirectory` routes through the configured root;
27. tool manifest is exactly eight tools;
28. new tool schema is exactly `{ project, path }` and rejects extra fields;
29. new tool annotations are exact safe-write annotations;
30. all previous seven tool schemas/annotations remain unchanged;
31. runtime MCP path can create a directory and then create a Markdown document inside it;
32. runtime MCP path can create a directory and then guarded-move a Markdown document into it;
33. created directory appears in `get_project_structure`;
34. Phase 1 read/search/structure regressions remain green;
35. Phase 2 create/update regressions remain green;
36. Phase 3 move/rename/native-helper regressions remain green.

## 18. Load-bearing proofs

Before merge, run two deliberate negative proofs and then restore the safe implementation.

### Proof A: no recursive parent creation

Temporarily replace the production single-leaf create behavior with recursive creation or otherwise bypass the missing-parent guard:

```ts
await mkdir(initialTarget, { recursive: true });
```

Required result: the missing-parent/no-partial test must turn RED because the forbidden parent chain gets created or the call incorrectly succeeds.

Restore the approved implementation and require GREEN.

### Proof B: parent symlink rejection

Temporarily weaken the parent-component no-follow check so a symlinked parent is followed.

Required result: the parent-symlink test must turn RED because the operation can resolve into the symlink target instead of returning `POLICY_DENIED`.

Restore the approved implementation and require GREEN.

A proof that stays green after the guard is removed is not load-bearing and must be fixed before release.

## 19. Release gate

Phase 4 implementation may merge only when all are true:

1. exact eight-tool manifest test passes;
2. existing seven contract tests pass unchanged;
3. directory path-policy matrix passes;
4. non-recursive/no-partial tests pass;
5. no-overwrite/concurrent-create tests pass;
6. symlink/containment tests pass;
7. mutation-time revalidation tests pass;
8. post-create verification tests pass;
9. runtime composition tests pass;
10. all Phase 1-3 regressions pass;
11. fresh full unit profile passes;
12. fresh typecheck passes;
13. both load-bearing proofs demonstrably go RED when their guards are removed and GREEN after restoration;
14. final diff contains no generated native binary and no unrelated refactor;
15. live S5 acceptance passes after canonical activation.

## 20. Real S5 acceptance

Use a disposable path under a real configured project, with the project selected by exact `list_projects.directory`.

### S5-A: success and composition

1. Invoke `create_project_directory` for `phase4-s5-acceptance-20260824`.
2. Require success result `{ path: "phase4-s5-acceptance-20260824" }`.
3. Create a Markdown document inside the directory with `create_project_document`; re-read it and require exact SHA/content/bytes.
4. Create or choose a disposable Markdown source outside the directory; read its SHA.
5. Move it into the new directory with `move_project_document` and the expected SHA.
6. Re-read the moved target and prove SHA/content/bytes preservation.
7. Require the original source path to be absent.
8. Require `get_project_structure` to expose the new directory and both Markdown files.

### S5-B: missing parent / no partial creation

1. Choose a unique path such as `phase4-s5-missing-parent-20260824/child` where the first component is absent.
2. Invoke `create_project_directory`.
3. Require `FILE_NOT_FOUND`.
4. Re-read structure and prove neither parent nor child exists.

### S5-C: existing target preservation

1. Reuse the successful directory from S5-A, now containing both Markdown files.
2. Invoke `create_project_directory` for the same directory again.
3. Require `FILE_EXISTS`.
4. Re-read both contained Markdown files.
5. Prove their content, SHA, and byte lengths are unchanged.

Because the V1/V2 public surface intentionally has no delete capability, acceptance artifacts may remain in the project. Do not add a delete tool merely for test cleanup.

## 21. Phase closeout

Phase 4 closes only after the real S5 matrix is complete and the exact live eight-tool contract has been re-checked after acceptance.

The closeout record must capture:

- implementation PR and merge SHA;
- canonical activation evidence;
- exact live tool count and annotations;
- S5 success SHA/content/byte preservation evidence;
- missing-parent/no-partial evidence;
- existing-target preservation evidence;
- fresh unit/typecheck counts;
- both load-bearing proof results;
- explicit `Phase 4 / Safe Directory Core: PASSED / CLOSED` decision.

Acceptance artifacts remain only because deletion is intentionally outside the public contract; this must not be treated as a reason to expand scope.

## 22. Implementation completion evidence

Implementation followed the approved plan in `docs/superpowers/plans/2026-08-24-grande-obsidian-mcp-phase4-safe-directory-core.md`.

- Implementation task: `task-gomcp-phase4-impl-20260824-001`
- Implementation PR: #8
- Implementation head: `34bce7087af0c12b843838082d8e4a3e1eded6ce`
- Canonical merge SHA: `ab22c394131d6dae3e021d6c24813d7d2dd7c36d`
- Fresh pre-merge unit: 15 test files / 130 tests passed
- Fresh pre-merge typecheck: passed
- Load-bearing Proof A: bypassing existing-parent-only semantics made missing-parent/no-partial tests RED; restored implementation returned GREEN.
- Load-bearing Proof B: following a symlinked directory parent made the parent-symlink policy test RED; restored implementation returned GREEN.

Live acceptance and final closeout evidence are recorded separately in `docs/superpowers/closeouts/2026-08-24-grande-obsidian-mcp-phase4-closeout.md`.
