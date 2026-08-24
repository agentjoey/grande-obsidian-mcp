# grande-obsidian-mcp Phase 5 / Controlled Delivery & Runtime Attestation Design

**Date:** 2026-08-25  
**Status:** Proposed rev2; Phase 5 direction approved by Human Owner, written spec awaiting review  
**Phase:** Phase 5 / Controlled Delivery & Runtime Attestation  
**Repository:** `grande-obsidian-mcp`  
**Base:** Phase 4 formally closed on canonical `main` at `257b1426da0f7baa70d7561d0008bb0e96647ca1`

## 1. Purpose

Phase 5 closes the only remaining routine manual step in the provider release loop: activating the just-merged canonical repository through launchd and proving that the live MCP process is the exact canonical build with the expected public contract.

Before Phase 5, the normal loop is:

```text
implementation
  -> unit/typecheck
  -> PR
  -> merge
  -> Human Owner runs `pnpm launchd:install` from canonical repo
  -> live capability discovery / S5
  -> closeout
```

After Phase 5, the normal loop is:

```text
implementation
  -> unit/typecheck
  -> PR
  -> merge
  -> GrandeGPT controlled deploy
  -> GrandeGPT controlled production verify
  -> live S5 when the phase changes business behavior
  -> closeout
```

The objective is not to build a deployment platform. It is to bind the existing launchd installer to GrandeGPT's existing trusted deployment mechanism and add enough runtime identity/contract verification to fail closed when the wrong build or wrong tool surface is running.

## 2. Product boundary

Phase 5 changes delivery architecture only.

The public MCP business surface remains exactly the Phase 4 surface:

1. `list_projects`
2. `get_project_structure`
3. `read_project_document`
4. `search_project`
5. `create_project_document`
6. `update_project_document`
7. `move_project_document`
8. `create_project_directory`

Phase 5 adds no ninth business tool and changes no file/directory mutation semantics.

The architecture remains:

```text
ChatGPT
  -> GrandeGPT generic S5 MCP capability
  -> grande-obsidian-mcp
  -> safe project-scoped filesystem layer
  -> Obsidian Vault / project root
```

Phase 5 adds one delivery path beside that product path:

```text
canonical Git main
  -> GrandeGPT trusted deployment spec
  -> approved deploy profile
  -> canonical launchd activation
  -> live runtime identity + contract evidence
  -> approved verify profile
  -> GrandeGPT deployment receipt / DONE
```

GrandeGPT continues to own task binding and deployment orchestration. `grande-obsidian-mcp` continues to own its launchd installer, runtime identity emission, and MCP contract.

## 3. Design principles

1. **Canonical only.** Production activation and expected-contract verification must be derived from the canonical repository, never a task worktree.
2. **No arbitrary deploy commands from repo config.** `.grande/deploy.yaml` may reference only control-plane-approved profiles/capabilities.
3. **Exact runtime identity.** `service is running` and `/mcp = 401` are necessary but insufficient. Verification must bind the running process to canonical `HEAD`.
4. **Contract verification from source, not hard-coded count.** Phase 5 must not become stale merely because a later phase adds a tool.
5. **Fail closed.** Missing, malformed, stale, dirty, or contradictory runtime evidence blocks `DONE`.
6. **No automatic rollback.** A failed deployment/verification remains visible for diagnosis; rollback is a separate future design.
7. **Do not upgrade MCP protocol as a side effect.** Phase 5 stays on the repository's current `@modelcontextprotocol/sdk` v1.x / 2025-era handshake unless a separate protocol-upgrade phase is approved.

## 4. Trusted deployment declaration

Phase 5 adds:

```text
.grande/deploy.yaml
```

with exactly:

```yaml
deploy:
  profile: deploy-production

verify:
  profile: verify-production
```

No `rollback` entry is added in Phase 5.

The repository declaration must not contain:

- shell command strings;
- argv arrays;
- executable paths;
- environment overrides;
- arbitrary network destinations;
- a repo-defined rollback action.

The declaration only selects profiles already approved in the GrandeGPT control plane.

## 5. One-time control-plane Human Gate

The repository currently has only `unit` and `typecheck` profiles. Phase 5 requires two new approved profiles in GrandeGPT control-plane configuration:

- `deploy-production`
- `verify-production`

This registration is a one-time Human Owner gate because it changes trusted host execution policy outside this repository.

