import type { Hono } from "hono";
import { loadConfig, type AppConfig } from "./config.ts";
import { createProjectService } from "./projectService.ts";
import { createApp } from "./server.ts";

export interface RuntimeSettings {
  configPath: string;
  token: string;
  host: "127.0.0.1";
  port: number;
  allowedOrigins: string[];
}

export interface Runtime {
  app: Hono;
  config: AppConfig;
  settings: RuntimeSettings;
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 8788;
  if (!/^\d+$/.test(value)) throw new Error("PORT must be an integer between 1 and 65535");
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function loadRuntimeSettings(env: NodeJS.ProcessEnv): RuntimeSettings {
  return {
    configPath: requiredEnv(env, "GRANDE_OBSIDIAN_CONFIG"),
    token: requiredEnv(env, "GRANDE_OBSIDIAN_TOKEN"),
    host: "127.0.0.1",
    port: parsePort(env.PORT),
    allowedOrigins: parseAllowedOrigins(env.GRANDE_OBSIDIAN_ALLOWED_ORIGINS),
  };
}

export async function createRuntime(settings: RuntimeSettings): Promise<Runtime> {
  const config = await loadConfig(settings.configPath);
  const service = createProjectService({ projectRootPath: config.projectRootPath });
  const app = createApp({
    service,
    token: settings.token,
    allowedOrigins: settings.allowedOrigins,
  });
  return { app, config, settings };
}
