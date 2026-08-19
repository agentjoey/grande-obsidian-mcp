import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LAUNCHD_LABEL,
  renderLaunchAgentPlist,
  resolveCanonicalRepoRoot,
} from "../../src/launchd.ts";

function fail(message: string): never {
  throw new Error(`[launchd:install] ${message}`);
}

function run(command: string, args: string[], allowFailure = false) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe" });
  if (!allowFailure && result.status !== 0) {
    const detail = (result.stderr || result.stdout || "unknown error").trim();
    fail(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return result;
}

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolveCanonicalRepoRoot(scriptRoot);
const homeDir = homedir();
const configPath = join(homeDir, ".grande-control", "config", "obsidian-mcp.yaml");
const tokenFile = join(homeDir, ".grande-control", "secrets", "obsidian-token");
const logsDir = join(homeDir, ".grande-control", "logs");
const launchAgentsDir = join(homeDir, "Library", "LaunchAgents");
const plistPath = join(launchAgentsDir, `${LAUNCHD_LABEL}.plist`);
const canonicalRunner = join(repoRoot, "ops", "launchd", "run.ts");
const canonicalMain = join(repoRoot, "src", "main.ts");
const canonicalPackage = join(repoRoot, "package.json");
const canonicalDependency = join(
  repoRoot,
  "node_modules",
  "@modelcontextprotocol",
  "sdk",
  "package.json",
);

if (repoRoot.includes("/.grande-work/worktrees/")) {
  fail("refusing to install a LaunchAgent from a task worktree");
}
if (!existsSync(canonicalRunner) || !existsSync(canonicalMain) || !existsSync(canonicalPackage)) {
  fail(`canonical repo is not ready at ${repoRoot}; merge the task before installing launchd`);
}
if (!existsSync(canonicalDependency)) {
  fail(`canonical dependencies are missing; run pnpm install --frozen-lockfile in ${repoRoot}`);
}
if (!existsSync(configPath)) {
  fail(`missing runtime config: ${configPath}`);
}
if (!existsSync(tokenFile)) {
  fail(`missing bearer-token file: ${tokenFile}`);
}
if (!readFileSync(tokenFile, "utf8").trim()) {
  fail(`bearer-token file is empty: ${tokenFile}`);
}
chmodSync(tokenFile, 0o600);

const packageJson = JSON.parse(readFileSync(canonicalPackage, "utf8")) as { name?: string };
if (packageJson.name !== "grande-obsidian-mcp") {
  fail(`unexpected canonical package at ${canonicalPackage}`);
}

mkdirSync(logsDir, { recursive: true });
mkdirSync(launchAgentsDir, { recursive: true });

const plist = renderLaunchAgentPlist({
  repoRoot,
  nodePath: process.execPath,
  homeDir,
});
const tempPlistPath = join(launchAgentsDir, `.${LAUNCHD_LABEL}.${randomUUID()}.plist`);
writeFileSync(tempPlistPath, plist, { encoding: "utf8", mode: 0o644, flag: "wx" });

try {
  run("/usr/bin/plutil", ["-lint", tempPlistPath]);

  const uid = process.getuid?.();
  if (uid === undefined) fail("launchd install requires a POSIX user id");
  const domain = `gui/${uid}`;
  const serviceTarget = `${domain}/${LAUNCHD_LABEL}`;

  const loaded = run("/bin/launchctl", ["print", serviceTarget], true).status === 0;
  if (loaded) {
    run("/bin/launchctl", ["bootout", serviceTarget]);
  }

  renameSync(tempPlistPath, plistPath);
  run("/bin/launchctl", ["bootstrap", domain, plistPath]);
  run("/bin/launchctl", ["kickstart", "-k", serviceTarget]);
  run("/bin/launchctl", ["print", serviceTarget]);

  console.log(`[launchd:install] installed ${LAUNCHD_LABEL}`);
  console.log(`[launchd:install] repo=${repoRoot}`);
  console.log(`[launchd:install] plist=${plistPath}`);
} finally {
  if (existsSync(tempPlistPath)) unlinkSync(tempPlistPath);
}