The GrandeGPT control-plane profile schema is already established as `profiles.yaml -> repos.<repoId>.<profile> -> { argv, timeoutSeconds }`. The intended registration is therefore exact in behavior, conceptually:

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

The final registration may use the control plane's accepted equivalent YAML formatting, but it must preserve those exact argv values and must not add shell interpolation, arbitrary command arguments, generic executable selection, or open-ended environment injection.

The deploy timeout is intentionally bounded but longer than the verifier because the installer may rebuild the fixed native rename helper and must complete bounded launchd unload/bootstrap/readiness. The verifier performs only bounded local inspection and loopback MCP calls.

Once registered, later provider phases must not require repeated Human Owner terminal activation unless the trusted deployment contract itself changes or a real host failure requires intervention.

## 6. Deploy profile contract

### 6.1 `deploy-production`

The deploy profile reuses the existing installer:

```text
pnpm launchd:install
```

The GrandeGPT profile starts from the preserved task worktree after merge, because the deployment spec is task-bound. The installer must immediately resolve from its script/worktree location to the canonical repository and use canonical paths for all persisted production state.

The existing installer already resolves a task-worktree script location back to the canonical repository and refuses a LaunchAgent rooted in `.grande-work/worktrees/...`.

Phase 5 preserves the existing installer guarantees:

- canonical repo pinning;
- native helper build before service activation;
- fixed launchd label `ai.agentjoey.grande-obsidian-mcp`;
- loopback service on port `8788`;
- bearer-token file validation and `0600` permissions;
- bounded unload before bootstrap;
- `RunAtLoad` / `KeepAlive` behavior;
- bounded readiness requiring launchd loaded plus unauthenticated `/mcp` returning HTTP `401`.

### 6.2 Canonical tracked-tree requirement

A Git commit SHA only identifies runtime code if the tracked canonical working tree matches that commit.

Before activation, the installer must require:

- canonical `HEAD` resolves successfully;
- no staged tracked-file changes relative to `HEAD`;
- no unstaged tracked-file changes relative to `HEAD`.

Untracked files are not a deployment blocker by themselves because the existing native build intentionally produces an untracked helper under `native/bin/`. Phase 5 must not confuse that expected generated artifact with tracked source drift.

If tracked canonical source differs from `HEAD`, deployment fails before launchd mutation. Phase 5 does not auto-stash, auto-reset, or commit canonical changes.

### 6.3 New build identity capture

Before rendering the LaunchAgent, the installer reads the canonical repository's exact Git `HEAD`.

Production build SHA format is exactly:

```text
^[0-9a-f]{40}$
```

The installer must fail before activation if canonical `HEAD` cannot be obtained or does not match that format.

The LaunchAgent receives:

```text
GRANDE_OBSIDIAN_BUILD_SHA=<canonical 40-char SHA>
```

No task branch SHA, PR head SHA, shortened SHA, dirty-tree pseudo-version, timestamp, or user-provided value may substitute for canonical `HEAD`.

The package/server semantic version remains `0.1.0`; Phase 5 does not encode Git identity inside the version string.

## 7. Runtime build identity channel

### 7.1 Why not `serverInfo.version`

Build identity and software version are different concepts. Phase 5 keeps MCP `serverInfo.version` as the package/server version and does not change versioning semantics merely to carry a deployment SHA.

The project currently uses the v1.x TypeScript SDK and the 2025-era initialize handshake. MCP 2025 results support implementation `_meta`, but the current high-level `McpServer` initialize path is not a stable application-level extension seam that Phase 5 should patch merely to emit a Git SHA. Phase 5 therefore does not patch SDK internals and does not upgrade protocol versions merely to expose build identity.

### 7.2 Build header

The runtime emits the build identity as a loopback HTTP response header:

```text
X-Grande-Obsidian-Build-Sha: <value>
```

Rules:

- production launchd runtime requires `GRANDE_OBSIDIAN_BUILD_SHA` to be a lowercase 40-character SHA;
- the header is emitted on every `/mcp` response, including `401` and successful authenticated MCP responses;
- build SHA is non-secret metadata;
- no other endpoint is added;
- no `/health`, `/version`, or new MCP tool/resource is added.

Test/in-process runtime may use an explicit non-production sentinel such as `dev`, but `verify-production` must reject any missing, malformed, or non-40-character build identity.

The header is self-reported runtime evidence, not a cryptographic signature. Its trust comes from the controlled launchd installer setting it from clean tracked canonical `HEAD`, plus verification of canonical LaunchAgent paths and the runtime response.

