import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const source = readFileSync(process.argv[2] ?? "migrate.workflow.ts", "utf8");
writeFileSync(process.argv[3] ?? "start.json", JSON.stringify({ requestId: randomUUID(), source, input: {} }, null, 2));
