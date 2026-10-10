export const criticalFabricTests: string[];
export const criticalGateTestPattern: string;
export function assertCriticalGateCoverage(source: string): string[];
export function assertCriticalGateResults(output: string): number;
export function fabricTestSelection(eventName: string, fabricOnly: string): string[];
