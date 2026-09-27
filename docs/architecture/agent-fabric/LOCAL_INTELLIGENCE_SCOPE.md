# Local grounded intelligence scope

Status: implementation slice for the single-owner PC pilot. This record does not adopt
step 9 of the broader Agent Fabric delivery plan or grant a new runtime permission.

`local-intelligence.ts` captures only an explicit list of tracked, regular UTF-8 files
from the current exact Git commit. The live files must match that commit. The snapshot
contains file text, byte counts, per-file digests, the full commit ID, and a canonical
snapshot digest. It is capped at 24 paths, 32 KiB per file, and 128 KiB total. Before
reuse, the caller must recheck the digest, HEAD, and every source file. Any changed
allowlisted file or new HEAD invalidates the snapshot. A CRLF working-tree rendering
of the same committed LF text is accepted for Windows Git checkouts.

The private local memory store lives under the repository's ignored
`.forge/local/agent-fabric` directory. A trusted single-owner caller can retain a note
for an explicit duration of at most 30 days, recall it only while its source snapshot
is current, delete a chosen entry, purge expired entries, or clear all entries. Notes
are capped at 2 KiB and 128 entries. The store uses atomic file replacement and
best-effort owner-only filesystem modes. Its digest detects accidental corruption;
it is not authentication against a process that can edit local files.

Source and memory entries are marked `untrusted_source` and `untrusted_memory`.
Their text is context data. It cannot grant permissions, change budgets, approve
effects, or override the owner's task contract. This module exposes no MCP or model
tool, and it does not invoke a model.

The trusted task service now checks the source snapshot at proposal and before
model dispatch; a changed source or HEAD blocks spending the approved attempt.
The private memory store is not yet exposed through owner controls or used in
context selection. Outstanding for complete step 9: prove redaction, retention
operations, and recovery through the service; evaluate relevance and resistance
to prompt injection on real coding tasks. The module is single-process local storage, without
cross-process write fencing, encrypted storage, or protection from an unrestricted
process in the same OS account.
