import { join } from "node:path";
import { ProgramFileLease } from "./program-lock.ts";

/** Owner and transactions use the same crash-recoverable admission protocol. */
export class ProgramOwnerLease {
  private constructor(private lease: ProgramFileLease) {}
  get path(): string { return this.lease.path; }
  get epoch(): string { return this.lease.token; }
  static async acquire(directory: string): Promise<ProgramOwnerLease> {
    return new ProgramOwnerLease(await ProgramFileLease.acquire(join(directory, "owner.lock"), {
      busyCode: "AF_PROGRAM_OWNER_BUSY", busyMessage: "Another program owner is active or reclaiming", lostMessage: "Owner admission lease lost",
    }));
  }
  async assert(): Promise<void> { await this.lease.assert(); }
  async close(): Promise<void> { await this.lease.close(); }
}
