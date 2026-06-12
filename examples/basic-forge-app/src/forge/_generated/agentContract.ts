// @forge-generated generator=0.0.0 input=546500a6b3678160b7670bd4f0428cd9913860cf4a90429c9bd9563aa38bc60f content=082e6a1652475c1de1ff3422c17fcd3988979f7b53d770f0d42e1cb59c6b0822
export const agentContract = {
  "actions": [
    {
      "allowedCapabilities": [
        "network",
        "secrets",
        "ai",
        "db"
      ],
      "allowedPackages": [
        "forge"
      ],
      "file": "src/actions/capturePosthog.ts",
      "forbiddenCapabilities": [],
      "frontend": {
        "components": [],
        "hook": "no generated React hook; invoke from server/action code",
        "routes": []
      },
      "http": {
        "exampleBody": {
          "args": {}
        },
        "method": "POST",
        "path": "/actions/capturePosthog"
      },
      "name": "capturePosthog"
    },
    {
      "allowedCapabilities": [
        "network",
        "secrets",
        "ai",
        "db"
      ],
      "allowedPackages": [
        "forge"
      ],
      "file": "src/actions/captureTicketCreated.ts",
      "forbiddenCapabilities": [],
      "frontend": {
        "components": [],
        "hook": "no generated React hook; invoke from server/action code",
        "routes": []
      },
      "http": {
        "exampleBody": {
          "args": {}
        },
        "method": "POST",
        "path": "/actions/captureTicketCreated"
      },
      "name": "captureTicketCreated"
    },
    {
      "allowedCapabilities": [
        "network",
        "secrets",
        "ai",
        "db"
      ],
      "allowedPackages": [
        "forge"
      ],
      "file": "src/actions/createCheckout.ts",
      "forbiddenCapabilities": [],
      "frontend": {
        "components": [],
        "hook": "no generated React hook; invoke from server/action code",
        "routes": []
      },
      "http": {
        "exampleBody": {
          "args": {}
        },
        "method": "POST",
        "path": "/actions/createCheckout"
      },
      "name": "createCheckout"
    }
  ],
  "ai": {
    "generations": [
      {
        "file": "src/workflows/triageTicketWorkflow.ts",
        "method": "generateText",
        "model": "gpt-4o-mini",
        "provider": "openai",
        "purpose": "ticket_triage"
      }
    ],
    "providers": [
      "anthropic",
      "gateway",
      "openai"
    ]
  },
  "auth": {
    "bearerTokenHeader": "Authorization",
    "claims": {
      "email": "email",
      "name": "name",
      "permissions": "permissions",
      "role": "role",
      "roles": "roles",
      "tenantId": "tenant_id",
      "userId": "sub"
    },
    "defaultMode": "dev-headers",
    "env": {
      "algorithms": "FORGE_AUTH_ALGORITHMS",
      "audience": "FORGE_AUTH_AUDIENCE",
      "issuer": "FORGE_AUTH_ISSUER",
      "jwksUri": "FORGE_AUTH_JWKS_URI",
      "mode": "FORGE_AUTH_MODE"
    },
    "modes": [
      "dev-headers",
      "jwt",
      "oidc",
      "disabled"
    ],
    "productionDefaultAllowed": false,
    "requiresTenant": true
  },
  "client": {
    "commands": [
      "badStripeCommand",
      "createTicket",
      "manageBilling"
    ],
    "liveQueries": [
      "liveTickets"
    ],
    "queries": [
      "getTicket",
      "listTickets"
    ],
    "reactHooks": [
      "ForgeProvider",
      "useForgeClient",
      "useAuth",
      "useQuery",
      "useCommand",
      "useLiveQuery"
    ],
    "transport": {
      "commands": "POST /commands/:name",
      "liveQueries": "GET /live/:name",
      "queries": "POST /queries/:name"
    }
  },
  "commands": [
    {
      "allowedPackages": [
        "forge"
      ],
      "emits": [],
      "file": "src/commands/badStripeCommand.ts",
      "forbiddenCapabilities": [
        "network",
        "secrets"
      ],
      "frontend": {
        "components": [],
        "hook": "useCommand(api.commands.badStripeCommand)",
        "routes": []
      },
      "http": {
        "exampleBody": {
          "args": {}
        },
        "method": "POST",
        "path": "/commands/badStripeCommand"
      },
      "name": "badStripeCommand",
      "policy": "public",
      "tablesRead": [],
      "tablesWritten": []
    },
    {
      "allowedPackages": [
        "forge",
        "zod"
      ],
      "emits": [
        "ticket.created"
      ],
      "file": "src/commands/createTicket.ts",
      "forbiddenCapabilities": [
        "network",
        "secrets"
      ],
      "frontend": {
        "components": [],
        "hook": "useCommand(api.commands.createTicket)",
        "routes": []
      },
      "http": {
        "exampleBody": {
          "args": {}
        },
        "method": "POST",
        "path": "/commands/createTicket"
      },
      "name": "createTicket",
      "policy": "tickets.create",
      "tablesRead": [],
      "tablesWritten": [
        "tickets"
      ]
    },
    {
      "allowedPackages": [
        "forge"
      ],
      "emits": [],
      "file": "src/commands/manageBilling.ts",
      "forbiddenCapabilities": [
        "network",
        "secrets"
      ],
      "frontend": {
        "components": [],
        "hook": "useCommand(api.commands.manageBilling)",
        "routes": []
      },
      "http": {
        "exampleBody": {
          "args": {}
        },
        "method": "POST",
        "path": "/commands/manageBilling"
      },
      "name": "manageBilling",
      "policy": "billing.manage",
      "tablesRead": [],
      "tablesWritten": []
    }
  ],
  "commandsToRun": {
    "afterEditing": [
      "forge generate",
      "forge check",
      "forge verify --strict"
    ],
    "beforeEditing": [
      "forge do inspect --json",
      "forge dev --once --json",
      "forge inspect all --json",
      "forge check --json"
    ],
    "dev": [
      "forge dev",
      "forge dev --once --json",
      "forge do fix --json",
      "forge do verify --json",
      "forge dev --api-only",
      "forge dev --web-only"
    ]
  },
  "data": {
    "tables": [
      {
        "fields": [
          "id"
        ],
        "file": "src/forge/schema.ts",
        "name": "tenants",
        "tenantScoped": false
      },
      {
        "fields": [
          "createdAt",
          "id",
          "status",
          "tenantId",
          "title"
        ],
        "file": "src/forge/schema.ts",
        "name": "tickets",
        "tenantField": "tenant_id",
        "tenantScoped": true
      }
    ]
  },
  "deploy": {
    "files": [
      "deploy/docker-compose.yml",
      "deploy/.env.example",
      "deploy/deployManifest.json"
    ],
    "selfHost": true
  },
  "frontend": {
    "bridgeFiles": [],
    "clientBindings": [],
    "componentBindings": [],
    "components": [],
    "diagnostics": [],
    "framework": "none",
    "present": false,
    "providers": [],
    "routeBindings": [],
    "routes": [],
    "runtimeEndpoints": [
      {
        "frontend": {
          "components": [],
          "hook": "useCommand(api.commands.badStripeCommand)",
          "routes": []
        },
        "http": {
          "exampleBody": {
            "args": {}
          },
          "method": "POST",
          "path": "/commands/badStripeCommand"
        },
        "kind": "command",
        "name": "badStripeCommand"
      },
      {
        "frontend": {
          "components": [],
          "hook": "useCommand(api.commands.createTicket)",
          "routes": []
        },
        "http": {
          "exampleBody": {
            "args": {}
          },
          "method": "POST",
          "path": "/commands/createTicket"
        },
        "kind": "command",
        "name": "createTicket"
      },
      {
        "frontend": {
          "components": [],
          "hook": "useCommand(api.commands.manageBilling)",
          "routes": []
        },
        "http": {
          "exampleBody": {
            "args": {}
          },
          "method": "POST",
          "path": "/commands/manageBilling"
        },
        "kind": "command",
        "name": "manageBilling"
      },
      {
        "frontend": {
          "components": [],
          "hook": "useLiveQuery(api.liveQueries.liveTickets, args)",
          "routes": []
        },
        "http": {
          "exampleUrl": "/live/liveTickets?args={}",
          "method": "GET",
          "path": "/live/liveTickets"
        },
        "kind": "liveQuery",
        "name": "liveTickets"
      },
      {
        "frontend": {
          "components": [],
          "hook": "useQuery(api.queries.getTicket, args)",
          "routes": []
        },
        "http": {
          "exampleBody": {
            "args": {}
          },
          "method": "POST",
          "path": "/queries/getTicket"
        },
        "kind": "query",
        "name": "getTicket"
      },
      {
        "frontend": {
          "components": [],
          "hook": "useQuery(api.queries.listTickets, args)",
          "routes": []
        },
        "http": {
          "exampleBody": {
            "args": {}
          },
          "method": "POST",
          "path": "/queries/listTickets"
        },
        "kind": "query",
        "name": "listTickets"
      }
    ],
    "webManifest": {
      "bridge": {
        "files": [],
        "valid": false
      },
      "env": {
        "apiUrl": "NEXT_PUBLIC_FORGE_URL"
      },
      "framework": "none",
      "present": false,
      "scripts": {},
      "urls": {
        "api": "http://127.0.0.1:3765"
      }
    }
  },
  "generatorVersion": "0.0.0",
  "integrations": [
    {
      "alias": "posthog",
      "allowedContexts": [
        "client",
        "server",
        "action",
        "workflow",
        "endpoint"
      ],
      "deniedContexts": [
        "query",
        "liveQuery",
        "command"
      ],
      "packages": [
        "posthog-js",
        "posthog-node"
      ],
      "secrets": [
        "NEXT_PUBLIC_POSTHOG_KEY",
        "POSTHOG_HOST",
        "POSTHOG_KEY"
      ]
    },
    {
      "alias": "stripe",
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint"
      ],
      "deniedContexts": [
        "client",
        "shared",
        "query",
        "liveQuery",
        "command"
      ],
      "packages": [
        "stripe"
      ],
      "secrets": [
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET"
      ]
    },
    {
      "alias": "zod",
      "allowedContexts": [
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
      "deniedContexts": [],
      "packages": [
        "zod"
      ],
      "secrets": []
    }
  ],
  "liveQueries": [
    {
      "allowedPackages": [
        "forge"
      ],
      "dependencies": [
        {
          "scope": "tenant",
          "table": "tickets"
        }
      ],
      "file": "src/queries/liveTickets.ts",
      "forbiddenCapabilities": [
        "network",
        "secrets"
      ],
      "frontend": {
        "components": [],
        "hook": "useLiveQuery(api.liveQueries.liveTickets, args)",
        "routes": []
      },
      "http": {
        "exampleUrl": "/live/liveTickets?args={}",
        "method": "GET",
        "path": "/live/liveTickets"
      },
      "name": "liveTickets",
      "policy": "tickets.read",
      "tablesRead": [
        "tickets"
      ]
    }
  ],
  "packages": [
    {
      "allowedContexts": [
        "shared",
        "client",
        "test",
        "build"
      ],
      "deniedContexts": [
        "server",
        "query",
        "liveQuery",
        "command",
        "action",
        "workflow",
        "endpoint",
        "edge"
      ],
      "name": "posthog-js",
      "version": "1.200.0"
    },
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint"
      ],
      "deniedContexts": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command",
        "edge",
        "test",
        "build"
      ],
      "name": "posthog-node",
      "version": "4.0.0"
    },
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint"
      ],
      "deniedContexts": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command",
        "edge",
        "test",
        "build"
      ],
      "name": "stripe",
      "version": "17.0.0"
    },
    {
      "allowedContexts": [
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
      "deniedContexts": [],
      "name": "zod",
      "version": "3.24.0"
    }
  ],
  "playbooks": [
    {
      "steps": [
        "Run forge do \"<objective>\" --json when the next command is not obvious.",
        "Use forge do fix --json for failures, forge do verify --json before handoff, and forge do connect-ui --json for frontend wiring.",
        "Follow the returned plan, filesToInspect, risks, and nextAction before using lower-level commands directly."
      ],
      "title": "Choose the right workflow"
    },
    {
      "steps": [
        "Add a file under src/commands.",
        "Declare auth with can(\"policy.name\") unless intentionally public/system.",
        "Use ctx.db for transactional writes.",
        "Use ctx.emit for side effects.",
        "Run forge generate.",
        "Run forge verify --strict."
      ],
      "title": "Add a command"
    },
    {
      "steps": [
        "Add a file under src/queries.",
        "Keep it read-only.",
        "Declare auth explicitly.",
        "Run forge generate.",
        "Run forge check."
      ],
      "title": "Add a query"
    },
    {
      "steps": [
        "Add a liveQuery under src/queries.",
        "Keep it read-only and tenant-scoped when reading tenant tables.",
        "Run forge generate.",
        "Use forge inspect client --json to confirm client exposure."
      ],
      "title": "Add a liveQuery"
    },
    {
      "steps": [
        "Run forge live status --json.",
        "Run forge live invalidations list --json and confirm the table and tenant changed.",
        "Run forge live debug <subscriptionId> --json when a subscription id is available.",
        "Check that _forge_live_invalidations has revisions newer than the last sent snapshot.",
        "Reconnect with Last-Event-ID or ?lastRevision=<revision> to verify resume behavior."
      ],
      "title": "Debug a stale liveQuery"
    },
    {
      "steps": [
        "Edit src/forge/schema.ts.",
        "Include tenantId for tenant-scoped data.",
        "Run forge generate.",
        "Run forge db diff.",
        "Run forge verify --strict."
      ],
      "title": "Add a table"
    },
    {
      "steps": [
        "Run forge make resource <name> --fields name:type,status:enum(open,closed) --dry-run --json.",
        "Review the plan and diagnostics.",
        "Run forge make resource <name> --fields name:type --with-ui --yes when the resource should be visible in the web app.",
        "Run forge generate.",
        "Run forge verify --strict."
      ],
      "title": "Scaffold a resource"
    },
    {
      "steps": [
        "Write a JSON blueprint under .forge/blueprints.",
        "Run forge feature validate <blueprint> --json.",
        "Run forge feature plan <blueprint>.",
        "Review the plan, impact, and risk.",
        "Run forge feature apply <blueprint> --yes.",
        "Run forge verify --strict."
      ],
      "title": "Apply a feature blueprint"
    },
    {
      "steps": [
        "Run forge refactor rename field <table.field> <table.field> --dry-run --json.",
        "Review filesToModify, migrationPlan, diagnostics, and risk.",
        "Use --allow-high-risk only for intentional high-risk refactors.",
        "Apply with forge refactor rename field <table.field> <table.field> --yes.",
        "Run forge generate.",
        "Run forge verify --strict."
      ],
      "title": "Safely refactor a feature"
    },
    {
      "steps": [
        "Run forge impact --changed --json.",
        "Run forge test plan --changed --json.",
        "Run forge test run --changed --json for targeted checks.",
        "Use forge verify --changed for the fast impact gate.",
        "Run forge verify --strict before final handoff."
      ],
      "title": "Plan impact-based tests"
    },
    {
      "steps": [
        "Run forge test run --changed --json.",
        "Run forge repair diagnose --from-last-test-run --json.",
        "Review the failureKind, likelyCause, suggestedRepairs, and confidence.",
        "Apply only high-confidence repairs automatically.",
        "Run forge verify --changed.",
        "Run forge verify --strict before final handoff."
      ],
      "title": "Repair a failing check"
    },
    {
      "steps": [
        "Use forge add <alias>.",
        "Do not install packages manually unless the architecture exception is intentional.",
        "Run forge generate.",
        "Run forge check."
      ],
      "title": "Add a package"
    },
    {
      "steps": [
        "Run forge deps upgrade-plan <package> --to latest.",
        "Read .forge/upgrades/.../plan.md.",
        "If risk is high, inspect affected files and generated adapters before applying.",
        "Apply with forge deps upgrade-apply <plan>.",
        "Finish with forge verify --strict."
      ],
      "title": "Upgrade a package"
    },
    {
      "steps": [
        "Capture the traceId from the response or frontend.",
        "Run forge telemetry inspect <traceId>.",
        "Run forge policy simulate <policy> --role <role>."
      ],
      "title": "Debug a policy error"
    },
    {
      "steps": [
        "Run forge dev for the full local loop: generated checks, API runtime, web app, DB, worker, watch, and startup URLs.",
        "Run forge dev --once --json for a one-shot diagnostic cycle.",
        "Use --api-only, --web-only, --no-watch, or --no-worker only when narrowing the loop intentionally.",
        "When a web app exists, forge dev starts the API runtime and the web dev server together and prints both URLs.",
        "Use generated client and React hooks through web/lib/forge.ts."
      ],
      "title": "Run dev"
    },
    {
      "steps": [
        "Run forge make ui --framework vite --dry-run --json when the app does not have a web root.",
        "Use web/lib/forge.ts as the generated client bridge.",
        "Mount ForgeProvider once in the web app provider/layout layer; use devAuth for local development.",
        "Use useQuery, useCommand, and useLiveQuery instead of raw /commands or /queries fetches.",
        "Run forge generate so frontendGraph and agentContract include routes and bindings.",
        "Run forge inspect capability-map --json to confirm UI actions map to runtime capabilities.",
        "Run forge dev --once --json and forge doctor --json."
      ],
      "title": "Add or update frontend"
    },
    {
      "steps": [
        "Run forge self-host compose.",
        "Review deploy/.env.example.",
        "Run forge self-host check."
      ],
      "title": "Self-host"
    },
    {
      "steps": [
        "Run forge release inspect <releaseId> --json.",
        "Run forge release sourcemaps symbolicate --input stacktrace.json --json.",
        "Open the original source file and line from the symbolicated frame.",
        "Use forge telemetry inspect <traceId> --with-release --json when a trace id is available."
      ],
      "title": "Debug a production stack trace"
    }
  ],
  "policies": [
    {
      "file": "src/policies.ts",
      "kind": "roles",
      "name": "billing.manage",
      "roles": [
        "admin",
        "owner"
      ]
    },
    {
      "file": "src/policies.ts",
      "kind": "roles",
      "name": "tickets.create",
      "roles": [
        "admin",
        "member",
        "owner"
      ]
    },
    {
      "file": "src/policies.ts",
      "kind": "roles",
      "name": "tickets.read",
      "roles": [
        "admin",
        "member",
        "owner"
      ]
    }
  ],
  "project": {
    "name": "basic-forge-app",
    "type": "forgeos-app"
  },
  "queries": [
    {
      "allowedPackages": [
        "forge"
      ],
      "file": "src/queries/getTicket.ts",
      "forbiddenCapabilities": [
        "network",
        "secrets"
      ],
      "frontend": {
        "components": [],
        "hook": "useQuery(api.queries.getTicket, args)",
        "routes": []
      },
      "http": {
        "exampleBody": {
          "args": {}
        },
        "method": "POST",
        "path": "/queries/getTicket"
      },
      "name": "getTicket",
      "policy": "tickets.read",
      "readOnly": true,
      "tablesRead": [
        "tickets"
      ],
      "tenantScoped": true
    },
    {
      "allowedPackages": [
        "forge"
      ],
      "file": "src/queries/listTickets.ts",
      "forbiddenCapabilities": [
        "network",
        "secrets"
      ],
      "frontend": {
        "components": [],
        "hook": "useQuery(api.queries.listTickets, args)",
        "routes": []
      },
      "http": {
        "exampleBody": {
          "args": {}
        },
        "method": "POST",
        "path": "/queries/listTickets"
      },
      "name": "listTickets",
      "policy": "tickets.read",
      "readOnly": true,
      "tablesRead": [
        "tickets"
      ],
      "tenantScoped": true
    }
  ],
  "rules": [
    {
      "allowed": [
        "ctx.db writes",
        "ctx.emit",
        "ctx.telemetry buffered events"
      ],
      "context": "command",
      "forbidden": [
        "network packages",
        "ctx.secrets",
        "ctx.ai",
        "process.env",
        "filesystem access"
      ]
    },
    {
      "allowed": [
        "ctx.db reads",
        "ctx.telemetry buffered events"
      ],
      "context": "query",
      "forbidden": [
        "insert/update/delete",
        "ctx.emit",
        "ctx.secrets",
        "ctx.ai",
        "network integrations"
      ]
    },
    {
      "allowed": [
        "ctx.db reads",
        "tenant-scoped subscriptions"
      ],
      "context": "liveQuery",
      "forbidden": [
        "insert/update/delete",
        "ctx.emit",
        "ctx.secrets",
        "ctx.ai",
        "network integrations"
      ]
    },
    {
      "allowed": [
        "ctx.secrets",
        "integrations",
        "ctx.ai",
        "ctx.db reads/writes",
        "network packages"
      ],
      "context": "action",
      "forbidden": [
        "uncommitted transactional side effects"
      ]
    },
    {
      "allowed": [
        "durable steps",
        "ctx.secrets",
        "integrations",
        "ctx.ai",
        "retries"
      ],
      "context": "workflow",
      "forbidden": [
        "non-idempotent step behavior without guards"
      ]
    }
  ],
  "schemaVersion": "0.1.0",
  "secrets": [
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "test",
        "build"
      ],
      "integration": "posthog",
      "name": "POSTHOG_HOST",
      "public": false,
      "required": false
    },
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "test",
        "build"
      ],
      "integration": "posthog",
      "name": "POSTHOG_KEY",
      "public": false,
      "required": true
    },
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "test",
        "build"
      ],
      "integration": "stripe",
      "name": "STRIPE_SECRET_KEY",
      "public": false,
      "required": true
    },
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "test",
        "build"
      ],
      "integration": "stripe",
      "name": "STRIPE_WEBHOOK_SECRET",
      "public": false,
      "required": true
    }
  ],
  "telemetry": {
    "events": [
      "ticket_create_started",
      "ticket_created",
      "ticket_created_action",
      "workflow_ticket_triaged"
    ],
    "sinks": [
      "local",
      "posthog"
    ]
  },
  "workflows": [
    {
      "file": "src/workflows/triageTicketWorkflow.ts",
      "name": "triageTicketWorkflow",
      "steps": [
        "loadTicket",
        "triageWithAI",
        "captureTriageAnalytics"
      ],
      "trigger": "ticket.created"
    }
  ]
} as const;
