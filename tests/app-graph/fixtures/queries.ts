import { query, liveQuery } from "forge/server";

export const getUser = query(async () => {
  return { id: "1" };
});

export const watchUser = liveQuery(async () => {
  return { id: "1" };
});
