// @forge-generated generator=0.0.0 input=219ea7f374e4f290890f7b468c21647187b05b8d10e11eb30d0b5207309cc615 content=dd611c42132ed9e29c6f3100d23eded64287d6f20a09ce20a87e8cd21cb8cec8
export const sqlPlan = {
  "checksum": "ebfd05ef680bad8c10d6d698c94fd2d2d0c1cf010a846bf3a5ef2fdad9f60c5c",
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
    },
    {
      "index": {
        "columns": [
          "tenant_id"
        ],
        "name": "idx_users_tenant_id",
        "table": "users"
      },
      "kind": "create_index",
      "sql": "CREATE INDEX IF NOT EXISTS \"idx_users_tenant_id\" ON \"users\" (\"tenant_id\")",
      "table": "users"
    }
  ],
  "migrationId": "migration_ebfd05ef680bad8c",
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
        }
      ],
      "kind": "create_table",
      "sql": "CREATE TABLE IF NOT EXISTS \"tenants\" (\"created_at\" timestamptz NOT NULL DEFAULT now(), \"id\" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY)",
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
          "name": "severity",
          "nullable": false,
          "primaryKey": false,
          "sqlType": "text"
        },
        {
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
        },
        {
          "name": "triage_summary",
          "nullable": false,
          "primaryKey": false,
          "sqlType": "text"
        },
        {
          "defaultExpr": "now()",
          "name": "updated_at",
          "nullable": false,
          "primaryKey": false,
          "sqlType": "timestamptz"
        }
      ],
      "kind": "create_table",
      "sql": "CREATE TABLE IF NOT EXISTS \"tickets\" (\"created_at\" timestamptz NOT NULL DEFAULT now(), \"id\" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, \"severity\" text NOT NULL, \"status\" text NOT NULL, \"tenant_id\" uuid NOT NULL REFERENCES \"tenants\" (\"id\"), \"title\" text NOT NULL, \"triage_summary\" text NOT NULL, \"updated_at\" timestamptz NOT NULL DEFAULT now())",
      "table": "tickets"
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
          "name": "email",
          "nullable": false,
          "primaryKey": false,
          "sqlType": "text"
        },
        {
          "defaultExpr": "gen_random_uuid()",
          "name": "id",
          "nullable": false,
          "primaryKey": true,
          "sqlType": "uuid"
        },
        {
          "name": "role",
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
        }
      ],
      "kind": "create_table",
      "sql": "CREATE TABLE IF NOT EXISTS \"users\" (\"created_at\" timestamptz NOT NULL DEFAULT now(), \"email\" text NOT NULL, \"id\" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, \"role\" text NOT NULL, \"tenant_id\" uuid NOT NULL REFERENCES \"tenants\" (\"id\"))",
      "table": "users"
    }
  ]
} as const;
