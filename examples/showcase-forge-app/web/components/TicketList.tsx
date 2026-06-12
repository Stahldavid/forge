"use client";

import { api } from "../../src/forge/_generated/api";
import { useLiveQuery } from "../../src/forge/_generated/react";
import { TraceDetails } from "./TraceDetails";

type Ticket = {
  id: string;
  title: string;
  status: string;
  triageSummary?: string | null;
};

export function TicketList() {
  const tickets = useLiveQuery<Ticket[]>(api.liveQueries.liveTickets, {});

  if (tickets.loading) {
    return <p className="panel">Loading tickets...</p>;
  }

  if (tickets.error) {
    return (
      <section className="panel">
        <h2>Open tickets</h2>
        <TraceDetails label="Error" error={tickets.error} />
      </section>
    );
  }

  return (
    <section className="panel stack">
      <div>
        <h2>Open tickets</h2>
        <p className="muted">
          {tickets.connected
            ? `Live connection active, revision ${tickets.revision ?? 0}`
            : "Connecting..."}
        </p>
      </div>

      <ul className="ticket-list">
        {(tickets.data ?? []).map((ticket) => (
          <li className="ticket" key={ticket.id}>
            <strong>{ticket.title}</strong>
            <span className="muted"> - {ticket.status}</span>
            {ticket.triageSummary ? <p>AI triage: {ticket.triageSummary}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
