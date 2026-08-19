import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("loadConfig", () => {
  it("loads one vault and project root from YAML", async () => {
    const root = await mkdtemp(join(tmpdir(), "grande-obsidian-mcp-"));
    roots.push(root);
    const vault = join(root, "vault");
    const projectRoot = "10_Projects/Active";
    await mkdir(join(vault, projectRoot), { recursive: true });
    const configPath = join(root, "config.yaml");
    await writeFile(configPath, `vaultPath: ${JSON.stringify(vault)}\nprojectRoot: ${projectRoot}\n`, "utf8");

    await expect(loadConfig(configPath)).resolves.toEqual({
      vaultPath: vault,
      projectRoot,
      projectRootPath: join(vault, projectRoot),
    });
  });

  it.each(["../outside", ".obsidian", "10_Projects/../outside", "10_Projects/.hidden"])(
    "rejects projectRoot components that can escape or enter hidden Vault paths: %s",
    async (projectRoot) => {
      const root = await mkdtemp(join(tmpdir(), "grande-obsidian-config-policy-"));
      roots.push(root);
      const vault = join(root, "vault");
      await mkdir(vault, { recursive: true });
      const configPath = join(root, "config.yaml");
      await writeFile(configPath, `vaultPath: ${JSON.stringify(vault)}\nprojectRoot: ${projectRoot}\n`, "utf8");

      await expect(loadConfig(configPath)).rejects.toThrow(/projectRoot/);
    },
  );
});
