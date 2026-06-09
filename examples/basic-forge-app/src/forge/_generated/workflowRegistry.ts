// @forge-generated generator=0.0.0 input=9255ba138ae80878f8ea821fed168d05fd040cb5d5f09ec1dae92c86cfbdf974 content=518072c02d2456e3eea8ef2461649cf9337b8ddc58ef04036bf9d0840ca8bfa0
export const workflowRegistry = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "generatorVersion": "0.0.0",
  "inputHash": "db58e5cd3c925a46e96ae87d76e8c68ccb58dc6df1f48e92cc2f5188dc77008d",
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
