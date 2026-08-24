import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export type ExclusiveRenameFailure =
  | "EEXIST"
  | "ENOENT"
  | "EXDEV"
  | "ELOOP"
  | "ENOTCAPABLE"
  | "ENOTDIR"
  | "EINVAL"
  | "ENOTSUP"
  | "EPERM"
  | "EACCES"
  | "UNKNOWN";

const failures = new Set<ExclusiveRenameFailure>([
  "EEXIST",
  "ENOENT",
  "EXDEV",
  "ELOOP",
  "ENOTCAPABLE",
  "ENOTDIR",
  "EINVAL",
  "ENOTSUP",
  "EPERM",
  "EACCES",
  "UNKNOWN",
]);

export class ExclusiveRenameError extends Error {
  readonly failure: ExclusiveRenameFailure;

  constructor(failure: ExclusiveRenameFailure, message = "exclusive rename failed") {
    super(message);
    this.name = "ExclusiveRenameError";
    this.failure = failure;
  }
}

const defaultHelperPath = resolve(dirname(fileURLToPath(import.meta.url)), "../native/bin/rename-excl");

function parseFailure(stdout: string): ExclusiveRenameFailure {
  const match = /^ERR ([A-Z]+)\n?$/.exec(stdout);
  if (!match) return "UNKNOWN";
  const token = match[1] as ExclusiveRenameFailure;
  return failures.has(token) ? token : "UNKNOWN";
}

export async function exclusiveRename(
  projectDirectory: string,
  sourceRelativePath: string,
  targetRelativePath: string,
  helperPath = defaultHelperPath,
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    execFile(
      helperPath,
      [projectDirectory, sourceRelativePath, targetRelativePath],
      { encoding: "utf8", shell: false },
      (error, stdout) => {
        if (!error) {
          if (stdout === "OK\n") {
            resolvePromise();
            return;
          }
          rejectPromise(new ExclusiveRenameError("UNKNOWN"));
          return;
        }

        rejectPromise(new ExclusiveRenameError(parseFailure(stdout)));
      },
    );
  });
}
