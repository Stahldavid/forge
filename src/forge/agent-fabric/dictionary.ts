// Identifiers are arbitrary non-empty strings, including Object.prototype names.
// Keep own-data semantics even for ordinary objects produced by clone or spread.
export function getOwn<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function setOwn<T>(record: Record<string, T>, key: string, value: T): T {
  Object.defineProperty(record, key, {
    value, enumerable: true, configurable: true, writable: true,
  });
  return value;
}
