import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, useCommand, useLiveQuery } from "./lib/forge";

export type LocalPersona = {
  id: string;
  label: string;
  email: string;
  organizationId: string;
  organizationName: string;
  role: string;
  permissions: string[];
};

type Vendor = {
  id: string;
  name: string;
  category: string;
  riskTier: string;
  ownerEmail: string;
  status: string;
};

type AccessRequest = {
  id: string;
  vendorId: string;
  requesterEmail: string;
  system: string;
  businessJustification: string;
  status: string;
  reviewedBy?: string;
};

type EvidenceItem = {
  id: string;
  vendorId: string;
  label: string;
  status: string;
  source: string;
};

type AuditEvent = {
  id: string;
  actorEmail: string;
  action: string;
  target: string;
  detail: string;
  createdAt: string;
};

type DashboardData = {
  organizations: Array<{ id: string; name: string; slug: string; plan: string }>;
  vendors: Vendor[];
  accessRequests: AccessRequest[];
  evidenceItems: EvidenceItem[];
  auditEvents: AuditEvent[];
};

type SeedState = "pending" | "done";

type AppProps = {
  persona: LocalPersona;
  personas: LocalPersona[];
  onPersonaChange: (personaId: string) => void;
  onSignOut: () => void;
};

const DEFAULT_REQUEST = {
  requesterEmail: "requester@example.com",
  system: "Production admin console",
  businessJustification: "Time-bound access needed for vendor risk review.",
};

