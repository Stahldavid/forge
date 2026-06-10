// @forge-generated generator=0.0.0 input=546500a6b3678160b7670bd4f0428cd9913860cf4a90429c9bd9563aa38bc60f content=56ebca09e8eafd8985c3df43c4376ba5d36eb0b7b05de803cd15a02cc7e38f9d
export const workflowRegistry = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "generatorVersion": "0.0.0",
  "inputHash": "f060c9dc0ce85058b7352a7cfeafdecd281f43168ee76f0fa3d831fabd38e1b0",
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
