# Phase 5 / Controlled Delivery & Runtime Attestation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the routine manual activation gap by binding the existing canonical launchd installer to GrandeGPT trusted deploy/verify profiles and proving that the live provider is the exact canonical build with the expected semantic MCP tool contract.

**Architecture:** Preserve the existing provider product path and eight-tool business surface. Add a build-SHA runtime header, canonical Git identity capture in launchd packaging, a deterministic semantic tool-manifest utility, and a bounded production verifier. `.grande/deploy.yaml` references only two GrandeGPT control-plane-approved profiles; the implementation PR self-hosts acceptance through `grande_deploy -> grande_deploy_verify` after one explicit Human Owner profile-registration gate.

**Tech Stack:** Node.js 24, TypeScript 5.9, Hono, `@modelcontextprotocol/sdk` v1.x, Vitest, macOS launchd, `/usr/bin/git`, `/usr/bin/plutil`, GrandeGPT trusted deployment profiles.

**Spec:** `docs/superpowers/specs/2026-08-25-grande-obsidian-mcp-phase5-controlled-delivery-runtime-attestation-design.md`

## Global Constraints

- Public MCP business surface remains exactly the Phase 4 eight tools; Phase 5 adds no ninth business tool.
- No file/directory mutation semantics change.
- No delete/trash, directory move/rename, cross-project mutation, wikilink rewrite, Obsidian CLI, automatic rollback, multi-host deployment, deployment database, or background deployment controller.
- Production runtime identity is independent from `serverInfo.version`; `serverInfo.version` remains `0.1.0`.
- Production build identity is exactly a lowercase 40-character Git SHA derived from canonical repository `HEAD`.
- Runtime build identity header is exactly `X-Grande-Obsidian-Build-Sha`.
- `.grande/deploy.yaml` may reference only `deploy-production` and `verify-production`; no repo-defined arbitrary command/argv/environment/rollback.
- The canonical tracked tree must have no staged or unstaged tracked modifications at deploy/verify time. Untracked build artifacts are not rejected merely for existing.
- Expected tool manifest for production verification must be loaded from the canonical repository tree, never from the retained task worktree.
- Tool-manifest acceptance is semantic digest equality, not hard-coded tool-count equality.
- Verifier network access is loopback-only at `http://127.0.0.1:8788/mcp`.
- Bearer token must never be printed or included in verifier result/artifact summaries.
- Phase 5 stays on the repository's current MCP SDK/protocol path; no protocol upgrade is allowed as a side effect.
- Every implementation task follows TDD: write failing test, prove RED, implement the minimum, prove GREEN, commit.
- Three load-bearing proofs are mandatory before release acceptance: stale runtime SHA, stale tool contract, wrong canonical launchd path.

---

## File Structure

The implementation should converge on these responsibilities:

- `src/runtime.ts` — parse and carry runtime build identity; local/test sentinel is `dev`.
- `src/server.ts` — emit the build header on every `/mcp` response without changing MCP version or business tools.
- `src/launchd.ts` — canonical repo resolution, production SHA validation, launchd plist rendering including build SHA.
- `ops/launchd/install.ts` — resolve canonical tracked Git state, capture exact canonical HEAD, render/bootstrap with that SHA.
- `src/toolManifest.ts` — source/live semantic projection, deterministic serialization, SHA-256 digest, bounded first-difference diagnostic.
- `ops/launchd/verifyCore.ts` — testable production-verification state machine with injected host/MCP dependencies.
- `ops/launchd/verify.ts` — thin real-host adapter: canonical Git/plist/launchctl checks, token loading, loopback MCP client, canonical-source manifest loading, bounded output.
- `.grande/deploy.yaml` — trusted profile references only.
- `package.json` — `launchd:verify` script only; existing scripts unchanged.
- Tests remain focused by responsibility rather than growing one giant integration file.

---

### Task 1: Runtime Build Identity Header

**Files:**
- Modify: `src/runtime.ts`
- Modify: `src/server.ts`
- Modify: `test/runtime.test.ts`
- Modify: `test/server.test.ts`

