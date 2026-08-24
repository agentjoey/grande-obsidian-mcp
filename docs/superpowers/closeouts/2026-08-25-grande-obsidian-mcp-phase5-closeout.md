# grande-obsidian-mcp Phase 5 / Controlled Delivery & Runtime Attestation Closeout

**Date:** 2026-08-25  
**Decision:** **Phase 5 / Controlled Delivery & Runtime Attestation: CLOSED BY HUMAN OWNER / SELF-HOSTED ACCEPTANCE DEFERRED**  
**Repository:** `grande-obsidian-mcp`  
**Implementation task:** `task-gomcp-phase5-impl-20260825-001`  
**Closeout task:** `task-gomcp-phase5-closeout-20260825-001`

## Closure meaning

Phase 5 is formally closed by explicit Human Owner decision.

This closeout does **not** claim `PASSED / CLOSED` under the original Phase 5 acceptance contract. The provider-side implementation was completed and merged, but the self-hosted `grande_deploy -> grande_deploy_verify -> DONE` acceptance sequence did not complete because GrandeGPT currently executes deployment profiles through the ordinary task sandbox, which cannot provide the canonical/host access required by the launchd installer.

The remaining gap is therefore recorded as an external GrandeGPT platform dependency rather than being worked around inside `grande-obsidian-mcp`.

## Delivery baseline

- Phase 5 design and implementation plan were approved before implementation.
- Design/plan PR: **#10**.
- Implementation task: `task-gomcp-phase5-impl-20260825-001`.
- Implementation PR: **#11**.
- Implementation head: `9a51d165d88b2aad83f6e3c54cff7cec23c74b8a`.
- Canonical implementation merge: `2a9c2c9a42c942fd3c05777352cccfeb5416b580`.
- `.grande/deploy.yaml` was merged with exactly:

```yaml
deploy:
  profile: deploy-production
verify:
  profile: verify-production
```

- Human Owner registered the trusted control-plane profiles `deploy-production` and `verify-production`.
- GrandeGPT capability discovery subsequently listed both profiles for `grande-obsidian-mcp`, proving that control-plane registration was active.

## Provider-side implementation delivered

Phase 5 merged the intended delivery/attestation implementation without changing the provider business surface.

Delivered provider-side behavior includes:

1. runtime build identity via `GRANDE_OBSIDIAN_BUILD_SHA`;
2. `X-Grande-Obsidian-Build-Sha` on `/mcp` responses, including unauthorized `401` responses;
3. `serverInfo.version` remains the package/server version `0.1.0` rather than a Git SHA;
4. canonical tracked-tree cleanliness check before launchd activation;
5. canonical Git `HEAD` captured and written into the LaunchAgent environment;
6. semantic source/live tool-manifest normalization and SHA-256 digest comparison;
7. production verifier core rejecting stale SHA, stale tool contract, wrong canonical launchd path, non-401 unauthenticated response, and malformed runtime evidence;
8. real verifier adapter using canonical source definitions and authenticated live `tools/list`;
9. trusted deployment declaration through `.grande/deploy.yaml`;
10. no rollback declaration and no generic shell/host execution capability added to the provider.

The public MCP business surface remained the same eight Phase 4 tools:

1. `list_projects`
2. `get_project_structure`
3. `read_project_document`
4. `search_project`
5. `create_project_document`
6. `update_project_document`
7. `move_project_document`
8. `create_project_directory`

No filesystem mutation semantics were changed in Phase 5.

## Implementation verification evidence

Fresh pre-merge release-candidate verification on the implementation task:

- unit: **18 test files / 150 tests passed**;
- typecheck: **passed**.

Three load-bearing proofs were executed and then reverted:

1. **Stale runtime SHA guard:** bypassing runtime/canonical SHA equality produced exactly one causal failing test; the stale runtime was incorrectly accepted. Restoring the guard returned the suite to GREEN.
2. **Stale manifest guard:** bypassing expected/live manifest equality produced exactly one causal failing test; a seven-tool live contract was incorrectly accepted. Restoring the guard returned the suite to GREEN.
3. **Wrong canonical activation guard:** bypassing canonical LaunchAgent path validation produced exactly one causal failing test; a different checkout was incorrectly accepted. Restoring the guard returned the suite to GREEN.

