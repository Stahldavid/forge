import { programAssert } from "./program-contract.ts";

export interface ActivityScope { id: string; limit: number }
interface Ticket { runId: string; runLimit: number; scopes: ActivityScope[]; resolve: (release: () => void) => void; reject: (error: Error) => void; signal: AbortSignal; abort: () => void }
/** Round robin between eligible runs; parent controls never hold activity capacity. */
export class ProgramActivityScheduler {
  private tickets: Ticket[] = [];
  private active = new Map<string, number>();
  private scopes = new Map<string, number>();
  private count = 0;
  private lastRun = "";
  constructor(readonly ownerLimit = 4) { programAssert(Number.isSafeInteger(ownerLimit) && ownerLimit > 0 && ownerLimit <= 32, "Invalid owner capacity"); }
  restore(runId: string, scopes: ActivityScope[]): () => void {
    this.count++; this.active.set(runId, (this.active.get(runId) ?? 0) + 1);
    for (const scope of scopes) this.scopes.set(scope.id, (this.scopes.get(scope.id) ?? 0) + 1);
    let released = false;
    return () => { if (released) return; released = true; this.count--; this.active.set(runId, this.active.get(runId)! - 1); for (const scope of scopes) this.scopes.set(scope.id, this.scopes.get(scope.id)! - 1); this.drain(); };
  }
  acquire(runId: string, runLimit: number, scopes: ActivityScope[], signal: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const ticket: Ticket = { runId, runLimit, scopes, resolve, reject, signal, abort: () => { this.tickets = this.tickets.filter(entry => entry !== ticket); reject(new Error("Activity admission canceled")); this.drain(); } };
      if (signal.aborted) { ticket.abort(); return; }
      signal.addEventListener("abort", ticket.abort, { once: true }); this.tickets.push(ticket); this.drain();
    });
  }
  private drain(): void {
    while (this.count < this.ownerLimit) {
      const eligible = this.tickets.filter(ticket => !ticket.signal.aborted && (this.active.get(ticket.runId) ?? 0) < ticket.runLimit && ticket.scopes.every(scope => (this.scopes.get(scope.id) ?? 0) < scope.limit));
      const ticket = eligible.find(entry => entry.runId !== this.lastRun) ?? eligible[0]; if (!ticket) return;
      this.tickets.splice(this.tickets.indexOf(ticket), 1); ticket.signal.removeEventListener("abort", ticket.abort);
      this.lastRun = ticket.runId; this.count++; this.active.set(ticket.runId, (this.active.get(ticket.runId) ?? 0) + 1);
      for (const scope of ticket.scopes) this.scopes.set(scope.id, (this.scopes.get(scope.id) ?? 0) + 1);
      let released = false;
      ticket.resolve(() => { if (released) return; released = true; this.count--; this.active.set(ticket.runId, this.active.get(ticket.runId)! - 1); for (const scope of ticket.scopes) this.scopes.set(scope.id, this.scopes.get(scope.id)! - 1); this.drain(); });
    }
  }
  snapshot(): { active: number; queued: number; ownerLimit: number } { return { active: this.count, queued: this.tickets.length, ownerLimit: this.ownerLimit }; }
}