**Interfaces:**
- Produces: `RuntimeSettings.buildSha: string`
- Produces: `parseRuntimeBuildSha(value: string | undefined): string` or equivalent focused parser; accepted values are `dev` or `^[0-9a-f]{40}$`.
- Changes `createApp(options)` input to include `buildSha: string`.
- HTTP contract: every `/mcp` response carries `X-Grande-Obsidian-Build-Sha: <buildSha>`.
- Does not change `McpServer({ name: "grande-obsidian-mcp", version: "0.1.0" })`.

- [ ] **Step 1: Add RED runtime-setting tests**

Add explicit build-identity assertions to `test/runtime.test.ts`:

```ts
expect(loadRuntimeSettings({
  GRANDE_OBSIDIAN_CONFIG: "/tmp/grande-obsidian.yaml",
  GRANDE_OBSIDIAN_TOKEN: "secret-token",
  GRANDE_OBSIDIAN_BUILD_SHA: "a".repeat(40),
  PORT: "8788",
})).toMatchObject({ buildSha: "a".repeat(40) });

expect(loadRuntimeSettings({
  GRANDE_OBSIDIAN_CONFIG: "/tmp/grande-obsidian.yaml",
  GRANDE_OBSIDIAN_TOKEN: "secret-token",
})).toMatchObject({ buildSha: "dev" });

expect(() => loadRuntimeSettings({
  GRANDE_OBSIDIAN_CONFIG: "/tmp/grande-obsidian.yaml",
  GRANDE_OBSIDIAN_TOKEN: "secret-token",
  GRANDE_OBSIDIAN_BUILD_SHA: "not-a-sha",
})).toThrow(/BUILD_SHA/);
```

Update every explicit `createRuntime({...})` fixture to include `buildSha: "dev"`.

- [ ] **Step 2: Add RED HTTP-header tests**

Update `test/server.test.ts` so app fixtures pass `buildSha: "a".repeat(40)` and assert both denied and authenticated responses carry the exact header:

```ts
const denied = await app.request("/mcp", {
  method: "POST",
  headers: { host: "127.0.0.1:8788", "content-type": "application/json" },
  body,
});
expect(denied.status).toBe(401);
expect(denied.headers.get("X-Grande-Obsidian-Build-Sha")).toBe("a".repeat(40));

const listed = await rpc(app, "tools/list", {});
expect(listed.status).toBe(200);
expect(listed.headers.get("X-Grande-Obsidian-Build-Sha")).toBe("a".repeat(40));
```

Add an initialize assertion proving `serverInfo.version` is still `0.1.0` and does not contain the Git SHA.

- [ ] **Step 3: Run RED**

Run:

```text
grande_run(profile="unit")
```

Expected: FAIL because `RuntimeSettings`/`ServerOptions` have no build identity and responses do not emit the header.

- [ ] **Step 4: Implement the minimum runtime parser**

In `src/runtime.ts`, implement the equivalent of:

```ts
const PRODUCTION_BUILD_SHA_RE = /^[0-9a-f]{40}$/;

function parseRuntimeBuildSha(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) return "dev";
  if (normalized === "dev" || PRODUCTION_BUILD_SHA_RE.test(normalized)) return normalized;
  throw new Error("GRANDE_OBSIDIAN_BUILD_SHA must be 'dev' or a lowercase 40-character Git SHA");
}
```

Add `buildSha` to `RuntimeSettings`, load it from `GRANDE_OBSIDIAN_BUILD_SHA`, and pass it into `createApp`.

- [ ] **Step 5: Emit the header without altering MCP semantics**

In `src/server.ts`, add `buildSha` to `ServerOptions`. Set the header before any auth return and also on the successful transport response:

```ts
const BUILD_SHA_HEADER = "X-Grande-Obsidian-Build-Sha";

app.all("/mcp", async (c) => {
  c.header(BUILD_SHA_HEADER, options.buildSha);
  // existing loopback + auth checks
  // ...
  const response = await transport.handleRequest(c.req.raw);
  response.headers.set(BUILD_SHA_HEADER, options.buildSha);
  return response;
});
```

