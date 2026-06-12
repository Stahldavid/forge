// @forge-generated generator=0.0.0 input=189335882cdc93cf4367de9ce956c1651e737cb3477bea96e54267a702e352bc content=acef47ef79ecaba45cafdc1745c1f1703863ad49a27ff4be8fd2e2c0ed593e10
export const agentContract = {
  "actions": [],
  "ai": {
    "generations": [],
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
    "requiresTenant": false
  },
  "client": {
    "commands": [],
    "liveQueries": [],
    "queries": [],
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
  "commands": [],
  "commandsToRun": {
    "afterEditing": [
      "forge generate",
      "forge check",
      "forge verify --strict"
    ],
    "beforeEditing": [
      "forge dev --once --json",
      "forge inspect all --json",
      "forge check --json"
    ],
    "dev": [
      "forge dev --once --json",
      "forge dev --db pglite --worker --telemetry local --mock-ai"
    ]
  },
  "data": {
    "tables": []
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
    "components": [],
    "diagnostics": [],
    "framework": "none",
    "present": false,
    "providers": [],
    "routes": [],
    "runtimeEndpoints": [],
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
      "alias": "ai-gateway",
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "test",
        "build"
      ],
      "deniedContexts": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command",
        "edge"
      ],
      "packages": [
        "ai"
      ],
      "secrets": [
        "AI_GATEWAY_API_KEY"
      ]
    },
    {
      "alias": "ai-provider-anthropic",
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "test",
        "build"
      ],
      "deniedContexts": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command",
        "edge"
      ],
      "packages": [
        "@ai-sdk/anthropic"
      ],
      "secrets": [
        "ANTHROPIC_API_KEY"
      ]
    },
    {
      "alias": "ai-provider-openai",
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "test",
        "build"
      ],
      "deniedContexts": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command",
        "edge"
      ],
      "packages": [
        "@ai-sdk/openai"
      ],
      "secrets": [
        "OPENAI_API_KEY"
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
  "liveQueries": [],
  "packages": [
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "test",
        "build"
      ],
      "deniedContexts": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command",
        "edge"
      ],
      "name": "@ai-sdk/anthropic",
      "version": "2.0.81"
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
      "deniedContexts": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command",
        "edge"
      ],
      "name": "@ai-sdk/openai",
      "version": "2.0.106"
    },
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "edge",
        "test",
        "build"
      ],
      "deniedContexts": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command"
      ],
      "name": "@electric-sql/pglite",
      "version": "0.2.17"
    },
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "edge",
        "test",
        "build"
      ],
      "deniedContexts": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command"
      ],
      "name": "@types/bun",
      "version": "1.3.14"
    },
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "edge",
        "test",
        "build"
      ],
      "deniedContexts": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command"
      ],
      "name": "@types/react",
      "version": "19.2.17"
    },
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "edge",
        "test",
        "build"
      ],
      "deniedContexts": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command"
      ],
      "name": "@types/react-test-renderer",
      "version": "19.1.0"
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
      "deniedContexts": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command",
        "edge"
      ],
      "name": "ai",
      "version": "5.0.197"
    },
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "edge",
        "test",
        "build"
      ],
      "deniedContexts": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command"
      ],
      "name": "fast-check",
      "version": "3.23.2"
    },
    {
      "allowedContexts": [
        "client",
        "server",
        "action",
        "workflow",
        "endpoint",
        "edge",
        "test",
        "build"
      ],
      "deniedContexts": [
        "shared",
        "query",
        "liveQuery",
        "command"
      ],
      "name": "jose",
      "version": "6.2.3"
    },
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "edge",
        "test",
        "build"
      ],
      "deniedContexts": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command"
      ],
      "name": "react",
      "version": "19.2.7"
    },
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "edge",
        "test",
        "build"
      ],
      "deniedContexts": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command"
      ],
      "name": "react-test-renderer",
      "version": "19.2.7"
    },
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "edge",
        "test",
        "build"
      ],
      "deniedContexts": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command"
      ],
      "name": "tree-sitter",
      "version": "0.22.4"
    },
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "edge",
        "test",
        "build"
      ],
      "deniedContexts": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command"
      ],
      "name": "tree-sitter-typescript",
      "version": "0.23.2"
    },
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "edge",
        "test",
        "build"
      ],
      "deniedContexts": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command"
      ],
      "name": "typescript",
      "version": "5.9.3"
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
      "version": "3.25.76"
    }
  ],
  "playbooks": [
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
        "Run forge dev --once --json for a one-shot diagnostic cycle.",
        "Run forge dev --db pglite --worker --telemetry local --mock-ai.",
        "When a web app exists, forge dev starts the API runtime and the web dev server together.",
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
  "policies": [],
  "project": {
    "name": "forge",
    "type": "forgeos-app"
  },
  "queries": [],
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
      "integration": "ai-gateway",
      "name": "AI_GATEWAY_API_KEY",
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
      "integration": "ai-provider-anthropic",
      "name": "ANTHROPIC_API_KEY",
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
      "integration": "ai-provider-openai",
      "name": "OPENAI_API_KEY",
      "public": false,
      "required": true
    }
  ],
  "telemetry": {
    "events": [],
    "sinks": [
      "local"
    ]
  },
  "workflows": []
} as const;
