// @forge-generated generator=0.0.0 input=dbed69e6d72dbc70c4da980e189c370546d6773f069f0b210a3b192dab421887 content=11460030d584ee2fe51b501889e25698e7df2290aa46b407a001f0e36e8c2ea3
export const workflowRegistry = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "generatorVersion": "0.0.0",
  "inputHash": "a66bb00b097d81a704e85a0e73b4b387e71154a25fee34da417be89c9eb28622",
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