Do not change the `McpServer` version string.

- [ ] **Step 6: Run GREEN and typecheck**

Run `unit`, then `typecheck`. Require both PASS.

- [ ] **Step 7: Commit Task 1**

Commit message:

```text
feat: expose runtime build identity
```

---

### Task 2: Canonical Git Identity in Launchd Packaging

**Files:**
- Modify: `src/launchd.ts`
- Modify: `ops/launchd/install.ts`
- Modify: `test/launchd.test.ts`

**Interfaces:**
- Produces: `assertProductionBuildSha(value: string): string` in `src/launchd.ts`.
- Extends `LaunchAgentOptions` with `buildSha: string`.
- LaunchAgent environment contains `GRANDE_OBSIDIAN_BUILD_SHA=<exact canonical HEAD>`.
- Installer derives SHA only from canonical repo and rejects tracked staged/unstaged drift before native build/bootstrap.

- [ ] **Step 1: Write RED plist tests**

In `test/launchd.test.ts`, change the render fixture:

```ts
const plist = renderLaunchAgentPlist({
  repoRoot: "/Users/xtation/AgentWorks/GPT_Workspace/grande-obsidian-mcp",
  nodePath: "/usr/local/bin/node",
  homeDir: "/Users/xtation",
  buildSha: "a".repeat(40),
});
expect(plist).toContain("<key>GRANDE_OBSIDIAN_BUILD_SHA</key>");
expect(plist).toContain(`<string>${"a".repeat(40)}</string>`);
```

Add:

```ts
expect(() => renderLaunchAgentPlist({ ...validOptions, buildSha: "bad" })).toThrow(/build SHA/i);
```

- [ ] **Step 2: Write RED installer-source ordering/identity tests**

Add bounded assertions that the installer:

- resolves `repoRoot` first;
- runs `/usr/bin/git -C <repoRoot> rev-parse HEAD`;
- runs `/usr/bin/git -C <repoRoot> status --porcelain --untracked-files=no`;
- rejects non-empty tracked status;
- obtains SHA before `buildRenameExcl(repoRoot)` and before launchctl bootstrap;
- passes `buildSha` into `renderLaunchAgentPlist`.

Prefer extracting a small `readCanonicalGitIdentity(repoRoot, runFn)` helper if source-string assertions become brittle. If extracted, unit-test it with injected command results rather than spawning real Git in every test.

- [ ] **Step 3: Run RED**

Run `unit`; expect launchd packaging tests to fail because build SHA is absent.

- [ ] **Step 4: Implement SHA validation and plist rendering**

In `src/launchd.ts`:

```ts
const PRODUCTION_BUILD_SHA_RE = /^[0-9a-f]{40}$/;

export function assertProductionBuildSha(value: string): string {
  if (!PRODUCTION_BUILD_SHA_RE.test(value)) {
    throw new Error("production build SHA must be a lowercase 40-character Git SHA");
  }
  return value;
}
```

Add `buildSha` to `LaunchAgentOptions`, validate it before rendering, and emit:

```xml
<key>GRANDE_OBSIDIAN_BUILD_SHA</key>
<string>...</string>
```

- [ ] **Step 5: Implement canonical tracked-state + HEAD capture**

In `ops/launchd/install.ts`, before `buildRenameExcl(repoRoot)`:

```ts
const trackedStatus = run("/usr/bin/git", [
  "-C", repoRoot, "status", "--porcelain", "--untracked-files=no",
]).stdout.trim();
if (trackedStatus) fail("canonical tracked tree is not clean");

const buildSha = assertProductionBuildSha(
  run("/usr/bin/git", ["-C", repoRoot, "rev-parse", "HEAD"]).stdout.trim(),
);
```

Pass `buildSha` to `renderLaunchAgentPlist`.

Do not reject untracked files merely for existing; the native helper build output is expected to remain outside tracked-state cleanliness.

- [ ] **Step 6: Run GREEN and regression**

