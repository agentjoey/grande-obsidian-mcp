import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { parse } from "yaml";

export interface AppConfig {
  vaultPath: string;
  projectRoot: string;
  projectRootPath: string;
}

interface RawConfig {
  vaultPath?: unknown;
  projectRoot?: unknown;
}

function assertSafeProjectRoot(projectRoot: string): void {
  if (projectRoot.includes("\\")) {
    throw new Error("projectRoot 必须使用 '/' 分隔且不能包含反斜杠");
  }
  const segments = projectRoot.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".." || segment.startsWith("."),
    )
  ) {
    throw new Error("projectRoot 不能包含空、'.'、'..' 或隐藏路径组件");
  }
}

export async function loadConfig(configPath: string): Promise<AppConfig> {
  const raw = parse(await readFile(configPath, "utf8")) as RawConfig | null;
  if (!raw || typeof raw !== "object") {
    throw new Error(`${configPath} 顶层必须是 object`);
  }
  if (typeof raw.vaultPath !== "string" || raw.vaultPath.length === 0 || !isAbsolute(raw.vaultPath)) {
    throw new Error("vaultPath 必须是非空绝对路径");
  }
  if (typeof raw.projectRoot !== "string" || raw.projectRoot.length === 0 || isAbsolute(raw.projectRoot)) {
    throw new Error("projectRoot 必须是非空相对路径");
  }
  assertSafeProjectRoot(raw.projectRoot);

  return {
    vaultPath: raw.vaultPath,
    projectRoot: raw.projectRoot,
    projectRootPath: join(raw.vaultPath, raw.projectRoot),
  };
}
