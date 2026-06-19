// @forge-generated generator=0.1.0-alpha.16 input=48860df69cb90d3dd3e4ab7f4a96c04ae6aaf13e86500ee34868ba58a6c23650 content=9f058eb2077646e169007bbff7911b3113ef95d12a5c7001db88e378557732d6
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
