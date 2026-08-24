# grande-obsidian-mcp Phase 4 / Safe Directory Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add exactly one safe, non-recursive `create_project_directory` capability that creates one absent project-relative directory leaf beneath an already-existing real parent chain and composes with existing Markdown create/move operations.

**Architecture:** Extend the existing `pathPolicy -> vaultFs -> ProjectService -> tools` flow without a new subsystem. Reuse current display-safety, project-containment, stable write-error, and mutation-time revalidation patterns; use ordinary non-recursive `node:fs/promises.mkdir` as the target-exclusive mutation primitive and verify the resulting directory before reporting success.

**Tech Stack:** TypeScript, Node.js 24, `node:fs/promises`, Vitest, MCP SDK, GrandeGPT S5 capability bridge, macOS launchd production provider.

**Spec:** `docs/superpowers/specs/2026-08-24-grande-obsidian-mcp-phase4-safe-directory-core-design.md`

## Global Constraints

- Add exactly one public capability: `create_project_directory`.
- Final public manifest is exactly eight tools; all existing seven tool contracts remain unchanged.
- `create_project_directory` input is exactly `{ project, path }`; `additionalProperties=false`; no optional fields.
- `project` means the exact `list_projects.directory` value, never `list_projects.id`.
- Directory paths are project-relative, `/`-separated, visible, display-safe, contained, non-empty, and may not contain `.`, `..`, hidden components, repeated/empty components, backslashes, unsafe control/spoofing characters, or symlink traversal.
- Directory names have no `.md` suffix restriction.
- Only the final leaf may be absent. Every parent must already exist as a real non-symlink directory.
- Never call `mkdir(..., { recursive: true })`; no `mkdir -p` semantics and no implicit parent creation in existing document tools.
- Ordinary non-recursive `mkdir(target)` supplies target exclusivity; a concurrent winner must cause the loser to fail rather than replace/retry.
- Revalidate project, parent chain, containment, and target absence immediately before mutation.
- Verify post-create final state before success; do not add destructive rollback.
- Reuse existing public write error codes; add no new error code.
- `create_project_directory` is `risk=write`, `readOnlyHint=false`, `destructiveHint=false`, `openWorldHint=false`.
- No directory delete/move/rename, file delete, recursive mkdir, cross-project mutation, overwrite/force, batch operation, wikilink rewrite, Obsidian CLI/plugin API, new native helper, lock, journal, database, cache, or background worker.
- Every implementation task follows TDD: failing test first, prove RED, minimal implementation, prove GREEN, then commit.
- Stop for Human Owner only on a spec/platform conflict or if correctness requires scope expansion listed in the spec stop conditions.

---

## File Structure

No new production source file is needed. Keep the change aligned with existing responsibilities:

- `src/pathPolicy.ts`: parse/validate directory logical paths and resolve an absent directory leaf beneath existing real parents.
- `src/vaultFs.ts`: own directory mutation-time revalidation, non-recursive `mkdir`, stable error translation, and post-create verification. Export `DirectoryWrite` and `createDirectory`.
- `src/projectService.ts`: expose thin `createProjectDirectory(project, path)` routing.
- `src/tools.ts`: add the eighth MCP tool and exact public schema/annotations.
- `test/pathPolicy.test.ts`: directory path syntax, existing-parent, existing-target, and symlink policy.
- `test/vaultFs.test.ts`: mutation semantics, concurrency, no-partial-parent, mutation-time race, and verification behavior.
- `test/projectService.test.ts`: service routing and composition with existing document operations.
- `test/tools.test.ts`: exact eight-tool manifest, schema, annotations, and handler routing.
- `test/runtime.test.ts`: end-to-end MCP composition through directory create -> document create -> move.
- `docs/superpowers/closeouts/...`: create only after merged canonical live S5 acceptance.

---

### Task 1: Directory Path Policy

**Files:**
- Modify: `src/pathPolicy.ts`
- Test: `test/pathPolicy.test.ts`

**Interfaces:**
- Consumes: existing project/display/containment rules in `src/pathPolicy.ts`.
- Produces: `resolveCreatableDirectory(projectRootPath: string, project: string, directoryPath: string): Promise<string>`.

- [ ] **Step 1: Write failing tests for valid root and nested-leaf resolution**

Add `resolveCreatableDirectory` to the import list and add:

