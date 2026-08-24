# grande-obsidian-mcp Phase 4 / Safe Directory Core Design

**Date:** 2026-08-24  
**Status:** Approved by Human Owner; specification baseline for implementation planning  
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

## 3. Roadmap state and public capability surface

### Phase 1 / Read Core — completed

1. `list_projects`
2. `get_project_structure`
3. `read_project_document`
4. `search_project`

### Phase 2 / Safe Write Core — completed

5. `create_project_document`
6. `update_project_document`

### Phase 3 / Safe Move & Rename Core — completed

7. `move_project_document`

### Phase 4 / Safe Directory Core — current design

8. `create_project_directory`

At Phase 4 completion the public manifest must contain **exactly eight tools**.

| Tool | Risk | readOnlyHint | destructiveHint | openWorldHint |
| --- | --- | --- | --- | --- |
| `list_projects` | read | `true` | `false` | `false` |
| `get_project_structure` | read | `true` | `false` | `false` |
| `read_project_document` | read | `true` | `false` | `false` |
| `search_project` | read | `true` | `false` | `false` |
| `create_project_document` | write | `false` | `false` | `false` |
| `update_project_document` | write | `false` | `false` | `false` |
| `move_project_document` | write | `false` | `false` | `false` |
| `create_project_directory` | write | `false` | `false` | `false` |

Directory creation is intentionally a normal safe write. It creates one absent target and cannot delete, replace, rename, or overwrite an existing filesystem entry.

## 4. `create_project_directory` public contract

### 4.1 Required input

The input object contains exactly two required fields:

- `project`: exact visible direct-child project directory returned by `list_projects.directory`, for example `P033-GrandeGPT`; `list_projects.id` such as `P033` is not an alias.
- `path`: project-relative directory path whose final directory does not yet exist.

Example:

```json
{
  "project": "P033-GrandeGPT",
  "path": "Research/2026"
}
```

The schema must reject additional properties. There is no `recursive`, `parents`, `force`, `overwrite`, `mode`, `sourceProject`, `targetProject`, or equivalent expansion/bypass field.

### 4.2 Successful result

A successful result is intentionally minimal:

```json
{
  "path": "Research/2026"
}
```

The returned path is the normalized public logical path supplied by the caller under the approved path syntax. No absolute host path, inode, temporary path, mode, task id, or provider-internal detail is exposed.

### 4.3 Success invariants

Success may be reported only when all of the following are true after the mutation:

- the project remains a real direct-child directory beneath the configured project root;
- every parent component of `path` remains an existing real directory;
- the final target exists;
- the final target is a real directory;
- the final target is not a symbolic link;
- the final target remains beneath the exact project;
- no pre-existing filesystem entry was overwritten, replaced, moved, or deleted;
- no missing parent directory was implicitly created.

## 5. Directory path policy

Phase 4 introduces a directory-path validator/resolver parallel to the existing Markdown-path policy. It must reuse the same display-safety and containment principles rather than invent a looser syntax.

A valid directory path is:

- non-empty;
- relative to the selected project;
- `/`-separated;
- composed only of non-empty visible path components;
- free of `.` and `..` components;
- free of hidden components beginning with `.`;
- free of backslash path syntax;
- free of the control/spoofing characters already denied by `pathPolicy`;
- contained beneath the resolved project directory.

Unlike Markdown document paths, a directory path has no `.md` suffix requirement.

The project argument keeps the existing contract and validation rules. No project-id alias layer is introduced.

### 5.1 Existing-parent rule

Only the final leaf directory may be absent.

For:

```text
Research/2026
```

`Research` must already exist as a real directory. If it does not exist, return `FILE_NOT_FOUND` and create nothing.

Phase 4 must never behave like `mkdir -p` and must never call `mkdir(..., { recursive: true })`.

### 5.2 Root-level creation

Creating one directory directly under the selected project is allowed:

```text
Research
```

The selected project itself is the existing parent in that case.

### 5.3 Existing target

If the final target already exists as any filesystem entry, the operation fails.

- existing real directory -> `FILE_EXISTS`;
- existing regular file -> `FILE_EXISTS`;
- existing symbolic link -> `POLICY_DENIED` rather than treating the symlink as a harmless collision.

