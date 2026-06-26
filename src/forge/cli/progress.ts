export interface CommandHeartbeat {
  setPhase: (phase: string) => void;
  stop: () => void;
}

export function startCommandHeartbeat(input: {
  label: string;
  enabled?: boolean;
  initialPhase?: string;
  intervalMs?: number;
  stallMs?: number;
}): CommandHeartbeat {
  if (input.enabled === false || process.env.FORGE_PROGRESS === "0") {
    return {
      setPhase: () => {},
      stop: () => {},
    };
  }

  const startedAt = Date.now();
  const intervalMs = input.intervalMs ?? 10_000;
  const stallMs = input.stallMs ?? 30_000;
  let phase = input.initialPhase ?? "running";
  let ticks = 0;

  const timer = setInterval(() => {
    ticks += 1;
    const elapsedMs = Date.now() - startedAt;
    const elapsedSeconds = Math.round(elapsedMs / 1000);
    const stalled = elapsedMs >= stallMs;
    const prefix = stalled ? "still waiting" : "working";
    process.stderr.write(
      `[forge] ${input.label}: ${prefix}; phase=${phase}; elapsed=${elapsedSeconds}s\n`,
    );
    if (stalled && ticks === Math.ceil(stallMs / intervalMs)) {
      process.stderr.write(
        `[forge] ${input.label}: run with --json for structured status; for dev startup failures, use forge last --json.\n`,
      );
    }
  }, intervalMs);
  timer.unref?.();

  return {
    setPhase: (nextPhase: string) => {
      phase = nextPhase;
    },
    stop: () => {
      clearInterval(timer);
    },
  };
}