function statusClass(status: string) {
  return status.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function formatError(error: Error | null | undefined) {
  if (!error) return null;
  return error.message.includes("Failed to fetch")
    ? "Workspace service is offline. Open local test details to check the API connection, then try again."
    : error.message;
}

export function App({ persona, personas, onPersonaChange, onSignOut }: AppProps) {
  const dashboard = useLiveQuery<DashboardData>(api.liveQueries.liveVendorAccessDashboard, {});
  const seedWorkspace = useCommand<{ reset?: boolean }, unknown>(api.commands.seedVendorAccessDemo);
  const approveRequest = useCommand<{ requestId: string; reviewerEmail: string; decision: "Approved" | "Rejected" }, unknown>(
    api.commands.approveAccessRequest,
  );
  const createRequest = useCommand<typeof DEFAULT_REQUEST & { vendorId: string }, unknown>(
    api.commands.createAccessRequest,
  );
  const addEvidence = useCommand<{ vendorId: string; label: string; source: string }, unknown>(
    api.commands.addEvidence,
  );

  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [requestDraft, setRequestDraft] = useState(DEFAULT_REQUEST);
  const [evidenceLabel, setEvidenceLabel] = useState("Updated vendor security review");
  const [seedStateByTenant, setSeedStateByTenant] = useState<Record<string, SeedState>>({});
  const tenantSeedState = seedStateByTenant[persona.organizationId];
  const hasSeededThisTenant = tenantSeedState === "done";

  const data = dashboard.data;
  const vendors = data?.vendors ?? [];
  const requests = data?.accessRequests ?? [];
  const evidence = data?.evidenceItems ?? [];
  const audits = (data?.auditEvents ?? []).slice().reverse().slice(0, 8);
  const selectedVendor = vendors.find((vendor) => vendor.id === selectedVendorId) ?? vendors[0];
  const pendingRequests = requests.filter((request) => request.status === "Pending");
  const canApprove = persona.permissions.includes("access:approve");
  const canRequest = persona.permissions.includes("access:request");
  const canManageEvidence = persona.permissions.includes("evidence:manage");
  const runSeedCommand = seedWorkspace.run;

  const runSeedForCurrentTenant = useCallback(
    (reset = false) => {
      const tenantId = persona.organizationId;
      setSeedStateByTenant((current) => ({ ...current, [tenantId]: "pending" }));
      void runSeedCommand(reset ? { reset: true } : {})
        .then(() => {
          setSeedStateByTenant((current) => ({ ...current, [tenantId]: "done" }));
        })
        .catch(() => {
          setSeedStateByTenant((current) => {
            const next = { ...current };
            delete next[tenantId];
            return next;
          });
        });
    },
    [persona.organizationId, runSeedCommand],
  );

  const requestByVendor = useMemo(() => {
    const map = new Map<string, AccessRequest[]>();
    for (const request of requests) {
      map.set(request.vendorId, [...(map.get(request.vendorId) ?? []), request]);
    }
    return map;
  }, [requests]);

  useEffect(() => {
    if (
      !dashboard.loading &&
      !dashboard.error &&
      data &&
      vendors.length === 0 &&
      !seedWorkspace.loading &&
      tenantSeedState !== "pending" &&
      tenantSeedState !== "done"
    ) {
      runSeedForCurrentTenant(false);
    }
  }, [
    dashboard.loading,
    dashboard.error,
    data,
    vendors.length,
    seedWorkspace.loading,
    tenantSeedState,
    runSeedForCurrentTenant,
  ]);

  useEffect(() => {
    if (vendors.length > 0 && !vendors.some((vendor) => vendor.id === selectedVendorId)) {
      setSelectedVendorId(vendors[0]!.id);
    }
  }, [selectedVendorId, vendors]);

  const submitRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedVendor || !canRequest) return;
    void createRequest.run({
      vendorId: selectedVendor.id,
      ...requestDraft,
    });
  };

  const submitEvidence = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedVendor || !canManageEvidence || !evidenceLabel.trim()) return;
    void addEvidence.run({
      vendorId: selectedVendor.id,
      label: evidenceLabel.trim(),
      source: persona.email,
    });
  };

  const refreshWorkspaceData = (reset = false) => {
    runSeedForCurrentTenant(reset);
  };

  const errorMessage =
    formatError(dashboard.error) ??
    formatError(seedWorkspace.error) ??
    formatError(approveRequest.error) ??
    formatError(createRequest.error) ??
    formatError(addEvidence.error);
  const rawErrorMessage =
    dashboard.error?.message ??
    seedWorkspace.error?.message ??
    approveRequest.error?.message ??
    createRequest.error?.message ??
    addEvidence.error?.message;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">VA</span>
          <div>
            <strong>Vendor Access</strong>
            <span>Risk operations</span>
          </div>
        </div>

        <label className="field compact">
          <span>Account</span>
          <select
            data-forge-testid="persona-select"
            value={persona.id}
            onChange={(event) => onPersonaChange(event.target.value)}
          >
            {personas.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <div className="identity-card">
          <span>{persona.organizationName}</span>
          <strong>{persona.email}</strong>
          <small>{persona.role}</small>
          <button className="secondary compact-action" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>

        <nav aria-label="Workspace sections">
          <a href="#queue">Approval queue</a>
          <a href="#vendors">Vendors</a>
          <a href="#evidence">Evidence</a>
          <a href="#audit">Audit</a>
        </nav>

        <details className="dev-panel">
          <summary data-forge-testid="dev-diagnostics-toggle">Developer diagnostics</summary>
          <dl>
            <dt>Tenant</dt>
            <dd>{persona.organizationId}</dd>
            <dt>Permissions</dt>
            <dd>{persona.permissions.join(", ")}</dd>
            <dt>Seed</dt>
            <dd>
              {tenantSeedState === "pending"
                ? "Preparing tenant data"
                : hasSeededThisTenant
                  ? "Tenant data ready"
                  : "Runs automatically when this tenant is empty"}
            </dd>
            <dt>Health check</dt>
            <dd>
              <a href="/health" target="_blank" rel="noreferrer">
                /health
              </a>
            </dd>
            {rawErrorMessage ? (
              <>
                <dt>Last error</dt>
                <dd>
                  {rawErrorMessage.includes("Failed to fetch")
                    ? "Failed to fetch. Start the local API with npm run dev, confirm /health returns 200, and keep the Vite proxy enabled."
                    : rawErrorMessage}
                </dd>
              </>
            ) : null}
          </dl>
          <button
            data-forge-testid="seed-demo"
            type="button"
            onClick={() => refreshWorkspaceData(false)}
            disabled={seedWorkspace.loading}
          >
            {seedWorkspace.loading ? "Refreshing..." : "Refresh tenant data"}
          </button>
          <button
            className="secondary"
            data-forge-testid="reset-demo"
            type="button"
            onClick={() => refreshWorkspaceData(true)}
            disabled={seedWorkspace.loading}
          >
            Reset tenant
          </button>
        </details>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Access operations</p>
            <h1>Vendor access review</h1>
          </div>
          <div className="summary-grid" aria-label="Workspace summary">
            <span>
              <strong>{vendors.length}</strong>
              Vendors
            </span>
            <span>
              <strong>{pendingRequests.length}</strong>
              Pending
            </span>
            <span>
              <strong>{evidence.length}</strong>
              Evidence
            </span>
          </div>
        </header>

        {dashboard.loading ? <p className="notice">Loading workspace...</p> : null}
        {seedWorkspace.loading ? (
          <p className="notice" data-forge-testid="seed-status">
            Preparing tenant data...
          </p>
        ) : null}
        {errorMessage ? (
          <p className="notice error" data-forge-testid="runtime-error">
            {errorMessage}
          </p>
        ) : null}
        {!dashboard.loading && !errorMessage && vendors.length === 0 ? (
          <section className="empty-state">
            <h2>No vendors in this workspace yet</h2>
            <p>Load tenant data to review vendors, access requests, evidence, and audit history.</p>
            <button type="button" onClick={() => refreshWorkspaceData(false)}>
              Load tenant data
            </button>
          </section>
        ) : null}

        <section id="queue" className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Queue</p>
              <h2>Requests needing review</h2>
            </div>
            <span className={`permission ${canApprove ? "granted" : "blocked"}`}>
              {canApprove ? "Approval enabled" : "Approval blocked"}
            </span>
          </div>
          {!canApprove ? (
            <p className="policy-note" data-forge-testid="policy-denied-approval">
              Your current role can review the queue but cannot approve or reject access.
            </p>
          ) : null}
          <div className="request-list" data-forge-testid="approval-queue">
            {pendingRequests.length === 0 ? <p className="muted">No pending requests.</p> : null}
            {pendingRequests.map((request) => {
              const vendor = vendors.find((item) => item.id === request.vendorId);
              return (
                <article key={request.id} className="request-row">
                  <div>
                    <strong>{vendor?.name ?? request.vendorId}</strong>
                    <span>{request.system}</span>
                    <p>{request.businessJustification}</p>
                  </div>
                  <div className="actions">
                    <button
                      data-forge-testid="approve-request"
                      type="button"
                      disabled={!canApprove || approveRequest.loading}
                      onClick={() =>
                        void approveRequest.run({
                          requestId: request.id,
                          reviewerEmail: persona.email,
                          decision: "Approved",
                        })
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={!canApprove || approveRequest.loading}
                      onClick={() =>
                        void approveRequest.run({
                          requestId: request.id,
                          reviewerEmail: persona.email,
                          decision: "Rejected",
                        })
                      }
                    >
                      Reject
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section id="vendors" className="grid-two">
          <div className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Portfolio</p>
                <h2>Vendors</h2>
              </div>
            </div>
            <div className="vendor-list" data-forge-testid="vendor-list">
              {vendors.map((vendor) => (
                <button
                  key={vendor.id}
                  type="button"
                  className={vendor.id === selectedVendor?.id ? "vendor active" : "vendor"}
                  onClick={() => setSelectedVendorId(vendor.id)}
                >
                  <span>
                    <strong>{vendor.name}</strong>
                    <small>{vendor.category}</small>
                  </span>
                  <em className={statusClass(vendor.riskTier)}>{vendor.riskTier}</em>
                </button>
              ))}
            </div>
            {selectedVendor ? (
              <div className="vendor-detail" data-forge-testid="vendor-detail">
                <div>
                  <span>Owner</span>
                  <strong>{selectedVendor.ownerEmail}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>{selectedVendor.status}</strong>
                </div>
                <div>
                  <span>Open requests</span>
                  <strong>
                    {
                      (requestByVendor.get(selectedVendor.id) ?? [])
                        .filter((request) => request.status === "Pending")
                        .length
                    }
                  </strong>
                </div>
              </div>
            ) : null}
          </div>

          <div className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Request</p>
                <h2>New access request</h2>
              </div>
            </div>
            <form className="stack" onSubmit={submitRequest}>
              <label className="field">
                <span>Vendor</span>
                <select value={selectedVendor?.id ?? ""} onChange={(event) => setSelectedVendorId(event.target.value)}>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Requester</span>
                <input
                  value={requestDraft.requesterEmail}
                  onChange={(event) => setRequestDraft({ ...requestDraft, requesterEmail: event.target.value })}
                />
              </label>
              <label className="field">
                <span>System</span>
                <input
                  value={requestDraft.system}
                  onChange={(event) => setRequestDraft({ ...requestDraft, system: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Justification</span>
                <textarea
                  value={requestDraft.businessJustification}
                  onChange={(event) =>
                    setRequestDraft({ ...requestDraft, businessJustification: event.target.value })
                  }
                />
              </label>
              <button type="submit" disabled={!canRequest || createRequest.loading || !selectedVendor}>
                {createRequest.loading ? "Submitting..." : "Submit request"}
              </button>
              {!canRequest ? (
                <p className="policy-note" data-forge-testid="policy-denied-request">
                  This role can inspect vendor state but cannot create access requests.
                </p>
              ) : null}
            </form>
          </div>
        </section>

        <section id="evidence" className="grid-two">
          <div className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Controls</p>
                <h2>Evidence</h2>
              </div>
            </div>
            <ul className="evidence-list">
              {evidence.map((item) => {
                const vendor = vendors.find((entry) => entry.id === item.vendorId);
                return (
                  <li key={item.id}>
                    <strong>{item.label}</strong>
                    <span>{vendor?.name ?? item.vendorId}</span>
                    <em>{item.status}</em>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Control update</p>
                <h2>Add evidence</h2>
              </div>
            </div>
            <form className="stack" onSubmit={submitEvidence}>
              <label className="field">
                <span>Evidence label</span>
                <input value={evidenceLabel} onChange={(event) => setEvidenceLabel(event.target.value)} />
              </label>
              <button type="submit" disabled={!canManageEvidence || addEvidence.loading || !selectedVendor}>
                {addEvidence.loading ? "Adding..." : "Add evidence"}
              </button>
              {!canManageEvidence ? (
                <p className="policy-note" data-forge-testid="policy-denied-evidence">
                  Evidence changes require the evidence:manage permission.
                </p>
              ) : null}
            </form>
          </div>
        </section>

        <section id="audit" className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Audit</p>
              <h2>Recent activity</h2>
            </div>
          </div>
          <ol className="audit-list">
            {audits.map((event) => (
              <li key={event.id}>
                <strong>{event.action}</strong>
                <span>{event.target}</span>
                <small>{event.actorEmail}</small>
              </li>
            ))}
          </ol>
        </section>
      </section>
    </main>
  );
}
