// @forge-generated generator=0.0.0 input=2109cd49dea7ae4cd20f98fc0ce6dce0a08c3e3732a7d77f530851d6d134f995 content=aef8c0bdd09351b3e183a1a921afb2685a7aa3d60b6e1016f0f27c2489ea9876
export const workflowRegistry = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "generatorVersion": "0.0.0",
  "inputHash": "c46bef31acca248f6b8a5a94a68ee8c1bb585ea5348651cae41c671c546e15c2",
  "schemaVersion": "0.1.0",
  "workflows": [
    {
      "exportName": "triageTicketWorkflow",
      "file": "src/workflows/triageTicketWorkflow.ts",
      "name": "triageTicketWorkflow",
      "steps": [
        {
          "index": 0,
          "name": "loadTicket"
        },
        {
          "index": 1,
          "name": "triageWithAI"
        },
        {
          "index": 2,
          "name": "captureTriageAnalytics"
        }
      ],
      "symbolId": "bf2312cc6a628448ad8c940452c76c3c571159716fe30f73831865fcf5fcb84f",
      "triggerEventType": "ticket.created"
    }
  ]
} as const;