## 8. Canonical LaunchAgent identity

`verify-production` must verify more than PID existence.

The expected production identity is fixed:

```text
label = ai.agentjoey.grande-obsidian-mcp
canonical repo = /Users/xtation/AgentWorks/GPT_Workspace/grande-obsidian-mcp
port = 8788
host = 127.0.0.1
```

The verifier checks:

1. the canonical repository resolves to the expected registered repo path;
2. canonical `HEAD` is a lowercase 40-character SHA;
3. no staged or unstaged tracked-file drift exists relative to canonical `HEAD`;
4. the launchd service is loaded;
5. the service is running or has a live PID according to the existing launchctl parsing contract;
6. the installed plist/launchd program arguments and working directory resolve to the canonical repository, not a task worktree or another checkout;
7. unauthenticated `/mcp` returns exactly HTTP `401`;
8. the response carries a valid build header;
9. the runtime build header equals canonical `HEAD`.

Untracked files are ignored for the tracked-tree identity check, specifically so the expected generated native helper does not make a valid production checkout unverifiable.

Phase 5 does not require matching a process executable inode or implementing code signing. Canonical path + clean tracked canonical tree + canonical SHA + runtime SHA is the proportional boundary for this local single-host provider.

## 9. Canonical tool manifest normalization

### 9.1 Problem

A verifier that hard-codes `tools.length === 8` becomes obsolete as soon as a later approved phase adds a tool. A verifier that hashes raw JSON is also brittle because object-key order, protocol-added `$schema`, and representational metadata can change without changing the public contract.

Phase 5 therefore defines one canonical semantic projection for tool-manifest comparison.

### 9.2 Canonical projection

Add a focused manifest utility, conceptually:

```text
src/toolManifest.ts
```

It converts either source tool definitions or raw MCP `tools/list` output into the same canonical representation.

Each canonical tool contains only fields Phase 5 can compare symmetrically and that affect the current public MCP contract:

```ts
interface CanonicalToolManifestEntry {
  name: string;
  description: string;
  inputs: Array<{
    name: string;
    type: "string" | "number";
    required: boolean;
  }>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    openWorldHint: boolean;
  };
}
```

Canonicalization rules:

- tools sorted lexically by `name`;
- inputs sorted lexically by property name;
- requiredness converted to a boolean on each input;
- missing optional annotation values are normalized only according to the provider's current explicit annotation contract, never guessed from tool name;
- protocol-added `$schema`, JSON object key order, and property-description text not preserved by the current SDK registration path are excluded from the digest;
- handler functions and implementation-only metadata are excluded;
- tool-level description remains included;
- property name/type/requiredness remain included.

Phase 5 deliberately does not change the existing tool registration semantics merely to make `additionalProperties` or property-description representation symmetric. Those concerns remain governed by their existing tool tests and can be hardened separately if real use requires it.

### 9.3 Expected manifest must come from canonical source

The verifier itself may be launched through a preserved task worktree after merge, but **expected contract data must not be imported from that worktree**.

The verifier first resolves the canonical repository, then loads canonical tool definitions from that canonical tree. Conceptually:

```text
verify script entrypoint
  -> resolveCanonicalRepoRoot(...)
  -> load canonical `src/tools.ts`
  -> canonical source `buildTools(...)`
  -> source projection
  -> canonical expected manifest
```

A non-executing stub `ProjectService` may be used solely to construct tool definitions; no provider handler is invoked during manifest generation.

If the verifier cannot load the expected manifest from the canonical tree identified by canonical `HEAD`, verification fails. It must not silently fall back to task-worktree source.

This constraint matters because the task worktree is a deployment orchestration artifact, not the production truth source.

### 9.4 Live manifest

Live manifest:

```text
authenticated raw MCP `tools/list`
  -> live projection
  -> canonical live manifest
```

Both expected and live projections use the same serialization function after projection:

```text
UTF-8 JSON(canonical manifest)
  -> SHA-256
```

Verification requires:

```text
expected digest == live digest
```

For diagnostics, a mismatch should also report the first bounded semantic difference, for example missing tool, extra tool, input mismatch, description mismatch, or annotation mismatch, rather than returning only two opaque hashes.

## 10. Production verifier

Phase 5 adds:

```text
pnpm launchd:verify
```

implemented by a bounded repo-owned verifier such as:

```text
ops/launchd/verify.ts
```

The verifier does not mutate the vault and does not call any provider write tool.

