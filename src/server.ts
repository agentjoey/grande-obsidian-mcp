import { Hono } from "hono";
import { z, type ZodRawShape, type ZodTypeAny } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authorizeRequest, AuthError } from "./auth.ts";
import type { ProjectService } from "./projectService.ts";
import { buildTools, type ToolDef } from "./tools.ts";
import { WriteDomainError } from "./writeErrors.ts";

const BUILD_SHA_HEADER = "X-Grande-Obsidian-Build-Sha";

export interface ServerOptions {
  service: ProjectService;
  token: string;
  buildSha: string;
  allowedOrigins: readonly string[];
}

function assertLoopbackHost(hostHeader: string | undefined): void {
  if (!hostHeader) throw new AuthError("FORBIDDEN", "Host header required");
  const host = hostHeader.toLowerCase();
  const valid =
    host === "127.0.0.1" ||
    host.startsWith("127.0.0.1:") ||
    host === "localhost" ||
    host.startsWith("localhost:") ||
    host === "[::1]" ||
    host.startsWith("[::1]:");
  if (!valid) throw new AuthError("FORBIDDEN", "non-loopback Host is not allowed");
}

function toZodShape(schema: ToolDef["inputSchema"]): ZodRawShape {
  const shape: Record<string, ZodTypeAny> = {};
  for (const [name, property] of Object.entries(schema.properties)) {
    let field: ZodTypeAny = property.type === "number" ? z.number() : z.string();
    if (!(schema.required ?? []).includes(name)) field = field.optional();
    shape[name] = field;
  }
  return shape;
}

function jsonRpcResult(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return { value };
}

function writeErrorResult(error: WriteDomainError) {
  const structuredContent = {
    error: {
      code: error.code,
      message: error.message,
    },
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: true,
  };
}

export function createApp(options: ServerOptions): Hono {
  const app = new Hono();

  app.all("/mcp", async (c) => {
    c.header(BUILD_SHA_HEADER, options.buildSha);
    try {
      assertLoopbackHost(c.req.header("host"));
      authorizeRequest(c.req.raw.headers, options.token, options.allowedOrigins);
    } catch (error) {
      if (error instanceof AuthError) {
        return c.json(
          { error: error.code },
          error.code === "AUTH_REQUIRED" ? 401 : 403,
        );
      }
      throw error;
    }

    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = new McpServer(
      { name: "grande-obsidian-mcp", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );

    for (const tool of buildTools(options.service)) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: toZodShape(tool.inputSchema),
          annotations: tool.annotations,
        },
        async (args) => {
          try {
            const result = jsonRpcResult(await tool.handler(args as Record<string, unknown>));
            return {
              content: [{ type: "text" as const, text: JSON.stringify(result) }],
              structuredContent: result,
            };
          } catch (error) {
            if (error instanceof WriteDomainError) return writeErrorResult(error);
            throw error;
          }
        },
      );
    }

    await server.connect(transport);
    const response = await transport.handleRequest(c.req.raw);
    response.headers.set(BUILD_SHA_HEADER, options.buildSha);
    return response;
  });

  return app;
}
