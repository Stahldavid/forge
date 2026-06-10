import type { FeatureBlueprint } from "./types.ts";

export const FEATURE_EXAMPLES: Record<string, FeatureBlueprint> = {
  invoices: {
    schemaVersion: "0.1.0",
    name: "invoices",
    description: "Add invoices resource with CRUD, live list and React page.",
    mode: "create",
    resources: [
      {
        name: "invoices",
        tenantScoped: true,
        fields: [
          { name: "amount", type: "number", required: true },
          {
            name: "status",
            type: "enum",
            values: ["draft", "paid", "void"],
            default: "draft",
            indexed: true,
          },
          { name: "dueDate", type: "timestamp", optional: true },
        ],
        policies: {
          read: ["owner", "admin", "member"],
          create: ["owner", "admin"],
          update: ["owner", "admin"],
          delete: ["owner"],
        },
        crud: true,
        liveQuery: true,
        react: true,
        frontend: {
          react: true,
          page: "/invoices",
          components: ["list", "createForm"],
        },
        tests: true,
      },
    ],
  },
  "ticket-priority": {
    schemaVersion: "0.1.0",
    name: "ticket-priority",
    description: "Add priority field, update command, liveQuery and badge component.",
    mode: "modify",
    changes: [
      {
        kind: "addField",
        table: "tickets",
        field: {
          name: "priority",
          type: "enum",
          values: ["low", "medium", "high"],
          default: "medium",
          indexed: true,
        },
      },
      {
        kind: "addCommand",
        name: "updateTicketPriority",
        table: "tickets",
        policy: "tickets.update",
        emits: "ticket.priorityUpdated",
      },
      {
        kind: "addLiveQuery",
        name: "liveTicketsByPriority",
        table: "tickets",
        policy: "tickets.read",
      },
      {
        kind: "addComponent",
        name: "PriorityBadge",
        table: "tickets",
        fields: ["priority"],
      },
    ],
  },
  "customer-notes": {
    schemaVersion: "0.1.0",
    name: "customer-notes",
    description: "Add customer notes resource for support context.",
    mode: "create",
    resources: [
      {
        name: "customerNotes",
        tenantScoped: true,
        fields: [
          { name: "customerId", type: "ref", refTable: "customers", required: true },
          { name: "body", type: "text", required: true },
          { name: "visibility", type: "enum", values: ["internal", "shared"], default: "internal" },
        ],
        crud: true,
        liveQuery: true,
        react: false,
        tests: true,
      },
    ],
  },
  "support-sla": {
    schemaVersion: "0.1.0",
    name: "support-sla",
    description: "Add SLA policy data for support tickets.",
    mode: "modify",
    changes: [
      {
        kind: "addField",
        table: "tickets",
        field: { name: "slaDueAt", type: "timestamp", optional: true, indexed: true },
      },
      {
        kind: "addField",
        table: "tickets",
        field: {
          name: "slaStatus",
          type: "enum",
          values: ["on_track", "at_risk", "breached"],
          default: "on_track",
          indexed: true,
        },
      },
    ],
  },
};
