const TELEMETRY_CAPTURE_PATTERN =
  /(?:telemetry|ctx\.telemetry)\.capture\s*\(\s*["']([^"']+)["']/g;

export function parseTelemetryEventsFromSlice(sourceSlice: string): string[] {
  const names: string[] = [];
  for (const match of sourceSlice.matchAll(TELEMETRY_CAPTURE_PATTERN)) {
    const name = match[1];
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}
