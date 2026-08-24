import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ProjectService } from "../../src/projectService.ts";
import type { ToolDef } from "../../src/tools.ts";
import {
  LAUNCHD_LABEL,
  LAUNCHD_PORT,
  resolveCanonicalRepoRoot,
} from "../../src/launchd.ts";
import { verifyProduction } from "./verifyCore.ts";

const ENDPOINT = `http://127.0.0.1:${LAUNCHD_PORT}/mcp`;
const BUILD_SHA_HEADER = "X-Grande-Obsidian-Build-Sha";
const REQUEST_TIMEOUT_MS = 3_000;

type ToolsModule = {
  buildTools(service: ProjectService): ToolDef[];
};
type ToolsImporter = (url: string) => Promise<ToolsModule>;
type LiveToolsLoader = (token: string) => Promise<readonly unknown[]>;

function fail(message: string): never {
  throw new Error(`[launchd:verify] ${message}`);
}

function run(command: string, args: string[], allowFailure = false) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe" });
  if (!allowFailure && result.status !== 0) {
    fail(`${command} failed`);
  }
  return result;
}

const never = async (): Promise<never> => {
  throw new Error("manifest stub service must not be invoked");
};

const manifestService: ProjectService = {
  listProjects: never,
  getProjectStructure: never,
  readProjectDocument: never,
  searchProject: never,
  createProjectDocument: never,
  updateProjectDocument: never,
  moveProjectDocument: never,
  createProjectDirectory: never,
};

export async function loadCanonicalExpectedTools(
  repoRoot: string,
  importer: ToolsImporter = async (url) => import(url) as Promise<ToolsModule>,
): Promise<readonly ToolDef[]> {
  const toolsUrl = pathToFileURL(join(repoRoot, "src", "tools.ts")).href;
  const module = await importer(toolsUrl);
  if (typeof module.buildTools !== "function") {
    throw new Error("canonical tools module does not export buildTools");
  }
  return module.buildTools(manifestService);
}

async function defaultLiveToolsLoader(token: string): Promise<readonly unknown[]> {
  const client = new Client({
    name: "grande-obsidian-mcp-verifier",
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  // SDK v1.30 declares StreamableHTTPClientTransport.sessionId as `string | undefined`
  // while its Transport interface declares `sessionId?: string`. With this repo's
  // exactOptionalPropertyTypes=true those upstream declarations are not structurally
  // assignable even though this concrete transport is the SDK's intended Client input.
  await client.connect(transport as unknown as Transport);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
  }
}

export async function loadLiveToolsSafely(
  token: string,
  loader: LiveToolsLoader = defaultLiveToolsLoader,
): Promise<readonly unknown[]> {
  try {
    return await loader(token);
  } catch {
    throw new Error("authenticated MCP tools/list failed");
  }
}

function canonicalState(repoRoot: string) {
  const tracked = run(
    "/usr/bin/git",
    ["-C", repoRoot, "status", "--porcelain", "--untracked-files=no"],
  ).stdout.trim();
  const canonicalSha = run(
    "/usr/bin/git",
    ["-C", repoRoot, "rev-parse", "HEAD"],
  ).stdout.trim();
  return {
    repoRoot,
    canonicalSha,
    trackedTreeClean: tracked.length === 0,
  };
}

function plistValue(plistPath: string, keyPath: string): string {
  const result = run(
    "/usr/bin/plutil",
    ["-extract", keyPath, "raw", "-o", "-", plistPath],
    true,
  );
  if (result.status !== 0) {
    fail(`unable to read LaunchAgent ${keyPath}`);
  }
  return result.stdout.trim();
}

function inspectLaunchAgent(homeDir: string) {
  const uid = process.getuid?.();
  if (uid === undefined) fail("launchd verification requires a POSIX user id");
  const serviceTarget = `gui/${uid}/${LAUNCHD_LABEL}`;
  const loaded = run("/bin/launchctl", ["print", serviceTarget], true).status === 0;
  const plistPath = join(homeDir, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
  if (!existsSync(plistPath)) {
    return { loaded: false, workingDirectory: "", runnerPath: "" };
  }
  return {
    loaded,
    workingDirectory: plistValue(plistPath, "WorkingDirectory"),
    runnerPath: plistValue(plistPath, "ProgramArguments.2"),
  };
}

async function probeUnauthenticated() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      redirect: "error",
      signal: controller.signal,
    });
    return {
      status: response.status,
      buildSha: response.headers.get(BUILD_SHA_HEADER),
    };
  } catch {
    throw new Error("unauthenticated loopback MCP probe failed");
  } finally {
    clearTimeout(timeout);
  }
}

function readToken(homeDir: string): string {
  const tokenPath = join(homeDir, ".grande-control", "secrets", "obsidian-token");
  if (!existsSync(tokenPath)) fail("missing bearer-token file");
  const token = readFileSync(tokenPath, "utf8").trim();
  if (!token) fail("bearer-token file is empty");
  return token;
}

export async function main(): Promise<void> {
  const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const repoRoot = resolveCanonicalRepoRoot(scriptRoot);
  const homeDir = homedir();
  const token = readToken(homeDir);

  const summary = await verifyProduction({
    resolveCanonicalState: async () => canonicalState(repoRoot),
    inspectLaunchAgent: async () => inspectLaunchAgent(homeDir),
    probeUnauthenticated,
    loadExpectedTools: loadCanonicalExpectedTools,
    loadLiveTools: async () => loadLiveToolsSafely(token),
  });

  console.log(JSON.stringify(summary));
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(thisFile)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown verification failure";
    console.error(message.startsWith("[launchd:verify]") ? message : `[launchd:verify] ${message}`);
    process.exitCode = 1;
  });
}
