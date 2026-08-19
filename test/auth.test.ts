import { describe, expect, it } from "vitest";
import { authorizeRequest, AuthError } from "../src/auth.js";

const token = "test-token-0123456789";

function headers(values: Record<string, string> = {}): Headers {
  return new Headers(values);
}

describe("authorizeRequest", () => {
  it("requires an exact bearer token", () => {
    expect(() => authorizeRequest(headers(), token, [])).toThrow(expect.objectContaining({ code: "AUTH_REQUIRED" }));
    expect(() => authorizeRequest(headers({ authorization: "Bearer wrong" }), token, [])).toThrow(
      expect.objectContaining({ code: "AUTH_REQUIRED" }),
    );
    expect(() => authorizeRequest(headers({ authorization: `Bearer ${token}` }), token, [])).not.toThrow();
  });

  it("rejects browser origins by default and only accepts exact allowlist entries", () => {
    const base = { authorization: `Bearer ${token}` };
    expect(() => authorizeRequest(headers({ ...base, origin: "https://evil.example" }), token, [])).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(() =>
      authorizeRequest(headers({ ...base, origin: "https://chatgpt.com" }), token, ["https://chatgpt.com"]),
    ).not.toThrow();
    expect(() =>
      authorizeRequest(headers({ ...base, origin: "https://chatgpt.com.evil.example" }), token, ["https://chatgpt.com"]),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });

  it("uses typed auth errors", () => {
    try {
      authorizeRequest(headers(), token, []);
      throw new Error("expected auth failure");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
    }
  });
});
