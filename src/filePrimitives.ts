import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function atomicWriteFile(targetPath: string, content: Uint8Array): Promise<void> {
  const directory = dirname(targetPath);
  const temporaryPath = join(directory, `.${basename(targetPath)}.grande-${randomUUID()}.tmp`);
  let temporaryExists = false;

  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    temporaryExists = true;
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }

    await rename(temporaryPath, targetPath);
    temporaryExists = false;
  } finally {
    if (temporaryExists) {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}
