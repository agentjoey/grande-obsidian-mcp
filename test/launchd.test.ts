import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("launchd packaging", () => {
  it("exposes explicit install, verify, native build, and uninstall commands", async () => {
    const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["native:build"]).toBe(
      "node --disable-warning=ExperimentalWarning ops/native/buildRenameExcl.ts",
    );
    expect(packageJson.scripts?.["launchd:install"]).toBe(
      "node --disable-warning=ExperimentalWarning ops/launchd/install.ts",
    );
    expect(packageJson.scripts?.["launchd:verify"]).toBe(
      "node --disable-warning=ExperimentalWarning ops/launchd/verify.ts",
    );
    expect(packageJson.scripts?.["launchd:uninstall"]).toBe(
      "node --disable-warning=ExperimentalWarning ops/launchd/uninstall.ts",
    );
  });

  it("declares only the two trusted production profiles and no rollback or arbitrary command", async () => {
    const deploySpec = await readFile(resolve(".grande/deploy.yaml"), "utf8");
    expect(deploySpec).toBe(
      "deploy:\n  profile: deploy-production\nverify:\n  profile: verify-production\n",
    );
    expect(deploySpec).not.toMatch(/rollback|command|argv|environment/i);
  });

  it("pins launchd to the canonical repo instead of a Grande task worktree", async () => {
    expect(existsSync(resolve("src/launchd.ts"))).toBe(true);
    const { resolveCanonicalRepoRoot } = await import("../src/launchd.js");

    expect(
      resolveCanonicalRepoRoot(
        "/Users/xtation/AgentWorks/GPT_Workspace/.grande-work/worktrees/grande-obsidian-mcp/task-obsidian-v1-20260818-001",
      ),
    ).toBe("/Users/xtation/AgentWorks/GPT_Workspace/grande-obsidian-mcp");
    expect(resolveCanonicalRepoRoot("/workspace/grande-obsidian-mcp")).toBe(
      "/workspace/grande-obsidian-mcp",
    );
  });

  it("renders a loopback launch agent with exact canonical build identity without embedding the bearer token", async () => {
    expect(existsSync(resolve("src/launchd.ts"))).toBe(true);
    const { renderLaunchAgentPlist } = await import("../src/launchd.js");
    const buildSha = "a".repeat(40);
    const plist = renderLaunchAgentPlist({
      repoRoot: "/Users/xtation/AgentWorks/GPT_Workspace/grande-obsidian-mcp",
      nodePath: "/usr/local/bin/node",
      homeDir: "/Users/xtation",
      buildSha,
    });

    expect(plist).toContain("ai.agentjoey.grande-obsidian-mcp");
    expect(plist).toContain("/usr/local/bin/node");
    expect(plist).toContain(
      "/Users/xtation/AgentWorks/GPT_Workspace/grande-obsidian-mcp/ops/launchd/run.ts",
    );
    expect(plist).toContain("/Users/xtation/.grande-control/config/obsidian-mcp.yaml");
    expect(plist).toContain("/Users/xtation/.grande-control/secrets/obsidian-token");
    expect(plist).toContain("<key>GRANDE_OBSIDIAN_BUILD_SHA</key>");
    expect(plist).toContain(`<string>${buildSha}</string>`);
    expect(plist).toContain("<string>8788</string>");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).not.toContain("<key>GRANDE_OBSIDIAN_TOKEN</key>");
    expect(plist).not.toContain("secret-token-value");
    expect(plist).not.toContain(".grande-work/worktrees");
  });

  it("rejects malformed production build identity before rendering launchd", async () => {
    const { renderLaunchAgentPlist } = await import("../src/launchd.js");
    expect(() => renderLaunchAgentPlist({
      repoRoot: "/workspace/grande-obsidian-mcp",
      nodePath: "/usr/local/bin/node",
      homeDir: "/Users/xtation",
      buildSha: "bad",
    })).toThrow(/build SHA/i);
  });

  it("captures clean canonical tracked state and exact HEAD before native build and bootstrap", async () => {
    const installer = await readFile(resolve("ops/launchd/install.ts"), "utf8");
    const statusCall = installer.indexOf('"status", "--porcelain", "--untracked-files=no"');
    const shaCall = installer.indexOf('"rev-parse", "HEAD"');
    const buildCall = installer.indexOf("buildRenameExcl(repoRoot)");
    const bootstrapCall = installer.indexOf('run("/bin/launchctl", ["bootstrap"');

    expect(statusCall).toBeGreaterThanOrEqual(0);
    expect(shaCall).toBeGreaterThan(statusCall);
    expect(installer).toContain("canonical tracked tree is not clean");
    expect(buildCall).toBeGreaterThan(shaCall);
    expect(bootstrapCall).toBeGreaterThan(buildCall);
    expect(installer).toContain("assertProductionBuildSha");
    expect(installer).toContain("buildSha,");
  });

  it("builds the canonical rename helper before launchctl bootstrap", async () => {
    const installer = await readFile(resolve("ops/launchd/install.ts"), "utf8");
    const buildCall = installer.indexOf("buildRenameExcl(repoRoot)");
    const bootstrapCall = installer.indexOf('run("/bin/launchctl", ["bootstrap"');

    expect(buildCall).toBeGreaterThanOrEqual(0);
    expect(bootstrapCall).toBeGreaterThanOrEqual(0);
    expect(buildCall).toBeLessThan(bootstrapCall);
  });

  it("waits for bootout completion before bootstrap", async () => {
    const installer = await readFile(resolve("ops/launchd/install.ts"), "utf8");
    const bootoutCall = installer.indexOf('run("/bin/launchctl", ["bootout", serviceTarget])');
    const waitCall = installer.indexOf("waitUntilUnloaded(serviceTarget)", bootoutCall);
    const bootstrapCall = installer.indexOf('run("/bin/launchctl", ["bootstrap", domain, plistPath])');

    expect(bootoutCall).toBeGreaterThanOrEqual(0);
    expect(waitCall).toBeGreaterThan(bootoutCall);
    expect(bootstrapCall).toBeGreaterThan(waitCall);
  });

  it("uses RunAtLoad readiness instead of racing bootstrap with kickstart -k", async () => {
    const installer = await readFile(resolve("ops/launchd/install.ts"), "utf8");

    expect(installer).toContain("waitUntilReady(serviceTarget)");
    expect(installer).toContain("http://127.0.0.1:${LAUNCHD_PORT}/mcp");
    expect(installer).toContain('probe.stdout.trim() === "401"');
    expect(installer).not.toContain('["kickstart", "-k", serviceTarget]');
  });

  it("ships a token-file launcher plus install, verify, and uninstall entrypoints", async () => {
    const runnerPath = resolve("ops/launchd/run.ts");
    const installPath = resolve("ops/launchd/install.ts");
    const verifyPath = resolve("ops/launchd/verify.ts");
    const uninstallPath = resolve("ops/launchd/uninstall.ts");

    expect(existsSync(runnerPath)).toBe(true);
    expect(existsSync(installPath)).toBe(true);
    expect(existsSync(verifyPath)).toBe(true);
    expect(existsSync(uninstallPath)).toBe(true);

    const runner = await readFile(runnerPath, "utf8");
    expect(runner).toContain("GRANDE_OBSIDIAN_TOKEN_FILE");
    expect(runner).toContain("GRANDE_OBSIDIAN_TOKEN");
    expect(runner).toContain("../../src/main.ts");

    const installer = await readFile(installPath, "utf8");
    expect(installer).toContain("resolveCanonicalRepoRoot");
    expect(installer).toContain("renderLaunchAgentPlist");
    expect(installer).toContain("process.execPath");
    expect(installer).toContain("node_modules");
    expect(installer).toContain("bootstrap");
    expect(installer).toContain("waitUntilReady");

    const verifier = await readFile(verifyPath, "utf8");
    expect(verifier).toContain("verifyProduction");
    expect(verifier).toContain("127.0.0.1");
    expect(verifier).toContain("obsidian-token");

    const uninstaller = await readFile(uninstallPath, "utf8");
    expect(uninstaller).toContain("bootout");
    expect(uninstaller).toContain("LAUNCHD_LABEL");
  });
});
