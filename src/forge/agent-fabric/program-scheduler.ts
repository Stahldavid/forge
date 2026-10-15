import { programAssert } from "./program-contract.ts";

export interface ActivityScope { id: string; limit: number }
interface Ticket { runId: string; runLimit: number; scopes: ActivityScope[]; resolve: (release: () => void) => void; reject: (error: Error) => void; signal: AbortSignal; abort: () => void }
/** Round robin between eligible runs; parent controls never hold activity capacity. */
export class ProgramActivityScheduler {
  private tickets: Ticket[] = [];
  private active = new Map<string, number>();
  private scopes = new Map<string, number>();
  private count = 0;
  private runOrder: string[] = [];
  private cursor = 0;
  private capacity: number;
  get ownerLimit(): number { return this.capacity; }
  constructor(ownerLimit = 4) { programAssert(Number.isSafeInteger(ownerLimit) && ownerLimit > 0 && ownerLimit <= 32, "Invalid owner capacity"); this.capacity = ownerLimit; }
  setOwnerCapacity(ownerLimit: number): void {
    programAssert(Number.isSafeInteger(ownerLimit) && ownerLimit > 0 && ownerLimit <= 32, "Invalid owner capacity");
    this.capacity = ownerLimit; this.drain();
  }
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
      signal.addEventListener("abort", ticket.abort, { once: true }); this.tickets.push(ticket);
      if (!this.runOrder.includes(runId)) this.runOrder.push(runId);
      this.drain();
    });
  }
  private drain(): void {
    while (this.count < this.ownerLimit) {
      const eligible = this.tickets.filter(ticket => !ticket.signal.aborted && (this.active.get(ticket.runId) ?? 0) < ticket.runLimit && ticket.scopes.every(scope => (this.scopes.get(scope.id) ?? 0) < scope.limit));
      let ticket: Ticket | undefined;
      for (let offset = 0; offset < this.runOrder.length; offset++) {
        const index = (this.cursor + offset) % this.runOrder.length;
        ticket = eligible.find(entry => entry.runId === this.runOrder[index]);
        // Keep the next ordinal unwrapped: newly queued runs after a lone run
        // must get their turn before the previously admitted run repeats.
        if (ticket) { this.cursor = index + 1; break; }
      }
      if (!ticket) return;
      this.tickets.splice(this.tickets.indexOf(ticket), 1); ticket.signal.removeEventListener("abort", ticket.abort);
      this.count++; this.active.set(ticket.runId, (this.active.get(ticket.runId) ?? 0) + 1);
      for (const scope of ticket.scopes) this.scopes.set(scope.id, (this.scopes.get(scope.id) ?? 0) + 1);
      let released = false;
      ticket.resolve(() => { if (released) return; released = true; this.count--; this.active.set(ticket.runId, this.active.get(ticket.runId)! - 1); for (const scope of ticket.scopes) this.scopes.set(scope.id, this.scopes.get(scope.id)! - 1); this.drain(); });
    }
  }
  snapshot(): { active: number; queued: number; ownerLimit: number; runs: { runId: string; active: number; queued: number }[] } {
    return { active: this.count, queued: this.tickets.length, ownerLimit: this.ownerLimit, runs: [...new Set([...this.active.keys(), ...this.tickets.map(ticket => ticket.runId)])].map(runId => ({ runId, active: this.active.get(runId) ?? 0, queued: this.tickets.filter(ticket => ticket.runId === runId).length })) };
  }
}
