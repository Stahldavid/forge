import { defineTable } from "forge/server";

export const agentSessions = defineTable({
  name: "agentSessions",
  fields: {
    id: "uuid",
    appName: "text",
    appPath: "text",
    previewUrl: "text",
    previewStatus: "text",
    previewStatusReason: "text",
    agent: "text",
    status: "text",
    objective: "text",
    generatedState: "text",
    generatedChangedFiles: "number",
    authoredFiles: "number",
    generatedFiles: "number",
    authoredDiffCommand: "text",
    generatedDiffCommand: "text",
    terminalCommand: "text",
    terminalCwd: "text",
    createdAt: "timestamp",
    updatedAt: "timestamp",
  },
});

export const agentSignals = defineTable({
  name: "agentSignals",
  fields: {
    id: "uuid",
    sessionId: "uuid",
    source: "text",
    kind: "text",
    title: "text",
    detail: "text",
    filesChanged: "text",
    status: "text",
    createdAt: "timestamp",
  },
});

export const checkRuns = defineTable({
  name: "checkRuns",
  fields: {
    id: "uuid",
    sessionId: "uuid",
    command: "text",
    status: "text",
    output: "text",
    durationMs: "number",
    createdAt: "timestamp",
  },
});
