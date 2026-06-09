const TOKEN_PREFIXES = ["sk_", "pk_", "ghp_", "xoxb-", "xoxp-", "xoxa-"] as const;

/** Match JSON object keys that may carry secret values — not substrings like "secrets". */
const SECRET_KEY_JSON_PATTERN =
  /"(?:api[_-]?key|secret|password|token|credential|private[_-]?key)"\s*:/i;

const HIGH_ENTROPY_PATTERN = /[A-Za-z0-9+/]{40,}={0,2}/;

export interface SecretScanOptions {
  knownSecretValues?: Iterable<string>;
  /** When false, skip high-entropy heuristics (for stable artifact checksums). */
  includeHighEntropy?: boolean;
}

export interface SecretScanResult {
  hasLeak: boolean;
  matches: string[];
}

export function secretLeakScan(
  serialized: string,
  options: SecretScanOptions = {},
): SecretScanResult {
  const matches: string[] = [];
  const includeHighEntropy = options.includeHighEntropy ?? true;

  for (const value of options.knownSecretValues ?? []) {
    if (value.length >= 4 && serialized.includes(value)) {
      matches.push(`known-secret:${value.slice(0, 4)}…`);
    }
  }

  if (SECRET_KEY_JSON_PATTERN.test(serialized)) {
    matches.push("secret-like-key");
  }

  for (const prefix of TOKEN_PREFIXES) {
    if (serialized.includes(prefix)) {
      matches.push(`token-prefix:${prefix}`);
    }
  }

  if (includeHighEntropy) {
    const entropy = serialized.match(HIGH_ENTROPY_PATTERN);
    if (entropy != null) {
      matches.push("high-entropy");
    }
  }

  return {
    hasLeak: matches.length > 0,
    matches,
  };
}
