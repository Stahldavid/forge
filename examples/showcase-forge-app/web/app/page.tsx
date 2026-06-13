import Link from "next/link";

export default function HomePage() {
  return (
    <main className="stack">
      <section className="hero">
        <div className="stack">
          <p className="eyebrow">ForgeOS showcase</p>
          <h1>Support Desk</h1>
          <p className="lead">
            A full-stack ticket queue wired through Forge commands, liveQueries,
            policies, workflows, telemetry, and generated agent contracts.
          </p>
          <p>
            <Link className="button-link" href="/tickets">
              Open ticket queue
            </Link>
          </p>
        </div>

        <div className="status-panel" aria-label="Runtime status">
          <div>
            <span className="status-dot" />
            <strong>API</strong>
            <span className="muted">ready</span>
          </div>
          <div>
            <span className="status-dot" />
            <strong>Web</strong>
            <span className="muted">connected</span>
          </div>
          <div>
            <span className="status-dot" />
            <strong>Worker</strong>
            <span className="muted">outbox driven</span>
          </div>
        </div>
      </section>

      <section className="capability-grid" aria-label="Forge capabilities">
        <article className="panel stack">
          <h2>Create tickets</h2>
          <p className="muted">UI form calls the createTicket command through generated hooks.</p>
        </article>
        <article className="panel stack">
          <h2>Live queue</h2>
          <p className="muted">The list is backed by liveTickets and updates from invalidations.</p>
        </article>
        <article className="panel stack">
          <h2>Policy denial</h2>
          <p className="muted">A member-only session shows billing.manage being blocked safely.</p>
        </article>
        <article className="panel stack">
          <h2>Agent map</h2>
          <p className="muted">agentContract, frontendGraph, and capabilityMap describe the app.</p>
        </article>
      </section>
    </main>
  );
}
