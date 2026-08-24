import { createHash } from "node:crypto";
import type { ToolDef } from "./tools.ts";

export interface CanonicalToolInput {
  name: string;
  type: "string" | "number";
  required: boolean;
}

export interface CanonicalToolManifestEntry {
  name: string;
  description: string;
  inputs: CanonicalToolInput[];
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    openWorldHint: boolean;
  };
}

export type CanonicalToolManifest = CanonicalToolManifestEntry[];

function byName<T extends { name: string }>(left: T, right: T): number {
  return left.name.localeCompare(right.name);
}

function sourceEntry(tool: ToolDef): CanonicalToolManifestEntry {
  const required = new Set(tool.inputSchema.required ?? []);
  return {
    name: tool.name,
    description: tool.description,
    inputs: Object.entries(tool.inputSchema.properties)
      .map(([name, property]) => ({
        name,
        type: property.type,
        required: required.has(name),
      }))
      .sort(byName),
    annotations: {
      readOnlyHint: tool.annotations.readOnlyHint,
      destructiveHint: tool.annotations.destructiveHint,
      openWorldHint: tool.annotations.openWorldHint,
    },
  };
}

export function canonicalizeSourceTools(tools: readonly ToolDef[]): CanonicalToolManifest {
  return tools.map(sourceEntry).sort(byName);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function liveEntry(value: unknown, index: number): CanonicalToolManifestEntry {
  const tool = record(value, `live tool ${index}`);
  const name = stringValue(tool.name, `live tool ${index} name`);
  const description = stringValue(tool.description, `live tool ${name} description`);
  const schema = record(tool.inputSchema, `live tool ${name} inputSchema`);
  if (schema.type !== "object") throw new Error(`live tool ${name} inputSchema type must be object`);
  const properties = record(schema.properties, `live tool ${name} inputSchema properties`);

  const requiredRaw = schema.required ?? [];
  if (!Array.isArray(requiredRaw) || requiredRaw.some((item) => typeof item !== "string")) {
    throw new Error(`live tool ${name} inputSchema required must be a string array`);
  }
  const required = new Set(requiredRaw as string[]);

  const inputs: CanonicalToolInput[] = Object.entries(properties).map((
    [inputName, rawProperty],
  ): CanonicalToolInput => {
    const property = record(rawProperty, `live tool ${name} input ${inputName}`);
    const type = property.type;
    if (type !== "string" && type !== "number") {
      throw new Error(`live tool ${name} input ${inputName} type must be string or number`);
    }
    return {
      name: inputName,
      type,
      required: required.has(inputName),
    };
  }).sort(byName);

  for (const requiredName of required) {
    if (!Object.hasOwn(properties, requiredName)) {
      throw new Error(`live tool ${name} required input ${requiredName} is missing from properties`);
    }
  }

  const annotations = record(tool.annotations, `live tool ${name} annotations`);
  return {
    name,
    description,
    inputs,
    annotations: {
      readOnlyHint: booleanValue(annotations.readOnlyHint, `live tool ${name} readOnlyHint`),
      destructiveHint: booleanValue(annotations.destructiveHint, `live tool ${name} destructiveHint`),
      openWorldHint: booleanValue(annotations.openWorldHint, `live tool ${name} openWorldHint`),
    },
  };
}

export function canonicalizeLiveTools(tools: readonly unknown[]): CanonicalToolManifest {
  return tools.map(liveEntry).sort(byName);
}

export function toolManifestDigest(manifest: CanonicalToolManifest): string {
  const digest = createHash("sha256").update(JSON.stringify(manifest), "utf8").digest("hex");
  return `sha256:${digest}`;
}

export function firstToolManifestDifference(
  expected: CanonicalToolManifest,
  actual: CanonicalToolManifest,
): string | null {
  const expectedByName = new Map(expected.map((tool) => [tool.name, tool]));
  const actualByName = new Map(actual.map((tool) => [tool.name, tool]));

  for (const tool of expected) {
    if (!actualByName.has(tool.name)) return `missing live tool: ${tool.name}`;
  }
  for (const tool of actual) {
    if (!expectedByName.has(tool.name)) return `unexpected live tool: ${tool.name}`;
  }

  for (const expectedTool of expected) {
    const actualTool = actualByName.get(expectedTool.name)!;
    if (expectedTool.description !== actualTool.description) {
      return `tool ${expectedTool.name} description differs`;
    }
    if (expectedTool.inputs.length !== actualTool.inputs.length) {
      return `tool ${expectedTool.name} input count differs`;
    }
    for (let index = 0; index < expectedTool.inputs.length; index += 1) {
      const expectedInput = expectedTool.inputs[index]!;
      const actualInput = actualTool.inputs[index]!;
      if (expectedInput.name !== actualInput.name) {
        return `tool ${expectedTool.name} input name differs: ${expectedInput.name} vs ${actualInput.name}`;
      }
      if (expectedInput.type !== actualInput.type) {
        return `tool ${expectedTool.name} input ${expectedInput.name} type differs`;
      }
      if (expectedInput.required !== actualInput.required) {
        return `tool ${expectedTool.name} input ${expectedInput.name} requiredness differs`;
      }
    }
    for (const key of ["readOnlyHint", "destructiveHint", "openWorldHint"] as const) {
      if (expectedTool.annotations[key] !== actualTool.annotations[key]) {
        return `tool ${expectedTool.name} annotation ${key} differs`;
      }
    }
  }

  return null;
}
