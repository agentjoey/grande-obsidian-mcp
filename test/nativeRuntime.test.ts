import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("native Node TypeScript runtime", () => {
  it("uses executable .ts extensions for relative source imports", async () => {
    const sourceFiles = (await readdir("src")).filter((name) => name.endsWith(".ts"));
    const invalidImports: string[] = [];

    for (const name of sourceFiles) {
      const content = await readFile(join("src", name), "utf8");
      for (const match of content.matchAll(/(?:from\s+|import\()["'](\.\.?\/[^"']+\.js)["']/g)) {
        invalidImports.push(`${name}: ${match[1]}`);
      }
    }

    expect(invalidImports).toEqual([]);
  });
});
