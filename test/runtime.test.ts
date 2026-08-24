import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRenameExcl } from "../ops/native/buildRenameExcl.js";
import { createRuntime, loadRuntimeSettings } from "../src/runtime.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runtime settings", () => {
  it("uses a fixed loopback host and loads explicit config, token, build identity, port, and Origin allowlist", () => {
    expect(
      loadRuntimeSettings({
        GRANDE_OBSIDIAN_CONFIG: "/tmp/grande-obsidian.yaml",
        GRANDE_OBSIDIAN_TOKEN: "secret-token",
        GRANDE_OBSIDIAN_BUILD_SHA: "a".repeat(40),
        GRANDE_OBSIDIAN_ALLOWED_ORIGINS: "https://chatgpt.com, https://chat.openai.com",
        PORT: "8788",
      }),
    ).toEqual({
      configPath: "/tmp/grande-obsidian.yaml",
      token: "secret-token",
      buildSha: "a".repeat(40),
      host: "127.0.0.1",
      port: 8788,
      allowedOrigins: ["https://chatgpt.com", "https://chat.openai.com"],
    });
  });

  it("defaults local runtime identity to dev and rejects malformed explicit build identity", () => {
    expect(loadRuntimeSettings({
      GRANDE_OBSIDIAN_CONFIG: "/tmp/config.yaml",
      GRANDE_OBSIDIAN_TOKEN: "secret-token",
    })).toMatchObject({ buildSha: "dev" });

    expect(() => loadRuntimeSettings({
      GRANDE_OBSIDIAN_CONFIG: "/tmp/config.yaml",
      GRANDE_OBSIDIAN_TOKEN: "secret-token",
      GRANDE_OBSIDIAN_BUILD_SHA: "not-a-sha",
    })).toThrow(/BUILD_SHA/);
  });

  it("fails closed when config path, token, or port is invalid", () => {
    expect(() => loadRuntimeSettings({ GRANDE_OBSIDIAN_TOKEN: "secret-token" })).toThrow(/CONFIG/);
    expect(() => loadRuntimeSettings({ GRANDE_OBSIDIAN_CONFIG: "/tmp/config.yaml" })).toThrow(/TOKEN/);
    expect(() =>
      loadRuntimeSettings({
        GRANDE_OBSIDIAN_CONFIG: "/tmp/config.yaml",
        GRANDE_OBSIDIAN_TOKEN: "secret-token",
        PORT: "0",
      }),
    ).toThrow(/PORT/);
  });

  it("runs the approved Phase 4 tool surface end-to-end through MCP", async () => {
    buildRenameExcl(resolve("."));
    const root = await mkdtemp(join(tmpdir(), "grande-obsidian-runtime-"));
    roots.push(root);
    const vault = join(root, "vault");
    const projectRoot = "10_Projects/Active";
    const project = "P033-GrandeGPT";
    const sourceContent = "# PRD\nPhase 4 is complete.\n";
    const createdContent = "# Created\nphase 4 directory composition\n";
    await mkdir(join(vault, projectRoot, project, "design"), { recursive: true });
    await writeFile(join(vault, projectRoot, project, "PRD.md"), sourceContent, "utf8");
    await writeFile(join(vault, projectRoot, project, "design", "DESIGN.md"), "# Design\nMCP architecture\n", "utf8");
    await writeFile(join(vault, projectRoot, project, "design", "ignore.txt"), "Phase 4 secret\n", "utf8");
    const configPath = join(root, "config.yaml");
    await writeFile(configPath, `vaultPath: ${JSON.stringify(vault)}\nprojectRoot: ${projectRoot}\n`, "utf8");

    const runtime = await createRuntime({
      configPath,
      token: "secret-token",
      buildSha: "dev",
      host: "127.0.0.1",
      port: 8788,
      allowedOrigins: [],
    });

    async function call(name: string, args: Record<string, unknown>): Promise<string> {
      const response = await runtime.app.request("/mcp", {
        method: "POST",
        headers: {
          host: "127.0.0.1:8788",
          authorization: "Bearer secret-token",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });
      expect(response.status).toBe(200);
      return response.text();
    }

    expect(await call("list_projects", {})).toContain(project);

    const initialStructure = await call("get_project_structure", { project });
    expect(initialStructure).toContain("PRD.md");
    expect(initialStructure).toContain("design/DESIGN.md");
    expect(initialStructure).not.toContain("ignore.txt");

    const read = await call("read_project_document", { project, path: "PRD.md" });
    expect(read).toContain("Phase 4 is complete.");
    expect(read).toMatch(/[a-f0-9]{64}/);

    const search = await call("search_project", { project, query: "phase 4", maxResults: 20 });
    expect(search).toContain("PRD.md");
    expect(search).toContain("Phase 4 is complete.");
    expect(search).not.toContain("Phase 4 secret");

    const directory = await call("create_project_directory", { project, path: "archive" });
    expect(directory).toContain("archive");

    const created = await call("create_project_document", {
      project,
      path: "archive/CREATED.md",
      content: createdContent,
    });
    expect(created).toContain("archive/CREATED.md");
    await expect(readFile(join(vault, projectRoot, project, "archive", "CREATED.md"), "utf8"))
      .resolves.toBe(createdContent);

    const expectedSha256 = createHash("sha256").update(sourceContent).digest("hex");
    const moved = await call("move_project_document", {
      project,
      sourcePath: "PRD.md",
      targetPath: "archive/MOVED.md",
      expectedSha256,
    });
    expect(moved).toContain("archive/MOVED.md");
    expect(moved).toContain(expectedSha256);
    await expect(readFile(join(vault, projectRoot, project, "archive", "MOVED.md"), "utf8"))
      .resolves.toBe(sourceContent);
    await expect(readFile(join(vault, projectRoot, project, "PRD.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });

    const finalStructure = await call("get_project_structure", { project });
    expect(finalStructure).toContain("archive");
    expect(finalStructure).toContain("archive/CREATED.md");
    expect(finalStructure).toContain("archive/MOVED.md");
  });
});
