"use client";

import { FormEvent, useState } from "react";
import { api } from "../../src/forge/_generated/api";
import { useCommand } from "../../src/forge/_generated/react";
import { TraceDetails } from "./TraceDetails";

export function CreateTicketForm() {
  const [title, setTitle] = useState("");
  const createTicket = useCommand<{ title: string }>(api.commands.createTicket);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }

    await createTicket.run({ title: trimmed });
    setTitle("");
  }

  return (
    <form className="panel stack" onSubmit={onSubmit}>
      <label>
        Ticket title
        <input
          data-forge-testid="ticket-title-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Describe the support issue"
        />
      </label>

      <button data-forge-testid="create-ticket-button" disabled={createTicket.loading}>
        {createTicket.loading ? "Creating..." : "Create ticket"}
      </button>

      {createTicket.error ? (
        <TraceDetails label="Create failed" error={createTicket.error} />
      ) : null}
    </form>
  );
}
