"use client";

import { CreateTicketForm } from "../../components/CreateTicketForm";
import { PolicyDeniedDemo } from "../../components/PolicyDeniedDemo";
import { TicketList } from "../../components/TicketList";
import { TriageStatus } from "../../components/TriageStatus";

export default function TicketsPage() {
  return (
    <main className="stack">
      <header>
        <h1>Tickets</h1>
        <p className="muted">Live support queue for the demo tenant.</p>
      </header>
      <CreateTicketForm />
      <TicketList />
      <TriageStatus />
      <PolicyDeniedDemo />
    </main>
  );
}
