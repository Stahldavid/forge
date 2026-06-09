import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function readTextFileIfExists(
  absolutePath: string,
): Promise<string | null> {
  try {
    return await readFile(absolutePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") {
      return null;
    }
    throw error;
  }
}

export async function writeFileAtomic(
  absolutePath: string,
  content: string,
): Promise<void> {
  const directory = dirname(absolutePath);
  await mkdir(directory, { recursive: true });

  const temporaryPath = join(
    directory,
    `.${basename(absolutePath)}.${process.pid}.tmp`,
  );

  try {
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, absolutePath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // Ignore cleanup failures while surfacing the original write error.
    }
    throw error;
  }
}

export async function removeFileIfExists(absolutePath: string): Promise<boolean> {
  try {
    await unlink(absolutePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