The symlink distinction preserves the provider's existing fail-closed path policy.

## 6. Mutation primitive and race semantics

Phase 4 uses the platform's ordinary non-recursive `mkdir(targetPath)` primitive.

No native helper is needed because ordinary `mkdir` already provides the required target-exclusive mutation property: it fails when the destination already exists rather than replacing it.

The operation sequence is:

```text
resolve project
  -> validate every existing parent
  -> validate target absent
  -> immediately re-resolve/revalidate project + parent chain + target
  -> mkdir(finalTarget) without recursive mode
  -> post-create re-resolve/revalidate final state
  -> success
```

The preflight target-absent check is not the no-overwrite guarantee by itself. The actual `mkdir` result remains authoritative under a concurrent target creator. If another actor creates the target between validation and mutation, `mkdir` must fail with `EEXIST`, which maps to `FILE_EXISTS` or `POLICY_DENIED` if post-failure inspection proves the target is a symlink.

The implementation must not retry by choosing a different name and must not convert `EEXIST` into success.

## 7. Mutation-time revalidation

The existing provider design treats early path validation as insufficient for a write. Phase 4 keeps that rule.

Immediately before `mkdir`, the provider must revalidate:

- configured project root remains a real directory;
- selected project remains a real directory and is not a symbolic link;
- every existing parent component remains a real directory and not a symbolic link;
- resolved target remains beneath the exact project;
- target remains absent.

If the revalidated target differs from the initially resolved target, or the parent chain no longer satisfies policy, the operation fails closed without calling `mkdir`.

No lock or journal is added. The check-to-mutation window is minimized and the mutation primitive supplies target exclusivity.

## 8. Post-create verification

A successful `mkdir` syscall is necessary but not sufficient for MCP success.

After creation, the provider must verify the final state using `lstat`-style no-follow inspection and project containment checks:

- target exists;
- target is a directory;
- target is not a symbolic link;
- parent chain is still valid and contained;
- logical target path resolves to the just-created directory under the selected project.

If verification cannot prove the final state, return `VERIFY_FAILED` and do not report success.

Phase 4 does **not** introduce destructive rollback. If an external concurrent mutation changes the newly created path before it can be verified, the provider must fail visibly rather than deleting an entry whose ownership/state can no longer be proven. This is consistent with the project's safety rule that uncertainty must not trigger destructive cleanup.

## 9. Stable error model

Phase 4 adds no new public write-domain error code.

The existing set remains:

- `FILE_EXISTS`
- `FILE_NOT_FOUND`
- `STALE_FILE`
- `INVALID_INPUT`
- `POLICY_DENIED`
- `WRITE_FAILED`
- `VERIFY_FAILED`

Expected meanings for `create_project_directory`:

| Code | Meaning |
| --- | --- |
| `FILE_EXISTS` | Final target already exists as a non-symlink filesystem entry or wins a concurrent create race. |
| `FILE_NOT_FOUND` | Project or required parent directory is missing/not the required directory type. |
| `INVALID_INPUT` | Project/path request shape or directory path syntax is invalid. |
| `POLICY_DENIED` | Hidden/traversal/escape/symlink or another explicit path-policy denial. |
| `WRITE_FAILED` | Non-policy filesystem failure prevents `mkdir`. |
| `VERIFY_FAILED` | Final created state cannot be proven to satisfy the success invariants. |

`STALE_FILE` remains part of the shared write-domain type for existing document operations but is not a normal directory-create outcome because there is no caller-supplied content version guard.

Public errors must not expose absolute host paths, secrets, launchd details, or raw internal exceptions.

## 10. Component boundaries

Phase 4 extends the existing architecture without restructuring it:

```text
tools.ts
  -> ProjectService
  -> vaultFs
  -> pathPolicy
  -> node:fs/promises mkdir + lstat
```

### `pathPolicy.ts`

Add only the minimum directory-path parsing/resolution needed to validate an absent leaf under an existing real parent chain. Shared display-safety/containment helpers should be reused or factored narrowly where that improves clarity.

Do not add a generic arbitrary-filesystem path resolver.

