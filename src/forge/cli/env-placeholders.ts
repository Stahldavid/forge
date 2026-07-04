export interface PlaceholderEnvProblem {
  key: string;
  reason: string;
}

const GENERIC_PLACEHOLDER_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bexample\.(com|test|org|net)\b/, reason: "example domain" },
  { pattern: /\bdummy\b/, reason: "dummy marker" },
  { pattern: /\bplaceholder\b/, reason: "placeholder marker" },
  { pattern: /\bchange[-_]?me\b/, reason: "change-me marker" },
  { pattern: /\bdo[-_]?not[-_]?use\b/, reason: "do-not-use marker" },
  { pattern: /^<.*>$/, reason: "angle-bracket placeholder" },
  { pattern: /^your[-_]/, reason: "your-value placeholder" },
];

const KEY_PLACEHOLDER_PATTERNS: Record<string, Array<{ pattern: RegExp; reason: string }>> = {
  DATABASE_URL: [
    { pattern: /^postgres:\/\/forge:forge@postgres:5432\/forge_app$/i, reason: "generated Docker example database URL" },
    { pattern: /^postgres:\/\/forge:forge@db:5432\/forge$/i, reason: "local dummy database URL" },
    { pattern: /^postgres:\/\/local-only\b/i, reason: "local-only database URL" },
  ],
  WORKOS_API_KEY: [
    { pattern: /^sk_test_dummy/i, reason: "dummy WorkOS API key" },
    { pattern: /^sk_test_?\.\.\.$/i, reason: "placeholder WorkOS API key" },
  ],
  WORKOS_CLIENT_ID: [
    { pattern: /^client_?\.\.\.$/i, reason: "placeholder WorkOS client id" },
    { pattern: /^client_test_local$/i, reason: "local fake WorkOS client id" },
  ],
  WORKOS_COOKIE_PASSWORD: [
    { pattern: /dummy/i, reason: "dummy cookie password" },
    { pattern: /change[-_]?me/i, reason: "change-me cookie password" },
  ],
  FORGE_AUTH_AUDIENCE: [
    { pattern: /^client_test_local$/i, reason: "local fake auth audience" },
  ],
  FORGE_AUTH_JWKS_URI: [
    { pattern: /\/client_test_local$/i, reason: "local fake JWKS client id" },
  ],
};

export function placeholderEnvProblem(key: string, value: string | undefined): PlaceholderEnvProblem | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  for (const { pattern, reason } of KEY_PLACEHOLDER_PATTERNS[key] ?? []) {
    if (pattern.test(trimmed)) return { key, reason };
  }
  for (const { pattern, reason } of GENERIC_PLACEHOLDER_PATTERNS) {
    if (pattern.test(normalized)) return { key, reason };
  }
  return null;
}

export function productionPlaceholderEnvProblems(
  values: Record<string, string>,
  keys = Object.keys(values),
): PlaceholderEnvProblem[] {
  return keys
    .map((key) => placeholderEnvProblem(key, values[key]))
    .filter((problem): problem is PlaceholderEnvProblem => Boolean(problem));
}
