import { ExclusiveRenameError } from "./exclusiveRename.ts";
import { PathPolicyError } from "./pathPolicy.ts";

export type WriteErrorCode =
  | "FILE_EXISTS"
  | "FILE_NOT_FOUND"
  | "STALE_FILE"
  | "INVALID_INPUT"
  | "POLICY_DENIED"
  | "WRITE_FAILED"
  | "VERIFY_FAILED";

export class WriteDomainError extends Error {
  readonly code: WriteErrorCode;

  constructor(code: WriteErrorCode, message: string) {
    super(message);
    this.name = `WriteDomainError [${code}]`;
    this.code = code;
  }
}

function nodeErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined;
  return (error as NodeJS.ErrnoException).code;
}

export function toWriteDomainError(
  error: unknown,
  fallback: "WRITE_FAILED" | "VERIFY_FAILED" = "WRITE_FAILED",
): WriteDomainError {
  if (error instanceof WriteDomainError) return error;

  if (error instanceof PathPolicyError) {
    switch (error.code) {
      case "INVALID_INPUT":
        return new WriteDomainError("INVALID_INPUT", "write input is invalid");
      case "NOT_FOUND":
        return new WriteDomainError("FILE_NOT_FOUND", "required project, parent, or document was not found");
      case "PATH_ESCAPE":
        return new WriteDomainError("POLICY_DENIED", "write path is denied by project policy");
      case "ALREADY_EXISTS":
        return new WriteDomainError("FILE_EXISTS", "write target already exists");
      default:
        return new WriteDomainError("POLICY_DENIED", "write path is denied by project policy");
    }
  }

  if (error instanceof ExclusiveRenameError) {
    switch (error.failure) {
      case "EEXIST":
        return new WriteDomainError("FILE_EXISTS", "write target already exists");
      case "ENOENT":
        return new WriteDomainError("FILE_NOT_FOUND", "required project, parent, or document was not found");
      case "ELOOP":
      case "ENOTCAPABLE":
        return new WriteDomainError("POLICY_DENIED", "write path is denied by project policy");
      default:
        return new WriteDomainError("WRITE_FAILED", "document write failed");
    }
  }

  switch (nodeErrorCode(error)) {
    case "EEXIST":
      return new WriteDomainError("FILE_EXISTS", "write target already exists");
    case "ENOENT":
      return new WriteDomainError("FILE_NOT_FOUND", "required project, parent, or document was not found");
    default:
      return new WriteDomainError(
        fallback,
        fallback === "VERIFY_FAILED" ? "written document could not be verified" : "document write failed",
      );
  }
}
