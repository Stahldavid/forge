// @forge-generated generator=0.1.0-alpha.4 input=89430851907382c0b60cc8761af3b49eda8db4a6e8993691990c0e710d2bd8a7 content=9f058eb2077646e169007bbff7911b3113ef95d12a5c7001db88e378557732d6
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