### `vaultFs.ts`

Add one directory-create primitive responsible for:

- initial target resolution;
- mutation-time revalidation;
- non-recursive `mkdir`;
- stable error translation;
- post-create verification.

Recommended domain result:

```ts
interface DirectoryWrite {
  path: string;
}
```

### `projectService.ts`

Add one method equivalent to:

```ts
createProjectDirectory(project: string, path: string): Promise<DirectoryWrite>
```

It should remain a thin domain-routing layer.

### `tools.ts`

Add the eighth tool with exact input schema and `SAFE_WRITE` annotations. Existing seven definitions and handlers remain unchanged.

## 11. Public schema details

The eighth tool definition must use:

```text
name = create_project_directory
required = [project, path]
additionalProperties = false
```

Descriptions must reinforce:

- `project` means `list_projects.directory`, not `list_projects.id`;
- `path` is a project-relative directory path;
- all parent directories must already exist;
- the operation is non-recursive and never overwrites an existing target.

No optional field is approved in Phase 4.

## 12. Interaction with existing capabilities

Phase 4's value is compositional. After a successful directory create, existing Phase 2/3 operations should work without semantic changes.

Example flow:

```text
create_project_directory("Research")
  -> create_project_document("Research/notes.md")
  -> move_project_document("draft.md", "Research/draft.md", expectedSha256)
```

`get_project_structure` already returns directory entries, so a new `list_directories` capability is unnecessary.

`create_project_document` and `move_project_document` must **not** gain implicit parent creation. Their existing-parent contract remains unchanged.

## 13. TDD and acceptance matrix

Implementation must cover at least the following cases before the public capability is considered complete:

1. create a root-level absent directory successfully;
2. create one absent nested leaf beneath an existing real parent successfully;
3. success result contains only the public logical `path`;
4. existing real directory returns `FILE_EXISTS` and remains unchanged;
5. existing regular file at target returns `FILE_EXISTS` and remains unchanged;
6. missing immediate parent returns `FILE_NOT_FOUND` and creates no partial directory;
7. missing earlier parent in a multi-component path returns `FILE_NOT_FOUND` and creates no partial directory;
8. project symlink is denied;
9. parent symlink is denied;
10. target symlink is denied;
11. absolute path is rejected;
12. `.` / `..` traversal is rejected;
13. hidden path component is rejected;
14. empty component / repeated separator is rejected;
15. backslash path syntax is rejected;
16. unsafe control/spoofing characters are rejected;
17. concurrent creates cannot both report success; one wins and the other fails without replacement;
18. mutation-time parent change/symlink substitution fails closed;
19. post-create verification failure does not report success;
20. `get_project_structure` sees the newly created directory;
21. `create_project_document` can create Markdown inside the new directory;
22. `move_project_document` can move an existing Markdown document into the new directory while preserving its Phase 3 SHA/byte invariants;
23. all seven existing tool schemas/annotations/behavior remain regression-green;
24. final manifest contains exactly eight tools;
25. the first four remain read-only and create/update/move/directory-create remain safe writes.

## 14. Load-bearing safety proofs

Phase 4 needs two small causal proofs, not a broader proof framework.

### 14.1 Recursive-parent prohibition proof

Temporarily alter the implementation to use recursive directory creation (or otherwise auto-create missing parents). The missing-parent/no-partial-state test must become RED. Restore the approved non-recursive behavior afterward.

### 14.2 Symlink-parent protection proof

Temporarily bypass the parent symlink rejection at the relevant path-policy boundary. The parent-symlink denial test must become RED. Restore the approved no-symlink behavior afterward.

A separate target-overwrite mutation proof is unnecessary because `mkdir` cannot replace an existing target by design and ordinary concurrent-target regression coverage directly exercises `EEXIST` behavior.

## 15. Real S5 acceptance

Use a disposable directory and Markdown documents inside an already-existing project, preferably `P033-GrandeGPT`, selected by its `list_projects.directory` value.

### 15.1 Success composition probe

