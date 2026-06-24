import { api, useForgeCommand, useForgeLiveQuery } from "./forge";

export type Note = {
  id: string;
  title: string;
  body?: string;
  status?: string;
  createdAt?: string;
};

export function useNotes(options: { onCreated?: (note: Note) => void } = {}) {
  const notes = useForgeLiveQuery<Note[]>(api.liveQueries.liveNotes, {});
  const createNote = useForgeCommand<{ title: string; body?: string }, Note>(
    api.commands.createNote,
    {
      onSuccess: (note) => options.onCreated?.(note),
    },
  );

  return {
    notes,
    createNote,
  };
}
