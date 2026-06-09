const EVENT_LITERAL_PATTERN = /event\s*:\s*["']([^"']+)["']/;

export function parseActionEventFromSlice(sourceSlice: string): string | null {
  const match = sourceSlice.match(EVENT_LITERAL_PATTERN);
  return match?.[1] ?? null;
}
