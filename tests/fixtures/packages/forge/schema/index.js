export function defineTable(name, config = {}) {
  return { name, ...config };
}
