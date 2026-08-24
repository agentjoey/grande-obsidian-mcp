import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("launchd packaging", () => {
  it("exposes explicit install, native build, and uninstall commands", async () => {
    const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["native:build"]).toBe(
      "node --disable-warning=ExperimentalWarning ops/native/buildRenameExcl.ts",
    );
    expect(packageJson.scripts?.["launchd:install"]).toBe(
      "node --disable-warning=ExperimentalWarning ops/launchd/install.ts",
    );
    expect(packageJson.scripts?.["launchd:uninstall"]).toBe(
      "node --disable-warning=ExperimentalWarning ops/launchd/uninstall.ts",
    );
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

  it("renders a loopback launch agent without embedding the bearer token", async () => {
    expect(existsSync(resolve("src/launchd.ts"))).toBe(true);
    const { renderLaunchAgentPlist } = await import("../src/launchd.js");
    const plist = renderLaunchAgentPlist({
      repoRoot: "/Users/xtation/AgentWorks/GPT_Workspace/grande-obsidian-mcp",
      nodePath: "/usr/local/bin/node",
      homeDir: "/Users/xtation",
    });

    expect(plist).toContain("ai.agentjoey.grande-obsidian-mcp");
    expect(plist).toContain("/usr/local/bin/node");
    expect(plist).toContain(
      "/Users/xtation/AgentWorks/GPT_Workspace/grande-obsidian-mcp/ops/launchd/run.ts",
    );
    expect(plist).toContain("/Users/xtation/.grande-control/config/obsidian-mcp.yaml");
    expect(plist).toContain("/Users/xtation/.grande-control/secrets/obsidian-token");
    expect(plist).toContain("<string>8788</string>");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).not.toContain("<key>GRANDE_OBSIDIAN_TOKEN</key>");
    expect(plist).not.toContain("secret-token-value");
    expect(plist).not.toContain(".grande-work/worktrees");
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

  it("ships a token-file launcher plus install and uninstall entrypoints", async () => {
    const runnerPath = resolve("ops/launchd/run.ts");
    const installPath = resolve("ops/launchd/install.ts");
    const uninstallPath = resolve("ops/launchd/uninstall.ts");

    expect(existsSync(runnerPath)).toBe(true);
    expect(existsSync(installPath)).toBe(true);
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

    const uninstaller = await readFile(uninstallPath, "utf8");
    expect(uninstaller).toContain("bootout");
    expect(uninstaller).toContain("LAUNCHD_LABEL");
  });
});