Although the verifier entrypoint may execute from a task worktree under the trusted profile, all production truth it compares must be resolved from the canonical repo and live service: canonical Git state, canonical tool definitions, canonical LaunchAgent paths, and live MCP responses.

### 10.1 Verification order

The order is fixed so stronger identity checks happen before product-level live acceptance:

```text
1. resolve canonical repo
2. resolve canonical Git HEAD
3. require tracked canonical tree clean relative to HEAD
4. load expected tool definitions from canonical tree
5. verify launchd identity / canonical paths
6. unauthenticated POST /mcp -> exactly 401
7. verify build-SHA response header == canonical HEAD
8. authenticated MCP handshake
9. authenticated raw tools/list
10. canonicalize expected + live manifests
11. require equal manifest digest
12. return success summary
```

### 10.2 Authentication

The verifier reads the same existing bearer-token file used by launchd:

```text
~/.grande-control/secrets/obsidian-token
```

Requirements:

- file exists;
- trimmed token is non-empty;
- verifier never prints the token;
- verifier never includes it in an artifact summary;
- token is used only for loopback MCP verification.

### 10.3 Network boundary

The verifier may contact only:

```text
http://127.0.0.1:8788/mcp
```

No open-world network call is required.

### 10.4 Success output

The verifier emits a bounded machine-readable summary containing non-secret evidence such as:

```json
{
  "label": "ai.agentjoey.grande-obsidian-mcp",
  "canonicalSha": "...40 hex...",
  "runtimeSha": "...40 hex...",
  "unauthenticatedStatus": 401,
  "toolsCount": 8,
  "expectedToolsDigest": "sha256:...",
  "liveToolsDigest": "sha256:..."
}
```

`toolsCount` is diagnostic only. It is not the acceptance condition. Digest equality is the contract condition.

The success result must not include the bearer token, config-file contents, vault paths beyond the already-known registered project root boundary, environment dumps, or raw launchctl output.

## 11. Failure semantics

Phase 5 reuses GrandeGPT deployment-stage failure reporting rather than adding provider public errors.

### Deploy failure

Examples:

- canonical repo cannot be resolved;
- canonical `HEAD` cannot be read;
- canonical tracked tree is dirty;
- native helper build fails;
- launchd bootout/bootstrap fails;
- bounded readiness does not reach `401`.

Result:

```text
grande_deploy -> failed
```

No deployment receipt is accepted and the task does not reach verify/DONE.

### Verify failure

Examples:

- canonical tracked tree is dirty;
- expected manifest cannot be loaded from canonical source;
- wrong launchd path;
- runtime not running;
- `/mcp` does not return `401` unauthenticated;
- missing/malformed runtime build header;
- runtime SHA differs from canonical SHA;
- authenticated MCP handshake fails;
- tools/list fails;
- semantic manifest digest differs.

Result:

```text
grande_deploy_verify -> failed
```

The deployment remains visible as unverified. No automatic rollback occurs.

### No automatic rollback

Phase 5 explicitly does not define:

- previous-build selection;
- rollback receipt;
- rollback profile;
- native helper rollback;
- automatic recovery after a partially successful restart;
- blue/green or dual-process activation.

A rollback system would require a separate approved design.

## 12. Files and component boundaries

Expected implementation touch points are intentionally small:

```text
.grande/deploy.yaml
package.json
src/runtime.ts
src/server.ts
src/toolManifest.ts            (new, focused)
src/launchd.ts                 (only if shared identity helpers belong here)
ops/launchd/install.ts
ops/launchd/verify.ts          (new)
test/runtime.test.ts
test/server.test.ts
test/tools.test.ts
new focused verifier/manifest tests as needed
```

No changes are expected in:

```text
src/pathPolicy.ts
src/vaultFs.ts
src/projectService.ts
src/writeErrors.ts
native/rename-excl.c
```

If implementation discovers a need to change filesystem mutation semantics, public tool schemas, native rename behavior, or MCP protocol generation, Phase 5 must stop for Human Owner review rather than quietly expanding scope.

## 13. TDD matrix

Implementation follows RED -> minimal GREEN -> refactor/verify for every slice.

### A. Runtime build identity

1. runtime settings accept explicit test build identity;
2. production build SHA validator accepts lowercase 40-char SHA;
3. malformed/empty production build SHA is rejected;
4. `/mcp` `401` response carries the build header;
5. authenticated MCP response carries the same build header;
6. `serverInfo.version` remains the package/server version rather than Git SHA.

