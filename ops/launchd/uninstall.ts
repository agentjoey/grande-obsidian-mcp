import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { LAUNCHD_LABEL } from "../../src/launchd.ts";

const uid = process.getuid?.();
if (uid === undefined) {
  throw new Error("[launchd:uninstall] launchd uninstall requires a POSIX user id");
}

const domain = `gui/${uid}`;
const serviceTarget = `${domain}/${LAUNCHD_LABEL}`;
const plistPath = join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);

const loaded = spawnSync("/bin/launchctl", ["print", serviceTarget], {
  encoding: "utf8",
  stdio: "pipe",
}).status === 0;

if (loaded) {
  const result = spawnSync("/bin/launchctl", ["bootout", serviceTarget], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(
      `[launchd:uninstall] bootout failed: ${(result.stderr || result.stdout || "unknown error").trim()}`,
    );
  }
}

if (existsSync(plistPath)) unlinkSync(plistPath);
console.log(`[launchd:uninstall] removed ${LAUNCHD_LABEL}`);
console.log("[launchd:uninstall] config, token, and logs were preserved");
