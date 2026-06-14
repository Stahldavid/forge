import { hashStable } from "./hash.ts";

export const DETERMINISTIC_HEADER_PREFIX = "// @forge-generated";

export interface DeterministicHeaderFields {
  generatorVersion: string;
  inputHash: string;
  contentHash: string;
}

const HEADER_PATTERN =
  /^\/\/ @forge-generated generator=([^\s]+) input=([^\s]+) content=([^\s]+)\r?\n/;

export function formatDeterministicHeader(
  fields: DeterministicHeaderFields,
): string {
  return `${DETERMINISTIC_HEADER_PREFIX} generator=${fields.generatorVersion} input=${fields.inputHash} content=${fields.contentHash}\n`;
}

export function parseDeterministicHeader(
  content: string,
): DeterministicHeaderFields | null {
  const match = content.match(HEADER_PATTERN);
  if (match === null) {
    return null;
  }

  return {
    generatorVersion: match[1]!,
    inputHash: match[2]!,
    contentHash: match[3]!,
  };
}

export function stripDeterministicHeader(content: string): string {
  return content.replace(HEADER_PATTERN, "");
}

export function prependDeterministicHeader(
  body: string,
  fields: Omit<DeterministicHeaderFields, "contentHash">,
): string {
  const contentHash = hashStable(body);
  return formatDeterministicHeader({ ...fields, contentHash }) + body;
}