1. Invoke `create_project_directory` for `phase4-s5-acceptance-20260824`.
2. Require success result `{ path: "phase4-s5-acceptance-20260824" }`.
3. Invoke `get_project_structure` and prove the directory is visible as `kind=directory`.
4. Invoke `create_project_document` for `phase4-s5-acceptance-20260824/created.md` with known content.
5. Read it and record exact SHA/content/byte count.
6. Create a separate root-level `phase4-s5-move-source.md` with known content.
7. Read source and record SHA/content/byte count.
8. Move it to `phase4-s5-acceptance-20260824/moved.md` using the recorded SHA.
9. Read the moved target and prove Phase 3 SHA/content/byte preservation.
10. Prove the source path is absent.

### 15.2 Missing-parent preservation probe

1. Choose a unique path such as `phase4-s5-missing-parent-20260824/child` where the first component is absent.
2. Invoke `create_project_directory`.
3. Require `FILE_NOT_FOUND`.
4. Prove neither the missing parent nor child appears in `get_project_structure`.

### 15.3 Existing-target preservation probe

1. Choose one existing directory created by the success probe.
2. Invoke `create_project_directory` for the exact same path again.
3. Require `FILE_EXISTS`.
4. Prove the directory and its created/moved Markdown contents remain unchanged.

Acceptance artifacts may remain because the public provider still has no delete capability. Phase 4 must not add delete merely for cleanup convenience.

## 16. Release gate

Phase 4 is release-ready only when all of the following are fresh and true:

- approved Phase 4 spec and implementation plan are committed;
- unit suite passes;
- typecheck passes;
- path-policy directory cases are green;
- directory mutation and verification tests are green;
- both Phase 4 load-bearing proofs have been demonstrated and restored;
- Phase 1 read regression remains green;
- Phase 2 create/update regression remains green;
- Phase 3 move/rename regression remains green;
- MCP manifest contains exactly eight tools;
- the eighth capability contract exactly matches this spec;
- existing seven public contracts are unchanged;
- no recursive mkdir/delete/directory move/cross-project mutation/link rewrite/Obsidian CLI capability is exposed;
- PR is opened and merged through normal GrandeGPT flow;
- canonical launchd provider is restarted/reloaded if required to activate the new public tool contract;
- live GrandeGPT capability discovery reports exactly eight Obsidian tools with correct risk/annotations;
- complete real S5 success, missing-parent, and existing-target probes pass on the actual configured Obsidian filesystem;
- Phase 4 closeout evidence is recorded after live acceptance.

## 17. Explicit non-goals

Phase 4 must not add or prebuild:

- recursive `mkdir` / `mkdir -p` behavior;
- automatic parent creation in document create or move;
- directory delete;
- file delete;
- directory move or rename;
- cross-project directory creation/mutation;
- overwrite/force/replace behavior;
- arbitrary filesystem mode/permission controls;
- batch/glob directory creation;
- copy/delete fallback;
- append/patch/frontmatter patch;
- wikilink rewriting or backlink maintenance;
- Obsidian CLI;
- Obsidian plugin API;
- generic filesystem CLI;
- additional native executable;
- locks, journal, database, index, or cache;
- background reconciliation worker;
- provider awareness of GrandeGPT task internals.

## 18. Stop conditions

Implementation must stop and report to the Human Owner if any of the following occurs:

1. correct directory creation cannot preserve the existing no-symlink/project-containment boundary with Node/macOS filesystem primitives;
2. correctness requires recursive parent creation, destructive cleanup, a new native helper, or broader filesystem mutation;
3. the approved public contract conflicts with actual platform behavior in a way that changes semantics;
4. a reliable success/failure model requires a new destructive capability or a new routine Human Gate;
5. post-create uncertainty cannot be surfaced safely without deleting or replacing ambiguous external state.

Ordinary implementation details, focused refactoring, test failures, and type errors within the approved boundary are not Human Gate conditions.

## 19. Completion definition

Phase 4 is complete when the provider exposes exactly eight public capabilities and `create_project_directory` can safely create one absent project-relative directory leaf beneath an already-existing real parent chain, without recursive parent creation, overwrite, symlink traversal, project escape, destructive rollback, or changes to existing document semantics; and the real S5 acceptance demonstrates directory creation composing successfully with existing create/read/move capabilities on the canonical launchd provider.
