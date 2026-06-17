// @forge-generated generator=0.1.0-alpha.9 input=ca868c8ec6ee8cac0b8a654cbdfef0cc44cdb8d68fa7e924cc6237ac0241a710 content=9f058eb2077646e169007bbff7911b3113ef95d12a5c7001db88e378557732d6
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