```ts
it("resolves an absent directory leaf only under existing real parents", async () => {
  const { projectRoot, project } = await fixture();
  await expect(resolveCreatableDirectory(projectRoot, project, "archive"))
    .resolves.toBe(join(projectRoot, project, "archive"));
  await expect(resolveCreatableDirectory(projectRoot, project, "design/archive"))
    .resolves.toBe(join(projectRoot, project, "design", "archive"));
});
```

- [ ] **Step 2: Write failing tests for missing parents and existing targets**

```ts
it("requires every directory parent to already exist", async () => {
  const { projectRoot, project } = await fixture();
  await expect(resolveCreatableDirectory(projectRoot, project, "missing/child"))
    .rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("rejects any existing directory-create target", async () => {
  const { projectRoot, project } = await fixture();
  await expect(resolveCreatableDirectory(projectRoot, project, "design"))
    .rejects.toMatchObject({ code: "ALREADY_EXISTS" });
  await expect(resolveCreatableDirectory(projectRoot, project, "PRD.md"))
    .rejects.toMatchObject({ code: "ALREADY_EXISTS" });
});
```

- [ ] **Step 3: Write failing path-shape and symlink tests**

```ts
it.each([
  "",
  "../archive",
  "/tmp/archive",
  ".hidden/archive",
  "design//archive",
  "design\\archive",
  "design/../archive",
  "design/evil\u202E",
  "design/evil\n",
])("rejects unsafe directory path %j", async (path) => {
  const { projectRoot, project } = await fixture();
  await expect(resolveCreatableDirectory(projectRoot, project, path)).rejects.toThrow();
});

it("allows directory names that happen to end in .md", async () => {
  const { projectRoot, project } = await fixture();
  await expect(resolveCreatableDirectory(projectRoot, project, "design/archive.md"))
    .resolves.toBe(join(projectRoot, project, "design", "archive.md"));
});
```

Also create a parent symlink and target symlink and require `PATH_ESCAPE`.

- [ ] **Step 4: Run `unit` and prove RED**

Expected: `test/pathPolicy.test.ts` fails because `resolveCreatableDirectory` is not exported/implemented.

- [ ] **Step 5: Implement the minimal directory parser and resolver**

Add a private parser parallel to `documentSegments` but without `.md` enforcement:

```ts
function directorySegments(path: string): string[] {
  if (path.length === 0 || isAbsolute(path) || path.includes("\\")) {
    throw new PathPolicyError("INVALID_INPUT", "directory path must be a non-empty '/'-separated relative path");
  }
  assertDisplaySafe(path, "directory path");
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === ".." || segment.startsWith(".")) {
      throw new PathPolicyError("INVALID_INPUT", "directory path contains a forbidden component");
    }
  }
  return segments;
}
```

Add:

```ts
export async function resolveCreatableDirectory(
  projectRootPath: string,
  project: string,
  directoryPath: string,
): Promise<string> {
  const projectPath = await resolveProjectDirectory(projectRootPath, project);
  const segments = directorySegments(directoryPath);
  let current = projectPath;

  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]!);
    assertContained(projectPath, current);
    const isLast = index === segments.length - 1;

    if (!isLast) {
      await assertRealDirectory(current, "directory parent component");
      continue;
    }

    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        throw new PathPolicyError("PATH_ESCAPE", "directory target must not be a symbolic link");
      }
      throw new PathPolicyError("ALREADY_EXISTS", "directory target already exists");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return current;
      throw error;
    }
  }

  throw new PathPolicyError("INVALID_INPUT", "directory path must not be empty");
}
```

Do not generalize the existing Markdown resolvers into a generic filesystem API.

- [ ] **Step 6: Run `unit` and `typecheck`**

Expected: all current tests plus new path-policy tests pass; `tsc --noEmit` passes.

- [ ] **Step 7: Commit Task 1**

```text
feat: add safe directory path policy
```

---

### Task 2: Directory Mutation Primitive

**Files:**
- Modify: `src/vaultFs.ts`
- Test: `test/vaultFs.test.ts`

**Interfaces:**
- Consumes: `resolveCreatableDirectory(projectRootPath, project, directoryPath): Promise<string>`, existing `toWriteDomainError`, `WriteDomainError`, and `resolveProjectDirectory`/`lstat` for verification.
- Produces:

```ts
export interface DirectoryWrite {
  path: string;
}

interface DirectoryDependencies {
  resolveCreatableDirectory: typeof resolveCreatableDirectory;
  mkdir: (path: string) => Promise<unknown>;
  verifyCreatedDirectory: (
    projectRootPath: string,
    project: string,
    logicalPath: string,
    expectedAbsolutePath: string,
  ) => Promise<void>;
}

export async function createDirectory(
  projectRootPath: string,
  project: string,
  path: string,
  dependencies: Partial<DirectoryDependencies> = {},
): Promise<DirectoryWrite>
```

