export function computeNextAttemptAt(attempts: number, now = new Date()): Date {
  const delayMs = attempts * 5_000;
  return new Date(now.getTime() + delayMs);
}

export function formatTimestamp(date: Date): string {
  return date.toISOString();
}
