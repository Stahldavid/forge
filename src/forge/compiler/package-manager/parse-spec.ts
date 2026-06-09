/**
 * Parse a package name from an install spec (e.g. "lodash@4.17.21", "@scope/pkg@1.0.0").
 */
export function parsePackageName(spec: string): string {
  const trimmed = spec.trim();
  if (trimmed.startsWith("@")) {
    const slashIdx = trimmed.indexOf("/");
    if (slashIdx === -1) {
      return trimmed;
    }
    const versionAt = trimmed.indexOf("@", slashIdx + 1);
    return versionAt === -1 ? trimmed : trimmed.slice(0, versionAt);
  }
  const atIdx = trimmed.indexOf("@");
  return atIdx === -1 ? trimmed : trimmed.slice(0, atIdx);
}