After all deliberate proof mutations were restored, fresh verification again reported:

- **18 test files / 150 tests passed**;
- **typecheck passed**.

A pre-existing test race was also removed by making `exclusiveRename.test.ts` use the existing atomic `buildRenameExcl()` publisher rather than directly compiling over the shared live helper path. This changed test reliability only, not production rename semantics.

## Self-hosted deployment acceptance evidence

After PR #11 merged, GrandeGPT correctly retained the implementation task in deployment state because the merged repository contained `.grande/deploy.yaml`.

`grande_deploy` successfully resolved and started the trusted profile:

```text
deploy-production
```

Deployment job:

```text
job_7890c8ca-3b48-4fe6-ab08-1e73370b66d3
```

The job failed before launchd activation with:

```text
[launchd:install] canonical dependencies are missing;
run pnpm install --frozen-lockfile in
/Users/xtation/AgentWorks/GPT_Workspace/grande-obsidian-mcp
```

A second direct execution of the same registered profile reproduced the same failure, confirming this was not a transient deploy orchestration result.

`grande_deploy_verify` then correctly refused to proceed because deploy had not passed. No false verification receipt or `DONE` state was produced.

## Root cause of deferred acceptance

The failure is not that the trusted profile names were absent. GrandeGPT listed both `deploy-production` and `verify-production` for `grande-obsidian-mcp`.

The architectural gap is in GrandeGPT's current profile deployment execution path:

```text
.grande/deploy.yaml
  -> deployment.ts executeAction(profile)
  -> grande_run
  -> ordinary task sandbox
```

The ordinary `RunProfile` contract currently supports bounded task execution fields such as `argv`, `timeoutSeconds`, `maxOutputBytes`, `maxRssMb`, `toolchain`, and `nativeExecTargets`. It does not provide a deployment-only trusted host execution mode.

The launchd installer, by design, resolves from the task worktree to the merged canonical repository and requires host resources including:

```text
canonical repo + canonical node_modules
~/.grande-control/config
~/.grande-control/secrets
~/Library/LaunchAgents
/bin/launchctl
```

The ordinary task sandbox cannot safely provide that host/canonical mutation boundary. Adding `depDirs` would only clone dependencies into the task worktree and would not solve canonical pinning, LaunchAgent writes, or `launchctl` access.

Therefore the correct follow-up belongs in GrandeGPT: a deployment-only trusted host profile execution mechanism, or an equivalent approved production capability, restricted to deployment orchestration and unavailable to ordinary `grande_run`.

## Explicit non-workarounds

Phase 5 closeout intentionally does not:

- manually run `pnpm launchd:install` and call the automated acceptance passed;
- weaken canonical repo pinning so production can run from a task worktree;
- expose canonical or home-directory write access to ordinary task sandboxes;
- add generic `shell_exec` / `host_exec`;
- add a provider-side deployment bypass;
- forge or edit a failed deployment receipt;
- claim `grande_deploy_verify` reached `DONE`;
- claim runtime SHA and manifest digest were verified on the newly merged Phase 5 runtime.

## Deferred external dependency

The remaining external dependency is:

> GrandeGPT needs a minimal deployment-only trusted host execution path for approved profiles, or a safe equivalent production capability, so `grande_deploy` / `grande_deploy_verify` can activate and verify launchd-backed providers while preserving canonical pinning and control-plane authorization.

That platform work is outside the `grande-obsidian-mcp` Phase 5 provider scope and may be completed independently. If later resolved, the production deployment/verification sequence can be re-run as a separate acceptance/revalidation task without reopening or reimplementing the provider-side Phase 5 code.

## Closeout decision

Human Owner explicitly directed Phase 5 to be formally closed on 2026-08-25.

The historical state is therefore:

```text
provider implementation: MERGED
unit/typecheck: PASS
load-bearing proofs: PASS
trusted profile registration: COMPLETE
self-hosted grande_deploy acceptance: NOT PASSED
production verify / DONE: NOT REACHED
remaining blocker: GrandeGPT deployment-only host execution gap
phase status: FORMALLY CLOSED BY HUMAN OWNER
```

**Phase 5 / Controlled Delivery & Runtime Attestation: CLOSED BY HUMAN OWNER / SELF-HOSTED ACCEPTANCE DEFERRED.**
