const ENV_ALLOWLIST = new Set([
  "PATH",
  "HOME",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "TMPDIR",
  "SYSTEMROOT",
  "PATHEXT",
  "COMSPEC",
  "LANG",
  "LC_ALL",
  "NODE_PATH",
]);

const SECRET_KEY_PATTERN =
  /secret|password|token|api[_-]?key|credential|private[_-]?key|auth/i;

export interface ScrubEnvOptions {
  /** Values loaded from .env files that must never pass through. */
  dotEnvValues?: Iterable<string>;
}

export function isSecretEnvKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function scrubEnv(
  env: NodeJS.ProcessEnv,
  options: ScrubEnvOptions = {},
): Record<string, string> {
  const blockedValues = new Set<string>();
  for (const value of options.dotEnvValues ?? []) {
    if (value.length > 0) {
      blockedValues.add(value);
    }
  }

  const scrubbed: Record<string, string> = {};
  for (const key of Object.keys(env).sort()) {
    if (!ENV_ALLOWLIST.has(key)) {
      continue;
    }
    if (isSecretEnvKey(key)) {
      continue;
    }

    const value = env[key];
    if (value == null || value.length === 0) {
      continue;
    }
    if (blockedValues.has(value)) {
      continue;
    }

    scrubbed[key] = value;
  }

  return scrubbed;
}
