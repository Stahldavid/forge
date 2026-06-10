// @forge-generated generator=0.0.0 input=be0a4129920f48c42d269789fd5c26029f4132e224b712db2471797b6371dc78 content=82fd4a5b796a7ddae62db7b0b87edf9953c6b6c76ceef402793b7a6a3d4d97e8
export const sqlPlan = {
  "checksum": "40efbdfe4b0abb53a8478cc8b1ade644000169c4adc857028b90b65e53502278",
  "indexes": [],
  "migrationId": "migration_40efbdfe4b0abb53",
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
          "defaultExpr": "gen_random_uuid()",
          "name": "id",
          "nullable": false,
          "primaryKey": true,
          "sqlType": "uuid"
        }
      ],
      "kind": "create_table",
      "sql": "CREATE TABLE IF NOT EXISTS \"tickets\" (\"id\" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY)",
      "table": "tickets"
    },
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
      "sql": "CREATE TABLE IF NOT EXISTS \"users\" (\"id\" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY)",
      "table": "users"
    }
  ]
} as const;
