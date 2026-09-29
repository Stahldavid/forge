import { register } from "tsx/esm/api";

register();
const { runDeltaBroker } = await import("./broker.ts");
await runDeltaBroker(process.argv[2]);
