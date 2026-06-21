import { api, useCommand, useLiveQuery } from "./lib/forge";

type Session = {
  id: string;
  appName: string;
  appPath: string;
  previewUrl: string;
  previewStatus?: string;
  previewStatusReason?: string;
  agent: string;
  status: string;
  objective?: string;
  generatedState?: string;
  generatedChangedFiles?: number;
  authoredFiles?: number;
  generatedFiles?: number;
  authoredDiffCommand?: string;
  generatedDiffCommand?: string;
  terminalCommand?: string;
  terminalCwd?: string;
};

type Signal = {
  id: string;
  source: string;
  kind: string;
  title: string;
  detail: string;
  filesChanged?: string;
  status: string;
  createdAt: string;
};

type CheckRun = {
  id: string;
  command: string;
  status: string;
  output?: string;
  durationMs: number;
  createdAt: string;
};

type WorkroomState = {
  selectedSession: Session | null;
  signals: Signal[];
  checks: CheckRun[];
  stats: {
    signalCount: number;
    checkCount: number;
    failingChecks: number;
    filesTouched: number;
  };
};

const defaultPreviewUrl = "http://127.0.0.1:5174";
const defaultAuthoredDiff = 'git diff -- . ":(exclude)src/forge/_generated/**" ":(exclude)forge.lock"';
const defaultGeneratedDiff = "git diff -- src/forge/_generated forge.lock";

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function splitFiles(files?: string): string[] {
  return (files ?? "")
    .split(",")
    .map((file) => file.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function trustState(session: Session | null, checks: CheckRun[], failingChecks: number): string {
  if (!session) {
    return "idle";
  }
  if (failingChecks > 0 || session.status === "needs-attention") {
    return "attention";
  }
  if (checks.some((check) => check.status === "passed")) {
    return "verified";
  }
  if ((session.generatedChangedFiles ?? 0) > 0) {
    return "regenerated";
  }
  return "observing";
}

export function App() {
  const room = useLiveQuery<WorkroomState>(api.liveQueries.liveWorkroom, {});
  const openWorkroom = useCommand(api.commands.openWorkroom);
  const recordSignal = useCommand(api.commands.recordAgentSignal);
  const recordCheck = useCommand(api.commands.recordCheckRun);
  const data = room.data;
  const session = data?.selectedSession ?? null;
  const signals = data?.signals ?? [];
  const checks = data?.checks ?? [];
  const previewUrl = session?.previewUrl ?? defaultPreviewUrl;
  const generatedState = session?.generatedState ?? "fresh";
  const trust = trustState(session, checks, data?.stats.failingChecks ?? 0);
  const lastSignal = signals[0];
  const lastCheck = checks[0];

  const seedWorkroom = () => {
    void openWorkroom.run({
      appName: "__FORGE_APP_TITLE__",
      appPath: ".",
      previewUrl,
      previewStatus: "not-running",
      previewStatusReason: "Target preview has not answered yet.",
      agent: "codex",
      objective: "External agent development session",
      generatedState: "fresh",
      terminalCommand: "codex",
      terminalCwd: ".",
    });
  };

  const replaySignal = () => {
    void recordSignal.run({
      sessionId: session?.id,
      source: session?.agent ?? "codex",
      kind: "hook",
      title: "Workspace snapshot received",
      detail: "ForgeOS separated authored changes from generated artifacts and refreshed the observer state.",
      filesChanged: ["web/src/App.tsx", "src/forge/schema.ts", "src/commands/recordAgentSignal.ts"],
      status: "info",
      previewStatus: "reachable",
      previewStatusReason: "Target preview answered on the attached URL.",
      generatedState: "regenerated",
      generatedChangedFiles: 12,
      authoredFiles: 3,
      generatedFiles: 12,
      authoredDiffCommand: defaultAuthoredDiff,
      generatedDiffCommand: defaultGeneratedDiff,
      terminalCommand: session?.terminalCommand ?? "codex",
      terminalCwd: session?.terminalCwd ?? ".",
    });
  };

  const markCheckPassed = () => {
    if (!session?.id) {
      return;
    }
    void recordCheck.run({
      sessionId: session.id,
      command: "forge verify agent",
      status: "passed",
      output: "Generated artifacts, Forge checks, and focused tests passed.",
      durationMs: 4200,
    });
  };

  return (
    <main className="workroom">
      <header className="topbar">
        <div className="brand-block">
          <p className="eyebrow">Agent workroom</p>
          <h1>{session?.appName ?? "__FORGE_APP_TITLE__"}</h1>
        </div>
        <div className="status-strip" data-state={trust}>
          <span>{session?.agent ?? "external agent"}</span>
          <strong>{trust}</strong>
        </div>
      </header>

      <section className="layout">
        <aside className="rail" aria-label="Workspace evidence">
          <section className="panel workspace-panel">
            <div>
              <p className="label">Workspace</p>
              <h2>{session?.appPath ?? "."}</h2>
            </div>
            <dl className="facts">
              <div>
                <dt>Terminal</dt>
                <dd>{session?.terminalCommand ?? "codex"}</dd>
              </div>
              <div>
                <dt>Cwd</dt>
                <dd>{session?.terminalCwd ?? "."}</dd>
              </div>
              <div>
                <dt>Preview</dt>
                <dd>{session?.previewStatus ?? "not-checked"}</dd>
              </div>
            </dl>
          </section>

          <section className="metrics" aria-label="Live counts">
            <div>
              <span>{data?.stats.signalCount ?? 0}</span>
              <p>signals</p>
            </div>
            <div>
              <span>{data?.stats.filesTouched ?? 0}</span>
              <p>files</p>
            </div>
            <div>
              <span>{data?.stats.checkCount ?? 0}</span>
              <p>checks</p>
            </div>
          </section>

          <section className="panel trust-panel">
            <div className="panel-heading">
              <h2>Trust trail</h2>
              <span>{generatedState}</span>
            </div>
            <ol className="trust-list">
              <li data-state={session ? "done" : "idle"}>
                <span>01</span>
                <p>workspace attached</p>
              </li>
              <li data-state={signals.length > 0 ? "done" : "idle"}>
                <span>02</span>
                <p>agent signals visible</p>
              </li>
              <li data-state={(session?.generatedChangedFiles ?? 0) > 0 ? "done" : "idle"}>
                <span>03</span>
                <p>generated state known</p>
              </li>
              <li data-state={lastCheck?.status === "passed" ? "done" : data?.stats.failingChecks ? "fail" : "idle"}>
                <span>04</span>
                <p>checks recorded</p>
              </li>
            </ol>
          </section>

          <section className="panel diff-panel">
            <div className="panel-heading">
              <h2>Diff focus</h2>
              <span>{session?.authoredFiles ?? 0}+{session?.generatedFiles ?? 0}</span>
            </div>
            <code>{session?.authoredDiffCommand ?? defaultAuthoredDiff}</code>
            <code>{session?.generatedDiffCommand ?? defaultGeneratedDiff}</code>
          </section>
        </aside>

        <section className="preview" aria-label="App preview">
          <div className="preview-bar">
            <div>
              <span>App preview</span>
              <code>{previewUrl}</code>
            </div>
            <strong data-state={session?.previewStatus ?? "not-checked"}>
              {session?.previewStatus ?? "not-checked"}
            </strong>
          </div>
          <div className="preview-frame">
            {session ? (
              <iframe title="App preview" src={previewUrl} />
            ) : (
              <div className="empty-preview">
                <p>Preview waiting</p>
                <code>forge studio attach . --target codex --preview-port 5174</code>
              </div>
            )}
          </div>
        </section>

        <aside className="activity" aria-label="Agent activity">
          <section className="panel terminal-panel">
            <div className="panel-heading">
              <h2>Agent terminal</h2>
              <span>{room.loading ? "syncing" : "live"}</span>
            </div>
            {room.error ? <p className="error">{room.error.message}</p> : null}
            <ol className="terminal-lines">
              {signals.length === 0 ? (
                <li>
                  <span>--:--</span>
                  <p>waiting for hook or ingest events</p>
                </li>
              ) : null}
              {signals.map((signal: Signal) => (
                <li key={signal.id} data-state={signal.status}>
                  <span>{timeLabel(signal.createdAt)}</span>
                  <div>
                    <strong>{signal.title}</strong>
                    <p>{signal.source} / {signal.kind}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="panel evidence-panel">
            <div className="panel-heading">
              <h2>Evidence</h2>
              <span>{lastSignal ? lastSignal.status : "empty"}</span>
            </div>
            {lastSignal ? (
              <>
                <p>{lastSignal.detail}</p>
                <div className="file-list">
                  {splitFiles(lastSignal.filesChanged).map((file) => <code key={file}>{file}</code>)}
                </div>
              </>
            ) : (
              <p className="muted">No evidence recorded yet.</p>
            )}
          </section>

          <section className="panel checks-panel">
            <div className="panel-heading">
              <h2>Checks</h2>
              <span>{data?.stats.failingChecks ?? 0} failing</span>
            </div>
            <ol className="checks">
              {checks.length === 0 ? <li data-status="idle"><strong>no checks yet</strong></li> : null}
              {checks.map((check: CheckRun) => (
                <li key={check.id} data-status={check.status}>
                  <strong>{check.command}</strong>
                  <span>{check.status} / {check.durationMs}ms</span>
                  {check.output ? <p>{check.output}</p> : null}
                </li>
              ))}
            </ol>
          </section>

          <section className="panel local-tools">
            <div className="panel-heading">
              <h2>Local controls</h2>
              <span>demo</span>
            </div>
            <div className="actions">
              <button type="button" onClick={seedWorkroom} disabled={openWorkroom.loading}>
                Attach
              </button>
              <button type="button" onClick={replaySignal} disabled={recordSignal.loading}>
                Signal
              </button>
              <button type="button" onClick={markCheckPassed} disabled={!session || recordCheck.loading}>
                Check
              </button>
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
