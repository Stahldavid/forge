import { randomBytes } from "node:crypto";

export type DeltaIdPrefix =
  | "actor"
  | "sess"
  | "op"
  | "txn"
  | "filechg"
  | "cmdrun"
  | "proof"
  | "rtcall"
  | "artifact"
  | "gitmap";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(time: number): string {
  let value = BigInt(time);
  let output = "";
  for (let index = 0; index < 10; index++) {
    output = CROCKFORD[Number(value % 32n)] + output;
    value = value / 32n;
  }
  return output;
}

function encodeRandom(bytes: Uint8Array): string {
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let output = "";
  for (let index = 0; index < 16; index++) {
    output = CROCKFORD[Number(value % 32n)] + output;
    value = value / 32n;
  }
  return output;
}

export function createDeltaId(prefix: DeltaIdPrefix): string {
  return `${prefix}_${encodeTime(Date.now())}${encodeRandom(randomBytes(10))}`;
}

