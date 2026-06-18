export const DELTA_SCHEMA_VERSION = "0.1.0";

export const DELTA_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS delta_meta (
    key text PRIMARY KEY,
    value text NOT NULL,
    updated_at text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS actors (
    id text PRIMARY KEY,
    kind text NOT NULL,
    name text,
    metadata_json text,
    created_at text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id text PRIMARY KEY,
    workspace_root text NOT NULL,
    source text NOT NULL,
    branch text,
    started_at text NOT NULL,
    ended_at text,
    summary text,
    metadata_json text
  )`,
  `CREATE TABLE IF NOT EXISTS operations (
    id text PRIMARY KEY,
    session_id text,
    txn_id text,
    kind text NOT NULL,
    timestamp text NOT NULL,
    actor_id text,
    summary text,
    data_json text NOT NULL,
    redaction_json text,
    hash text,
    prev_hash text
  )`,
  `CREATE TABLE IF NOT EXISTS file_changes (
    id text PRIMARY KEY,
    operation_id text NOT NULL,
    path text NOT NULL,
    change_type text NOT NULL,
    hash_before text,
    hash_after text,
    diff_summary text,
    semantic_hints_json text
  )`,
  `CREATE TABLE IF NOT EXISTS command_runs (
    id text PRIMARY KEY,
    operation_id text NOT NULL,
    command_name text NOT NULL,
    argv_redacted_json text,
    exit_code integer,
    duration_ms integer,
    diagnostics_json text
  )`,
  `CREATE TABLE IF NOT EXISTS proofs (
    id text PRIMARY KEY,
    operation_id text NOT NULL,
    proof_kind text NOT NULL,
    command text,
    result text NOT NULL,
    assurance text,
    diagnostics_json text,
    artifact_paths_json text
  )`,
  `CREATE TABLE IF NOT EXISTS runtime_calls (
    id text PRIMARY KEY,
    operation_id text NOT NULL,
    entry_name text NOT NULL,
    entry_kind text,
    risk text,
    policy text,
    tenant_scoped integer,
    result text,
    diagnostic_code text,
    trace_id text,
    service text,
    language text
  )`,
  `CREATE TABLE IF NOT EXISTS artifacts (
    id text PRIMARY KEY,
    operation_id text NOT NULL,
    path text NOT NULL,
    artifact_kind text,
    hash text,
    generated integer
  )`,
  `CREATE TABLE IF NOT EXISTS git_mappings (
    id text PRIMARY KEY,
    operation_id text,
    commit_sha text,
    branch text,
    detected_at text,
    confidence real,
    metadata_json text
  )`,
  `CREATE INDEX IF NOT EXISTS operations_timestamp_idx ON operations(timestamp)`,
  `CREATE INDEX IF NOT EXISTS operations_kind_idx ON operations(kind)`,
  `CREATE INDEX IF NOT EXISTS operations_session_idx ON operations(session_id)`,
  `CREATE INDEX IF NOT EXISTS file_changes_path_idx ON file_changes(path)`,
  `CREATE INDEX IF NOT EXISTS runtime_calls_entry_idx ON runtime_calls(entry_name)`,
  `CREATE INDEX IF NOT EXISTS artifacts_path_idx ON artifacts(path)`,
];

