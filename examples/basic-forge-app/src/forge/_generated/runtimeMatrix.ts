// @forge-generated generator=0.0.0 input=9255ba138ae80878f8ea821fed168d05fd040cb5d5f09ec1dae92c86cfbdf974 content=02e8f319c1522504cd44a04dcf72f8f8fc42e7d7e174bd62514835b23f1844c2
export const runtimeMatrix = {
  "entries": [
    {
      "alias": "posthog",
      "compatible": [
        "shared",
        "client",
        "test",
        "build"
      ],
      "incompatible": [
        "server",
        "query",
        "liveQuery",
        "command",
        "action",
        "workflow",
        "endpoint",
        "edge"
      ],
      "packageName": "posthog-js",
      "perEntrypoint": [
        {
          "alias": "posthog",
          "capabilities": {
            "filesystem": {
              "confidence": "rule",
              "evidence": [
                "default: no filesystem signals"
              ],
              "status": "not-detected"
            },
            "lifecycleScripts": {
              "confidence": "rule",
              "evidence": [
                "default: scripts disabled by forge add"
              ],
              "status": "not-detected"
            },
            "nativeAddon": {
              "confidence": "rule",
              "evidence": [
                "default: no native addon signals"
              ],
              "status": "not-detected"
            },
            "network": {
              "confidence": "manual",
              "evidence": [
                "recipe:posthog"
              ],
              "status": "required",
              "value": {
                "egress": [
                  "*.posthog.com",
                  "us.i.posthog.com",
                  "eu.i.posthog.com"
                ]
              }
            },
            "process": {
              "confidence": "rule",
              "evidence": [
                "default: no process signals"
              ],
              "status": "not-detected"
            },
            "secrets": [
              {
                "detectedFrom": "recipe",
                "envVar": "NEXT_PUBLIC_POSTHOG_KEY",
                "required": true
              },
              {
                "detectedFrom": "recipe",
                "envVar": "POSTHOG_HOST",
                "required": false
              },
              {
                "detectedFrom": "recipe",
                "envVar": "POSTHOG_KEY",
                "required": true
              }
            ]
          },
          "compatible": [
            "shared",
            "client",
            "test",
            "build"
          ],
          "entrypoint": ".",
          "exportName": "InitOptions",
          "incompatible": [
            "server",
            "query",
            "liveQuery",
            "command",
            "action",
            "workflow",
            "endpoint",
            "edge"
          ],
          "packageName": "posthog-js"
        },
        {
          "alias": "posthog",
          "capabilities": {
            "filesystem": {
              "confidence": "rule",
              "evidence": [
                "default: no filesystem signals"
              ],
              "status": "not-detected"
            },
            "lifecycleScripts": {
              "confidence": "rule",
              "evidence": [
                "default: scripts disabled by forge add"
              ],
              "status": "not-detected"
            },
            "nativeAddon": {
              "confidence": "rule",
              "evidence": [
                "default: no native addon signals"
              ],
              "status": "not-detected"
            },
            "network": {
              "confidence": "manual",
              "evidence": [
                "recipe:posthog"
              ],
              "status": "required",
              "value": {
                "egress": [
                  "*.posthog.com",
                  "us.i.posthog.com",
                  "eu.i.posthog.com"
                ]
              }
            },
            "process": {
              "confidence": "rule",
              "evidence": [
                "default: no process signals"
              ],
              "status": "not-detected"
            },
            "secrets": [
              {
                "detectedFrom": "recipe",
                "envVar": "NEXT_PUBLIC_POSTHOG_KEY",
                "required": true
              },
              {
                "detectedFrom": "recipe",
                "envVar": "POSTHOG_HOST",
                "required": false
              },
              {
                "detectedFrom": "recipe",
                "envVar": "POSTHOG_KEY",
                "required": true
              }
            ]
          },
          "compatible": [
            "shared",
            "client",
            "test",
            "build"
          ],
          "entrypoint": ".",
          "exportName": "PostHog",
          "incompatible": [
            "server",
            "query",
            "liveQuery",
            "command",
            "action",
            "workflow",
            "endpoint",
            "edge"
          ],
          "packageName": "posthog-js"
        },
        {
          "alias": "posthog",
          "capabilities": {
            "filesystem": {
              "confidence": "rule",
              "evidence": [
                "default: no filesystem signals"
              ],
              "status": "not-detected"
            },
            "lifecycleScripts": {
              "confidence": "rule",
              "evidence": [
                "default: scripts disabled by forge add"
              ],
              "status": "not-detected"
            },
            "nativeAddon": {
              "confidence": "rule",
              "evidence": [
                "default: no native addon signals"
              ],
              "status": "not-detected"
            },
            "network": {
              "confidence": "manual",
              "evidence": [
                "recipe:posthog"
              ],
              "status": "required",
              "value": {
                "egress": [
                  "*.posthog.com",
                  "us.i.posthog.com",
                  "eu.i.posthog.com"
                ]
              }
            },
            "process": {
              "confidence": "rule",
              "evidence": [
                "default: no process signals"
              ],
              "status": "not-detected"
            },
            "secrets": [
              {
                "detectedFrom": "recipe",
                "envVar": "NEXT_PUBLIC_POSTHOG_KEY",
                "required": true
              },
              {
                "detectedFrom": "recipe",
                "envVar": "POSTHOG_HOST",
                "required": false
              },
              {
                "detectedFrom": "recipe",
                "envVar": "POSTHOG_KEY",
                "required": true
              }
            ]
          },
          "compatible": [
            "shared",
            "client",
            "test",
            "build"
          ],
          "entrypoint": ".",
          "exportName": "init",
          "incompatible": [
            "server",
            "query",
            "liveQuery",
            "command",
            "action",
            "workflow",
            "endpoint",
            "edge"
          ],
          "packageName": "posthog-js"
        }
      ],
      "rationale": {
        "action": "denied by integration recipe",
        "build": "allowed by integration recipe",
        "client": "allowed by integration recipe",
        "command": "denied by integration recipe",
        "edge": "denied by integration recipe",
        "endpoint": "denied by integration recipe",
        "liveQuery": "denied by integration recipe",
        "query": "denied by integration recipe",
        "server": "denied by integration recipe",
        "shared": "allowed by integration recipe",
        "test": "allowed by integration recipe",
        "workflow": "denied by integration recipe"
      }
    },
    {
      "alias": "posthog",
      "compatible": [
        "server",
        "action",
        "workflow",
        "endpoint"
      ],
      "incompatible": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command",
        "edge",
        "test",
        "build"
      ],
      "packageName": "posthog-node",
      "perEntrypoint": [
        {
          "alias": "posthog",
          "capabilities": {
            "filesystem": {
              "confidence": "rule",
              "evidence": [
                "default: no filesystem signals"
              ],
              "status": "not-detected"
            },
            "lifecycleScripts": {
              "confidence": "rule",
              "evidence": [
                "default: scripts disabled by forge add"
              ],
              "status": "not-detected"
            },
            "nativeAddon": {
              "confidence": "rule",
              "evidence": [
                "default: no native addon signals"
              ],
              "status": "not-detected"
            },
            "network": {
              "confidence": "manual",
              "evidence": [
                "recipe:posthog"
              ],
              "status": "required",
              "value": {
                "egress": [
                  "*.posthog.com",
                  "us.i.posthog.com",
                  "eu.i.posthog.com"
                ]
              }
            },
            "process": {
              "confidence": "rule",
              "evidence": [
                "default: no process signals"
              ],
              "status": "not-detected"
            },
            "secrets": [
              {
                "detectedFrom": "recipe",
                "envVar": "NEXT_PUBLIC_POSTHOG_KEY",
                "required": true
              },
              {
                "detectedFrom": "recipe",
                "envVar": "POSTHOG_HOST",
                "required": false
              },
              {
                "detectedFrom": "recipe",
                "envVar": "POSTHOG_KEY",
                "required": true
              }
            ]
          },
          "compatible": [
            "server",
            "action",
            "workflow",
            "endpoint"
          ],
          "entrypoint": ".",
          "exportName": "CaptureParams",
          "incompatible": [
            "shared",
            "client",
            "query",
            "liveQuery",
            "command",
            "edge",
            "test",
            "build"
          ],
          "packageName": "posthog-node"
        },
        {
          "alias": "posthog",
          "capabilities": {
            "filesystem": {
              "confidence": "rule",
              "evidence": [
                "default: no filesystem signals"
              ],
              "status": "not-detected"
            },
            "lifecycleScripts": {
              "confidence": "rule",
              "evidence": [
                "default: scripts disabled by forge add"
              ],
              "status": "not-detected"
            },
            "nativeAddon": {
              "confidence": "rule",
              "evidence": [
                "default: no native addon signals"
              ],
              "status": "not-detected"
            },
            "network": {
              "confidence": "manual",
              "evidence": [
                "recipe:posthog"
              ],
              "status": "required",
              "value": {
                "egress": [
                  "*.posthog.com",
                  "us.i.posthog.com",
                  "eu.i.posthog.com"
                ]
              }
            },
            "process": {
              "confidence": "rule",
              "evidence": [
                "default: no process signals"
              ],
              "status": "not-detected"
            },
            "secrets": [
              {
                "detectedFrom": "recipe",
                "envVar": "NEXT_PUBLIC_POSTHOG_KEY",
                "required": true
              },
              {
                "detectedFrom": "recipe",
                "envVar": "POSTHOG_HOST",
                "required": false
              },
              {
                "detectedFrom": "recipe",
                "envVar": "POSTHOG_KEY",
                "required": true
              }
            ]
          },
          "compatible": [
            "server",
            "action",
            "workflow",
            "endpoint"
          ],
          "entrypoint": ".",
          "exportName": "PostHog",
          "incompatible": [
            "shared",
            "client",
            "query",
            "liveQuery",
            "command",
            "edge",
            "test",
            "build"
          ],
          "packageName": "posthog-node"
        },
        {
          "alias": "posthog",
          "capabilities": {
            "filesystem": {
              "confidence": "rule",
              "evidence": [
                "default: no filesystem signals"
              ],
              "status": "not-detected"
            },
            "lifecycleScripts": {
              "confidence": "rule",
              "evidence": [
                "default: scripts disabled by forge add"
              ],
              "status": "not-detected"
            },
            "nativeAddon": {
              "confidence": "rule",
              "evidence": [
                "default: no native addon signals"
              ],
              "status": "not-detected"
            },
            "network": {
              "confidence": "manual",
              "evidence": [
                "recipe:posthog"
              ],
              "status": "required",
              "value": {
                "egress": [
                  "*.posthog.com",
                  "us.i.posthog.com",
                  "eu.i.posthog.com"
                ]
              }
            },
            "process": {
              "confidence": "rule",
              "evidence": [
                "default: no process signals"
              ],
              "status": "not-detected"
            },
            "secrets": [
              {
                "detectedFrom": "recipe",
                "envVar": "NEXT_PUBLIC_POSTHOG_KEY",
                "required": true
              },
              {
                "detectedFrom": "recipe",
                "envVar": "POSTHOG_HOST",
                "required": false
              },
              {
                "detectedFrom": "recipe",
                "envVar": "POSTHOG_KEY",
                "required": true
              }
            ]
          },
          "compatible": [
            "server",
            "action",
            "workflow",
            "endpoint"
          ],
          "entrypoint": ".",
          "exportName": "createPostHog",
          "incompatible": [
            "shared",
            "client",
            "query",
            "liveQuery",
            "command",
            "edge",
            "test",
            "build"
          ],
          "packageName": "posthog-node"
        }
      ],
      "rationale": {
        "action": "allowed by integration recipe",
        "build": "not in integration recipe allowed contexts",
        "client": "denied by integration recipe",
        "command": "denied by integration recipe",
        "edge": "not in integration recipe allowed contexts",
        "endpoint": "allowed by integration recipe",
        "liveQuery": "denied by integration recipe",
        "query": "denied by integration recipe",
        "server": "allowed by integration recipe",
        "shared": "denied by integration recipe",
        "test": "not in integration recipe allowed contexts",
        "workflow": "allowed by integration recipe"
      }
    },
    {
      "alias": "stripe",
      "compatible": [
        "server",
        "action",
        "workflow",
        "endpoint"
      ],
      "incompatible": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command",
        "edge",
        "test",
        "build"
      ],
      "packageName": "stripe",
      "perEntrypoint": [
        {
          "alias": "stripe",
          "capabilities": {
            "filesystem": {
              "confidence": "rule",
              "evidence": [
                "default: no filesystem signals"
              ],
              "status": "not-detected"
            },
            "lifecycleScripts": {
              "confidence": "rule",
              "evidence": [
                "default: scripts disabled by forge add"
              ],
              "status": "not-detected"
            },
            "nativeAddon": {
              "confidence": "rule",
              "evidence": [
                "default: no native addon signals"
              ],
              "status": "not-detected"
            },
            "network": {
              "confidence": "manual",
              "evidence": [
                "recipe:stripe"
              ],
              "status": "required",
              "value": {
                "egress": [
                  "api.stripe.com"
                ]
              }
            },
            "process": {
              "confidence": "rule",
              "evidence": [
                "default: no process signals"
              ],
              "status": "not-detected"
            },
            "secrets": [
              {
                "detectedFrom": "recipe",
                "envVar": "STRIPE_SECRET_KEY",
                "required": true
              },
              {
                "detectedFrom": "recipe",
                "envVar": "STRIPE_WEBHOOK_SECRET",
                "required": true
              }
            ]
          },
          "compatible": [
            "server",
            "action",
            "workflow",
            "endpoint"
          ],
          "entrypoint": ".",
          "exportName": "Customer",
          "incompatible": [
            "shared",
            "client",
            "query",
            "liveQuery",
            "command",
            "edge",
            "test",
            "build"
          ],
          "packageName": "stripe"
        },
        {
          "alias": "stripe",
          "capabilities": {
            "filesystem": {
              "confidence": "rule",
              "evidence": [
                "default: no filesystem signals"
              ],
              "status": "not-detected"
            },
            "lifecycleScripts": {
              "confidence": "rule",
              "evidence": [
                "default: scripts disabled by forge add"
              ],
              "status": "not-detected"
            },
            "nativeAddon": {
              "confidence": "rule",
              "evidence": [
                "default: no native addon signals"
              ],
              "status": "not-detected"
            },
            "network": {
              "confidence": "manual",
              "evidence": [
                "recipe:stripe"
              ],
              "status": "required",
              "value": {
                "egress": [
                  "api.stripe.com"
                ]
              }
            },
            "process": {
              "confidence": "rule",
              "evidence": [
                "default: no process signals"
              ],
              "status": "not-detected"
            },
            "secrets": [
              {
                "detectedFrom": "recipe",
                "envVar": "STRIPE_SECRET_KEY",
                "required": true
              },
              {
                "detectedFrom": "recipe",
                "envVar": "STRIPE_WEBHOOK_SECRET",
                "required": true
              }
            ]
          },
          "compatible": [
            "server",
            "action",
            "workflow",
            "endpoint"
          ],
          "entrypoint": ".",
          "exportName": "CustomerCreateParams",
          "incompatible": [
            "shared",
            "client",
            "query",
            "liveQuery",
            "command",
            "edge",
            "test",
            "build"
          ],
          "packageName": "stripe"
        },
        {
          "alias": "stripe",
          "capabilities": {
            "filesystem": {
              "confidence": "rule",
              "evidence": [
                "default: no filesystem signals"
              ],
              "status": "not-detected"
            },
            "lifecycleScripts": {
              "confidence": "rule",
              "evidence": [
                "default: scripts disabled by forge add"
              ],
              "status": "not-detected"
            },
            "nativeAddon": {
              "confidence": "rule",
              "evidence": [
                "default: no native addon signals"
              ],
              "status": "not-detected"
            },
            "network": {
              "confidence": "manual",
              "evidence": [
                "recipe:stripe"
              ],
              "status": "required",
              "value": {
                "egress": [
                  "api.stripe.com"
                ]
              }
            },
            "process": {
              "confidence": "rule",
              "evidence": [
                "default: no process signals"
              ],
              "status": "not-detected"
            },
            "secrets": [
              {
                "detectedFrom": "recipe",
                "envVar": "STRIPE_SECRET_KEY",
                "required": true
              },
              {
                "detectedFrom": "recipe",
                "envVar": "STRIPE_WEBHOOK_SECRET",
                "required": true
              }
            ]
          },
          "compatible": [
            "server",
            "action",
            "workflow",
            "endpoint"
          ],
          "entrypoint": ".",
          "exportName": "CustomersResource",
          "incompatible": [
            "shared",
            "client",
            "query",
            "liveQuery",
            "command",
            "edge",
            "test",
            "build"
          ],
          "packageName": "stripe"
        },
        {
          "alias": "stripe",
          "capabilities": {
            "filesystem": {
              "confidence": "rule",
              "evidence": [
                "default: no filesystem signals"
              ],
              "status": "not-detected"
            },
            "lifecycleScripts": {
              "confidence": "rule",
              "evidence": [
                "default: scripts disabled by forge add"
              ],
              "status": "not-detected"
            },
            "nativeAddon": {
              "confidence": "rule",
              "evidence": [
                "default: no native addon signals"
              ],
              "status": "not-detected"
            },
            "network": {
              "confidence": "manual",
              "evidence": [
                "recipe:stripe"
              ],
              "status": "required",
              "value": {
                "egress": [
                  "api.stripe.com"
                ]
              }
            },
            "process": {
              "confidence": "rule",
              "evidence": [
                "default: no process signals"
              ],
              "status": "not-detected"
            },
            "secrets": [
              {
                "detectedFrom": "recipe",
                "envVar": "STRIPE_SECRET_KEY",
                "required": true
              },
              {
                "detectedFrom": "recipe",
                "envVar": "STRIPE_WEBHOOK_SECRET",
                "required": true
              }
            ]
          },
          "compatible": [
            "server",
            "action",
            "workflow",
            "endpoint"
          ],
          "entrypoint": ".",
          "exportName": "Stripe",
          "incompatible": [
            "shared",
            "client",
            "query",
            "liveQuery",
            "command",
            "edge",
            "test",
            "build"
          ],
          "packageName": "stripe"
        },
        {
          "alias": "stripe",
          "capabilities": {
            "filesystem": {
              "confidence": "rule",
              "evidence": [
                "default: no filesystem signals"
              ],
              "status": "not-detected"
            },
            "lifecycleScripts": {
              "confidence": "rule",
              "evidence": [
                "default: scripts disabled by forge add"
              ],
              "status": "not-detected"
            },
            "nativeAddon": {
              "confidence": "rule",
              "evidence": [
                "default: no native addon signals"
              ],
              "status": "not-detected"
            },
            "network": {
              "confidence": "manual",
              "evidence": [
                "recipe:stripe"
              ],
              "status": "required",
              "value": {
                "egress": [
                  "api.stripe.com"
                ]
              }
            },
            "process": {
              "confidence": "rule",
              "evidence": [
                "default: no process signals"
              ],
              "status": "not-detected"
            },
            "secrets": [
              {
                "detectedFrom": "recipe",
                "envVar": "STRIPE_SECRET_KEY",
                "required": true
              },
              {
                "detectedFrom": "recipe",
                "envVar": "STRIPE_WEBHOOK_SECRET",
                "required": true
              }
            ]
          },
          "compatible": [
            "server",
            "action",
            "workflow",
            "endpoint"
          ],
          "entrypoint": ".",
          "exportName": "StripeConfig",
          "incompatible": [
            "shared",
            "client",
            "query",
            "liveQuery",
            "command",
            "edge",
            "test",
            "build"
          ],
          "packageName": "stripe"
        },
        {
          "alias": "stripe",
          "capabilities": {
            "filesystem": {
              "confidence": "rule",
              "evidence": [
                "default: no filesystem signals"
              ],
              "status": "not-detected"
            },
            "lifecycleScripts": {
              "confidence": "rule",
              "evidence": [
                "default: scripts disabled by forge add"
              ],
              "status": "not-detected"
            },
            "nativeAddon": {
              "confidence": "rule",
              "evidence": [
                "default: no native addon signals"
              ],
              "status": "not-detected"
            },
            "network": {
              "confidence": "manual",
              "evidence": [
                "recipe:stripe"
              ],
              "status": "required",
              "value": {
                "egress": [
                  "api.stripe.com"
                ]
              }
            },
            "process": {
              "confidence": "rule",
              "evidence": [
                "default: no process signals"
              ],
              "status": "not-detected"
            },
            "secrets": [
              {
                "detectedFrom": "recipe",
                "envVar": "STRIPE_SECRET_KEY",
                "required": true
              },
              {
                "detectedFrom": "recipe",
                "envVar": "STRIPE_WEBHOOK_SECRET",
                "required": true
              }
            ]
          },
          "compatible": [
            "server",
            "action",
            "workflow",
            "endpoint"
          ],
          "entrypoint": "./server",
          "exportName": "Event",
          "incompatible": [
            "shared",
            "client",
            "query",
            "liveQuery",
            "command",
            "edge",
            "test",
            "build"
          ],
          "packageName": "stripe"
        },
        {
          "alias": "stripe",
          "capabilities": {
            "filesystem": {
              "confidence": "rule",
              "evidence": [
                "default: no filesystem signals"
              ],
              "status": "not-detected"
            },
            "lifecycleScripts": {
              "confidence": "rule",
              "evidence": [
                "default: scripts disabled by forge add"
              ],
              "status": "not-detected"
            },
            "nativeAddon": {
              "confidence": "rule",
              "evidence": [
                "default: no native addon signals"
              ],
              "status": "not-detected"
            },
            "network": {
              "confidence": "manual",
              "evidence": [
                "recipe:stripe"
              ],
              "status": "required",
              "value": {
                "egress": [
                  "api.stripe.com"
                ]
              }
            },
            "process": {
              "confidence": "rule",
              "evidence": [
                "default: no process signals"
              ],
              "status": "not-detected"
            },
            "secrets": [
              {
                "detectedFrom": "recipe",
                "envVar": "STRIPE_SECRET_KEY",
                "required": true
              },
              {
                "detectedFrom": "recipe",
                "envVar": "STRIPE_WEBHOOK_SECRET",
                "required": true
              }
            ]
          },
          "compatible": [
            "server",
            "action",
            "workflow",
            "endpoint"
          ],
          "entrypoint": "./server",
          "exportName": "constructEvent",
          "incompatible": [
            "shared",
            "client",
            "query",
            "liveQuery",
            "command",
            "edge",
            "test",
            "build"
          ],
          "packageName": "stripe"
        }
      ],
      "rationale": {
        "action": "allowed by integration recipe",
        "build": "not in integration recipe allowed contexts",
        "client": "denied by integration recipe",
        "command": "denied by integration recipe",
        "edge": "not in integration recipe allowed contexts",
        "endpoint": "allowed by integration recipe",
        "liveQuery": "denied by integration recipe",
        "query": "denied by integration recipe",
        "server": "allowed by integration recipe",
        "shared": "denied by integration recipe",
        "test": "not in integration recipe allowed contexts",
        "workflow": "allowed by integration recipe"
      }
    },
    {
      "alias": "zod",
      "compatible": [
        "shared",
        "client",
        "server",
        "query",
        "liveQuery",
        "command",
        "action",
        "workflow",
        "endpoint",
        "edge",
        "test",
        "build"
      ],
      "incompatible": [],
      "packageName": "zod",
      "perEntrypoint": [
        {
          "alias": "zod",
          "capabilities": {
            "filesystem": {
              "confidence": "rule",
              "evidence": [
                "default: no filesystem signals"
              ],
              "status": "not-detected"
            },
            "lifecycleScripts": {
              "confidence": "rule",
              "evidence": [
                "default: scripts disabled by forge add"
              ],
              "status": "not-detected"
            },
            "nativeAddon": {
              "confidence": "rule",
              "evidence": [
                "default: no native addon signals"
              ],
              "status": "not-detected"
            },
            "network": {
              "confidence": "rule",
              "evidence": [
                "default: no network signals"
              ],
              "status": "not-detected"
            },
            "process": {
              "confidence": "rule",
              "evidence": [
                "default: no process signals"
              ],
              "status": "not-detected"
            },
            "secrets": []
          },
          "compatible": [
            "shared",
            "client",
            "server",
            "query",
            "liveQuery",
            "command",
            "action",
            "workflow",
            "endpoint",
            "edge",
            "test",
            "build"
          ],
          "entrypoint": ".",
          "exportName": "StringSchema",
          "incompatible": [],
          "packageName": "zod"
        },
        {
          "alias": "zod",
          "capabilities": {
            "filesystem": {
              "confidence": "rule",
              "evidence": [
                "default: no filesystem signals"
              ],
              "status": "not-detected"
            },
            "lifecycleScripts": {
              "confidence": "rule",
              "evidence": [
                "default: scripts disabled by forge add"
              ],
              "status": "not-detected"
            },
            "nativeAddon": {
              "confidence": "rule",
              "evidence": [
                "default: no native addon signals"
              ],
              "status": "not-detected"
            },
            "network": {
              "confidence": "rule",
              "evidence": [
                "default: no network signals"
              ],
              "status": "not-detected"
            },
            "process": {
              "confidence": "rule",
              "evidence": [
                "default: no process signals"
              ],
              "status": "not-detected"
            },
            "secrets": []
          },
          "compatible": [
            "shared",
            "client",
            "server",
            "query",
            "liveQuery",
            "command",
            "action",
            "workflow",
            "endpoint",
            "edge",
            "test",
            "build"
          ],
          "entrypoint": ".",
          "exportName": "parse",
          "incompatible": [],
          "packageName": "zod"
        },
        {
          "alias": "zod",
          "capabilities": {
            "filesystem": {
              "confidence": "rule",
              "evidence": [
                "default: no filesystem signals"
              ],
              "status": "not-detected"
            },
            "lifecycleScripts": {
              "confidence": "rule",
              "evidence": [
                "default: scripts disabled by forge add"
              ],
              "status": "not-detected"
            },
            "nativeAddon": {
              "confidence": "rule",
              "evidence": [
                "default: no native addon signals"
              ],
              "status": "not-detected"
            },
            "network": {
              "confidence": "rule",
              "evidence": [
                "default: no network signals"
              ],
              "status": "not-detected"
            },
            "process": {
              "confidence": "rule",
              "evidence": [
                "default: no process signals"
              ],
              "status": "not-detected"
            },
            "secrets": []
          },
          "compatible": [
            "shared",
            "client",
            "server",
            "query",
            "liveQuery",
            "command",
            "action",
            "workflow",
            "endpoint",
            "edge",
            "test",
            "build"
          ],
          "entrypoint": ".",
          "exportName": "string",
          "incompatible": [],
          "packageName": "zod"
        },
        {
          "alias": "zod",
          "capabilities": {
            "filesystem": {
              "confidence": "rule",
              "evidence": [
                "default: no filesystem signals"
              ],
              "status": "not-detected"
            },
            "lifecycleScripts": {
              "confidence": "rule",
              "evidence": [
                "default: scripts disabled by forge add"
              ],
              "status": "not-detected"
            },
            "nativeAddon": {
              "confidence": "rule",
              "evidence": [
                "default: no native addon signals"
              ],
              "status": "not-detected"
            },
            "network": {
              "confidence": "rule",
              "evidence": [
                "default: no network signals"
              ],
              "status": "not-detected"
            },
            "process": {
              "confidence": "rule",
              "evidence": [
                "default: no process signals"
              ],
              "status": "not-detected"
            },
            "secrets": []
          },
          "compatible": [
            "shared",
            "client",
            "server",
            "query",
            "liveQuery",
            "command",
            "action",
            "workflow",
            "endpoint",
            "edge",
            "test",
            "build"
          ],
          "entrypoint": ".",
          "exportName": "z",
          "incompatible": [],
          "packageName": "zod"
        }
      ],
      "rationale": {
        "action": "allowed by integration recipe",
        "build": "allowed by integration recipe",
        "client": "allowed by integration recipe",
        "command": "allowed by integration recipe",
        "edge": "allowed by integration recipe",
        "endpoint": "allowed by integration recipe",
        "liveQuery": "allowed by integration recipe",
        "query": "allowed by integration recipe",
        "server": "allowed by integration recipe",
        "shared": "allowed by integration recipe",
        "test": "allowed by integration recipe",
        "workflow": "allowed by integration recipe"
      }
    }
  ],
  "schemaVersion": "1"
} as const;
