import { readFileSync, readdirSync } from "node:fs";
export const input = JSON.parse(readFileSync(process.env.FORGE_PROGRAM_INPUT_PATH, "utf8"));
export function files(directory = "src") {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(`${directory}/${entry.name}`) : entry.isFile() && entry.name.endsWith(".txt") ? [`${directory}/${entry.name}`] : []).sort();
}
export const selected = () => input.workItem ? [input.workItem.id] : files();
export const migrated = () => selected().every(path => readFileSync(path, "utf8") === "new");