The dependency object is an internal deterministic test seam only. It is not exported through MCP and must not become a general filesystem adapter.

- [ ] **Step 1: Write failing success/existing/missing-parent tests**

```ts
it("creates one absent directory leaf and reports only its logical path", async () => {
  const { projectRoot } = await fixture();
  await expect(createDirectory(projectRoot, "P033-GrandeGPT", "design/archive"))
    .resolves.toEqual({ path: "design/archive" });
  const stat = await lstat(join(projectRoot, "P033-GrandeGPT", "design", "archive"));
  expect(stat.isDirectory()).toBe(true);
  expect(stat.isSymbolicLink()).toBe(false);
});

it("never creates missing parents", async () => {
  const { projectRoot } = await fixture();
  const parent = join(projectRoot, "P033-GrandeGPT", "missing");
  await expect(createDirectory(projectRoot, "P033-GrandeGPT", "missing/child"))
    .rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  await expectMissing(parent);
});
```

Add existing real directory, existing regular file, and target symlink cases. Require `FILE_EXISTS` for non-symlink collisions and `POLICY_DENIED` for a symlink target.

- [ ] **Step 2: Write a failing concurrent-create test**

```ts
it("allows only one concurrent create winner", async () => {
  const { projectRoot } = await fixture();
  const calls = await Promise.allSettled([
    createDirectory(projectRoot, "P033-GrandeGPT", "design/race"),
    createDirectory(projectRoot, "P033-GrandeGPT", "design/race"),
  ]);
  expect(calls.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const rejection = calls.find((result) => result.status === "rejected");
  expect(rejection).toMatchObject({ reason: { code: "FILE_EXISTS" } });
});
```

- [ ] **Step 3: Write a deterministic mutation-time parent substitution test**

Wrap the real resolver so the first resolution succeeds, then replace the parent with a symlink before the second resolution:

```ts
it("fails closed when the parent becomes a symlink before mkdir", async () => {
  const { root, projectRoot } = await fixture();
  const project = "P033-GrandeGPT";
  const parent = join(projectRoot, project, "design");
  const outside = join(root, "outside-dir-race");
  await mkdir(outside);
  const realResolve = resolveCreatableDirectory;
  let calls = 0;
  let mkdirCalled = false;

  await expect(createDirectory(projectRoot, project, "design/archive", {
    resolveCreatableDirectory: async (...args) => {
      const resolved = await realResolve(...args);
      if (++calls === 1) {
        await rm(parent, { recursive: true });
        await symlink(outside, parent);
      }
      return resolved;
    },
    mkdir: async () => {
      mkdirCalled = true;
    },
  })).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(mkdirCalled).toBe(false);
});
```

- [ ] **Step 4: Write a deterministic post-create verification-failure test**

Use the focused verifier seam, not fake `lstat` objects:

```ts
it("does not report success when post-create verification fails", async () => {
  const { projectRoot } = await fixture();
  await expect(createDirectory(projectRoot, "P033-GrandeGPT", "design/verify-fail", {
    verifyCreatedDirectory: async () => {
      throw new WriteDomainError("VERIFY_FAILED", "created directory could not be verified");
    },
  })).rejects.toMatchObject({ code: "VERIFY_FAILED" });

  const stat = await lstat(join(projectRoot, "P033-GrandeGPT", "design", "verify-fail"));
  expect(stat.isDirectory()).toBe(true);
});
```

The second assertion proves Phase 4 does not destructively roll back uncertain state.

- [ ] **Step 5: Run `unit` and prove RED**

Expected: new `vaultFs` tests fail because `createDirectory` and its interfaces do not exist.

- [ ] **Step 6: Implement the production verifier**

Add a private helper equivalent to:

```ts
async function verifyCreatedDirectory(
  projectRootPath: string,
  project: string,
  logicalPath: string,
  expectedAbsolutePath: string,
): Promise<void> {
  try {
    const projectPath = await resolveProjectDirectory(projectRootPath, project);
    const segments = logicalPath.split("/");
    let current = projectPath;
    for (const segment of segments) {
      current = join(current, segment);
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new WriteDomainError("VERIFY_FAILED", "created directory could not be verified");
      }
    }
    if (current !== expectedAbsolutePath) {
      throw new WriteDomainError("VERIFY_FAILED", "created directory could not be verified");
    }
  } catch (error) {
    throw toWriteDomainError(error, "VERIFY_FAILED");
  }
}
```

