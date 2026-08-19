import { join, normalize } from "node:path";

export const LAUNCHD_LABEL = "ai.agentjoey.grande-obsidian-mcp";
export const LAUNCHD_PORT = 8788;
const REPO_ID = "grande-obsidian-mcp";

export interface LaunchAgentOptions {
  repoRoot: string;
  nodePath: string;
  homeDir: string;
}

export function resolveCanonicalRepoRoot(repoRoot: string): string {
  const normalized = normalize(repoRoot);
  const marker = `/.grande-work/worktrees/${REPO_ID}/`;
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) {
    return normalized;
  }

  const workspaceRoot = normalized.slice(0, markerIndex);
  return join(workspaceRoot, REPO_ID);
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderLaunchAgentPlist(options: LaunchAgentOptions): string {
  const repoRoot = resolveCanonicalRepoRoot(options.repoRoot);
  const runnerPath = join(repoRoot, "ops", "launchd", "run.ts");
  const configPath = join(options.homeDir, ".grande-control", "config", "obsidian-mcp.yaml");
  const tokenFile = join(options.homeDir, ".grande-control", "secrets", "obsidian-token");
  const stdoutPath = join(options.homeDir, ".grande-control", "logs", "obsidian-mcp.stdout.log");
  const stderrPath = join(options.homeDir, ".grande-control", "logs", "obsidian-mcp.stderr.log");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(LAUNCHD_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(options.nodePath)}</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>${xml(runnerPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(repoRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>GRANDE_OBSIDIAN_CONFIG</key>
    <string>${xml(configPath)}</string>
    <key>GRANDE_OBSIDIAN_TOKEN_FILE</key>
    <string>${xml(tokenFile)}</string>
    <key>PORT</key>
    <string>${LAUNCHD_PORT}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(stderrPath)}</string>
</dict>
</plist>
`;
}
