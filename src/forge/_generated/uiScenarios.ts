// @forge-generated generator=0.1.0-alpha.63 input=43623ccc7209d544f8745a8d03de2c1703d186ea75709a2ca79af821a88f2818 content=9f058eb2077646e169007bbff7911b3113ef95d12a5c7001db88e378557732d6
export const uiScenarios = {
  "scenarios": [
    {
      "cost": "browser",
      "description": "Load the home route and verify the app renders.",
      "name": "home-loads",
      "requires": {
        "commands": [],
        "components": [],
        "liveQueries": [],
        "policies": [],
        "queries": [],
        "workflows": []
      },
      "route": "/",
      "steps": [
        {
          "kind": "goto",
          "path": "/"
        },
        {
          "kind": "expectVisible",
          "selector": "[data-forge-testid='app-root'], body"
        }
      ]
    }
  ],
  "schemaVersion": "0.1.0"
} as const;
