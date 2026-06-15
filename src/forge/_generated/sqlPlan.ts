// @forge-generated generator=0.1.0-alpha.3 input=991570b39d634099828586e546d58e2eeae22189c5392405901477094c1855ae content=d5967c203c4ecb427d0cf694931a3cc8dc6dd88726fcd4b71b79c2ab0c464e10
export const sqlPlan = {
  "checksum": "e00b135de6e380256e8116fb3ac28f4d925aef552528a58b4dc5285782737654",
  "diagnostics": [],
  "indexes": [
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
  "migrationId": "migration_e00b135de6e38025",
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
  "tables": []
} as const;
