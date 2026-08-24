import { join } from "node:path";
import { assertProductionBuildSha, LAUNCHD_LABEL } from "../../src/launchd.ts";
import type { ToolDef } from "../../src/tools.ts";
import {
  canonicalizeLiveTools,
  canonicalizeSourceTools,
  firstToolManifestDifference,
  toolManifestDigest,
} from "../../src/toolManifest.ts";

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
  probeUnauthenticated(): Promise<{
    status: number;
    buildSha: string | null;
  }>;
  loadExpectedTools(repoRoot: string): Promise<readonly ToolDef[]>;
  loadLiveTools(): Promise<readonly unknown[]>;
}

export async function verifyProduction(
  dependencies: ProductionVerifyDependencies,
): Promise<ProductionVerifySummary> {
  const canonical = await dependencies.resolveCanonicalState();
  if (!canonical.trackedTreeClean) {
    throw new Error("canonical tracked tree is not clean");
  }
  const canonicalSha = assertProductionBuildSha(canonical.canonicalSha);

  const launchAgent = await dependencies.inspectLaunchAgent();
  if (!launchAgent.loaded) {
    throw new Error(`${LAUNCHD_LABEL} is not loaded`);
  }
  if (launchAgent.workingDirectory !== canonical.repoRoot) {
    throw new Error("LaunchAgent WorkingDirectory does not match canonical repo");
  }
  const expectedRunner = join(canonical.repoRoot, "ops", "launchd", "run.ts");
  if (launchAgent.runnerPath !== expectedRunner) {
    throw new Error("LaunchAgent runner does not match canonical repo");
  }

  const probe = await dependencies.probeUnauthenticated();
  if (probe.status !== 401) {
    throw new Error(`unauthenticated /mcp must return exactly 401; received ${probe.status}`);
  }
  if (!probe.buildSha) {
    throw new Error("runtime build SHA header is missing");
  }
  const runtimeSha = assertProductionBuildSha(probe.buildSha);
  if (runtimeSha !== canonicalSha) {
    throw new Error(`runtime build SHA does not match canonical SHA (${runtimeSha} != ${canonicalSha})`);
  }

  const expectedTools = await dependencies.loadExpectedTools(canonical.repoRoot);
  const liveTools = await dependencies.loadLiveTools();
  const expectedManifest = canonicalizeSourceTools(expectedTools);
  const liveManifest = canonicalizeLiveTools(liveTools);
  const expectedToolsDigest = toolManifestDigest(expectedManifest);
  const liveToolsDigest = toolManifestDigest(liveManifest);
  if (expectedToolsDigest !== liveToolsDigest) {
    const difference = firstToolManifestDifference(expectedManifest, liveManifest) ?? "tool manifest digest differs";
    throw new Error(difference);
  }

  return {
    label: LAUNCHD_LABEL,
    canonicalSha,
    runtimeSha,
    unauthenticatedStatus: 401,
    toolsCount: liveManifest.length,
    expectedToolsDigest,
    liveToolsDigest,
  };
}
