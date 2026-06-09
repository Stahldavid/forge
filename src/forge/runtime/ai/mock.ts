import type { ForgeAiUsage } from "./types.ts";

export interface MockAiQueuedResponse {
  text: string;
  usage?: Partial<ForgeAiUsage>;
}

let mockQueue: MockAiQueuedResponse[] = [];
let defaultMockText = "mock-ai-response";

export function resetMockAiQueue(): void {
  mockQueue = [];
  defaultMockText = "mock-ai-response";
}

export function enqueueMockAiResponse(response: MockAiQueuedResponse): void {
  mockQueue.push(response);
}

export function setDefaultMockAiText(text: string): void {
  defaultMockText = text;
}

export function dequeueMockAiResponse(): MockAiQueuedResponse {
  const next = mockQueue.shift();
  if (next) {
    return next;
  }
  return {
    text: defaultMockText,
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
  };
}

export function createMockAiUsage(override?: Partial<ForgeAiUsage>): ForgeAiUsage {
  return {
    promptTokens: override?.promptTokens ?? 10,
    completionTokens: override?.completionTokens ?? 20,
    totalTokens: override?.totalTokens ?? 30,
  };
}

export function createMockAiProvider() {
  return {
    enqueue: enqueueMockAiResponse,
    reset: resetMockAiQueue,
    setDefaultText: setDefaultMockAiText,
  };
}
