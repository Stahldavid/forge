import { readFile } from "node:fs/promises";
import { summarizeBenchmarkReport, compareBenchmarkReports } from "../src/forge/agent-fabric/program-benchmark.ts";
const path = process.argv[2];
if (!path) throw new Error("Usage: node --import tsx scripts/summarize-fabric-benchmark.mjs REPORT.json [COUNTERPART.json]");
const report = JSON.parse(await readFile(path, "utf8"));
console.log(JSON.stringify(process.argv[3] ? compareBenchmarkReports(report, JSON.parse(await readFile(process.argv[3], "utf8"))) : summarizeBenchmarkReport(report), null, 2));
