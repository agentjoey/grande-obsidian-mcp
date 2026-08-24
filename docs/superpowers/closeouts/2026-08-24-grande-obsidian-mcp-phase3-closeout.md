# grande-obsidian-mcp Phase 3 Closeout

**Date:** 2026-08-24  
**Phase:** Phase 3 / Safe Move & Rename Core  
**Feature baseline:** canonical merge `d3f2722f5323a9311f87afc7744ac39bd5509be8`  
**Acceptance task:** `task-gomcp-phase3-acceptance-20260824-001`

## Live provider contract

The canonical launchd provider was confirmed listening on `127.0.0.1:8788`; an unauthenticated `/mcp` probe returned HTTP `401` before acceptance.

Live GrandeGPT capability discovery returned exactly seven Obsidian capabilities:

1. `list_projects`
2. `get_project_structure`
3. `read_project_document`
4. `search_project`
5. `create_project_document`
6. `update_project_document`
7. `move_project_document`

`move_project_document` is exposed as `risk=write` with `readOnlyHint=false`, `destructiveHint=false`, and `openWorldHint=false`. No delete, overwrite, cross-project move, directory move, mkdir, link rewrite, or Obsidian CLI capability was added.

## Real S5 acceptance evidence

Acceptance used disposable Markdown files in existing project `P033-GrandeGPT`. The public project selector contract requires the visible directory value returned by `list_projects.directory`; project id `P033` is intentionally not an alias.

### Success probe

- source: `phase3-acceptance-20260824-success-source.md`
- target: `phase3-acceptance-20260824-success-target.md`
- guarded SHA-256: `223ab0324c9be508280f520cb1cc543df52b493c1a204ac33b2486ee281a0454`
- byte count: `88`
- move returned the same SHA and byte count;
- target read returned the exact original content, same SHA, and same 88-byte count;
- source read failed with `ENOENT`, proving the source path no longer existed.

Result: **PASSED**.

### Stale-source probe

- source v1 SHA-256: `b17e49fb4898d8c5ca580a694afc18236948f5d99299e1707c28b7a56b674bab`
- guarded update produced source v2 SHA-256 `07ea5d12c98f6a6ce3151fdbe49c69cf70afdbfdcbc4bb3d732731c6ba75c481`, 60 bytes;
- move invoked with the stale v1 SHA returned `STALE_FILE`;
- source read after failure still returned v2 content, SHA `07ea5d12c98f6a6ce3151fdbe49c69cf70afdbfdcbc4bb3d732731c6ba75c481`, and 60 bytes;
- stale target remained absent (`ENOENT`).

Result: **PASSED**.

### Existing-target probe

- source SHA-256: `dae4f9fc8e6a077d1419f04412022353fdaf7c7aec9e742893c87d74e8d2a96c`, 74 bytes;
- target SHA-256: `7509f694fa8f24245623e1799b54aea17861ef960d3e32293c29b2c4812fed37`, 74 bytes;
- move returned `FILE_EXISTS`;
- source read after failure returned its original content and original SHA;
- target read after failure returned its distinct original content and original SHA.

Result: **PASSED**.

Acceptance artifacts are intentionally retained because the public provider has no delete capability. Phase 3 did not add delete for test cleanup.

## Launchd installer hardening

Activation exposed two installer timing weaknesses outside the public seven-tool contract:

1. `bootout` could be followed by `bootstrap` before launchd had fully removed the previous service registration.
2. The plist already uses `RunAtLoad=true` and `KeepAlive=true`; immediately issuing `kickstart -k` after `bootstrap` could terminate the process that bootstrap had just started while the HTTP endpoint was still becoming ready.

The installer was hardened in this acceptance task without widening product scope:

- after a loaded service is booted out, installation now polls `launchctl print` until the old service is actually absent, with a bounded timeout;
- the redundant post-bootstrap `kickstart -k` was removed;
- readiness now waits for both a loaded launchd service and the provider's unauthenticated `http://127.0.0.1:8788/mcp` contract returning HTTP `401`, with a bounded timeout;
- native helper build ordering, canonical-repo pinning, token-file handling, `RunAtLoad`, and `KeepAlive` behavior remain unchanged.

Fresh validation after the installer fix:

- unit: **14 test files / 106 tests passed**;
- typecheck: **passed**.

## Closeout decision

The real S5 acceptance demonstrates the approved same-project, SHA-guarded, no-overwrite move semantics against the canonical launchd provider. The installer hardening addresses the activation race without changing the public MCP contract or permission model.

**Phase 3 / Safe Move & Rename Core acceptance: PASSED.**
