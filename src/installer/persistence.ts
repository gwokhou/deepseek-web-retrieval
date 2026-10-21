import { randomUUID } from "node:crypto";
import {
  closeSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

/** Replace one file, retaining valid symlinks and modes. This is not a multi-file transaction. */
export function atomicWrite(file: string, text: string, mode?: number): void {
  let target = file;
  let existingMode: number | undefined;
  try {
    const entry = lstatSync(file);
    // Resolve explicitly: never replace a dangling symlink with a new regular file.
    if (entry.isSymbolicLink()) target = realpathSync(file);
    existingMode = statSync(target).mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // A dangling link exists even though its target does not.
    try {
      if (lstatSync(file).isSymbolicLink()) throw new Error(`Cannot write dangling symlink ${file}`);
    } catch (linkError) {
      if ((linkError as NodeJS.ErrnoException).code !== "ENOENT") throw linkError;
    }
  }
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true });
  const temporary = join(dir, `.${basename(target)}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, text);
    // Catch incomplete/silently dropped writes before replacing the original.
    if (readFileSync(temporary, "utf8") !== text) throw new Error(`Incomplete write to ${file}`);
    fchmodSync(fd, mode ?? existingMode ?? 0o666 & ~process.umask());
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, target);
    syncDirectory(dir);
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}

function syncDirectory(dir: string): void {
  // Windows does not support opening directories for fsync.
  if (process.platform === "win32") return;
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
