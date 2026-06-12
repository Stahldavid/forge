// @forge-generated generator=0.0.0 input=546500a6b3678160b7670bd4f0428cd9913860cf4a90429c9bd9563aa38bc60f content=76d5d621f1c198e1fe4c4639e6fcecbeb279b6172d6b588fa9b51dba0c57b00e
export const sqlPlan = {
  "checksum": "418e7965808fba344799c6ed1489ae11c907a69a376ecc3b15345d4247b52bee",
  "diagnostics": [],
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
          "revision"
        ],
        "name": "forge_live_invalidations_revision_idx",
        "table": "_forge_live_invalidations"
      },
      "kind": "create_index",
      "sql": "CREATE INDEX IF NOT EXISTS \"forge_live_invalidations_revision_idx\" ON \"_forge_live_invalidations\" (\"revision\")",
      "table": "_forge_live_invalidations"
    },
    {
      "index": {
        "columns": [
          "table_name",
          "tenant_id",
          "revision"
        ],
        "name": "forge_live_invalidations_table_tenant_revision_idx",
        "table": "_forge_live_invalidations"
      },
      "kind": "create_index",
      "sql": "CREATE INDEX IF NOT EXISTS \"forge_live_invalidations_table_tenant_revision_idx\" ON \"_forge_live_invalidations\" (\"table_name\", \"tenant_id\", \"revision\")",
      "table": "_forge_live_invalidations"
    }
  ],
  "migrationId": "migration_418e7965808fba34",
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
    },
    {
      "kind": "create_sequence",
      "sql": "CREATE SEQUENCE IF NOT EXISTS _forge_live_revision_seq START WITH 2",
      "table": "_forge_live_revision_seq"
    },
    {
      "kind": "create_table",
      "sql": "CREATE TABLE IF NOT EXISTS _forge_live_invalidations (id bigserial PRIMARY KEY, revision bigint NOT NULL, table_name text NOT NULL, tenant_id text, operation text NOT NULL, source_kind text NOT NULL, source_name text, trace_id text, release_id text, deploy_id text, payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now())",
      "table": "_forge_live_invalidations"
    },
    {
      "kind": "create_table",
      "sql": "CREATE TABLE IF NOT EXISTS _forge_live_subscription_debug (id text PRIMARY KEY, name text NOT NULL, tenant_id text, dependencies jsonb NOT NULL, last_revision bigint, runtime_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())",
      "table": "_forge_live_subscription_debug"
    }
  ],
  "tables": [
    {
      "columns": [
        {
          "defaultExpr": "gen_random_uuid()",
          "fieldName": "id",
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
          "fieldName": "createdAt",
          "name": "created_at",
          "nullable": false,
          "primaryKey": false,
          "sqlType": "timestamptz"
        },
        {
          "defaultExpr": "gen_random_uuid()",
          "fieldName": "id",
          "name": "id",
          "nullable": false,
          "primaryKey": true,
          "sqlType": "uuid"
        },
        {
          "checkConstraint": "\"status\" IN ('open', 'pending', 'closed')",
          "fieldName": "status",
          "name": "status",
          "nullable": false,
          "primaryKey": false,
          "sqlType": "text"
        },
        {
          "fieldName": "tenantId",
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
          "fieldName": "title",
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