Run `unit` and `typecheck`. Confirm all existing launchd bootout/readiness/native-build tests remain green.

- [ ] **Step 7: Commit Task 2**

Commit message:

```text
feat: bind launchd runtime to canonical sha
```

---

### Task 3: Canonical Semantic Tool Manifest

**Files:**
- Create: `src/toolManifest.ts`
- Create: `test/toolManifest.test.ts`
- Read-only dependency: `src/tools.ts`

**Interfaces:**
- Produces:

```ts
export interface CanonicalToolInput {
  name: string;
  type: "string" | "number";
  required: boolean;
}

export interface CanonicalToolManifestEntry {
  name: string;
  description: string;
  inputs: CanonicalToolInput[];
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    openWorldHint: boolean;
  };
}

export type CanonicalToolManifest = CanonicalToolManifestEntry[];

export function canonicalizeSourceTools(tools: readonly ToolDef[]): CanonicalToolManifest;
export function canonicalizeLiveTools(tools: readonly unknown[]): CanonicalToolManifest;
export function toolManifestDigest(manifest: CanonicalToolManifest): string;
export function firstToolManifestDifference(expected: CanonicalToolManifest, actual: CanonicalToolManifest): string | null;
```

- Digest format is exactly `sha256:<64 lowercase hex>`.
- Canonicalization sorts tools by name and inputs by property name.
- `$schema`, raw key order, property descriptions, handlers, and implementation-only fields do not affect digest.

- [ ] **Step 1: Write RED deterministic-projection tests**

Create tests with two semantically equivalent source/live manifests whose tool order, property order, and `$schema` differ. Require identical canonical output and digest.

Representative live fixture:

```ts
const live = [{
  name: "example",
  description: "Example tool",
  inputSchema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      optional: { type: "number", description: "ignored representation detail" },
      project: { type: "string" },
    },
    required: ["project"],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
}];
```

- [ ] **Step 2: Write RED sensitivity tests**

Require digest/difference changes for each semantic mutation:

- missing tool;
- added tool;
- changed tool description;
- changed input name;
- changed input type;
- changed requiredness;
- changed `readOnlyHint`;
- changed `destructiveHint`;
- changed `openWorldHint`.

Require no digest change for:

- tool order only;
- property order only;
- `$schema` only;
- source handler identity only.

- [ ] **Step 3: Write RED malformed-live-manifest tests**

Require `canonicalizeLiveTools` to reject missing/invalid name, description, input schema, unsupported property type, or missing explicit annotation booleans. It must not infer risk from tool name.

- [ ] **Step 4: Run RED**

Run `unit`; expected failure because `src/toolManifest.ts` does not exist.

- [ ] **Step 5: Implement canonicalization**

Implementation rules:

```ts
function canonicalInputs(properties, requiredNames) {
  return Object.entries(properties)
    .map(([name, schema]) => ({
      name,
      type: assertSupportedType(schema.type),
      required: requiredNames.has(name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

Source and live adapters may parse different input types, but both must return the same `CanonicalToolManifestEntry` structure. Do not hash raw MCP JSON.

- [ ] **Step 6: Implement stable digest + bounded diagnostic**

Use `createHash("sha256")` over `JSON.stringify(manifest)` after canonicalization:

```ts
return `sha256:${createHash("sha256").update(JSON.stringify(manifest), "utf8").digest("hex")}`;
```

`firstToolManifestDifference` should return one concise bounded message such as:

```text
missing live tool: create_project_directory
```

or:

```text
tool update_project_document input expectedSha256 requiredness differs
```

Do not dump the entire manifests on mismatch.

- [ ] **Step 7: Run GREEN and typecheck**

Run `unit` and `typecheck`.

- [ ] **Step 8: Commit Task 3**

Commit message:

```text
feat: add semantic tool manifest digest
```

---

### Task 4: Production Verification Core

**Files:**
- Create: `ops/launchd/verifyCore.ts`
- Create: `test/launchdVerify.test.ts`
- Uses: `src/toolManifest.ts`, `src/launchd.ts`

**Interfaces:**
- Produces:

```ts
export interface ProductionVerifySummary {
  label: string;
  canonicalSha: string;
  runtimeSha: string;
  unauthenticatedStatus: 401;
  toolsCount: number;
  expectedToolsDigest: string;
  liveToolsDigest: string;
}

