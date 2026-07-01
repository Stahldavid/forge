import { StrictMode, type ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, type LocalPersona } from "./App";
import { ForgeProvider, forgeUrl } from "./lib/forge";
import "./styles.css";

const forgeAuthMode = (import.meta.env.VITE_FORGE_AUTH_MODE as string | undefined) ?? "dev-headers";
const usesHostedAuth = forgeAuthMode === "oidc" || forgeAuthMode === "jwt";

const personas: LocalPersona[] = [
  {
    id: "acme-owner",
    label: "Acme owner",
    email: "riley@acme.example",
    organizationId: "11111111-1111-4111-8111-111111111111",
    organizationName: "Acme Corp",
    role: "owner",
    permissions: [
      "demo:seed",
      "vendors:read",
      "vendors:manage",
      "access:request",
      "access:approve",
      "evidence:manage",
      "audit:read",
    ],
  },
  {
    id: "acme-requester",
    label: "Acme requester",
    email: "maya@acme.example",
    organizationId: "11111111-1111-4111-8111-111111111111",
    organizationName: "Acme Corp",
    role: "requester",
    permissions: ["demo:seed", "vendors:read", "access:request", "audit:read"],
  },
  {
    id: "globex-security",
    label: "Globex security",
    email: "nina@globex.example",
    organizationId: "22222222-2222-4222-8222-222222222222",
    organizationName: "Globex Security",
    role: "security",
    permissions: [
      "demo:seed",
      "vendors:read",
      "vendors:manage",
      "access:request",
      "access:approve",
      "evidence:manage",
      "audit:read",
    ],
  },
  {
    id: "globex-auditor",
    label: "Globex auditor",
    email: "audit@globex.example",
    organizationId: "22222222-2222-4222-8222-222222222222",
    organizationName: "Globex Security",
    role: "auditor",
    permissions: ["demo:seed", "vendors:read", "audit:read"],
  },
];

function Root() {
  const [personaId, setPersonaId] = useState(personas[0]!.id);
  const [signedInPersonaId, setSignedInPersonaId] = useState<string | null>(null);
  const persona = personas.find((item) => item.id === personaId) ?? personas[0]!;
  const signedInPersona = signedInPersonaId
    ? personas.find((item) => item.id === signedInPersonaId) ?? personas[0]!
    : null;

  if (!signedInPersona) {
    return (
      <LoginScreen
        usesHostedAuth={usesHostedAuth}
        personas={personas}
        selectedPersonaId={personaId}
        onPersonaChange={setPersonaId}
        onSignIn={() => setSignedInPersonaId(persona.id)}
      />
    );
  }

  return (
    <LocalForgeProvider persona={signedInPersona}>
      <App
        persona={signedInPersona}
        personas={personas}
        onPersonaChange={(nextPersonaId) => {
          setPersonaId(nextPersonaId);
          setSignedInPersonaId(nextPersonaId);
        }}
        onSignOut={() => setSignedInPersonaId(null)}
      />
    </LocalForgeProvider>
  );
}

function LoginScreen({
  usesHostedAuth,
  personas,
  selectedPersonaId,
  onPersonaChange,
  onSignIn,
}: {
  usesHostedAuth: boolean;
  personas: LocalPersona[];
  selectedPersonaId: string;
  onPersonaChange: (personaId: string) => void;
  onSignIn: () => void;
}) {
  const selected = personas.find((item) => item.id === selectedPersonaId) ?? personas[0]!;

  const selectPersona = (personaId: string) => {
    const next = personas.find((item) => item.id === personaId) ?? personas[0]!;
    onPersonaChange(next.id);
  };

  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand login-brand">
          <span className="brand-mark">VA</span>
          <div>
            <strong>Vendor Access</strong>
            <span>Risk operations</span>
          </div>
        </div>
        <p className="eyebrow">Secure workspace</p>
        <h1 id="login-title">Sign in to review vendor access</h1>
        {usesHostedAuth ? (
          <div className="login-form">
            <p className="auth-mode-note">Production auth uses WorkOS AuthKit for this workspace.</p>
            <a className="button-link" data-forge-testid="workos-login" href="/login">
              Continue with WorkOS
            </a>
          </div>
        ) : (
          <div className="login-form">
            <p className="auth-mode-note">Local development identity for policy and tenant testing.</p>
            <label className="field">
              <span>Local development account</span>
              <select
                data-forge-testid="login-persona"
                value={selected.id}
                onChange={(event) => selectPersona(event.target.value)}
              >
                {personas.map((persona) => (
                  <option key={persona.id} value={persona.id}>
                    {persona.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="local-login-summary">
              <span>{selected.organizationName}</span>
              <strong>{selected.email}</strong>
              <small>{selected.role}</small>
            </div>
            <button data-forge-testid="login-submit" type="button" onClick={onSignIn}>
              Sign in
            </button>
          </div>
        )}
      </section>
      <aside className="login-context">
        <span>{selected.organizationName}</span>
        <strong>{selected.label}</strong>
        <p>{selected.email}</p>
        <p>Review vendor access, evidence, and approvals for the selected workspace.</p>
      </aside>
    </main>
  );
}

function LocalForgeProvider({ persona, children }: { persona: LocalPersona; children: ReactNode }) {
  return (
    <ForgeProvider
      url={forgeUrl}
      devAuth={{
        userId: persona.email,
        organizationId: persona.organizationId,
        tenantId: persona.organizationId,
        role: persona.role,
        roles: [persona.role],
        permissions: persona.permissions,
        claims: {
          email: persona.email,
          organization_id: persona.organizationId,
          role: persona.role,
          permissions: persona.permissions,
        },
      }}
    >
      {children}
    </ForgeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
