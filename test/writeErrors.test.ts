import { describe, expect, it } from "vitest";
import { ExclusiveRenameError } from "../src/exclusiveRename.js";
import { toWriteDomainError } from "../src/writeErrors.js";

describe("exclusive rename error mapping", () => {
  it.each([
    ["EEXIST", "FILE_EXISTS"],
    ["ENOENT", "FILE_NOT_FOUND"],
    ["ELOOP", "POLICY_DENIED"],
    ["ENOTCAPABLE", "POLICY_DENIED"],
    ["EXDEV", "WRITE_FAILED"],
    ["ENOTSUP", "WRITE_FAILED"],
    ["EINVAL", "WRITE_FAILED"],
    ["UNKNOWN", "WRITE_FAILED"],
  ] as const)("maps helper failure %s to stable write code %s", (failure, expectedCode) => {
    expect(toWriteDomainError(new ExclusiveRenameError(failure))).toMatchObject({ code: expectedCode });
  });
});