Use the already validated logical syntax; do not add a looser parser here.

- [ ] **Step 7: Implement minimal `createDirectory`**

Construct defaults:

```ts
const deps: DirectoryDependencies = {
  resolveCreatableDirectory,
  mkdir,
  verifyCreatedDirectory,
  ...dependencies,
};
```

Then implement:

```ts
let initialTarget: string;
try {
  initialTarget = await deps.resolveCreatableDirectory(projectRootPath, project, path);
  const revalidatedTarget = await deps.resolveCreatableDirectory(projectRootPath, project, path);
  if (revalidatedTarget !== initialTarget) {
    throw new WriteDomainError("POLICY_DENIED", "directory target changed during validation");
  }
  await deps.mkdir(initialTarget); // never recursive
} catch (error) {
  throw toWriteDomainError(error);
}

try {
  await deps.verifyCreatedDirectory(projectRootPath, project, path, initialTarget);
} catch (error) {
  throw toWriteDomainError(error, "VERIFY_FAILED");
}
return { path };
```

If a real concurrent creator wins, ordinary `mkdir` returns `EEXIST`, which the existing error mapper converts to `FILE_EXISTS`. A pre-existing/initial target symlink is already denied by `resolveCreatableDirectory`; do not add overwrite or retry behavior.

- [ ] **Step 8: Run `unit` and `typecheck`**

Expected: directory mutation tests plus all Phase 1-3 regressions pass; typecheck passes.

- [ ] **Step 9: Commit Task 2**

```text
feat: add verified directory creation
```

---

### Task 3: Project Service and Exact Eight-Tool MCP Contract

**Files:**
- Modify: `src/projectService.ts`
- Modify: `src/tools.ts`
- Test: `test/projectService.test.ts`
- Test: `test/tools.test.ts`

**Interfaces:**
- Consumes: `createDirectory(projectRootPath, project, path): Promise<DirectoryWrite>`.
- Produces:

```ts
ProjectService.createProjectDirectory(project: string, path: string): Promise<DirectoryWrite>
```

and the public tool:

```text
name = create_project_directory
required = [project, path]
additionalProperties = false
annotations = SAFE_WRITE
```

- [ ] **Step 1: Write failing ProjectService route/composition tests**

```ts
it("creates a project directory through the configured root", async () => {
  const { projectRootPath, project } = await fixture();
  const service = createProjectService({ projectRootPath });
  await expect(service.createProjectDirectory(project, "design/archive"))
    .resolves.toEqual({ path: "design/archive" });
  await expect(service.createProjectDocument(project, "design/archive/NOTE.md", "# Note\n"))
    .resolves.toMatchObject({ path: "design/archive/NOTE.md" });
});
```

Add a second test that creates `archive`, reads the current `PRD.md` bytes/SHA, moves it to `archive/PRD.md`, and asserts exact byte preservation.

- [ ] **Step 2: Write failing exact manifest/schema tests**

Extend the `ProjectService` test double with:

```ts
createProjectDirectory: async (_project, path) => ({ path }),
```

Change the manifest expectation to exactly eight tools, including `create_project_directory`.

Require:

```ts
const directory = tools.find((tool) => tool.name === "create_project_directory");
expect(directory?.inputSchema.required).toEqual(["project", "path"]);
expect(Object.keys(directory?.inputSchema.properties ?? {}).sort()).toEqual(["path", "project"]);
expect(directory?.inputSchema.additionalProperties).toBe(false);
expect(directory?.annotations).toEqual({
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
});
for (const forbidden of ["recursive", "parents", "force", "overwrite", "mode", "sourceProject", "targetProject"]) {
  expect(directory?.inputSchema.properties).not.toHaveProperty(forbidden);
}
expect(directory?.description).toMatch(/parent.*already exist/i);
expect(directory?.description).toMatch(/non-recursive/i);
```

Update the project-argument documentation test so the new tool is included, and update safe-write classification to include four write tools.

- [ ] **Step 3: Run `unit` and prove RED**

Expected: service interface/tool manifest tests fail because the method and eighth tool are absent.

- [ ] **Step 4: Implement the thin service route**

Import `createDirectory` and `DirectoryWrite`, extend `ProjectService`, and add:

```ts
createProjectDirectory: (project, path) =>
  createDirectory(options.projectRootPath, project, path),
```

Do not add directory policy logic to the service layer.

