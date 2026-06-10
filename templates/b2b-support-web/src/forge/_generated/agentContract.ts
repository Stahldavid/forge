// @forge-generated generator=0.0.0 input=219ea7f374e4f290890f7b468c21647187b05b8d10e11eb30d0b5207309cc615 content=465b10125746acab63d141a0687c11ad4370e8cdea4172ec22b9ed72075b60ea
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
      "file": "src/actions/captureTicketCreated.ts",
      "forbiddenCapabilities": [],
      "name": "captureTicketCreated"
    }
  ],
  "ai": {
    "generations": [
      {
        "file": "src/workflows/triageTicketWorkflow.ts",
        "method": "generateText",
        "model": "mock",
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
  "client": {
    "commands": [
      "closeTicket",
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
      "file": "src/commands/closeTicket.ts",
      "forbiddenCapabilities": [],
      "name": "closeTicket",
      "policy": "tickets.close",
      "tablesWritten": []
    },
    {
      "allowedPackages": [
        "forge"
      ],
      "emits": [],
      "file": "src/commands/createTicket.ts",
      "forbiddenCapabilities": [],
      "name": "createTicket",
      "policy": "tickets.create",
      "tablesWritten": []
    },
    {
      "allowedPackages": [
        "forge"
      ],
      "emits": [],
      "file": "src/commands/manageBilling.ts",
      "forbiddenCapabilities": [],
      "name": "manageBilling",
      "policy": "billing.manage",
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
      "forge inspect all --json",
      "forge check --json"
    ],
    "dev": [
      "forge dev --db pglite --worker --telemetry local --mock-ai"
    ]
  },
  "data": {
    "tables": [
      {
        "fields": [
          "createdAt",
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
          "severity",
          "status",
          "tenantId",
          "title",
          "triageSummary",
          "updatedAt"
        ],
        "file": "src/forge/schema.ts",
        "name": "tickets",
        "tenantField": "tenant_id",
        "tenantScoped": true
      },
      {
        "fields": [
          "createdAt",
          "email",
          "id",
          "role",
          "tenantId"
        ],
        "file": "src/forge/schema.ts",
        "name": "users",
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
  "generatorVersion": "0.0.0",
  "integrations": [],
  "liveQueries": [
    {
      "allowedPackages": [
        "forge"
      ],
      "dependencies": [
        {
          "scope": "tenant",
          "table": "tickets"
        },
        {
          "scope": "tenant",
          "table": "users"
        }
      ],
      "file": "src/queries/liveTickets.ts",
      "forbiddenCapabilities": [],
      "name": "liveTickets",
      "policy": "tickets.read"
    }
  ],
  "packages": [],
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
        "Use forge add <alias>.",
        "Do not install packages manually unless the architecture exception is intentional.",
        "Run forge generate.",
        "Run forge check."
      ],
      "title": "Add a package"
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
        "Run forge dev --db pglite --worker --telemetry local --mock-ai.",
        "Use generated client and React hooks from src/forge/_generated."
      ],
      "title": "Run dev"
    },
    {
      "steps": [
        "Run forge self-host compose.",
        "Review deploy/.env.example.",
        "Run forge self-host check."
      ],
      "title": "Self-host"
    }
  ],
  "policies": [
    {
      "file": "src/policies.ts",
      "kind": "roles",
      "name": "billing.manage",
      "roles": [
        "owner"
      ]
    },
    {
      "file": "src/policies.ts",
      "kind": "roles",
      "name": "tickets.close",
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
    },
    {
      "file": "src/policies.ts",
      "kind": "roles",
      "name": "tickets.update",
      "roles": [
        "admin",
        "owner"
      ]
    }
  ],
  "project": {
    "name": "__FORGE_APP_NAME__",
    "type": "forgeos-app"
  },
  "queries": [
    {
      "allowedPackages": [
        "forge"
      ],
      "file": "src/queries/getTicket.ts",
      "forbiddenCapabilities": [],
      "name": "getTicket",
      "policy": "tickets.read",
      "readOnly": true,
      "tenantScoped": true
    },
    {
      "allowedPackages": [
        "forge"
      ],
      "file": "src/queries/listTickets.ts",
      "forbiddenCapabilities": [],
      "name": "listTickets",
      "policy": "tickets.read",
      "readOnly": true,
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
  "secrets": [],
  "telemetry": {
    "events": [
      "ticket_created",
      "ticket_created_action_processed",
      "ticket_triaged"
    ],
    "sinks": [
      "local"
    ]
  },
  "workflows": [
    {
      "file": "src/workflows/triageTicketWorkflow.ts",
      "name": "triageTicketWorkflow",
      "steps": [
        "loadTicket",
        "triageWithAI",
        "saveTriage",
        "captureTriageTelemetry"
      ],
      "trigger": "ticket.created"
    }
  ]
} as const;