export interface ProductionVerifyDependencies {
  resolveCanonicalState(): Promise<{
    repoRoot: string;
    canonicalSha: string;
    trackedTreeClean: boolean;
  }>;
  inspectLaunchAgent(): Promise<{
    loaded: boolean;
    workingDirectory: string;
    runnerPath: string;
  }>;
  probeUnauthenticated(): Promise<{ status: number; buildSha: string | null }>;
  loadExpectedTools(repoRoot: string): Promise<unknown[]>;
  loadLiveTools(): Promise<unknown[]>;
}

export async function verifyProduction(
  dependencies: ProductionVerifyDependencies,
): Promise<ProductionVerifySummary>;
```

The exact shape may be minimally adjusted during implementation, but the dependencies must keep host I/O outside the verification decision logic so all fail-closed cases are deterministic unit tests.

- [ ] **Step 1: Write RED success-path test**

Use a fixture where:

```text
canonical repo = /workspace/grande-obsidian-mcp
canonical SHA = aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
launchd loaded = true
workingDirectory = canonical repo
runnerPath = canonical repo/ops/launchd/run.ts
unauth status = 401
runtime header SHA = canonical SHA
expected/live tools = semantically equal
```

Require exact `ProductionVerifySummary` and equal digests.

- [ ] **Step 2: Write RED fail-closed tests**

Add one test each for:

- tracked tree dirty;
- service not loaded;
- wrong WorkingDirectory;
- wrong runner path;
- unauth status `200`, `403`, or `500`;
- missing build header;
- malformed build header;
- runtime SHA different from canonical SHA;
- expected/live manifest mismatch;
- live manifest malformed.

Each must reject before returning success.

- [ ] **Step 3: Run RED**

Run `unit`; expected failure because verification core does not exist.

- [ ] **Step 4: Implement fixed verification order**

Implement exactly:

```text
resolve canonical state
-> require tracked tree clean
-> validate canonical SHA
-> inspect launchd
-> require canonical WorkingDirectory/runner
-> unauth probe
-> require exactly 401
-> require valid runtime build header
-> require runtime SHA == canonical SHA
-> load canonical expected tools using repoRoot returned above
-> load live tools
-> canonicalize both
-> require digest equality
-> return bounded summary
```

Do not perform any vault write operation.

- [ ] **Step 5: Ensure diagnostic safety**

Errors may contain label/path/SHA/status/tool difference. They must never contain bearer token or arbitrary full response bodies.

- [ ] **Step 6: Run GREEN and typecheck**

Run `unit` and `typecheck`.

- [ ] **Step 7: Commit Task 4**

Commit message:

```text
feat: verify production runtime identity
```

---

### Task 5: Real Host Verifier Adapter and Trusted Deploy Declaration

**Files:**
- Create: `ops/launchd/verify.ts`
- Modify: `package.json`
- Create: `.grande/deploy.yaml`
- Modify: `test/launchd.test.ts`
- Create or modify: focused adapter tests if needed

**Interfaces:**
- `package.json` adds exactly:

```json
"launchd:verify": "node --disable-warning=ExperimentalWarning ops/launchd/verify.ts"
```

- `.grande/deploy.yaml` is exactly:

```yaml
deploy:
  profile: deploy-production
verify:
  profile: verify-production
