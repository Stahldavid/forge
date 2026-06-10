// @forge-generated generator=0.0.0 input=dbed69e6d72dbc70c4da980e189c370546d6773f069f0b210a3b192dab421887 content=b96368f619c35efb9aac917d7221700851827a2dba8bb35368e6bcd2d4f54bf2
export const sqlPlan = {
  "checksum": "b6564fb46c4c389d9e7d23948cc6dcaca657a75ef3faf19a333910eda21e600c",
  "indexes": [
    {
      "index": {
        "columns": [
          "tenant_id"
        ],
        "name": "idx_tickets_tenant_id",
        "table": "tickets"
      },
      "kind": "create_index",
      "sql": "CREATE INDEX IF NOT EXISTS \"idx_tickets_tenant_id\" ON \"tickets\" (\"tenant_id\")",
      "table": "tickets"
    }
  ],
  "migrationId": "migration_b6564fb46c4c389d",
  "schemaVersion": "1.0.0",
  "systemTables": [
    {
      "kind": "create_table",
      "sql": "CREATE TABLE IF NOT EXISTS _forge_migrations (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
      "table": "_forge_migrations"
    },
    {
      "kind": "create_table",
      "sql": "CREATE TABLE IF NOT EXISTS _forge_outbox (id bigserial PRIMARY KEY, event_type text NOT NULL, payload jsonb NOT NULL, auth_context jsonb, created_at timestamptz NOT NULL DEFAULT now())",
      "table": "_forge_outbox"
    },
    {
      "kind": "create_table",
      "sql": "CREATE TABLE IF NOT EXISTS _forge_outbox_deliveries (id bigserial PRIMARY KEY, outbox_id bigint NOT NULL REFERENCES _forge_outbox(id), action_name text NOT NULL, status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5, next_attempt_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz, locked_by text, last_error text, processed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(outbox_id, action_name))",
      "table": "_forge_outbox_deliveries"
    },
    {
      "kind": "create_table",
      "sql": "CREATE TABLE IF NOT EXISTS _forge_workflow_runs (id bigserial PRIMARY KEY, workflow_name text NOT NULL, trigger_type text NOT NULL, trigger_outbox_id bigint, idempotency_key text NOT NULL UNIQUE, input jsonb NOT NULL, auth_context jsonb, status text NOT NULL DEFAULT 'pending', current_step text, last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, completed_at timestamptz, canceled_at timestamptz)",
      "table": "_forge_workflow_runs"
    },
    {
      "kind": "create_table",
      "sql": "CREATE TABLE IF NOT EXISTS _forge_workflow_steps (id bigserial PRIMARY KEY, run_id bigint NOT NULL REFERENCES _forge_workflow_runs(id), step_name text NOT NULL, step_index integer NOT NULL, status text NOT NULL DEFAULT 'pending', input jsonb, output jsonb, attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5, next_attempt_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz, locked_by text, last_error text, started_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id, step_name))",
      "table": "_forge_workflow_steps"
    },
    {
      "kind": "create_table",
      "sql": "CREATE TABLE IF NOT EXISTS _forge_telemetry_events (id bigserial PRIMARY KEY, trace_id text NOT NULL, event_type text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending', sink text, attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5, next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text, created_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz)",
      "table": "_forge_telemetry_events"
    },
    {
      "kind": "create_table",
      "sql": "CREATE TABLE IF NOT EXISTS _forge_trace_spans (id bigserial PRIMARY KEY, trace_id text NOT NULL, parent_span_id text, span_id text NOT NULL, name text NOT NULL, kind text NOT NULL, attributes jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'ok', started_at timestamptz NOT NULL, ended_at timestamptz, error text)",
      "table": "_forge_trace_spans"
    }
  ],
  "tables": [
    {
      "columns": [
        {
          "defaultExpr": "gen_random_uuid()",
          "name": "id",
          "nullable": false,
          "primaryKey": true,
          "sqlType": "uuid"
        }
      ],
      "kind": "create_table",
      "sql": "CREATE TABLE IF NOT EXISTS \"tenants\" (\"id\" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY)",
      "table": "tenants"
    },
    {
      "columns": [
        {
          "defaultExpr": "now()",
          "name": "created_at",
          "nullable": false,
          "primaryKey": false,
          "sqlType": "timestamptz"
        },
        {
          "defaultExpr": "gen_random_uuid()",
          "name": "id",
          "nullable": false,
          "primaryKey": true,
          "sqlType": "uuid"
        },
        {
          "checkConstraint": "\"status\" IN ('open', 'pending', 'closed')",
          "name": "status",
          "nullable": false,
          "primaryKey": false,
          "sqlType": "text"
        },
        {
          "name": "tenant_id",
          "nullable": false,
          "primaryKey": false,
          "references": {
            "column": "id",
            "table": "tenants"
          },
          "sqlType": "uuid"
        },
        {
          "name": "title",
          "nullable": false,
          "primaryKey": false,
          "sqlType": "text"
        }
      ],
      "kind": "create_table",
      "sql": "CREATE TABLE IF NOT EXISTS \"tickets\" (\"created_at\" timestamptz NOT NULL DEFAULT now(), \"id\" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, \"status\" text NOT NULL CHECK (\"status\" IN ('open', 'pending', 'closed')), \"tenant_id\" uuid NOT NULL REFERENCES \"tenants\" (\"id\"), \"title\" text NOT NULL)",
      "table": "tickets"
    }
  ]
} as const;
