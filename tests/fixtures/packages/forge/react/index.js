export function ForgeProvider({ children }) {
  return children;
}

export function createForgeClient(config) {
  return { config };
}

export function useCommand() {
  return async () => {
    throw new Error("forge/react fixture useCommand is not connected");
  };
}

export function useQuery() {
  return { data: undefined, error: undefined, loading: false };
}

export function useLiveQuery() {
  return { data: undefined, error: undefined, loading: false };
}
