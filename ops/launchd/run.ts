import { readFile } from "node:fs/promises";

const tokenFile = process.env.GRANDE_OBSIDIAN_TOKEN_FILE?.trim();
if (!tokenFile) {
  throw new Error("GRANDE_OBSIDIAN_TOKEN_FILE is required for launchd startup");
}

const token = (await readFile(tokenFile, "utf8")).trim();
if (!token) {
  throw new Error("launchd token file is empty");
}

process.env.GRANDE_OBSIDIAN_TOKEN = token;
await import("../../src/main.ts");
