// @forge-generated generator=0.0.0 input=54f3f6b66f87a575bff2d09c80de50b1bfca193d6bbbd7adb6204ec0df01c245 content=024063f93b56615fe5fa5b1b356760aa357b7bac735fa0ac1e3861fccd040ecb
export const workflowRegistry = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "generatorVersion": "0.0.0",
  "inputHash": "568d2b4ceb9ab9bffb08c83a892315ec8aee172cce7ceefbf39d7258325201e2",
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
