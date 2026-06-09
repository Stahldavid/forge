/** Resolve the Bun executable for spawning child processes (Windows-safe). */
export function resolveBunExecutable(): string {
  if (/bun/i.test(process.execPath)) {
    return process.execPath;
  }

  const fromPath = typeof Bun !== "undefined" ? Bun.which("bun") : undefined;
  if (fromPath) {
    return fromPath;
  }

  return "bun";
}
