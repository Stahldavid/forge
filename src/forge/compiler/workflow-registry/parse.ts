const TRIGGER_EVENT_PATTERN =
  /trigger\s*:\s*event\s*\(\s*["']([^"']+)["']\s*\)/;
const STEP_NAME_PATTERN = /step\s*\(\s*["']([^"']+)["']/g;

export function parseWorkflowTriggerFromSlice(sourceSlice: string): string | null {
  const match = sourceSlice.match(TRIGGER_EVENT_PATTERN);
  return match?.[1] ?? null;
}

export function parseWorkflowStepNamesFromSlice(sourceSlice: string): string[] {
  const names: string[] = [];
  for (const match of sourceSlice.matchAll(STEP_NAME_PATTERN)) {
    const name = match[1];
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}