```

- `ops/launchd/verify.ts` is a thin adapter around `verifyProduction(...)`.

- [ ] **Step 1: Write RED packaging tests**

Extend `test/launchd.test.ts`:

```ts
expect(packageJson.scripts?.["launchd:verify"]).toBe(
  "node --disable-warning=ExperimentalWarning ops/launchd/verify.ts",
);
```

Read `.grande/deploy.yaml` and require exact profile names and no rollback/command/argv fields.

- [ ] **Step 2: Write RED adapter tests for canonical source loading**

Test the real helper responsible for expected-source loading with two roots:

```text
worktree root A contains modified fake tools
canonical root B contains expected tools
```

Require the helper to import/build expected tool definitions from B only. This is load-bearing for the statement “canonical source is truth.”

The real canonical loader should dynamically import canonical `src/tools.ts` using a `file://` URL derived from `repoRoot`, construct a non-executing stub `ProjectService`, call canonical `buildTools(stub)`, and return those definitions. No handler may be invoked.

- [ ] **Step 3: Write RED token/output tests**

With injected token file content `super-secret-token`, require verifier success/failure output never to contain that string.

- [ ] **Step 4: Run RED**

Run `unit`; expect failures because verify script/deploy spec are absent.

- [ ] **Step 5: Implement real canonical Git/plist/launchctl adapters**

`verify.ts` resolves its script root to canonical root with `resolveCanonicalRepoRoot` and obtains:

```text
git status --porcelain --untracked-files=no
git rev-parse HEAD
```

For installed plist identity, use `/usr/bin/plutil` against:

```text
~/Library/LaunchAgents/ai.agentjoey.grande-obsidian-mcp.plist
```

Extract at minimum:

```text
WorkingDirectory
ProgramArguments.2
```

and require them to equal:

```text
<canonicalRoot>
<canonicalRoot>/ops/launchd/run.ts
```

Use `/bin/launchctl print gui/<uid>/ai.agentjoey.grande-obsidian-mcp` to prove the service is loaded.

- [ ] **Step 6: Implement unauthenticated loopback probe**

Use built-in `fetch` only against `http://127.0.0.1:8788/mcp`, with a bounded timeout. Capture status and `X-Grande-Obsidian-Build-Sha`; do not follow any externally supplied URL.

- [ ] **Step 7: Implement authenticated MCP tools/list adapter**

Read the existing token from `~/.grande-control/secrets/obsidian-token`, require non-empty, and never log it.

