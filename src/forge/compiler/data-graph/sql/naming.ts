export function toSnakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

export function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}
