# grande-obsidian-mcp Phase 4 / Safe Directory Core Closeout

**Date:** 2026-08-24  
**Decision:** **Phase 4 / Safe Directory Core: PASSED / CLOSED**  
**Repository:** `grande-obsidian-mcp`  
**Acceptance task:** `task-gomcp-phase4-acceptance-20260824-001`

## Delivery baseline

- Approved Phase 4 design and implementation plan were merged before implementation.
- Implementation PR: **#8**
- Implementation head: `34bce7087af0c12b843838082d8e4a3e1eded6ce`
- Canonical implementation merge: `ab22c394131d6dae3e021d6c24813d7d2dd7c36d`
- Canonical host activation was run from that exact SHA with `pnpm launchd:install`.
- Host installer reported `installed ai.agentjoey.grande-obsidian-mcp` from `/Users/xtation/AgentWorks/GPT_Workspace/grande-obsidian-mcp`.
- After activation, GrandeGPT discovered the live provider with exactly eight capabilities.

## Exact live contract

The live `obsidian` provider exposed exactly:

1. `list_projects`
2. `get_project_structure`
3. `read_project_document`
4. `search_project`
5. `create_project_document`
6. `update_project_document`
7. `move_project_document`
8. `create_project_directory`

`create_project_directory` live contract:

- risk: `write`
- required input: exactly `project`, `path`
- `readOnlyHint=false`
- `destructiveHint=false`
- `openWorldHint=false`
- description states non-recursive creation, existing parents required, and no overwrite.

The original seven live tools retained their prior risk/annotation classes.

## S5-A: success and composition

Project selector: exact `list_projects.directory` value `P033-GrandeGPT`.

Created directory:

`phase4-s5-acceptance-20260824`

Result:

```json
{"path":"phase4-s5-acceptance-20260824"}
```

Created Markdown inside the new directory:

`phase4-s5-acceptance-20260824/created.md`

Verified result and re-read:

- SHA-256: `6ebb5f09051de49dbc8609d78a9a5afa74102e15e373fafc540b383b41c6bf1b`
- bytes: `104`
- content: exact match
- truncated: `false`

Created disposable move source:

`phase4-s5-move-source-20260824.md`

Source metadata:

- SHA-256: `2e5c958c5b55ff4b96e69018256049e8eafa8155f170f71c0c6358b590232a60`
- bytes: `98`

Moved it to:

`phase4-s5-acceptance-20260824/moved.md`

Move result preserved:

- SHA-256: `2e5c958c5b55ff4b96e69018256049e8eafa8155f170f71c0c6358b590232a60`
- bytes: `98`

Target re-read preserved the exact content, SHA, and byte length. The original source path subsequently returned `ENOENT`, proving source removal.

A full `get_project_structure` result was `truncated=false` and exposed:

- `phase4-s5-acceptance-20260824`
- `phase4-s5-acceptance-20260824/created.md`
- `phase4-s5-acceptance-20260824/moved.md`

S5-A: **PASS**.

## S5-B: missing parent / no partial creation

Attempted:

`phase4-s5-missing-parent-20260824/child`

Live result:

```json
{"error":{"code":"FILE_NOT_FOUND","message":"required project, parent, or document was not found"}}
```

The subsequent full structure read was `truncated=false` and contained neither the missing parent nor child path. No partial hierarchy was created.

S5-B: **PASS**.

## S5-C: existing target preservation

Re-invoked `create_project_directory` for the already populated directory:

`phase4-s5-acceptance-20260824`

Live result:

```json
{"error":{"code":"FILE_EXISTS","message":"write target already exists"}}
```

After the failed create, both contained Markdown files were re-read:

- `created.md`: SHA `6ebb5f09051de49dbc8609d78a9a5afa74102e15e373fafc540b383b41c6bf1b`, 104 bytes, exact original content.
- `moved.md`: SHA `2e5c958c5b55ff4b96e69018256049e8eafa8155f170f71c0c6358b590232a60`, 98 bytes, exact original content.

No contained file was overwritten or mutated.

S5-C: **PASS**.

## Implementation verification evidence

Fresh pre-merge release-candidate validation:

- unit: **15 test files / 130 tests passed**
- typecheck: **passed**

Load-bearing proofs:

1. **Existing-parent-only guard:** deliberately bypassing the missing-parent guard caused the missing-parent/no-partial tests to go RED because `missing/child` incorrectly became creatable. Restoring the guard returned the suite to GREEN.
2. **Symlink-parent guard:** deliberately weakening the no-follow parent check caused the symlink-parent policy test to go RED because `linked-directory-parent/child` resolved through the symlink. Restoring the guard returned the suite to GREEN.

No Phase 4 production code uses recursive directory creation. No delete, directory move/rename, cross-project mutation, overwrite/force input, Obsidian CLI integration, new native helper, or new public error code was introduced.

## Acceptance artifacts

The following live artifacts remain intentionally because the provider has no delete capability by design:

- `phase4-s5-acceptance-20260824/created.md`
- `phase4-s5-acceptance-20260824/moved.md`

The failed missing-parent probe left no artifact.

Adding a delete capability merely to clean test data would widen the approved product surface and is explicitly out of scope.

## Closeout decision

All Phase 4 implementation, negative-proof, canonical activation, exact-live-contract, success-composition, missing-parent, no-partial-creation, and existing-target-preservation gates are satisfied.

**Phase 4 / Safe Directory Core: PASSED / CLOSED.**