Use the installed SDK client rather than hand-writing a second MCP protocol implementation:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "grande-obsidian-mcp-verifier", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(
  new URL("http://127.0.0.1:8788/mcp"),
  { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
);
await client.connect(transport);
try {
  return (await client.listTools()).tools;
} finally {
  await client.close();
}
```

If the installed v1.30 SDK constructor option shape differs, inspect the actual package declaration and adjust only the adapter call site; do not replace the SDK client with a custom protocol stack unless required by evidence and reviewed as a plan deviation.

- [ ] **Step 8: Implement canonical expected-tool loader**

Load canonical source from `repoRoot`, not `import "../../src/tools.ts"` from the worktree. Use `pathToFileURL(join(repoRoot, "src", "tools.ts"))` for dynamic import. Build tools with a stub service whose methods throw if ever invoked.

- [ ] **Step 9: Wire CLI output**

Call `verifyProduction(realDependencies)` and emit exactly one bounded JSON summary on success. On failure, throw/exit non-zero with a bounded diagnostic and no token.

- [ ] **Step 10: Run GREEN and full regression**

Run `unit` and `typecheck`. Require the public tool manifest test still exposes exactly the same eight Phase 4 tools.

- [ ] **Step 11: Commit Task 5**

Commit message:

```text
feat: add trusted production verifier
```

---

### Task 6: Load-Bearing Proofs and Release-Candidate Verification

**Files:**
- Temporary proof mutations only in verification implementation; restore every mutation.
- No permanent scope expansion.

**Interfaces:**
- Consumes all Phase 5 implementation.
- Produces causal RED/GREEN evidence for the three required guards.

- [ ] **Step 1: Fresh GREEN baseline**

Run full `unit` and `typecheck`. Record counts and job IDs.

- [ ] **Step 2: Proof A — stale runtime SHA**

Create a checkpoint. Temporarily weaken `verifyProduction` so it does not reject `runtimeSha !== canonicalSha`.

Run the dedicated test with:

```text
canonical SHA = bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
runtime SHA   = aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

Expected: test goes RED because weakened production verification incorrectly succeeds.

Restore checkpoint. Run the dedicated test and require GREEN.

- [ ] **Step 3: Proof B — stale tool contract**

Create a checkpoint. Temporarily bypass expected/live manifest digest equality.

Run the dedicated test with a live manifest missing `create_project_directory` or with a changed annotation.

Expected: test goes RED because the weakened verifier accepts stale contract.

Restore checkpoint. Require GREEN.

- [ ] **Step 4: Proof C — wrong canonical activation**

Create a checkpoint. Temporarily bypass canonical WorkingDirectory/runner-path rejection.

Run the dedicated test where canonical repo is B but LaunchAgent paths point at checkout A.

Expected: test goes RED because the weakened verifier accepts the wrong activation root.

Restore checkpoint. Require GREEN.

- [ ] **Step 5: Scope audit**

Search production/public code for accidental additions:

```text
delete
trash
move_project_directory
sourceProject
targetProject
updateLinks
Obsidian CLI
rollback
command:
argv:
```

Interpret matches in docs/tests/config context; require no new public/destructive capability or repo-defined arbitrary deploy command.

Confirm `buildTools(service)` still returns exactly the same eight Phase 4 business tools.

- [ ] **Step 6: Fresh release-candidate verification**

After all proof mutations are restored, run full `unit` and `typecheck` again. These final jobs, not prior runs, are the completion evidence.

- [ ] **Step 7: Diff/review and commit if needed**

Use bounded `grande_diff` pages. If Task 6 required permanent test-only clarity changes, commit them with:

```text
test: prove phase 5 delivery guards
```

Otherwise do not create an empty commit.

---

### Task 7: Implementation PR and One-Time Control-Plane Human Gate

**Files:**
- Provider repo: no new implementation files beyond Tasks 1-6.
- External trusted config: GrandeGPT control plane `~/.grande-control/config/profiles.yaml` (or the control-plane-managed equivalent).

**Interfaces:**
- Provider repo declares profile names only.
- Human-approved control-plane entries are exactly:

```yaml
repos:
  grande-obsidian-mcp:
    deploy-production:
      argv: [pnpm, launchd:install]
      timeoutSeconds: 120
    verify-production:
      argv: [pnpm, launchd:verify]
      timeoutSeconds: 60
```

- This is the single planned Human Gate for trusted host execution policy.

- [ ] **Step 1: Push and open implementation PR**

Push the implementation branch and open a ready PR summarizing:

- no public business-tool change;
- runtime build header;
- canonical launchd SHA binding;
- semantic manifest digest;
- production verifier;
- `.grande/deploy.yaml`;
- fresh unit/typecheck;
- three load-bearing proofs.

- [ ] **Step 2: Read PR status**

Require current PR head matches task HEAD, mergeable is true, CI is not pending/failed, and current SHA has the required local attestation.

- [ ] **Step 3: Stop at the real Human Gate if profiles are not already registered**

Do not emulate or bypass GrandeGPT profile policy from the provider repository. Present the exact two profile entries above for Human Owner approval/application using the normal GrandeGPT control-plane workflow.

After the Human Owner confirms the profiles are registered, continue without another approval prompt.

- [ ] **Step 4: Re-read readiness after profile registration**

Verify the control plane recognizes `deploy-production` and `verify-production` for `grande-obsidian-mcp`. If either is absent or resolves to a different argv/timeout, fail closed before merge/self-hosting acceptance.

---

### Task 8: Self-Hosted Phase 5 Acceptance

**Files:**
- No source changes during the deployment proof.
- Later create: `docs/superpowers/closeouts/2026-08-25-grande-obsidian-mcp-phase5-closeout.md`
- Modify spec status after acceptance.

**Interfaces:**
- `grande_pr_merge` must preserve the task after merge because `.grande/deploy.yaml` makes deployment pending.
- `grande_deploy` invokes `deploy-production`.
- `grande_deploy_verify` invokes `verify-production` and binds receipt to unchanged deployment spec.

- [ ] **Step 1: Merge implementation PR**

Invoke `grande_pr_merge`. Require:

- PR merged;
- canonical refresh succeeds;
- task remains available in deploy-pending state rather than being cleaned up;
- canonical merge SHA is recorded.

- [ ] **Step 2: Controlled deploy**

Invoke `grande_deploy` on the retained implementation task.

Require `deploy-production` to complete without any Human Owner terminal command. If sandbox/host policy prevents launchd install despite the approved profile, stop and report the concrete policy failure; do not fall back to manual activation and still call Phase 5 accepted.

- [ ] **Step 3: Controlled production verify**

Invoke `grande_deploy_verify`.

Require verifier evidence:

```text
label = ai.agentjoey.grande-obsidian-mcp
canonicalSha = merged canonical HEAD
runtimeSha = canonicalSha
unauthenticatedStatus = 401
expectedToolsDigest = liveToolsDigest
```

`toolsCount` should be 8 for this Phase 5 release, but count is diagnostic; digest equality is the architectural gate.

- [ ] **Step 4: Confirm GrandeGPT deployment state reaches DONE**

Read task status and deployment receipt. Require deploy and verify success against the same unchanged `.grande/deploy.yaml` digest.

- [ ] **Step 5: Independent live capability discovery**

Run GrandeGPT capability discovery against provider `obsidian`. Require the same eight Phase 4 tools and unchanged risk/annotation classes. No vault write probe is required because Phase 5 changes delivery/attestation only.

- [ ] **Step 6: Create closeout evidence task if merge cleanup requires one**

If the deploy task is automatically completed/cleaned after DONE, open a bounded docs-only closeout task from the verified canonical merge SHA. Otherwise use the retained task only if GrandeGPT lifecycle permits safe docs closeout without invalidating the deployment receipt.

- [ ] **Step 7: Write Phase 5 closeout**

Record:

- design/spec/plan references;
- implementation PR/head/merge SHA;
- control-plane profile approval fact and exact profile names (never secrets);
- final unit/typecheck evidence;
- three load-bearing RED/GREEN proof results;
- deploy job/result;
- verify job/result;
- canonical SHA and runtime SHA;
- launchd canonical WorkingDirectory/runner identity;
- unauthenticated 401;
- expected/live tool digests and diagnostic toolsCount;
- independent live eight-tool discovery;
- explicit decision `Phase 5 / Controlled Delivery & Runtime Attestation: PASSED / CLOSED`.

Update the Phase 5 spec status to completed.

- [ ] **Step 8: Fresh docs-side verification**

Run `typecheck` (and `unit` if any non-doc source changed after deployment, which normally should not happen). Review diff for docs-only closeout scope.

- [ ] **Step 9: Commit, push, PR, merge closeout**

Use normal GrandeGPT PR flow. After merge, confirm canonical contains the closeout decision. Do not redeploy merely because the docs-only closeout commit changed canonical SHA; the closeout must explicitly distinguish the verified implementation/runtime SHA from the later docs-only canonical closeout SHA.

---

## Plan Self-Review Checklist

Before implementation begins, confirm:

- Every spec section 1-19 maps to at least one task above.
- Runtime identity is independent from MCP version.
- Build SHA comes from canonical Git HEAD and is carried by launchd env into the HTTP header.
- Canonical tracked-state cleanliness ignores untracked native build artifacts.
- Expected manifest is dynamically loaded from canonical tree, not worktree imports.
- Source/live manifests converge to one semantic representation before hashing.
- Tool count is never the acceptance gate.
- Production verifier checks canonical path before accepting self-reported runtime SHA.
- Token never appears in success/failure output.
- No public business tool or filesystem mutation code is touched.
- No rollback is declared.
- Control-plane profile registration occurs exactly once at the real trusted-host policy gate.
- Self-hosted acceptance refuses a manual-terminal fallback as proof of Phase 5 success.
- Docs-only closeout commit is not confused with the previously verified implementation/runtime SHA.
- No TODO/TBD/placeholders remain in executable steps.
