# Playbook: Debug Trace

1. Capture the `traceId` from frontend or runtime output.
2. Run `forge telemetry inspect <traceId>`.
3. Run `forge repair diagnose --trace <traceId> --json`.
4. Prefer targeted repairs and impacted tests before full verify.
