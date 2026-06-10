"use client";

export function TriageStatus() {
  return (
    <section className="panel">
      <h2>AI triage</h2>
      <p className="muted">
        The ticket.created workflow writes triageSummary with mock AI when the
        worker processes the outbox.
      </p>
    </section>
  );
}