- [ ] **Step 5: Implement the eighth tool**

Extend `ToolName` with `"create_project_directory"` and append:

```ts
{
  name: "create_project_directory",
  description: "Safely create one non-recursive project directory; all parent directories must already exist and an existing target is never overwritten.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string", description: PROJECT_ARG_DESCRIPTION },
      path: { type: "string", description: "Project-relative directory path; all parent directories must already exist." },
    },
    required: ["project", "path"],
    additionalProperties: false,
  },
  annotations: SAFE_WRITE,
  handler: (args) => service.createProjectDirectory(
    requiredString(args, "project"),
    requiredString(args, "path"),
  ),
}
```

Do not change the seven existing definitions except where manifest/count tests must classify the new tool.

- [ ] **Step 6: Run `unit` and `typecheck`**

Expected: exact eight-tool contract green; all prior service/tool tests remain green.

- [ ] **Step 7: Commit Task 3**

```text
feat: expose safe project directory creation
```

---

### Task 4: MCP End-to-End Composition and Regression Gate

**Files:**
- Modify: `test/runtime.test.ts`
- Modify `test/server.test.ts` only if an existing server assertion needs the new manifest count; do not refactor server code.

**Interfaces:**
- Consumes: public `create_project_directory` plus unchanged existing tools.
- Produces: end-to-end proof through the real MCP runtime.

- [ ] **Step 1: Extend runtime E2E with directory creation**

Before the move, invoke:

```ts
const directory = await call("create_project_directory", {
  project,
  path: "archive",
});
expect(directory).toContain("archive");
```

Then call:

```ts
await call("create_project_document", {
  project,
  path: "archive/CREATED.md",
  content: "# Created\nphase 4 directory composition\n",
});
```

Move the existing source to `archive/MOVED.md` using its current SHA, assert moved bytes are unchanged, assert the source is absent, and call `get_project_structure` afterward to require `archive`, `archive/CREATED.md`, and `archive/MOVED.md`.

- [ ] **Step 2: Run `unit`**

If the E2E fails, fix only the directly responsible Phase 4 integration defect. Do not widen the public contract.

- [ ] **Step 3: Run full `unit` and `typecheck`**

Expected: all Phase 1 read, Phase 2 create/update, Phase 3 move, and Phase 4 directory-create tests pass.

- [ ] **Step 4: Review the full implementation diff against the spec**

Confirm:

- exactly one new public capability;
- no existing input schema widened;
- no `recursive: true` in production code;
- no delete/directory move/cross-project behavior;
- no new native helper/dependency;
- no host paths in public results/errors;
- no provider awareness of GrandeGPT task internals.

- [ ] **Step 5: Commit Task 4 if files changed**

```text
test: cover phase 4 mcp composition
```

Do not create an empty commit.

---

### Task 5: Load-Bearing Proofs and Release Candidate

**Files:**
- Temporary mutations only in existing implementation/test files; restore them before final validation.
- No permanent proof framework or proof-only production code.

**Interfaces:**
- Consumes: completed Phase 4 implementation/tests.
- Produces: causal evidence for the two approved safety guards plus a restored green release candidate.

- [ ] **Step 1: Prove recursive-parent prohibition is load-bearing**

Temporarily replace the non-recursive mutation with recursive behavior, e.g. a direct temporary call to:

```ts
await mkdir(initialTarget, { recursive: true });
```

Run `unit`. Expected: the missing-parent/no-partial-state test becomes RED because a forbidden parent is created or the call incorrectly succeeds.

Restore the approved non-recursive code immediately.

- [ ] **Step 2: Prove symlink-parent denial is load-bearing**

Temporarily bypass the parent-symlink rejection in the directory resolver for the proof. Run `unit`. Expected: the parent-symlink test becomes RED.

Restore the approved no-symlink resolver immediately.

- [ ] **Step 3: Run fresh validation after restoration**

Run `unit`, then `typecheck`. Both must pass on the restored final tree.

- [ ] **Step 4: Final diff review**

Use `grande_diff` and verify no proof mutation, generated artifact, placeholder, unrelated refactor, recursive mkdir, or scope expansion remains.

- [ ] **Step 5: Commit any final correction only if necessary**

No empty cleanup commit. Any permanent correction requires fresh validation after the change.

---

### Task 6: PR, Merge, Canonical Activation, and Real S5 Acceptance

**Files:**
- Implementation branch files from Tasks 1-5.
- After live acceptance, create `docs/superpowers/closeouts/2026-08-24-grande-obsidian-mcp-phase4-closeout.md` in a separate bounded closeout task.
- Update the Phase 4 design spec status only in that post-acceptance closeout task.

