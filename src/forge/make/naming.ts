export function singularize(name: string): string {
  if (name.endsWith("ies")) {
    return `${name.slice(0, -3)}y`;
  }
  if (name.endsWith("s") && name.length > 1) {
    return name.slice(0, -1);
  }
  return name;
}

export function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

export function camelCase(value: string): string {
  const parts = words(value);
  return parts
    .map((part, index) =>
      index === 0 ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`,
    )
    .join("");
}

export function pascalCase(value: string): string {
  return words(value)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
}

export function titleCase(value: string): string {
  return words(value)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function kebabCase(value: string): string {
  return words(value).join("-");
}
