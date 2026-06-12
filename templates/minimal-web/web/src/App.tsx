import { FormEvent, useState } from "react";
import { api, useCommand, useLiveQuery } from "./lib/forge";

type Note = {
  id: string;
  title: string;
  body?: string;
  status?: string;
  createdAt?: string;
};

export function App() {
  const notes = useLiveQuery<Note[]>(api.liveQueries.liveNotes, {});
  const createNote = useCommand<{ title: string; body?: string }, Note>(
    api.commands.createNote,
    {
      onSuccess: () => {
        setTitle("");
        setBody("");
      },
    },
  );
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return;
    }
    void createNote.run({
      title: trimmedTitle,
      body: body.trim(),
    });
  };

  return (
    <main className="shell">
      <section className="header">
        <p className="eyebrow">ForgeOS minimal-web</p>
        <h1>Notes</h1>
      </section>

      <form className="composer" onSubmit={submit}>
        <label>
          <span>Title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Ship the full-stack loop"
          />
        </label>
        <label>
          <span>Body</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Optional note"
          />
        </label>
        <button disabled={createNote.loading || !title.trim()} type="submit">
          {createNote.loading ? "Creating..." : "Create note"}
        </button>
        {createNote.error ? <p className="error">{createNote.error.message}</p> : null}
      </form>

      <section className="notes">
        <div className="section-heading">
          <h2>Live notes</h2>
          <span>{notes.data?.length ?? 0}</span>
        </div>
        {notes.loading ? <p className="muted">Loading notes...</p> : null}
        {notes.error ? <p className="error">{notes.error.message}</p> : null}
        {!notes.loading && !notes.error && (notes.data?.length ?? 0) === 0 ? (
          <p className="muted">No notes yet.</p>
        ) : null}
        <ul>
          {notes.data?.map((note) => (
            <li key={note.id}>
              <strong>{note.title}</strong>
              {note.body ? <p>{note.body}</p> : null}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