**Interfaces:**
- Consumes: attested implementation commit with exact eight-tool contract.
- Produces: merged canonical implementation, activated launchd provider, real S5 evidence, and final Phase 4 closeout.

- [ ] **Step 1: Ensure fresh attestation on current implementation HEAD**

Run `unit` and `typecheck` after the last permanent code change, then create the final GrandeGPT commit so current HEAD has a validation attestation.

- [ ] **Step 2: Push and open the implementation PR**

PR summary must include:

- one new safe-write capability;
- non-recursive existing-parent semantics;
- ordinary `mkdir` target exclusivity;
- unchanged existing seven contracts;
- fresh unit/typecheck results;
- both load-bearing proof results.

- [ ] **Step 3: Read PR/CI and merge when gates pass**

Require PR head equals task HEAD, attestation is current, CI is not pending/failed, and mergeability is true. Merge through GrandeGPT.

- [ ] **Step 4: Activate canonical launchd provider**

Use the repository's approved canonical launchd install/activation path. The hardened installer must wait for bootout completion, bootstrap canonical source, rely on `RunAtLoad + KeepAlive`, and wait for unauthenticated `http://127.0.0.1:8788/mcp` to return HTTP `401`.

If GrandeGPT exposes no approved host activation capability, this is the only required Human Owner host action. Provide the exact canonical command instead of inventing a new execution route.

- [ ] **Step 5: Verify live exact eight-tool contract**

Require exactly:

```text
list_projects
get_project_structure
read_project_document
search_project
create_project_document
update_project_document
move_project_document
create_project_directory
```

Require `create_project_directory` to be `risk=write` with `readOnlyHint=false`, `destructiveHint=false`, `openWorldHint=false`, exact `{project,path}` required input, and no extra fields.

- [ ] **Step 6: Run real S5 success-composition probe**

Against `P033-GrandeGPT`, using the exact `list_projects.directory` value:

1. Create `phase4-s5-acceptance-20260824`.
2. Require `{ path: "phase4-s5-acceptance-20260824" }`.
3. Confirm structure reports it as `kind=directory`.
4. Create `phase4-s5-acceptance-20260824/created.md` with known content.
5. Read and record exact SHA/content/bytes.
6. Create root `phase4-s5-move-source.md` with distinct content.
7. Read source and record SHA/content/bytes.
8. Move to `phase4-s5-acceptance-20260824/moved.md` with the recorded SHA.
9. Read target and prove exact SHA/content/byte preservation.
10. Read source and require absence.

- [ ] **Step 7: Run real S5 missing-parent probe**

Invoke `create_project_directory` for:

```text
phase4-s5-missing-parent-20260824/child
```

Require `FILE_NOT_FOUND`, then prove neither parent nor child appears in structure output.

- [ ] **Step 8: Run real S5 existing-target probe**

Invoke `create_project_directory` again for `phase4-s5-acceptance-20260824`. Require `FILE_EXISTS`. Re-read both Markdown files inside it and prove SHA/content/bytes remain unchanged.

- [ ] **Step 9: Create bounded Phase 4 closeout task**

Record:

- implementation merge SHA;
- canonical activation evidence (`8788 LISTEN`, unauthenticated `/mcp = 401`);
- exact live eight-tool contract and annotations;
- success-composition SHA/byte evidence;
- missing-parent/no-partial evidence;
- existing-target preservation evidence;
- fresh unit/typecheck counts;
- both load-bearing proof results;
- explicit `Phase 4 / Safe Directory Core: PASSED / CLOSED` decision.

Update the Phase 4 design spec header to completed in the same docs-only closeout task, validate it, then commit/PR/merge normally.

---

## Plan Self-Review Checklist

Before execution begins, confirm:

- Every approved spec section maps to Tasks 1-6.
- No implementation step contains an unresolved placeholder or vague error-handling instruction.
- Exact names are consistent everywhere: `resolveCreatableDirectory`, `DirectoryWrite`, `createDirectory`, `createProjectDirectory`, `create_project_directory`.
- No task introduces recursive mkdir, delete, directory move/rename, cross-project mutation, overwrite/force, Obsidian CLI/plugin integration, a new native helper, or a new public error code.
- Existing seven tool schemas remain unchanged; only manifest/count/classification tests expand to eight.
- Real S5 acceptance happens only after canonical merge/activation, and closeout documentation happens afterward in a separate bounded task.