### B. Installer identity capture

7. canonical Git HEAD is captured from canonical repo, not worktree HEAD;
8. staged tracked canonical changes block deployment;
9. unstaged tracked canonical changes block deployment;
10. expected untracked generated helper does not by itself block deployment;
11. malformed/unavailable canonical HEAD causes install to fail before bootstrap;
12. rendered LaunchAgent receives exact `GRANDE_OBSIDIAN_BUILD_SHA`;
13. worktree-origin installer still pins canonical runtime paths;
14. existing token/readiness/native-build installer tests remain green.

### C. Canonical manifest normalization

15. source tools normalize deterministically regardless of object key order;
16. live tools/list normalizes to the same semantic shape;
17. tool ordering differences do not change digest;
18. input property ordering differences do not change digest;
19. missing tool changes digest and produces bounded diagnostic;
20. added tool changes digest automatically without hard-coded expected count;
21. changed input property name/type/requiredness changes digest;
22. changed tool description changes digest;
23. changed readOnly/destructive/openWorld annotation changes digest;
24. protocol-added `$schema` alone does not change digest;
25. handler implementation does not affect digest;
26. verifier loads expected tool definitions from canonical tree when entrypoint runs from task worktree;
27. deliberate task-worktree tool-definition drift does not change the expected canonical digest;
28. inability to load canonical tool definitions fails rather than falling back to worktree source.

### D. Production verifier

29. correct canonical source + launchd path + SHA + 401 + authenticated tools/list passes;
30. service absent fails;
31. wrong canonical WorkingDirectory/runner path fails;
32. unauthenticated status other than exactly 401 fails;
33. missing build header fails;
34. malformed build header fails;
35. runtime SHA != canonical SHA fails;
36. authentication failure fails without leaking token;
37. tools/list failure fails;
38. expected/live manifest digest mismatch fails;
39. tracked canonical drift fails verification;
40. success summary contains only bounded non-secret evidence.

### E. Deployment declaration/regression

41. `.grande/deploy.yaml` references exactly `deploy-production` and `verify-production`;
42. no rollback is declared;
43. public provider tool surface remains the same eight Phase 4 business tools;
44. all Phase 1-4 unit tests remain green;
45. typecheck remains green.

## 14. Load-bearing proofs

Three deliberate break/fix proofs are required before release acceptance.

### Proof A: stale runtime identity

Deliberately bypass runtime-SHA equality in the verifier and construct:

```text
canonical SHA = B
runtime header = A
```

The dedicated stale-runtime test must go RED because the weakened verifier would incorrectly accept A. Restore the equality guard and require GREEN.

This proves that `service running + 401` is not treated as deployment success.

### Proof B: stale tool contract

Deliberately bypass manifest-digest equality and construct a live manifest differing from canonical source, for example one missing `create_project_directory` or with a changed annotation.

The dedicated stale-contract test must go RED under the weakened verifier. Restore digest equality and require GREEN.

This proves that `MCP reachable + correct SHA` is still insufficient when the exposed contract is stale or malformed.

### Proof C: wrong canonical activation

Deliberately bypass canonical LaunchAgent path validation and construct:

```text
canonical repo = expected repo B
LaunchAgent WorkingDirectory / runner = different checkout A
runtime happens to be reachable
```

The dedicated activation-identity test must go RED under the weakened verifier. Restore canonical path validation and require GREEN.

This proves that runtime metadata is not accepted without verifying that launchd is anchored to the intended canonical checkout.

All deliberate proof mutations must be reverted before the final release-candidate validation.

## 15. Phase 5 acceptance

Phase 5 acceptance is intentionally self-hosting: the feature is not accepted merely because unit tests say deploy automation exists. It must deploy its own merged canonical build through the newly configured trusted path.

### Preconditions

- Phase 5 implementation PR is merged;
- `.grande/deploy.yaml` exists on the merged tree;
- `deploy-production` and `verify-production` are registered in GrandeGPT control-plane configuration through the one-time Human Owner gate with exact fixed argv semantics;
- canonical tracked source is clean at the merged `HEAD`;
- task worktree is preserved by GrandeGPT after merge because deployment remains pending.

### Acceptance sequence

