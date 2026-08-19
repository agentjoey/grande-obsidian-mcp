import { timingSafeEqual } from "node:crypto";

export class AuthError extends Error {
  readonly code: "AUTH_REQUIRED" | "FORBIDDEN";

  constructor(code: "AUTH_REQUIRED" | "FORBIDDEN", message: string) {
    super(message);
    this.name = `AuthError [${code}]`;
    this.code = code;
  }
}

function tokenMatches(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function authorizeRequest(headers: Headers, token: string, allowedOrigins: readonly string[]): void {
  const authorization = headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(authorization);
  if (!match || !tokenMatches(match[1]!, token)) {
    throw new AuthError("AUTH_REQUIRED", "valid bearer token required");
  }

  const origin = headers.get("origin");
  if (origin !== null && !allowedOrigins.includes(origin)) {
    throw new AuthError("FORBIDDEN", "origin is not allowed");
  }
}
