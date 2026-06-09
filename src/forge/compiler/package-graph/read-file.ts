import { readFileSync } from "node:fs";

export interface ReadFileTracker {
  recordRead(path: string): void;
}

let activeTracker: ReadFileTracker | undefined;

export function setReadFileTracker(tracker: ReadFileTracker | undefined): void {
  activeTracker = tracker;
}

export function readTextFile(path: string): string {
  activeTracker?.recordRead(path);
  return readFileSync(path, "utf8");
}

export function readBinaryFile(path: string): Uint8Array {
  activeTracker?.recordRead(path);
  return readFileSync(path);
}