1. `grande_pr_merge` merges the Phase 5 implementation PR and preserves the task for deploy.
2. Confirm canonical refresh succeeded and canonical `HEAD` is known.
3. Confirm canonical tracked source has no staged/unstaged drift.
4. Invoke `grande_deploy`.
5. Require `deploy-production` success with no Human Owner terminal command.
6. Invoke `grande_deploy_verify`.
7. Require launchd identity anchored to canonical repo.
8. Require unauthenticated `/mcp` exactly `401`.
9. Require runtime build SHA equals canonical `HEAD`.
10. Require authenticated MCP handshake success.
11. Require expected manifest was derived from canonical source, not task worktree.
12. Require expected/live semantic tool-manifest digests equal.
13. Confirm the live business surface remains the same eight Phase 4 tools for this release.
14. Require GrandeGPT deployment/verify state reaches `DONE` according to the existing deployment receipt contract.
15. Record Phase 5 closeout evidence and merge a bounded docs-only closeout PR.

No live write probe into the Obsidian vault is required merely to accept Phase 5, because Phase 5 changes delivery/attestation and deliberately leaves all business tool behavior unchanged. The unchanged Phase 1-4 runtime composition tests plus exact live manifest verification cover the provider contract without creating more vault artifacts for a non-business change.

## 16. Human Gate policy after Phase 5

After successful Phase 5 acceptance, normal future provider phases should proceed through:

```text
merge -> grande_deploy -> grande_deploy_verify -> phase-specific live acceptance
```

without asking the Human Owner to run `pnpm launchd:install` manually.

A new Human Gate is justified only if:

- trusted profile definitions must change;
- host execution policy must expand;
- a deploy/verify failure requires privileged diagnosis unavailable to GrandeGPT;
- rollback/destructive recovery is requested;
- a future design changes production topology or deployment mechanism.

## 17. Non-goals

Phase 5 does not add or implement:

- a ninth public MCP business tool;
- delete/trash;
- directory move/rename;
- cross-project mutation;
- case-only rename protocol;
- wikilink/backlink rewriting;
- Obsidian CLI/plugin integration;
- MCP protocol v2 / 2026-07-28 migration;
- generic health/version HTTP endpoints;
- deployment database;
- background deployment controller;
- multi-host or multi-instance deployment;
- blue/green/canary activation;
- automatic rollback;
- generic shell execution from `.grande/deploy.yaml`.

## 18. Security invariants

Phase 5 is acceptable only while all of the following remain true:

1. launchd production runtime is pinned to the canonical repo path;
2. a task worktree cannot become the persisted production runtime root;
3. canonical SHA is derived from canonical Git state, not user input;
4. staged/unstaged tracked canonical source must match that SHA before deploy and verify;
5. expected canonical manifest must be loaded from the canonical tree, never silently from the task worktree;
6. production runtime build identity is present and exactly 40 lowercase hex characters;
7. the build identity header is emitted only as non-secret metadata and never substitutes for authentication;
8. bearer token remains secret, file-backed, and absent from verifier logs/results;
9. verifier network access is loopback-only;
10. expected/live tool contract is compared semantically and deterministically;
11. tool count is diagnostic, never a hard-coded acceptance constant;
12. deploy/verify failures block completion;
13. no automatic rollback or destructive cleanup occurs;
14. Phase 5 leaves filesystem mutation semantics unchanged.

## 19. Done when

Phase 5 is `PASSED / CLOSED` only when all of the following are true:

- formal implementation matches this approved spec;
- trusted deploy and verify profiles have been approved once by Human Owner with fixed `pnpm launchd:install` / `pnpm launchd:verify` argv semantics;
- `.grande/deploy.yaml` is merged and parses through GrandeGPT's existing trusted deployment mechanism;
- canonical tracked source is clean at deployment and verification time;
- runtime build identity is independent from `serverInfo.version` and matches canonical `HEAD` after real activation;
- LaunchAgent canonical-path identity is verified;
- unauthenticated `/mcp` remains exactly `401`;
- authenticated raw `tools/list` matches a semantic manifest derived from canonical source;
- the live business tool surface remains unchanged for Phase 5;
- all three load-bearing proofs go RED under deliberate guard removal and GREEN after restoration;
- fresh full `unit` and `typecheck` pass after all proof mutations are reverted;
- the merged Phase 5 build deploys and verifies via `grande_deploy` / `grande_deploy_verify` without a manual host activation command;
- a canonical closeout document records the exact build SHA, runtime SHA, launchd identity, expected/live manifest digest evidence, validation results, and final `Phase 5 / Controlled Delivery & Runtime Attestation: PASSED / CLOSED` decision.
