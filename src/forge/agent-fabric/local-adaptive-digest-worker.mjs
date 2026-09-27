// Fixed data-only worker. This file deliberately has no Forge imports, tools,
// filesystem access, or network calls. The coordinator verifies its output.
import { createHash } from "node:crypto";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  if (Buffer.byteLength(input, "utf8") > 1_024) process.exit(2);
});
process.stdin.on("end", () => {
  try {
    const message = JSON.parse(input);
    if (!message || Object.keys(message).sort().join(",") !== "input,role" ||
        !["inventory", "constraints"].includes(message.role) ||
        typeof message.input !== "string" || message.input.length > 256) {
      process.exitCode = 2;
      return;
    }
    const canonical = JSON.stringify({ input: message.input, role: message.role });
    const resultDigest = `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
    process.stdout.write(JSON.stringify({ pid: process.pid, role: message.role, resultDigest }));
  } catch {
    process.exitCode = 2;
  }
});
