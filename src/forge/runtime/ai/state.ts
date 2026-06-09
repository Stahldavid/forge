export function isMockAiEnabled(options?: { mockAi?: boolean }): boolean {
  if (options?.mockAi) {
    return true;
  }
  if (process.env.FORGE_MOCK_AI === "1") {
    return true;
  }
  return false;
}

export function setMockAiMode(enabled: boolean): void {
  if (enabled) {
    process.env.FORGE_MOCK_AI = "1";
  } else {
    delete process.env.FORGE_MOCK_AI;
  }
}
